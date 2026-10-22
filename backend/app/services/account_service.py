"""User self-service: wallet balance, top-ups, coupon requests, support, purchase.

Spending balance records a normal ``billing_payments`` row so the existing
entitlement engine keeps being the single source of truth for live access.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import BadRequest, Conflict, Forbidden, NotFound
from app.models.account import (
    CouponRequest,
    SupportRequest,
    WalletAccount,
    WalletTopup,
    WalletTransaction,
)
from app.models.billing import Payment
from app.models.enums import (
    BillingPlan,
    PaymentStatus,
    RequestStatus,
    SupportStatus,
    WalletTxnKind,
)
from app.models.user import User
from app.services import billing_service, content_service

MONEY = Decimal("0.01")


def _money(value: Decimal) -> Decimal:
    return Decimal(value).quantize(MONEY, rounding=ROUND_HALF_UP)


# ------------------------------------------------------------------- wallet


async def get_or_create_wallet(session: AsyncSession, user_id: uuid.UUID) -> WalletAccount:
    wallet = await session.get(WalletAccount, user_id)
    if wallet is None:
        wallet = WalletAccount(user_id=user_id, balance=Decimal("0"), currency="USD")
        session.add(wallet)
        await session.flush()
    return wallet


async def _apply_delta(
    session: AsyncSession,
    user_id: uuid.UUID,
    amount: Decimal,
    *,
    kind: WalletTxnKind,
    reference: str | None = None,
    note: str | None = None,
    actor_id: uuid.UUID | None = None,
) -> WalletAccount:
    wallet = await get_or_create_wallet(session, user_id)
    new_balance = _money(wallet.balance + amount)
    if new_balance < 0:
        raise BadRequest("Not enough wallet balance.", code="wallet_insufficient")
    wallet.balance = new_balance
    session.add(
        WalletTransaction(
            user_id=user_id,
            amount=_money(amount),
            balance_after=new_balance,
            kind=kind.value,
            reference=reference,
            note=note,
            created_by_user_id=actor_id,
        )
    )
    await session.flush()
    return wallet


async def list_transactions(
    session: AsyncSession, user_id: uuid.UUID, *, limit: int = 50
) -> list[WalletTransaction]:
    rows = await session.execute(
        select(WalletTransaction)
        .where(WalletTransaction.user_id == user_id)
        .order_by(WalletTransaction.created_at.desc())
        .limit(limit)
    )
    return list(rows.scalars())


# -------------------------------------------------------------------- top-ups


async def create_topup(
    session: AsyncSession,
    user: User,
    *,
    amount: Decimal,
    method: str,
    reference: str | None,
    note: str | None,
) -> WalletTopup:
    if amount <= 0:
        raise BadRequest("Enter an amount greater than zero.", code="topup_amount_invalid")
    row = WalletTopup(
        user_id=user.id,
        amount=_money(amount),
        currency="USD",
        method=(method or "manual").strip()[:40] or "manual",
        reference=(reference or None),
        note=(note or None),
        status=RequestStatus.PENDING.value,
    )
    session.add(row)
    await session.flush()
    return row


async def list_topups(session: AsyncSession, user_id: uuid.UUID) -> list[WalletTopup]:
    rows = await session.execute(
        select(WalletTopup)
        .where(WalletTopup.user_id == user_id)
        .order_by(WalletTopup.created_at.desc())
    )
    return list(rows.scalars())


async def list_all_topups(
    session: AsyncSession, *, status: str | None = None, limit: int = 100, offset: int = 0
) -> list[tuple[WalletTopup, User]]:
    stmt = (
        select(WalletTopup, User)
        .join(User, User.id == WalletTopup.user_id)
        .order_by(WalletTopup.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if status:
        stmt = stmt.where(WalletTopup.status == status)
    rows = await session.execute(stmt)
    return [(row[0], row[1]) for row in rows.all()]


async def approve_topup(
    session: AsyncSession, admin: User, topup_id: uuid.UUID
) -> WalletTopup:
    row = await session.get(WalletTopup, topup_id)
    if row is None:
        raise NotFound("That top-up request does not exist.", code="topup_not_found")
    if row.status != RequestStatus.PENDING.value:
        raise Conflict("That top-up was already decided.", code="topup_decided")
    row.status = RequestStatus.APPROVED.value
    row.decided_by_user_id = admin.id
    row.decided_at = datetime.now(UTC)
    await _apply_delta(
        session,
        row.user_id,
        row.amount,
        kind=WalletTxnKind.TOPUP,
        reference=row.reference or f"topup:{row.id}",
        note="Top-up approved",
        actor_id=admin.id,
    )
    await session.flush()
    return row


async def reject_topup(
    session: AsyncSession, admin: User, topup_id: uuid.UUID, note: str | None = None
) -> WalletTopup:
    row = await session.get(WalletTopup, topup_id)
    if row is None:
        raise NotFound("That top-up request does not exist.", code="topup_not_found")
    if row.status != RequestStatus.PENDING.value:
        raise Conflict("That top-up was already decided.", code="topup_decided")
    row.status = RequestStatus.REJECTED.value
    row.decided_by_user_id = admin.id
    row.decided_at = datetime.now(UTC)
    if note:
        row.note = note
    await session.flush()
    return row


# ------------------------------------------------------- purchase with balance


async def purchase_with_balance(
    session: AsyncSession,
    user: User,
    *,
    plan: BillingPlan,
    quantity: int = 1,
    tournament_id: uuid.UUID | None = None,
    coupon_code: str | None = None,
) -> Payment:
    if plan is BillingPlan.FREE:
        raise BadRequest("The free plan does not take a payment.", code="plan_is_free")
    if plan is BillingPlan.TOURNAMENT and tournament_id is None:
        raise BadRequest("Pick the tournament this package covers.", code="tournament_required")
    if settings.requires_admin_approval() and not user.is_approved and not user.is_admin:
        raise Forbidden(
            "This account is waiting for admin approval.", code="account_pending_approval"
        )

    coupon = None
    if coupon_code:
        coupon = await billing_service.get_coupon(session, coupon_code, require_valid=True)

    priced = billing_service.quote(
        plan=plan, quantity=quantity, member_discount=False, coupon=coupon
    )
    paid = _money(priced["paid_amount"])

    wallet = await get_or_create_wallet(session, user.id)
    if wallet.balance < paid:
        raise BadRequest(
            "Your wallet balance is not enough for this purchase. Add a top-up first.",
            code="wallet_insufficient",
            details={"balance": str(wallet.balance), "required": str(paid)},
        )

    now = datetime.now(UTC)
    period_start = period_end = None
    if plan is BillingPlan.PRO:
        period_start = now
        period_end = now + timedelta(days=int(priced["period_days"] or 30))

    payment = Payment(
        user_id=user.id,
        created_by_user_id=user.id,
        coupon_id=coupon.id if coupon else None,
        tournament_id=tournament_id,
        plan=plan,
        quantity=max(1, quantity),
        list_amount=priced["list_amount"],
        member_discount=False,
        discount_amount=priced["discount_amount"],
        paid_amount=paid,
        live_credits=priced["live_credits"],
        period_start=period_start,
        period_end=period_end,
        coupon_code=priced["coupon_code"],
        note="Paid from wallet balance",
        status=PaymentStatus.PAID,
    )
    session.add(payment)
    if coupon is not None:
        coupon.used_count += 1
    await session.flush()

    if paid > 0:
        await _apply_delta(
            session,
            user.id,
            -paid,
            kind=WalletTxnKind.PURCHASE,
            reference=f"payment:{payment.id}",
            note=f"{priced['plan_name']} x{max(1, quantity)}",
            actor_id=user.id,
        )
    return payment


# ------------------------------------------------------------- coupon requests


async def create_coupon_request(
    session: AsyncSession, user: User, *, message: str | None
) -> CouponRequest:
    row = CouponRequest(
        user_id=user.id, message=(message or None), status=RequestStatus.PENDING.value
    )
    session.add(row)
    await session.flush()
    return row


async def list_coupon_requests(
    session: AsyncSession, *, user_id: uuid.UUID | None = None, status: str | None = None
) -> list[tuple[CouponRequest, User]]:
    stmt = (
        select(CouponRequest, User)
        .join(User, User.id == CouponRequest.user_id)
        .order_by(CouponRequest.created_at.desc())
    )
    if user_id is not None:
        stmt = stmt.where(CouponRequest.user_id == user_id)
    if status:
        stmt = stmt.where(CouponRequest.status == status)
    rows = await session.execute(stmt)
    return [(row[0], row[1]) for row in rows.all()]


async def resolve_coupon_request(
    session: AsyncSession,
    admin: User,
    request_id: uuid.UUID,
    *,
    status: RequestStatus,
    response: str | None = None,
    coupon_code: str | None = None,
) -> CouponRequest:
    row = await session.get(CouponRequest, request_id)
    if row is None:
        raise NotFound("That coupon request does not exist.", code="coupon_request_not_found")
    row.status = status.value
    row.response = response or row.response
    row.coupon_code = coupon_code or row.coupon_code
    row.decided_by_user_id = admin.id
    row.decided_at = datetime.now(UTC)
    await session.flush()
    return row


# ------------------------------------------------------------ support requests


async def create_support_request(
    session: AsyncSession, user: User, *, subject: str, message: str
) -> SupportRequest:
    row = SupportRequest(
        user_id=user.id,
        subject=subject.strip()[:160],
        message=message.strip(),
        status=SupportStatus.OPEN.value,
    )
    session.add(row)
    await session.flush()
    return row


async def list_support_requests(
    session: AsyncSession, *, user_id: uuid.UUID | None = None, status: str | None = None
) -> list[tuple[SupportRequest, User]]:
    stmt = (
        select(SupportRequest, User)
        .join(User, User.id == SupportRequest.user_id)
        .order_by(SupportRequest.created_at.desc())
    )
    if user_id is not None:
        stmt = stmt.where(SupportRequest.user_id == user_id)
    if status:
        stmt = stmt.where(SupportRequest.status == status)
    rows = await session.execute(stmt)
    return [(row[0], row[1]) for row in rows.all()]


async def respond_support_request(
    session: AsyncSession,
    admin: User,
    request_id: uuid.UUID,
    *,
    response: str | None = None,
    status: SupportStatus = SupportStatus.RESOLVED,
) -> SupportRequest:
    row = await session.get(SupportRequest, request_id)
    if row is None:
        raise NotFound("That support request does not exist.", code="support_request_not_found")
    row.response = response or row.response
    row.status = status.value
    row.decided_by_user_id = admin.id
    row.decided_at = datetime.now(UTC)
    await session.flush()
    return row


# ------------------------------------------------------------------ overview


async def account_overview(session: AsyncSession, user: User) -> dict[str, Any]:
    wallet = await get_or_create_wallet(session, user.id)
    entitlement = await billing_service.entitlement_for(session, user)
    site = await content_service.get_site(session)
    rate = float(site.get("exchange_rate_bdt") or 0) or 0.0
    converted = _money(wallet.balance * Decimal(str(rate))) if rate else None
    pending_topups = (
        await session.execute(
            select(func.count())
            .select_from(WalletTopup)
            .where(
                WalletTopup.user_id == user.id,
                WalletTopup.status == RequestStatus.PENDING.value,
            )
        )
    ).scalar_one()
    return {
        "balance": wallet.balance,
        "currency": wallet.currency,
        "converted_balance_bdt": converted,
        "exchange_rate_bdt": rate or None,
        "live_credits": entitlement.live_credits,
        "can_go_live": entitlement.can_go_live,
        "pro_until": entitlement.pro_until,
        "is_admin": user.is_admin,
        "is_approved": user.is_approved or user.is_admin,
        "pending_topups": int(pending_topups),
        "reason": entitlement.reason,
    }
