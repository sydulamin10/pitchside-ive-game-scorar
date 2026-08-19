"""Ball-by-ball scoring: the write path the scoring console drives."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Body, Depends, Query, Request

from app.api.deps import CurrentUser, SessionDep, authorise_match
from app.core.rate_limit import RateLimit
from app.schemas.scoring import (
    CreaseBattersUpdate,
    CreaseBowlerUpdate,
    CreaseSwapEnds,
    DeliveryBatch,
    DeliveryCreate,
    DeliveryUpdate,
    ScoringResult,
)
from app.services import scoring_service
from app.services.scoring_service import ScoringOutcome

router = APIRouter(prefix="/matches/{match_id}", tags=["scoring"])

# A fast scorer taps roughly one ball every 20 seconds; 240/min leaves enormous
# head-room for legitimate use while still stopping a runaway client.
ball_rate_limit = RateLimit("ball", 240, 60)
sync_rate_limit = RateLimit("sync", 30, 60)


def _payload(outcome: ScoringOutcome, *, full: bool) -> dict[str, Any]:
    result = ScoringResult(
        delivery_id=outcome.delivery_id,
        state_version=outcome.state_version,
        accepted=outcome.accepted,
        duplicates=outcome.duplicates,
        rejected=outcome.rejected,
    )
    return {
        "result": result.model_dump(mode="json"),
        "state": outcome.snapshot.to_dict() if full else outcome.snapshot.compact(),
    }


@router.post(
    "/deliveries",
    dependencies=[Depends(ball_rate_limit)],
    summary="Record a ball",
    response_model=None,
)
async def record_delivery(
    match_id: uuid.UUID,
    payload: DeliveryCreate,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
    innings_id: uuid.UUID | None = Query(default=None),
    full: bool = Query(
        default=True, description="Return the whole scorecard, not just the summary"
    ),
) -> dict[str, Any]:
    await authorise_match(session, match_id, user, write=True)
    outcome = await scoring_service.record_delivery(
        session,
        match_id=match_id,
        innings_id=innings_id,
        payload=payload,
        actor=user,
        request=request,
    )
    return _payload(outcome, full=full)


@router.post(
    "/deliveries/sync",
    dependencies=[Depends(sync_rate_limit)],
    summary="Drain an offline queue of balls",
    response_model=None,
)
async def sync_deliveries(
    match_id: uuid.UUID,
    payload: DeliveryBatch,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
    innings_id: uuid.UUID | None = Query(default=None),
) -> dict[str, Any]:
    await authorise_match(session, match_id, user, write=True)
    outcome = await scoring_service.record_batch(
        session,
        match_id=match_id,
        innings_id=innings_id,
        payload=payload,
        actor=user,
        request=request,
    )
    return _payload(outcome, full=True)


@router.patch("/deliveries/{delivery_id}", summary="Correct a ball", response_model=None)
async def edit_delivery(
    match_id: uuid.UUID,
    delivery_id: uuid.UUID,
    payload: DeliveryUpdate,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
) -> dict[str, Any]:
    await authorise_match(session, match_id, user, write=True)
    outcome = await scoring_service.edit_delivery(
        session,
        match_id=match_id,
        delivery_id=delivery_id,
        payload=payload,
        actor=user,
        request=request,
    )
    return _payload(outcome, full=True)


@router.delete("/deliveries/{delivery_id}", summary="Remove a ball", response_model=None)
async def delete_delivery(
    match_id: uuid.UUID,
    delivery_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
    reason: str | None = Query(default=None, max_length=240),
    expected_state_version: int | None = Query(default=None, ge=0),
) -> dict[str, Any]:
    await authorise_match(session, match_id, user, write=True)
    outcome = await scoring_service.delete_delivery(
        session,
        match_id=match_id,
        delivery_id=delivery_id,
        reason=reason,
        actor=user,
        request=request,
        expected_state_version=expected_state_version,
    )
    return _payload(outcome, full=True)


@router.post("/undo", summary="Undo the last ball of an innings", response_model=None)
async def undo(
    match_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
    innings_id: uuid.UUID | None = Body(default=None, embed=True),
) -> dict[str, Any]:
    await authorise_match(session, match_id, user, write=True)
    outcome = await scoring_service.undo_last_delivery(
        session, match_id=match_id, innings_id=innings_id, actor=user, request=request
    )
    return _payload(outcome, full=True)


@router.post(
    "/crease/bowler",
    dependencies=[Depends(ball_rate_limit)],
    summary="Change bowler mid-over (injury replacement)",
    response_model=None,
)
async def change_crease_bowler(
    match_id: uuid.UUID,
    payload: CreaseBowlerUpdate,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
    innings_id: uuid.UUID | None = Query(default=None),
) -> dict[str, Any]:
    await authorise_match(session, match_id, user, write=True)
    outcome = await scoring_service.set_crease_bowler(
        session,
        match_id=match_id,
        bowler_id=payload.bowler_id,
        innings_id=innings_id,
        expected_state_version=payload.expected_state_version,
        actor=user,
        request=request,
    )
    return _payload(outcome, full=True)


@router.post(
    "/crease/swap-ends",
    dependencies=[Depends(ball_rate_limit)],
    summary="Swap striker and non-striker for future balls",
    response_model=None,
)
async def swap_crease_ends(
    match_id: uuid.UUID,
    payload: CreaseSwapEnds,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
    innings_id: uuid.UUID | None = Query(default=None),
) -> dict[str, Any]:
    await authorise_match(session, match_id, user, write=True)
    outcome = await scoring_service.swap_crease_ends(
        session,
        match_id=match_id,
        innings_id=innings_id,
        expected_state_version=payload.expected_state_version,
        actor=user,
        request=request,
    )
    return _payload(outcome, full=True)


@router.post(
    "/crease/ends",
    dependencies=[Depends(ball_rate_limit)],
    summary="Set crease ends for future balls",
    response_model=None,
)
async def set_crease_ends(
    match_id: uuid.UUID,
    payload: CreaseBattersUpdate,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
    innings_id: uuid.UUID | None = Query(default=None),
) -> dict[str, Any]:
    await authorise_match(session, match_id, user, write=True)
    outcome = await scoring_service.set_crease_ends(
        session,
        match_id=match_id,
        striker_id=payload.striker_id,
        non_striker_id=payload.non_striker_id,
        innings_id=innings_id,
        expected_state_version=payload.expected_state_version,
        actor=user,
        request=request,
    )
    return _payload(outcome, full=True)
