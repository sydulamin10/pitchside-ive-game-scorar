"""The scoring write path.

Every mutation follows the same shape:

1. Take a row lock on the match, so two scorers on two phones cannot interleave.
2. Load the delivery log and replay it — the state we validate against is always
   derived, never read from a counter that might have drifted.
3. Validate the change against the laws of cricket.
4. Persist the change, then **replay again** and rewrite the derived projections
   (innings summary, innings/match status, result).
5. Commit, then push the fresh scorecard to the cache and the realtime feed.

Because step 2 and step 4 both replay from scratch, correcting a ball from an
hour ago fixes every downstream number automatically — including the chase target
of the following innings, which is itself derived from the first innings total.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import set_committed_value

from app.core.errors import Conflict, NotFound, RuleViolation, VersionConflict
from app.core.logging import get_logger
from app.core.metrics import DELIVERIES
from app.models.enums import (
    AuditAction,
    InningsEndReason,
    InningsStatus,
    MatchFormat,
    MatchResultType,
    MatchStatus,
)
from app.models.match import Delivery, DeliveryRevision, Innings, InningsSummary, Match
from app.models.user import User
from app.realtime.broker import broker, channel_for_match
from app.realtime.events import EventType, envelope
from app.schemas.scoring import (
    DeliveryBatch,
    DeliveryCreate,
    DeliveryRejection,
    DeliveryUpdate,
)
from app.scoring import DeliveryEvent, build_innings_state, replay, validate_delivery
from app.services import audit_service, state_cache
from app.services.match_query import (
    InningsSnapshot,
    MatchSnapshot,
    build_snapshot,
    load_match,
)

logger = get_logger(__name__)

#: Endings the engine derives, and can therefore also un-derive after a
#: correction. Anything else was a human decision and is never undone silently.
AUTO_END_REASONS = frozenset(
    {
        InningsEndReason.OVERS_COMPLETE,
        InningsEndReason.ALL_OUT,
        InningsEndReason.TARGET_REACHED,
    }
)


@dataclass(slots=True)
class ScoringOutcome:
    snapshot: MatchSnapshot
    delivery_id: uuid.UUID | None = None
    accepted: int = 0
    duplicates: int = 0
    rejected: list[DeliveryRejection] = field(default_factory=list)

    @property
    def state_version(self) -> int:
        return self.snapshot.match.state_version


# ------------------------------------------------------------------ public API


async def record_delivery(
    session: AsyncSession,
    *,
    match_id: uuid.UUID,
    innings_id: uuid.UUID | None,
    payload: DeliveryCreate,
    actor: User,
    request: Request | None = None,
) -> ScoringOutcome:
    await _lock_match(session, match_id)
    match = await load_match(session, match_id=match_id)
    _check_version(match, payload.expected_state_version)
    innings = _require_open_innings(match, innings_id)

    snapshot = await build_snapshot(session, match)
    innings_snapshot = snapshot.innings_by_id(innings.id)
    assert innings_snapshot is not None

    duplicate = _find_duplicate(innings, payload.client_event_id)
    if duplicate is not None:
        # Offline replay or a network retry: nothing to do, and the client gets
        # the same answer it would have got the first time.
        return ScoringOutcome(snapshot=snapshot, delivery_id=duplicate.id, duplicates=1)

    delivery = await _append_delivery(
        session, match, innings, innings_snapshot, payload, actor=actor
    )
    snapshot = await _finalise(session, match, actor=actor, request=request)
    await audit_service.record(
        session,
        AuditAction.DELIVERY_RECORDED,
        actor_user_id=actor.id,
        entity_type="delivery",
        entity_id=delivery.id,
        context={"match_id": str(match.id), "sequence": delivery.sequence},
        request=request,
    )
    await session.commit()
    await publish(snapshot)
    DELIVERIES.inc()
    return ScoringOutcome(snapshot=snapshot, delivery_id=delivery.id, accepted=1)


async def record_batch(
    session: AsyncSession,
    *,
    match_id: uuid.UUID,
    innings_id: uuid.UUID | None,
    payload: DeliveryBatch,
    actor: User,
    request: Request | None = None,
) -> ScoringOutcome:
    """Drain an offline queue in order.

    Balls already present (matched on ``client_event_id``) are skipped, so a
    partially-synced queue can be replayed safely from the beginning.
    """
    await _lock_match(session, match_id)
    match = await load_match(session, match_id=match_id)
    innings = _require_open_innings(match, innings_id)

    accepted = 0
    duplicates = 0
    rejected: list[DeliveryRejection] = []
    last_delivery_id: uuid.UUID | None = None

    for index, item in enumerate(payload.deliveries):
        if _find_duplicate(innings, item.client_event_id) is not None:
            duplicates += 1
            continue
        snapshot = await build_snapshot(session, match)
        innings_snapshot = snapshot.innings_by_id(innings.id)
        assert innings_snapshot is not None
        try:
            delivery = await _append_delivery(
                session, match, innings, innings_snapshot, item, actor=actor
            )
        except RuleViolation as exc:
            rejected.append(
                DeliveryRejection(
                    client_event_id=item.client_event_id,
                    index=index,
                    code=exc.code,
                    message=exc.message,
                )
            )
            if payload.stop_on_error:
                break
            continue
        accepted += 1
        last_delivery_id = delivery.id

    snapshot = await _finalise(session, match, actor=actor, request=request)
    if accepted:
        await audit_service.record(
            session,
            AuditAction.DELIVERY_RECORDED,
            actor_user_id=actor.id,
            entity_type="match",
            entity_id=match.id,
            context={"batch": True, "accepted": accepted, "duplicates": duplicates},
            request=request,
        )
    await session.commit()
    if accepted:
        await publish(snapshot)
        DELIVERIES.inc(accepted)
    return ScoringOutcome(
        snapshot=snapshot,
        delivery_id=last_delivery_id,
        accepted=accepted,
        duplicates=duplicates,
        rejected=rejected,
    )


async def edit_delivery(
    session: AsyncSession,
    *,
    match_id: uuid.UUID,
    delivery_id: uuid.UUID,
    payload: DeliveryUpdate,
    actor: User,
    request: Request | None = None,
) -> ScoringOutcome:
    await _lock_match(session, match_id)
    match = await load_match(session, match_id=match_id)
    _check_version(match, payload.expected_state_version)
    innings, delivery = _find_delivery(match, delivery_id)

    snapshot = await build_snapshot(session, match)
    innings_snapshot = snapshot.innings_by_id(innings.id)
    assert innings_snapshot is not None

    previous_state = _delivery_dict(delivery)
    _apply_update(delivery, payload)
    edited_event = _model_to_event(delivery)

    # Validate against the state as it stood *before* this ball, so the check is
    # about whether this ball could have been bowled at that moment.
    prefix = [e for e in innings_snapshot.events if e.sequence < delivery.sequence]
    prefix_state = build_innings_state(
        innings_snapshot.rules,
        innings_snapshot.batting_refs,
        innings_snapshot.bowling_refs,
        prefix,
    )
    # A correction may well be to a ball that came after the innings had already
    # (accidentally) ended, so completion is not a reason to refuse the edit.
    prefix_state.is_complete = False
    prefix_state.end_reason = None
    validate_delivery(
        prefix_state,
        edited_event,
        innings_snapshot.rules,
        innings_snapshot.batting_refs,
        innings_snapshot.bowling_refs,
    )

    delivery.revision += 1
    session.add(
        DeliveryRevision(
            delivery_id=delivery.id,
            innings_id=innings.id,
            revision=delivery.revision,
            change_kind="edit",
            previous_state=previous_state,
            new_state=_delivery_dict(delivery),
            reason=payload.reason,
            changed_by_user_id=actor.id,
        )
    )
    await session.flush()

    snapshot = await _finalise(session, match, actor=actor, request=request)
    await audit_service.record(
        session,
        AuditAction.DELIVERY_EDITED,
        actor_user_id=actor.id,
        entity_type="delivery",
        entity_id=delivery.id,
        context={"match_id": str(match.id), "reason": payload.reason},
        request=request,
    )
    await session.commit()
    await publish(snapshot)
    return ScoringOutcome(snapshot=snapshot, delivery_id=delivery.id, accepted=1)


async def delete_delivery(
    session: AsyncSession,
    *,
    match_id: uuid.UUID,
    delivery_id: uuid.UUID,
    reason: str | None,
    actor: User,
    request: Request | None = None,
    expected_state_version: int | None = None,
) -> ScoringOutcome:
    await _lock_match(session, match_id)
    match = await load_match(session, match_id=match_id)
    _check_version(match, expected_state_version)
    innings, delivery = _find_delivery(match, delivery_id)

    session.add(
        DeliveryRevision(
            delivery_id=delivery.id,
            innings_id=innings.id,
            revision=delivery.revision + 1,
            change_kind="delete",
            previous_state=_delivery_dict(delivery),
            new_state=None,
            reason=reason,
            changed_by_user_id=actor.id,
        )
    )
    innings.deliveries.remove(delivery)
    await session.delete(delivery)
    await session.flush()

    snapshot = await _finalise(session, match, actor=actor, request=request)
    await audit_service.record(
        session,
        AuditAction.DELIVERY_DELETED,
        actor_user_id=actor.id,
        entity_type="delivery",
        entity_id=delivery_id,
        context={"match_id": str(match.id), "reason": reason},
        request=request,
    )
    await session.commit()
    await publish(snapshot)
    return ScoringOutcome(snapshot=snapshot, delivery_id=None, accepted=1)


async def undo_last_delivery(
    session: AsyncSession,
    *,
    match_id: uuid.UUID,
    innings_id: uuid.UUID | None,
    actor: User,
    request: Request | None = None,
) -> ScoringOutcome:
    match = await load_match(session, match_id=match_id)
    innings = _resolve_innings(match, innings_id)
    if not innings.deliveries:
        raise Conflict("There is nothing to undo in this innings.", code="nothing_to_undo")
    last = max(innings.deliveries, key=lambda d: d.sequence)
    return await delete_delivery(
        session,
        match_id=match_id,
        delivery_id=last.id,
        reason="undo",
        actor=actor,
        request=request,
    )


async def close_innings_now(
    session: AsyncSession,
    *,
    match_id: uuid.UUID,
    innings_id: uuid.UUID,
    end_reason: InningsEndReason,
    actor: User,
    request: Request | None = None,
) -> ScoringOutcome:
    await _lock_match(session, match_id)
    match = await load_match(session, match_id=match_id)
    innings = _resolve_innings(match, innings_id)
    if innings.status is InningsStatus.COMPLETED:
        raise Conflict("That innings is already closed.", code="innings_closed")
    innings.status = InningsStatus.COMPLETED
    innings.end_reason = end_reason
    innings.completed_at = datetime.now(UTC)
    snapshot = await _finalise(
        session, match, actor=actor, request=request, force_closed=innings.id
    )
    await session.commit()
    await publish(snapshot, event_type=EventType.INNINGS_CHANGED)
    return ScoringOutcome(snapshot=snapshot, accepted=1)


async def rebuild_projections(
    session: AsyncSession, *, match_id: uuid.UUID, actor: User | None = None
) -> MatchSnapshot:
    """Rebuild every derived row for a match straight from the delivery log.

    An operational escape hatch: if a projection is ever suspected of drifting,
    this makes the log the winner again without touching the log itself.
    """
    await _lock_match(session, match_id)
    match = await load_match(session, match_id=match_id)
    snapshot = await _finalise(session, match, actor=actor)
    await session.commit()
    await publish(snapshot)
    logger.info("match_projections_rebuilt", match_id=str(match_id))
    return snapshot


async def publish(
    snapshot: MatchSnapshot, *, event_type: EventType = EventType.SCORE_UPDATE
) -> None:
    """Refresh the read cache and push a frame to every connected viewer."""
    match = snapshot.match
    compact = snapshot.compact()
    await state_cache.put_scorecard(match.public_slug, snapshot.to_dict())
    await state_cache.put_compact(match.public_slug, compact)
    await broker.publish(
        channel_for_match(str(match.id)),
        envelope(
            event_type,
            match_id=str(match.id),
            state_version=match.state_version,
            data=compact,
        ),
    )


# -------------------------------------------------------------------- internals


async def _lock_match(session: AsyncSession, match_id: uuid.UUID) -> None:
    """Serialise writes for one match without locking anything else.

    Two scorers with flaky connections both tapping "4" is a real scenario; this
    turns it into two ordered appends instead of a corrupted over.
    """
    locked = (
        await session.execute(
            select(Match.id)
            .where(Match.id == match_id, Match.deleted_at.is_(None))
            .with_for_update()
        )
    ).scalar_one_or_none()
    if locked is None:
        raise NotFound("That match does not exist.", code="match_not_found")


def _check_version(match: Match, expected: int | None) -> None:
    if expected is not None and expected != match.state_version:
        raise VersionConflict(
            details={"expected": expected, "actual": match.state_version},
        )


def _resolve_innings(match: Match, innings_id: uuid.UUID | None) -> Innings:
    if innings_id is not None:
        innings = next((i for i in match.innings if i.id == innings_id), None)
        if innings is None:
            raise NotFound("That innings does not belong to this match.", code="innings_not_found")
        return innings
    open_innings = next((i for i in match.innings if i.status is InningsStatus.IN_PROGRESS), None)
    if open_innings is None:
        if not match.innings:
            raise Conflict(
                "No innings has been started yet. Start an innings first.",
                code="no_innings",
            )
        return max(match.innings, key=lambda i: i.sequence)
    return open_innings


def _require_open_innings(match: Match, innings_id: uuid.UUID | None) -> Innings:
    if match.status is MatchStatus.COMPLETED:
        raise Conflict(
            "This match is complete. Reopen it by deleting or editing a ball first.",
            code="match_completed",
        )
    if match.status is MatchStatus.ABANDONED:
        raise Conflict("This match was abandoned.", code="match_abandoned")
    innings = _resolve_innings(match, innings_id)
    if innings.status is InningsStatus.COMPLETED:
        raise Conflict(
            "That innings is closed. Start the next innings to continue scoring.",
            code="innings_closed",
            details={"innings_id": str(innings.id)},
        )
    return innings


def _find_duplicate(innings: Innings, client_event_id: uuid.UUID | None) -> Delivery | None:
    if client_event_id is None:
        return None
    return next((d for d in innings.deliveries if d.client_event_id == client_event_id), None)


def _find_delivery(match: Match, delivery_id: uuid.UUID) -> tuple[Innings, Delivery]:
    for innings in match.innings:
        for delivery in innings.deliveries:
            if delivery.id == delivery_id:
                return innings, delivery
    raise NotFound("That delivery is not part of this match.", code="delivery_not_found")


async def _append_delivery(
    session: AsyncSession,
    match: Match,
    innings: Innings,
    innings_snapshot: InningsSnapshot,
    payload: DeliveryCreate,
    *,
    actor: User,
) -> Delivery:
    state = innings_snapshot.state
    striker_id = payload.striker_id
    non_striker_id = payload.non_striker_id

    # Which end each batter stands at is a consequence of the previous ball, so
    # the replay wins over whatever the client believed.
    if (
        state.striker_id
        and state.non_striker_id
        and {str(striker_id), str(non_striker_id)} == {state.striker_id, state.non_striker_id}
    ):
        striker_id = uuid.UUID(state.striker_id)
        non_striker_id = uuid.UUID(state.non_striker_id)

    sequence = innings.next_delivery_seq
    event = DeliveryEvent(
        id=str(uuid.uuid4()),
        sequence=sequence,
        striker_id=str(striker_id),
        non_striker_id=str(non_striker_id),
        bowler_id=str(payload.bowler_id),
        batter_runs=payload.batter_runs,
        extra_type=payload.extra_type,
        extra_runs=payload.extra_runs,
        is_boundary=payload.is_boundary,
        batters_crossed=payload.batters_crossed,
        is_wicket=payload.is_wicket,
        wicket_type=payload.wicket_type,
        dismissed_player_id=str(payload.dismissed_player_id)
        if payload.dismissed_player_id
        else None,
        fielder_id=str(payload.fielder_id) if payload.fielder_id else None,
        replacement_batter_id=str(payload.replacement_batter_id)
        if payload.replacement_batter_id
        else None,
        commentary=payload.commentary,
    )
    validate_delivery(
        state,
        event,
        innings_snapshot.rules,
        innings_snapshot.batting_refs,
        innings_snapshot.bowling_refs,
    )

    delivery = Delivery(
        id=uuid.UUID(event.id),
        innings_id=innings.id,
        sequence=sequence,
        striker_id=striker_id,
        non_striker_id=non_striker_id,
        bowler_id=payload.bowler_id,
        batter_runs=payload.batter_runs,
        extra_type=payload.extra_type,
        extra_runs=payload.extra_runs,
        is_boundary=payload.is_boundary,
        batters_crossed=payload.batters_crossed,
        is_wicket=payload.is_wicket,
        wicket_type=payload.wicket_type,
        dismissed_player_id=payload.dismissed_player_id,
        fielder_id=payload.fielder_id,
        replacement_batter_id=payload.replacement_batter_id,
        commentary=payload.commentary,
        recorded_by_user_id=actor.id,
        client_event_id=payload.client_event_id,
        occurred_at=payload.occurred_at or datetime.now(UTC),
    )
    session.add(delivery)
    innings.deliveries.append(delivery)
    innings.next_delivery_seq = sequence + 1
    if innings.started_at is None:
        innings.started_at = datetime.now(UTC)
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise Conflict("That ball was already recorded.", code="duplicate_delivery") from exc
    return delivery


def _apply_update(delivery: Delivery, payload: DeliveryUpdate) -> None:
    if payload.striker_id is not None:
        delivery.striker_id = payload.striker_id
    if payload.non_striker_id is not None:
        delivery.non_striker_id = payload.non_striker_id
    if payload.bowler_id is not None:
        delivery.bowler_id = payload.bowler_id
    if payload.batter_runs is not None:
        delivery.batter_runs = payload.batter_runs
    if payload.clear_extra:
        delivery.extra_type = None
        delivery.extra_runs = 0
    elif payload.extra_type is not None:
        delivery.extra_type = payload.extra_type
    if payload.extra_runs is not None:
        delivery.extra_runs = payload.extra_runs
    if payload.is_boundary is not None:
        delivery.is_boundary = payload.is_boundary
    if payload.clear_batters_crossed:
        delivery.batters_crossed = None
    elif payload.batters_crossed is not None:
        delivery.batters_crossed = payload.batters_crossed
    if payload.is_wicket is not None:
        delivery.is_wicket = payload.is_wicket
        if not payload.is_wicket:
            delivery.wicket_type = None
            delivery.dismissed_player_id = None
            delivery.fielder_id = None
            delivery.replacement_batter_id = None
    if payload.wicket_type is not None:
        delivery.wicket_type = payload.wicket_type
        delivery.is_wicket = True
    if payload.dismissed_player_id is not None:
        delivery.dismissed_player_id = payload.dismissed_player_id
    if payload.fielder_id is not None:
        delivery.fielder_id = payload.fielder_id
    if payload.replacement_batter_id is not None:
        delivery.replacement_batter_id = payload.replacement_batter_id
    if payload.commentary is not None:
        delivery.commentary = payload.commentary

    if delivery.striker_id == delivery.non_striker_id:
        raise RuleViolation(
            "The striker and non-striker must be different players.", code="batters_identical"
        )


async def _finalise(
    session: AsyncSession,
    match: Match,
    *,
    actor: User | None,
    request: Request | None = None,
    force_closed: uuid.UUID | None = None,
) -> MatchSnapshot:
    """Replay everything, repair the log, and rewrite all derived rows."""
    snapshot = await build_snapshot(session, match)
    status_before = match.status

    for innings_snapshot in snapshot.innings:
        await _repair_strike_assignments(session, innings_snapshot)
        _write_summary(session, match, innings_snapshot)

    await _sync_statuses(session, snapshot, actor=actor, request=request, force_closed=force_closed)
    match.state_version += 1
    await session.flush()

    # Only touch the points table when the result itself changed — recomputing a
    # whole tournament on every ball would be pointless work.
    if match.tournament_id is not None and (
        match.status is MatchStatus.COMPLETED or status_before is MatchStatus.COMPLETED
    ):
        from app.services import tournament_service

        await tournament_service.on_match_result(session, match)
        if match.status is MatchStatus.COMPLETED:
            await audit_service.record(
                session,
                AuditAction.MATCH_COMPLETED,
                actor_user_id=actor.id if actor else None,
                entity_type="match",
                entity_id=match.id,
                context={"result": match.result_summary},
                request=request,
            )
        await session.flush()

    # Rebuild once more so the response (and the realtime frame) include any
    # innings that was just opened and the final match status.
    return await build_snapshot(session, match)


async def _repair_strike_assignments(
    session: AsyncSession, innings_snapshot: InningsSnapshot
) -> None:
    """Rewrite stored batter ends that an edit invalidated.

    Editing "ball 3 was a single, not a dot" flips who is on strike for every
    later ball in that over. The engine reports the corrections; we persist them
    so the log and the replay never disagree.
    """
    result = replay(
        innings_snapshot.rules,
        innings_snapshot.batting_refs,
        innings_snapshot.bowling_refs,
        innings_snapshot.events,
    )
    if not result.repairs:
        return
    by_id = {str(d.id): d for d in innings_snapshot.innings.deliveries}
    for repair in result.repairs:
        delivery = by_id.get(repair.delivery_id)
        if delivery is None:  # pragma: no cover - defensive
            continue
        delivery.striker_id = uuid.UUID(repair.striker_id)
        delivery.non_striker_id = uuid.UUID(repair.non_striker_id)
    logger.info(
        "strike_assignments_repaired",
        innings_id=str(innings_snapshot.innings.id),
        count=len(result.repairs),
    )
    await session.flush()


def _write_summary(session: AsyncSession, match: Match, snapshot: InningsSnapshot) -> None:
    innings = snapshot.innings
    state = snapshot.state
    summary = innings.summary
    if summary is None:
        summary = InningsSummary(innings_id=innings.id)
        session.add(summary)
        innings.summary = summary
    summary.match_id = match.id
    summary.batting_team_id = innings.batting_team_id
    summary.bowling_team_id = innings.bowling_team_id
    summary.total_runs = state.total_runs
    summary.total_wickets = state.wickets
    summary.legal_balls = state.legal_balls
    summary.overs_text = state.overs_text
    summary.nrr_overs = state.nrr_overs()
    summary.extras_wide = state.extras.wide
    summary.extras_no_ball = state.extras.no_ball
    summary.extras_bye = state.extras.bye
    summary.extras_leg_bye = state.extras.leg_bye
    summary.extras_penalty = state.extras.penalty
    summary.run_rate = state.run_rate
    summary.is_all_out = state.is_all_out
    summary.delivery_count = len(innings.deliveries)
    summary.computed_at = datetime.now(UTC)


async def _sync_statuses(
    session: AsyncSession,
    snapshot: MatchSnapshot,
    *,
    actor: User | None,
    request: Request | None,
    force_closed: uuid.UUID | None = None,
) -> None:
    match = snapshot.match
    now = datetime.now(UTC)

    for index, innings_snapshot in enumerate(snapshot.innings):
        innings = innings_snapshot.innings
        state = innings_snapshot.state
        later_has_balls = any(later.innings.deliveries for later in snapshot.innings[index + 1 :])

        if state.is_complete or innings.id == force_closed:
            if innings.status is not InningsStatus.COMPLETED:
                innings.status = InningsStatus.COMPLETED
                innings.end_reason = innings.end_reason or state.end_reason
                innings.completed_at = now
                await audit_service.record(
                    session,
                    AuditAction.INNINGS_CLOSED,
                    actor_user_id=actor.id if actor else None,
                    entity_type="innings",
                    entity_id=innings.id,
                    context={
                        "end_reason": (innings.end_reason.value if innings.end_reason else None)
                    },
                    request=request,
                )
        elif (
            innings.status is InningsStatus.COMPLETED
            and innings.end_reason in AUTO_END_REASONS
            and not later_has_balls
        ):
            # A correction pulled the innings back below its end condition. Only
            # automatic endings reopen: a declaration or an abandonment was a
            # human decision and stays put.
            innings.status = InningsStatus.IN_PROGRESS
            innings.end_reason = None
            innings.completed_at = None

    await _open_next_innings(session, snapshot)
    _apply_result(match, snapshot, now)


async def _open_next_innings(session: AsyncSession, snapshot: MatchSnapshot) -> None:
    """Start the chase automatically once the first innings closes."""
    match = snapshot.match
    if match.match_format is MatchFormat.TEST:
        return
    completed = [s for s in snapshot.innings if s.innings.status is InningsStatus.COMPLETED]
    if len(snapshot.innings) != 1 or not completed:
        return

    first = snapshot.innings[0].innings
    if first.is_super_over:
        return
    innings = Innings(
        match_id=match.id,
        sequence=2,
        batting_team_id=first.bowling_team_id,
        bowling_team_id=first.batting_team_id,
        status=InningsStatus.IN_PROGRESS,
        overs_limit=first.overs_limit,
        started_at=None,
    )
    session.add(innings)
    # Nothing may lazy-load on an async session, and this innings has no history.
    set_committed_value(innings, "deliveries", [])
    set_committed_value(innings, "summary", None)
    match.innings.append(innings)
    await session.flush()
    logger.info("second_innings_opened", match_id=str(match.id), innings_id=str(innings.id))


def _apply_result(match: Match, snapshot: MatchSnapshot, now: datetime) -> None:
    all_closed = len(snapshot.innings) >= 2 and all(
        s.innings.status is InningsStatus.COMPLETED for s in snapshot.innings
    )
    outcome = snapshot.outcome

    if all_closed and outcome.is_decided:
        match.status = MatchStatus.COMPLETED
        match.completed_at = match.completed_at or now
        match.result_type = outcome.result_type or MatchResultType.WIN
        match.winner_team_id = uuid.UUID(outcome.winner_team_id) if outcome.winner_team_id else None
        match.result_summary = outcome.summary
        match.win_margin_runs = outcome.margin_runs
        match.win_margin_wickets = outcome.margin_wickets
        return

    # Not decided (any more): make sure a reopened match looks live again.
    if match.status is MatchStatus.COMPLETED:
        match.status = MatchStatus.LIVE
        match.completed_at = None
        match.result_type = None
        match.winner_team_id = None
        match.result_summary = None
        match.win_margin_runs = None
        match.win_margin_wickets = None

    any_closed = any(s.innings.status is InningsStatus.COMPLETED for s in snapshot.innings)
    any_open_with_balls = any(
        s.innings.status is InningsStatus.IN_PROGRESS and s.innings.deliveries
        for s in snapshot.innings
    )
    if match.status not in (MatchStatus.ABANDONED,):
        if any_open_with_balls:
            match.status = MatchStatus.LIVE
        elif any_closed:
            match.status = MatchStatus.INNINGS_BREAK
        elif snapshot.innings:
            match.status = MatchStatus.LIVE


def _delivery_dict(delivery: Delivery) -> dict[str, Any]:
    """JSON snapshot of a delivery, for the immutable correction log."""
    return {
        "id": str(delivery.id),
        "sequence": delivery.sequence,
        "striker_id": str(delivery.striker_id),
        "non_striker_id": str(delivery.non_striker_id),
        "bowler_id": str(delivery.bowler_id),
        "batter_runs": delivery.batter_runs,
        "extra_type": delivery.extra_type.value if delivery.extra_type else None,
        "extra_runs": delivery.extra_runs,
        "is_boundary": delivery.is_boundary,
        "batters_crossed": delivery.batters_crossed,
        "is_wicket": delivery.is_wicket,
        "wicket_type": delivery.wicket_type.value if delivery.wicket_type else None,
        "dismissed_player_id": str(delivery.dismissed_player_id)
        if delivery.dismissed_player_id
        else None,
        "fielder_id": str(delivery.fielder_id) if delivery.fielder_id else None,
        "replacement_batter_id": str(delivery.replacement_batter_id)
        if delivery.replacement_batter_id
        else None,
        "commentary": delivery.commentary,
        "revision": delivery.revision,
    }


def _model_to_event(delivery: Delivery) -> DeliveryEvent:
    return DeliveryEvent(
        id=str(delivery.id),
        sequence=delivery.sequence,
        striker_id=str(delivery.striker_id),
        non_striker_id=str(delivery.non_striker_id),
        bowler_id=str(delivery.bowler_id),
        batter_runs=delivery.batter_runs,
        extra_type=delivery.extra_type,
        extra_runs=delivery.extra_runs,
        is_boundary=delivery.is_boundary,
        batters_crossed=delivery.batters_crossed,
        is_wicket=delivery.is_wicket,
        wicket_type=delivery.wicket_type,
        dismissed_player_id=str(delivery.dismissed_player_id)
        if delivery.dismissed_player_id
        else None,
        fielder_id=str(delivery.fielder_id) if delivery.fielder_id else None,
        replacement_batter_id=str(delivery.replacement_batter_id)
        if delivery.replacement_batter_id
        else None,
        commentary=delivery.commentary,
    )
