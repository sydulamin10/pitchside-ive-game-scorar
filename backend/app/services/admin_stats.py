"""Lightweight admin dashboard aggregates (counts and revenue summaries)."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.models.account import CouponRequest, SupportRequest, WalletTopup
from app.models.billing import Payment
from app.models.enums import (
    BillingPlan,
    MatchStatus,
    PaymentStatus,
    RequestStatus,
    SupportStatus,
    TournamentStatus,
)
from app.models.match import Match
from app.models.team import Team
from app.models.tournament import Tournament
from app.models.user import User
from app.services import billing_service


async def _count(session: AsyncSession, stmt) -> int:
    return int((await session.execute(stmt)).scalar_one())


async def _revenue(session: AsyncSession, since: datetime | None) -> Decimal:
    stmt = select(func.coalesce(func.sum(Payment.paid_amount), 0)).where(
        Payment.status == PaymentStatus.PAID,
        Payment.paid_amount > 0,
        Payment.note.is_distinct_from(billing_service.GRANDFATHER_NOTE),
    )
    if since is not None:
        stmt = stmt.where(Payment.created_at >= since)
    return Decimal((await session.execute(stmt)).scalar_one() or 0)


async def dashboard(session: AsyncSession) -> dict[str, Any]:
    now = datetime.now(UTC)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = day_start.replace(day=1)

    total_users = await _count(session, select(func.count()).select_from(User))
    total_teams = await _count(session, select(func.count()).select_from(Team))
    total_matches = await _count(
        session, select(func.count()).select_from(Match).where(Match.deleted_at.is_(None))
    )
    live_matches = await _count(
        session,
        select(func.count())
        .select_from(Match)
        .where(Match.deleted_at.is_(None), Match.status == MatchStatus.LIVE),
    )
    active_tournaments = await _count(
        session,
        select(func.count())
        .select_from(Tournament)
        .where(Tournament.status == TournamentStatus.ACTIVE),
    )
    active_pro = await _count(
        session,
        select(func.count(func.distinct(Payment.user_id))).where(
            Payment.status == PaymentStatus.PAID,
            Payment.plan == BillingPlan.PRO,
            Payment.period_end.is_not(None),
            Payment.period_end > now,
            Payment.note.is_distinct_from(billing_service.GRANDFATHER_NOTE),
        ),
    )
    pending_topups = await _count(
        session,
        select(func.count())
        .select_from(WalletTopup)
        .where(WalletTopup.status == RequestStatus.PENDING.value),
    )
    pending_coupon_requests = await _count(
        session,
        select(func.count())
        .select_from(CouponRequest)
        .where(CouponRequest.status == RequestStatus.PENDING.value),
    )
    open_support_requests = await _count(
        session,
        select(func.count())
        .select_from(SupportRequest)
        .where(SupportRequest.status == SupportStatus.OPEN.value),
    )

    recent_payments_rows = list(
        (
            await session.execute(
                select(Payment)
                .options(joinedload(Payment.user))
                .where(Payment.status == PaymentStatus.PAID)
                .order_by(Payment.created_at.desc())
                .limit(8)
            )
        )
        .unique()
        .scalars()
    )
    recent_users_rows = list(
        (
            await session.execute(select(User).order_by(User.created_at.desc()).limit(8))
        ).scalars()
    )

    return {
        "totals": {
            "users": total_users,
            "teams": total_teams,
            "matches": total_matches,
            "live_matches": live_matches,
            "active_tournaments": active_tournaments,
            "active_pro_subscribers": active_pro,
            "pending_topups": pending_topups,
            "pending_coupon_requests": pending_coupon_requests,
            "open_support_requests": open_support_requests,
        },
        "revenue": {
            "today": str(await _revenue(session, day_start)),
            "month": str(await _revenue(session, month_start)),
            "all_time": str(await _revenue(session, None)),
            "currency": "USD",
        },
        "recent_payments": [
            billing_service.payment_out(row) for row in recent_payments_rows
        ],
        "recent_users": [
            {
                "id": row.id,
                "email": row.email,
                "display_name": row.display_name,
                "role": row.role.value,
                "is_approved": row.is_approved or row.is_admin,
                "created_at": row.created_at,
            }
            for row in recent_users_rows
        ],
    }
