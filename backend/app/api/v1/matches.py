"""Match setup, lifecycle, and the scorer's view of the scorecard."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import joinedload, selectinload

from app.api.deps import CurrentUser, PaginationDep, SessionDep, authorise_match
from app.core.errors import Conflict, NotFound
from app.core.rate_limit import write_rate_limit
from app.models.enums import CollaboratorRole, InningsEndReason, MatchResultType, MatchStatus
from app.models.match import Delivery, DeliveryRevision, Innings, Match, MatchCollaborator
from app.schemas.common import Message
from app.schemas.match import (
    CollaboratorInvite,
    InningsClose,
    InningsCreate,
    MatchCompleteRequest,
    MatchCreate,
    MatchListItem,
    MatchUpdate,
    SquadUpdate,
)
from app.services import match_service, scoring_service, stream_session_service
from app.services.match_query import build_snapshot, load_match, load_snapshot
from app.schemas.stream import StreamDestinationUpdate, StreamSessionCreate

router = APIRouter(prefix="/matches", tags=["matches"])


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(write_rate_limit)],
    summary="Create a match",
    response_model=None,
)
async def create_match(
    payload: MatchCreate, request: Request, session: SessionDep, user: CurrentUser
) -> dict[str, Any]:
    match = await match_service.create_match(session, user, payload, request=request)
    await session.commit()
    snapshot = await load_snapshot(session, match_id=match.id)
    return snapshot.to_dict()


@router.get("", response_model=list[MatchListItem], summary="List matches I can score")
async def list_matches(
    session: SessionDep,
    user: CurrentUser,
    pagination: PaginationDep,
    match_status: MatchStatus | None = Query(default=None, alias="status"),
    tournament_id: uuid.UUID | None = None,
) -> list[MatchListItem]:
    collaborating = select(MatchCollaborator.match_id).where(MatchCollaborator.user_id == user.id)
    stmt = (
        select(Match)
        .options(
            joinedload(Match.team_a),
            joinedload(Match.team_b),
            selectinload(Match.innings).selectinload(Innings.summary),
        )
        .where(
            Match.deleted_at.is_(None),
            or_(Match.created_by_user_id == user.id, Match.id.in_(collaborating)),
        )
        .order_by(Match.created_at.desc())
        .limit(pagination.limit)
        .offset(pagination.offset)
    )
    if match_status is not None:
        stmt = stmt.where(Match.status == match_status)
    if tournament_id is not None:
        stmt = stmt.where(Match.tournament_id == tournament_id)

    matches = list((await session.execute(stmt)).unique().scalars())
    return [
        MatchListItem.model_validate(match_service.list_item_payload(m, _score_line(m)))
        for m in matches
    ]


@router.get("/{match_id}", summary="Full scorecard for a scorer", response_model=None)
async def get_match(match_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> dict[str, Any]:
    await authorise_match(session, match_id, user, write=False)
    snapshot = await load_snapshot(session, match_id=match_id)
    return snapshot.to_dict()


@router.get("/{match_id}/state", summary="Compact live state", response_model=None)
async def get_match_state(
    match_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> dict[str, Any]:
    await authorise_match(session, match_id, user, write=False)
    snapshot = await load_snapshot(session, match_id=match_id)
    return snapshot.compact()


@router.patch("/{match_id}", summary="Update match details, rules or toss", response_model=None)
async def update_match(
    match_id: uuid.UUID,
    payload: MatchUpdate,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
) -> dict[str, Any]:
    await authorise_match(session, match_id, user, write=True)
    match = await load_match(session, match_id=match_id)
    await match_service.update_match(session, match, payload, actor=user, request=request)
    await session.commit()
    snapshot = await build_snapshot(session, match)
    await scoring_service.publish(snapshot)
    return snapshot.to_dict()


@router.delete("/{match_id}", response_model=Message, summary="Delete a match")
async def delete_match(
    match_id: uuid.UUID, request: Request, session: SessionDep, user: CurrentUser
) -> Message:
    await authorise_match(session, match_id, user, write=True)
    match = await load_match(session, match_id=match_id)
    if match.created_by_user_id != user.id and not user.is_admin:
        raise Conflict("Only the match owner can delete it.", code="owner_only")
    await match_service.soft_delete_match(session, match, actor=user, request=request)
    await session.commit()
    return Message(message="Match deleted.")


@router.put("/{match_id}/squad", summary="Replace one side's squad", response_model=None)
async def replace_squad(
    match_id: uuid.UUID, payload: SquadUpdate, session: SessionDep, user: CurrentUser
) -> dict[str, Any]:
    await authorise_match(session, match_id, user, write=True)
    match = await load_match(session, match_id=match_id)
    await match_service.replace_squad(session, match, payload.team_id, payload.players)
    await session.commit()
    snapshot = await load_snapshot(session, match_id=match_id)
    return snapshot.to_dict()


@router.post(
    "/{match_id}/innings",
    status_code=status.HTTP_201_CREATED,
    summary="Start an innings",
    response_model=None,
)
async def start_innings(
    match_id: uuid.UUID,
    payload: InningsCreate,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
) -> dict[str, Any]:
    await authorise_match(session, match_id, user, write=True)
    match = await load_match(session, match_id=match_id)
    await match_service.start_innings(session, match, payload, actor=user, request=request)
    await session.commit()
    snapshot = await build_snapshot(session, match)
    await scoring_service.publish(snapshot)
    return snapshot.to_dict()


@router.post(
    "/{match_id}/innings/{innings_id}/close",
    summary="Close an innings early (declaration, rain, forfeit)",
    response_model=None,
)
async def close_innings(
    match_id: uuid.UUID,
    innings_id: uuid.UUID,
    payload: InningsClose,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
) -> dict[str, Any]:
    await authorise_match(session, match_id, user, write=True)
    outcome = await scoring_service.close_innings_now(
        session,
        match_id=match_id,
        innings_id=innings_id,
        end_reason=payload.end_reason,
        actor=user,
        request=request,
    )
    return outcome.snapshot.to_dict()


@router.post(
    "/{match_id}/innings/{innings_id}/revise",
    summary="Revise an innings for rain (overs and DLS target)",
    response_model=None,
)
async def revise_innings(
    match_id: uuid.UUID,
    innings_id: uuid.UUID,
    session: SessionDep,
    user: CurrentUser,
    overs_limit: int | None = Query(default=None, ge=1, le=200),
    target_runs: int | None = Query(default=None, ge=1, le=2000),
) -> dict[str, Any]:
    await authorise_match(session, match_id, user, write=True)
    match = await load_match(session, match_id=match_id)
    innings = next((i for i in match.innings if i.id == innings_id), None)
    if innings is None:
        raise NotFound("That innings does not belong to this match.", code="innings_not_found")
    if overs_limit is not None:
        innings.overs_limit = overs_limit
    if target_runs is not None:
        innings.target_runs = target_runs
    await session.commit()
    return (
        await scoring_service.rebuild_projections(session, match_id=match_id, actor=user)
    ).to_dict()


@router.post("/{match_id}/abandon", summary="Abandon a match", response_model=None)
async def abandon_match(
    match_id: uuid.UUID,
    payload: MatchCompleteRequest,
    session: SessionDep,
    user: CurrentUser,
) -> dict[str, Any]:
    await authorise_match(session, match_id, user, write=True)
    match = await load_match(session, match_id=match_id)
    match.status = MatchStatus.ABANDONED
    match.result_type = payload.result_type or MatchResultType.ABANDONED
    match.result_summary = payload.result_summary or "Match abandoned"
    match.state_version += 1
    for innings in match.innings:
        if innings.end_reason is None and innings.status.value != "completed":
            innings.end_reason = InningsEndReason.RAIN
    await session.commit()
    snapshot = await load_snapshot(session, match_id=match_id)
    await scoring_service.publish(snapshot)
    return snapshot.to_dict()


@router.post(
    "/{match_id}/rebuild",
    summary="Rebuild every derived figure from the delivery log",
    response_model=None,
)
async def rebuild(match_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> dict[str, Any]:
    await authorise_match(session, match_id, user, write=True)
    snapshot = await scoring_service.rebuild_projections(session, match_id=match_id, actor=user)
    return snapshot.to_dict()


@router.post(
    "/{match_id}/collaborators",
    status_code=status.HTTP_201_CREATED,
    response_model=Message,
    summary="Let someone else score this match",
)
async def add_collaborator(
    match_id: uuid.UUID,
    payload: CollaboratorInvite,
    session: SessionDep,
    user: CurrentUser,
) -> Message:
    await authorise_match(session, match_id, user, write=True)
    match = await load_match(session, match_id=match_id)
    if match.created_by_user_id != user.id and not user.is_admin:
        raise Conflict("Only the match owner can add scorers.", code="owner_only")
    await match_service.add_collaborator(
        session, match, email=payload.email, role=payload.role, invited_by=user
    )
    await session.commit()
    verb = "score" if payload.role is CollaboratorRole.SCORER else "view"
    return Message(message=f"They can now {verb} this match.")


@router.get("/{match_id}/deliveries", summary="The raw delivery log", response_model=None)
async def list_deliveries(
    match_id: uuid.UUID,
    session: SessionDep,
    user: CurrentUser,
    pagination: PaginationDep,
    innings_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    await authorise_match(session, match_id, user, write=False)
    innings_ids = select(Innings.id).where(Innings.match_id == match_id)
    stmt = (
        select(Delivery)
        .where(Delivery.innings_id.in_(innings_ids))
        .order_by(Delivery.innings_id, Delivery.sequence)
        .limit(pagination.limit)
        .offset(pagination.offset)
    )
    if innings_id is not None:
        stmt = stmt.where(Delivery.innings_id == innings_id)
    rows = list((await session.execute(stmt)).scalars())
    total = (
        await session.execute(
            select(func.count()).select_from(Delivery).where(Delivery.innings_id.in_(innings_ids))
        )
    ).scalar_one()
    return {
        "items": [
            {
                "id": str(d.id),
                "innings_id": str(d.innings_id),
                "sequence": d.sequence,
                "striker_id": str(d.striker_id),
                "non_striker_id": str(d.non_striker_id),
                "bowler_id": str(d.bowler_id),
                "batter_runs": d.batter_runs,
                "extra_type": d.extra_type.value if d.extra_type else None,
                "extra_runs": d.extra_runs,
                "is_boundary": d.is_boundary,
                "batters_crossed": d.batters_crossed,
                "is_wicket": d.is_wicket,
                "wicket_type": d.wicket_type.value if d.wicket_type else None,
                "dismissed_player_id": str(d.dismissed_player_id)
                if d.dismissed_player_id
                else None,
                "fielder_id": str(d.fielder_id) if d.fielder_id else None,
                "commentary": d.commentary,
                "revision": d.revision,
                "created_at": d.created_at,
            }
            for d in rows
        ],
        "total": total,
        "limit": pagination.limit,
        "offset": pagination.offset,
        "has_more": pagination.offset + len(rows) < total,
    }


@router.get("/{match_id}/revisions", summary="Correction log for this match", response_model=None)
async def list_revisions(
    match_id: uuid.UUID, session: SessionDep, user: CurrentUser, pagination: PaginationDep
) -> dict[str, Any]:
    await authorise_match(session, match_id, user, write=False)
    innings_ids = select(Innings.id).where(Innings.match_id == match_id)
    rows = list(
        (
            await session.execute(
                select(DeliveryRevision)
                .where(DeliveryRevision.innings_id.in_(innings_ids))
                .order_by(DeliveryRevision.created_at.desc())
                .limit(pagination.limit)
                .offset(pagination.offset)
            )
        ).scalars()
    )
    return {
        "items": [
            {
                "id": str(r.id),
                "delivery_id": str(r.delivery_id),
                "innings_id": str(r.innings_id),
                "revision": r.revision,
                "change_kind": r.change_kind,
                "previous_state": r.previous_state,
                "new_state": r.new_state,
                "reason": r.reason,
                "changed_by_user_id": str(r.changed_by_user_id) if r.changed_by_user_id else None,
                "created_at": r.created_at,
            }
            for r in rows
        ],
        "limit": pagination.limit,
        "offset": pagination.offset,
    }


def _score_line(match: Match) -> str | None:
    """`180/6 (20.0) v 150/8 (19.2)` for list views, straight from the projection."""
    parts: list[str] = []
    for innings in sorted(match.innings, key=lambda i: i.sequence):
        summary = innings.summary
        if summary is None:
            continue
        parts.append(f"{summary.total_runs}/{summary.total_wickets} ({summary.overs_text})")
    if not parts:
        return None
    return " v ".join(parts)


# --------------------------------------------------------------- stream sessions


async def _session_payload(
    session: SessionDep, row: Any, *, stream_key: str | None = None
) -> dict[str, Any]:
    from app.models.match import Match

    payload = stream_session_service.session_to_dict(row, stream_key=stream_key)
    slug = (
        await session.execute(select(Match.public_slug).where(Match.id == row.match_id).limit(1))
    ).scalar_one_or_none()
    if slug:
        stream_session_service.attach_camera_url(payload, slug)
    return payload


@router.post(
    "/{match_id}/stream-sessions",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(write_rate_limit)],
    summary="Create a stream session",
    response_model=None,
)
async def create_stream_session(
    match_id: uuid.UUID,
    payload: StreamSessionCreate,
    session: SessionDep,
    user: CurrentUser,
) -> dict[str, Any]:
    row, stream_key = await stream_session_service.create_session(
        session, user, match_id, payload
    )
    await session.commit()
    return await _session_payload(session, row, stream_key=stream_key)


@router.post(
    "/{match_id}/stream-sessions/ensure",
    dependencies=[Depends(write_rate_limit)],
    summary="Ensure an active stream session (for Go Live QR)",
    response_model=None,
)
async def ensure_stream_session(
    match_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> dict[str, Any]:
    row, stream_key = await stream_session_service.ensure_session(session, user, match_id)
    await session.commit()
    return await _session_payload(session, row, stream_key=stream_key)


@router.get(
    "/{match_id}/stream-sessions/active",
    summary="Get the active stream session",
    response_model=None,
)
async def get_active_stream_session(
    match_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> dict[str, Any]:
    row = await stream_session_service.get_session_for_match(session, user, match_id)
    return await _session_payload(session, row)


@router.patch(
    "/{match_id}/stream-sessions/active",
    summary="Update stream destinations",
    response_model=None,
)
async def update_stream_destinations(
    match_id: uuid.UUID,
    payload: StreamDestinationUpdate,
    session: SessionDep,
    user: CurrentUser,
) -> dict[str, Any]:
    row, stream_key = await stream_session_service.update_destinations(
        session, user, match_id, payload
    )
    await session.commit()
    return await _session_payload(session, row, stream_key=stream_key)


@router.post(
    "/{match_id}/stream-sessions/active/go-live",
    summary="Mark the stream session live",
    response_model=None,
)
async def go_live_stream_session(
    match_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> dict[str, Any]:
    row = await stream_session_service.go_live(session, user, match_id)
    await session.commit()
    return await _session_payload(session, row)


@router.post(
    "/{match_id}/stream-sessions/active/end",
    summary="End the active stream session",
    response_model=None,
)
async def end_stream_session(
    match_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> dict[str, Any]:
    row = await stream_session_service.end_session(session, user, match_id)
    await session.commit()
    return await _session_payload(session, row)


@router.head("/{match_id}", include_in_schema=False)
async def head_match(match_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> Response:
    await authorise_match(session, match_id, user, write=False)
    version = (
        await session.execute(select(Match.state_version).where(Match.id == match_id).limit(1))
    ).scalar_one_or_none()
    if version is None:
        raise NotFound("That match does not exist.", code="match_not_found")
    return Response(status_code=204, headers={"ETag": f'W/"{version}"'})
