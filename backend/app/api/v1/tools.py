"""Toss utilities.

These could live entirely in the browser, but two captains arguing about a toss
is a real thing, so the randomness comes from the server's CSPRNG and every
result is stamped with an HMAC receipt that cannot be re-rolled quietly.
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime

from fastapi import APIRouter, Depends

from app.core.rate_limit import RateLimit
from app.core.security import receipt
from app.schemas.tools import (
    CoinFlipRequest,
    CoinFlipResult,
    SpinWheelRequest,
    SpinWheelResult,
)

router = APIRouter(
    prefix="/tools",
    tags=["tools"],
    dependencies=[Depends(RateLimit("tools", 120, 60))],
)


@router.post("/coin-flip", response_model=CoinFlipResult, summary="Flip a coin")
async def coin_flip(payload: CoinFlipRequest) -> CoinFlipResult:
    result = "heads" if secrets.randbelow(2) == 0 else "tails"
    flipped_at = datetime.now(UTC)
    return CoinFlipResult(
        result=result,
        call=payload.call,
        called_by=payload.called_by,
        call_correct=None if payload.call is None else payload.call == result,
        flipped_at=flipped_at,
        receipt=receipt(result, flipped_at.isoformat(), purpose="coin-flip"),
    )


@router.post("/spin-wheel", response_model=SpinWheelResult, summary="Spin the wheel")
async def spin_wheel(payload: SpinWheelRequest) -> SpinWheelResult:
    # Fisher-Yates with a CSPRNG: every ordering is equally likely, and the whole
    # order is returned so the wheel animation can land honestly.
    order = list(payload.options)
    for index in range(len(order) - 1, 0, -1):
        swap = secrets.randbelow(index + 1)
        order[index], order[swap] = order[swap], order[index]

    winners = order if payload.shuffle_all else order[: payload.picks]
    spun_at = datetime.now(UTC)
    return SpinWheelResult(
        winners=winners,
        order=order,
        spun_at=spun_at,
        receipt=receipt(*order, spun_at.isoformat(), purpose="spin-wheel"),
    )
