"""Pricing-page plans, coupons, payments, and live-broadcast entitlements."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Literal

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import BadRequest, Conflict, Forbidden, NotFound
from app.models.billing import Coupon, LiveUsage, Payment
from app.models.enums import (
    AuditAction,
    BillingPlan,
    CouponDiscountType,
    LiveUsageSource,
    PaymentStatus,
    UserRole,
)
from app.models.match import Match
from app.models.user import User
from app.services import audit_service, auth_service

MONEY = Decimal("0.01")
MEMBER_DISCOUNT_PERCENT = Decimal("25")
GRANDFATHER_NOTE = "Grandfathered at billing launch"

PLAN_CATALOG: dict[BillingPlan, dict[str, Any]] = {
    BillingPlan.FREE: {
        "name": "Community Scoring",
        "price": Decimal("0"),
        "live": False,
        "unlimited": False,
    },
    BillingPlan.LIVE_MATCH: {
        "name": "Live Broadcast",
        "price": Decimal("1.20"),
        "member_price": Decimal("0.90"),
        "live": True,
        "credits": 1,
    },
    BillingPlan.PRO: {
        "name": "ODCC LIVE Pro",
        "price": Decimal("9.99"),
        "live": True,
        "unlimited": True,
        "days": 30,
    },
    BillingPlan.TOURNAMENT: {
        "name": "Tournament Package",
        "price": Decimal("15.99"),
        "live": True,
        "unlimited": True,
    },
}


def _money(value: Decimal) -> Decimal:
    return value.quantize(MONEY, rounding=ROUND_HALF_UP)


def _norm_code(raw: str | None) -> str:
    return (raw or "").strip().upper()


@dataclass(slots=True)
class Entitlement:
    can_go_live: bool
    live_credits: int
    pro_until: datetime | None
    tournament_ids: list[uuid.UUID]
    reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "can_go_live": self.can_go_live,
            "live_credits": self.live_credits,
            "pro_until": self.pro_until,
            "tournament_ids": self.tournament_ids,
            "reason": self.reason,
        }


def quote(
    *,
    plan: BillingPlan,
    quantity: int = 1,
    member_discount: bool = False,
    coupon: Coupon | None = None,
) -> dict[str, Any]:
    if plan is BillingPlan.FREE:
        raise BadRequest("The free scoring plan does not take a payment.", code="plan_is_free")
    spec = PLAN_CATALOG[plan]
    qty = max(1, quantity)
    unit = Decimal(spec["price"])
    if member_discount:
        unit = _money(unit * (Decimal("100") - MEMBER_DISCOUNT_PERCENT) / Decimal("100"))
    list_amount = _money(unit * qty)
    discount = Decimal("0")
    coupon_code = None
    if coupon is not None:
        coupon_code = coupon.code
        if coupon.discount_type is CouponDiscountType.PERCENT:
            discount = _money(list_amount * coupon.discount_value / Decimal("100"))
        else:
            discount = min(list_amount, _money(coupon.discount_value))
    paid = max(Decimal("0"), _money(list_amount - discount))
    credits = int(spec.get("credits", 0)) * qty if plan is BillingPlan.LIVE_MATCH else 0
    return {
        "plan": plan,
        "plan_name": spec["name"],
        "quantity": qty,
        "list_amount": list_amount,
        "member_discount": member_discount,
        "coupon_code": coupon_code,
        "discount_amount": discount,
        "paid_amount": paid,
        "currency": "USD",
        "live_credits": credits,
        "period_days": spec.get("days") * qty if spec.get("days") else None,
    }


async def get_coupon(session: AsyncSession, code: str, *, require_valid: bool = False) -> Coupon:
    coupon = (
        await session.execute(select(Coupon).where(Coupon.code == _norm_code(code)).limit(1))
    ).scalar_one_or_none()
    if coupon is None:
        raise NotFound("That coupon does not exist.", code="coupon_not_found")
    if require_valid:
        _assert_coupon_usable(coupon)
    return coupon


def _assert_coupon_usable(coupon: Coupon) -> None:
    now = datetime.now(UTC)
    if not coupon.is_active:
        raise BadRequest("That coupon is turned off.", code="coupon_inactive")
    if coupon.expires_at and coupon.expires_at <= now:
        raise BadRequest("That coupon has expired.", code="coupon_expired")
    if coupon.max_uses is not None and coupon.used_count >= coupon.max_uses:
        raise BadRequest("That coupon has been used up.", code="coupon_exhausted")


async def create_coupon(session: AsyncSession, payload: Any) -> Coupon:
    code = _norm_code(payload.code)
    if not code:
        raise BadRequest("Coupon code is required.", code="coupon_code_required")
    exists = (
        await session.execute(select(Coupon.id).where(Coupon.code == code).limit(1))
    ).scalar_one_or_none()
    if exists is not None:
        raise Conflict("A coupon with that code already exists.", code="coupon_code_taken")
    if payload.discount_type is CouponDiscountType.PERCENT and payload.discount_value > 100:
        raise BadRequest("A percent coupon cannot exceed 100.", code="coupon_percent_range")
    coupon = Coupon(
        code=code,
        discount_type=payload.discount_type,
        discount_value=_money(payload.discount_value),
        max_uses=payload.max_uses,
        expires_at=payload.expires_at,
        note=payload.note,
    )
    session.add(coupon)
    await session.flush()
    return coupon


async def list_coupons(session: AsyncSession) -> list[Coupon]:
    result = await session.execute(select(Coupon).order_by(Coupon.created_at.desc()))
    return list(result.scalars())


async def update_coupon(session: AsyncSession, coupon_id: uuid.UUID, payload: Any) -> Coupon:
    coupon = await session.get(Coupon, coupon_id)
    if coupon is None:
        raise NotFound("That coupon does not exist.", code="coupon_not_found")
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(coupon, key, value)
    await session.flush()
    return coupon


async def quote_request(session: AsyncSession, payload: Any) -> dict[str, Any]:
    coupon = None
    if payload.coupon_code:
        coupon = await get_coupon(session, payload.coupon_code, require_valid=True)
    return quote(
        plan=payload.plan,
        quantity=payload.quantity,
        member_discount=payload.member_discount,
        coupon=coupon,
    )


async def record_payment(session: AsyncSession, admin: User, payload: Any) -> Payment:
    user = await session.get(User, payload.user_id)
    if user is None:
        raise NotFound("That account does not exist.", code="user_not_found")
    if payload.plan is BillingPlan.FREE:
        raise BadRequest("The free scoring plan does not take a payment.", code="plan_is_free")
    if payload.plan is BillingPlan.TOURNAMENT and payload.tournament_id is None:
        raise BadRequest("Pick the tournament this package covers.", code="tournament_required")

    coupon = None
    if payload.coupon_code:
        coupon = await get_coupon(session, payload.coupon_code, require_valid=True)

    priced = quote(
        plan=payload.plan,
        quantity=payload.quantity,
        member_discount=payload.member_discount,
        coupon=coupon,
    )
    paid_amount = (
        _money(payload.paid_amount) if payload.paid_amount is not None else priced["paid_amount"]
    )
    now = datetime.now(UTC)
    period_start = None
    period_end = None
    if payload.plan is BillingPlan.PRO:
        period_start = now
        period_end = now + timedelta(days=int(priced["period_days"] or 30))

    row = Payment(
        user_id=user.id,
        created_by_user_id=admin.id,
        coupon_id=coupon.id if coupon else None,
        tournament_id=payload.tournament_id,
        plan=payload.plan,
        quantity=payload.quantity,
        list_amount=priced["list_amount"],
        member_discount=payload.member_discount,
        discount_amount=priced["discount_amount"],
        paid_amount=paid_amount,
        live_credits=priced["live_credits"],
        period_start=period_start,
        period_end=period_end,
        coupon_code=priced["coupon_code"],
        note=payload.note,
        status=PaymentStatus.PAID,
    )
    session.add(row)
    if coupon is not None:
        coupon.used_count += 1
    await session.flush()
    await audit_service.record(
        session,
        AuditAction.PAYMENT_RECORDED,
        actor_user_id=admin.id,
        entity_type="payment",
        entity_id=row.id,
        context={"plan": payload.plan.value, "user_id": str(user.id), "paid": str(paid_amount)},
    )
    return row


async def void_payment(session: AsyncSession, admin: User, payment_id: uuid.UUID) -> Payment:
    row = await session.get(Payment, payment_id)
    if row is None:
        raise NotFound("That payment does not exist.", code="payment_not_found")
    if row.status is PaymentStatus.VOID:
        return row
    row.status = PaymentStatus.VOID
    await session.flush()
    await audit_service.record(
        session,
        AuditAction.PAYMENT_VOIDED,
        actor_user_id=admin.id,
        entity_type="payment",
        entity_id=row.id,
    )
    return row


async def list_payments(
    session: AsyncSession, *, user_id: uuid.UUID | None = None, limit: int = 50, offset: int = 0
) -> list[Payment]:
    stmt = select(Payment).order_by(Payment.created_at.desc()).limit(limit).offset(offset)
    if user_id is not None:
        stmt = stmt.where(Payment.user_id == user_id)
    return list((await session.execute(stmt)).scalars())


def _counts_for_entitlement(payment: Payment) -> bool:
    """Launch grandfather rows are not admin-granted access."""
    return (payment.note or "").strip() != GRANDFATHER_NOTE


async def entitlement_for(session: AsyncSession, user: User) -> Entitlement:
    if user.is_admin:
        return Entitlement(
            True, live_credits=999, pro_until=None, tournament_ids=[], reason="admin"
        )
    now = datetime.now(UTC)
    payments = [
        payment
        for payment in (
            await session.execute(
                select(Payment).where(
                    Payment.user_id == user.id, Payment.status == PaymentStatus.PAID
                )
            )
        ).scalars()
        if _counts_for_entitlement(payment)
    ]
    used = (
        await session.execute(
            select(func.coalesce(func.sum(1), 0)).where(
                LiveUsage.user_id == user.id, LiveUsage.source == LiveUsageSource.CREDIT
            )
        )
    ).scalar_one()
    credits = sum(p.live_credits for p in payments if p.plan is BillingPlan.LIVE_MATCH) - int(used)
    pro_until = None
    tournament_ids: list[uuid.UUID] = []
    for payment in payments:
        if (
            payment.plan is BillingPlan.PRO
            and payment.period_end
            and payment.period_end > now
            and (pro_until is None or payment.period_end > pro_until)
        ):
            pro_until = payment.period_end
        if payment.plan is BillingPlan.TOURNAMENT and payment.tournament_id:
            tournament_ids.append(payment.tournament_id)
    remaining = max(0, credits)
    can = remaining > 0 or pro_until is not None or bool(tournament_ids)
    reason = None
    if not user.is_approved:
        can = False
        reason = "This account is waiting for admin approval."
    elif not can:
        reason = (
            "This account has no live match credits left. One credit starts one live match, "
            "or pay for Pro / a tournament package."
        )
    return Entitlement(
        can_go_live=can,
        live_credits=remaining,
        pro_until=pro_until,
        tournament_ids=tournament_ids,
        reason=reason,
    )


async def assert_can_prepare_live(session: AsyncSession, user: User, match: Match) -> Entitlement:
    billed = await session.get(User, match.created_by_user_id) or user
    if billed.is_admin or user.is_admin:
        return Entitlement(True, 999, None, [], "admin")
    if not billed.is_approved:
        raise Forbidden(
            "This account is waiting for admin approval.",
            code="account_pending_approval",
        )
    if not settings.BILLING_ENFORCE:
        return Entitlement(True, 999, None, [], "billing_off")
    already = (
        await session.execute(select(LiveUsage.id).where(LiveUsage.match_id == match.id).limit(1))
    ).scalar_one_or_none()
    if already is not None:
        return Entitlement(True, 0, None, [], "already_used")
    entitlement = await entitlement_for(session, billed)
    if entitlement.pro_until is not None:
        return entitlement
    if match.tournament_id and match.tournament_id in entitlement.tournament_ids:
        return entitlement
    if entitlement.live_credits > 0:
        return entitlement
    raise Forbidden(
        entitlement.reason
        or "This account has no live match credits left. One credit starts one live match.",
        code="live_not_entitled",
        details=entitlement.to_dict(),
    )


async def consume_live(session: AsyncSession, user: User, match: Match) -> LiveUsage | None:
    billed = await session.get(User, match.created_by_user_id) or user
    existing = (
        await session.execute(select(LiveUsage).where(LiveUsage.match_id == match.id).limit(1))
    ).scalar_one_or_none()
    if existing is not None:
        return existing
    if billed.is_admin or user.is_admin or not settings.BILLING_ENFORCE:
        row = LiveUsage(
            match_id=match.id,
            user_id=billed.id,
            source=(
                LiveUsageSource.ADMIN
                if billed.is_admin or user.is_admin
                else LiveUsageSource.PRO
            ),
        )
        session.add(row)
        await session.flush()
        return row

    entitlement = await entitlement_for(session, billed)
    source = LiveUsageSource.CREDIT
    payment_id = None
    if entitlement.pro_until is not None:
        source = LiveUsageSource.PRO
    elif match.tournament_id and match.tournament_id in entitlement.tournament_ids:
        source = LiveUsageSource.TOURNAMENT
    elif entitlement.live_credits > 0:
        source = LiveUsageSource.CREDIT
        payment = (
            await session.execute(
                select(Payment)
                .where(
                    Payment.user_id == billed.id,
                    Payment.status == PaymentStatus.PAID,
                    Payment.plan == BillingPlan.LIVE_MATCH,
                    Payment.live_credits > 0,
                    Payment.note.is_distinct_from(GRANDFATHER_NOTE),
                )
                .order_by(Payment.created_at.asc())
                .limit(1)
            )
        ).scalar_one_or_none()
        payment_id = payment.id if payment else None
    else:
        raise Forbidden(
            entitlement.reason
            or "This account has no live match credits left. One credit starts one live match.",
            code="live_not_entitled",
            details=entitlement.to_dict(),
        )

    row = LiveUsage(
        match_id=match.id, user_id=billed.id, payment_id=payment_id, source=source
    )
    session.add(row)
    await session.flush()
    return row


async def list_users(
    session: AsyncSession,
    *,
    query: str | None = None,
    pending_only: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> list[User]:
    stmt = select(User).order_by(User.created_at.desc()).limit(limit).offset(offset)
    if pending_only:
        stmt = stmt.where(User.is_approved.is_(False), User.role == UserRole.USER)
    if query:
        needle = f"%{query.strip().lower()}%"
        stmt = stmt.where(
            or_(func.lower(User.email).like(needle), func.lower(User.display_name).like(needle))
        )
    return list((await session.execute(stmt)).scalars())


async def set_approved(
    session: AsyncSession, admin: User, user_id: uuid.UUID, approved: bool
) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise NotFound("That account does not exist.", code="user_not_found")
    if user.is_admin:
        raise Forbidden("Administrator accounts stay approved.", code="admin_always_approved")
    user.is_approved = approved
    if not approved:
        await auth_service.revoke_all_sessions(session, user.id, reason="unapproved")
    await audit_service.record(
        session,
        AuditAction.USER_APPROVED if approved else AuditAction.USER_UNAPPROVED,
        actor_user_id=admin.id,
        entity_type="user",
        entity_id=user.id,
    )
    await session.flush()
    return user


async def grant_credits(
    session: AsyncSession,
    admin: User,
    user_id: uuid.UUID,
    credits: int,
    *,
    mode: Literal["add", "set"] = "add",
    note: str | None = None,
) -> User:
    if credits < 0:
        raise BadRequest("Credits cannot be negative.", code="credits_negative")
    user = await session.get(User, user_id)
    if user is None:
        raise NotFound("That account does not exist.", code="user_not_found")
    if mode == "set":
        current = (await entitlement_for(session, user)).live_credits
        delta = credits - current
    else:
        if credits < 1:
            raise BadRequest("Add at least one live credit.", code="credits_required")
        delta = credits
    if delta == 0:
        return user

    row = Payment(
        user_id=user.id,
        created_by_user_id=admin.id,
        plan=BillingPlan.LIVE_MATCH,
        quantity=max(1, abs(delta)),
        list_amount=Decimal("0"),
        member_discount=False,
        discount_amount=Decimal("0"),
        paid_amount=Decimal("0"),
        live_credits=delta,
        note=note or ("Admin credit set" if mode == "set" else "Admin credit grant"),
        status=PaymentStatus.PAID,
    )
    session.add(row)
    await session.flush()
    await audit_service.record(
        session,
        AuditAction.PAYMENT_RECORDED,
        actor_user_id=admin.id,
        entity_type="payment",
        entity_id=row.id,
        context={
            "kind": "credit_grant",
            "mode": mode,
            "delta": delta,
            "user_id": str(user.id),
        },
    )
    return user


def billing_user_payload(user: User, entitlement: Entitlement) -> dict[str, Any]:
    return {
        "id": user.id,
        "email": user.email,
        "display_name": user.display_name,
        "role": user.role.value,
        "is_approved": user.is_approved or user.is_admin,
        "is_active": user.is_active,
        "created_at": user.created_at,
        "last_login_at": user.last_login_at,
        "live_credits": entitlement.live_credits,
        "pro_until": entitlement.pro_until,
        "can_go_live": entitlement.can_go_live,
    }


def payment_out(row: Payment) -> dict[str, Any]:
    user = row.user
    return {
        "id": row.id,
        "user_id": row.user_id,
        "user_email": user.email if user else None,
        "user_name": user.display_name if user else None,
        "plan": row.plan,
        "quantity": row.quantity,
        "list_amount": row.list_amount,
        "member_discount": row.member_discount,
        "discount_amount": row.discount_amount,
        "paid_amount": row.paid_amount,
        "currency": row.currency,
        "status": row.status,
        "live_credits": row.live_credits,
        "tournament_id": row.tournament_id,
        "period_start": row.period_start,
        "period_end": row.period_end,
        "coupon_code": row.coupon_code,
        "note": row.note,
        "created_by_user_id": row.created_by_user_id,
        "created_at": row.created_at,
    }
