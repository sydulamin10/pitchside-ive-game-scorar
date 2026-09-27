"""Separate billing admin: approvals, plans, coupons, transactions."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Query
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from app.api.deps import AdminUser, CurrentUser, PaginationDep, SessionDep
from app.models.billing import Payment
from app.models.enums import BillingPlan
from app.schemas.billing import (
    ApprovalUpdate,
    BillingUserOut,
    CouponCreate,
    CouponOut,
    CouponUpdate,
    CreditGrant,
    EntitlementOut,
    PaymentCreate,
    PaymentOut,
    QuoteOut,
    QuoteRequest,
)
from app.schemas.common import Message
from app.services import billing_service

router = APIRouter(prefix="/billing", tags=["billing"])


@router.get("/plans")
async def list_plans(_admin: AdminUser) -> list[dict]:
    return [
        {
            "id": plan.value,
            "name": spec["name"],
            "price": spec["price"],
            "live": spec.get("live", False),
            "unlimited": spec.get("unlimited", False),
            "credits": spec.get("credits"),
            "days": spec.get("days"),
            "member_price": spec.get("member_price"),
        }
        for plan, spec in billing_service.PLAN_CATALOG.items()
        if plan is not BillingPlan.FREE
    ]


@router.get("/entitlement", response_model=EntitlementOut)
async def my_entitlement(session: SessionDep, user: CurrentUser) -> EntitlementOut:
    entitlement = await billing_service.entitlement_for(session, user)
    return EntitlementOut.model_validate(entitlement.to_dict())


@router.get("/users", response_model=list[BillingUserOut])
async def billing_users(
    session: SessionDep,
    _admin: AdminUser,
    pagination: PaginationDep,
    q: str | None = Query(default=None, max_length=80),
    pending: bool = False,
) -> list[BillingUserOut]:
    users = await billing_service.list_users(
        session, query=q, pending_only=pending, limit=pagination.limit, offset=pagination.offset
    )
    out: list[BillingUserOut] = []
    for user in users:
        entitlement = await billing_service.entitlement_for(session, user)
        out.append(BillingUserOut.model_validate(billing_service.billing_user_payload(user, entitlement)))
    return out


async def _user_out(session, user) -> BillingUserOut:
    entitlement = await billing_service.entitlement_for(session, user)
    return BillingUserOut.model_validate(billing_service.billing_user_payload(user, entitlement))


@router.patch("/users/{user_id}/approval", response_model=BillingUserOut)
async def set_approval(
    user_id: uuid.UUID,
    payload: ApprovalUpdate,
    session: SessionDep,
    admin: AdminUser,
) -> BillingUserOut:
    user = await billing_service.set_approved(session, admin, user_id, payload.is_approved)
    await session.commit()
    await session.refresh(user)
    return await _user_out(session, user)


@router.post("/users/{user_id}/credits", response_model=BillingUserOut)
async def grant_credits(
    user_id: uuid.UUID,
    payload: CreditGrant,
    session: SessionDep,
    admin: AdminUser,
) -> BillingUserOut:
    mode = "set" if payload.mode == "set" else "add"
    user = await billing_service.grant_credits(
        session, admin, user_id, payload.credits, mode=mode, note=payload.note
    )
    await session.commit()
    await session.refresh(user)
    return await _user_out(session, user)


@router.post("/quote", response_model=QuoteOut)
async def quote_payment(
    payload: QuoteRequest, session: SessionDep, _admin: AdminUser
) -> QuoteOut:
    return QuoteOut.model_validate(await billing_service.quote_request(session, payload))


@router.get("/payments", response_model=list[PaymentOut])
async def list_payments(
    session: SessionDep,
    _admin: AdminUser,
    pagination: PaginationDep,
    user_id: uuid.UUID | None = None,
) -> list[PaymentOut]:
    rows = await billing_service.list_payments(
        session, user_id=user_id, limit=pagination.limit, offset=pagination.offset
    )
    # Re-load with users for names.
    ids = [row.id for row in rows]
    if not ids:
        return []
    loaded = list(
        (
            await session.execute(
                select(Payment).options(joinedload(Payment.user)).where(Payment.id.in_(ids))
            )
        )
        .unique()
        .scalars()
    )
    by_id = {row.id: row for row in loaded}
    return [
        PaymentOut.model_validate(billing_service.payment_out(by_id[i]))
        for i in ids
        if i in by_id
    ]


@router.post("/payments", response_model=PaymentOut)
async def create_payment(
    payload: PaymentCreate, session: SessionDep, admin: AdminUser
) -> PaymentOut:
    row = await billing_service.record_payment(session, admin, payload)
    await session.commit()
    await session.refresh(row, attribute_names=["user"])
    return PaymentOut.model_validate(billing_service.payment_out(row))


@router.post("/payments/{payment_id}/void", response_model=PaymentOut)
async def void_payment(
    payment_id: uuid.UUID, session: SessionDep, admin: AdminUser
) -> PaymentOut:
    row = await billing_service.void_payment(session, admin, payment_id)
    await session.commit()
    await session.refresh(row, attribute_names=["user"])
    return PaymentOut.model_validate(billing_service.payment_out(row))


@router.get("/coupons", response_model=list[CouponOut])
async def list_coupons(session: SessionDep, _admin: AdminUser) -> list[CouponOut]:
    return [CouponOut.model_validate(c) for c in await billing_service.list_coupons(session)]


@router.post("/coupons", response_model=CouponOut)
async def create_coupon(
    payload: CouponCreate, session: SessionDep, _admin: AdminUser
) -> CouponOut:
    coupon = await billing_service.create_coupon(session, payload)
    await session.commit()
    return CouponOut.model_validate(coupon)


@router.patch("/coupons/{coupon_id}", response_model=CouponOut)
async def update_coupon(
    coupon_id: uuid.UUID, payload: CouponUpdate, session: SessionDep, _admin: AdminUser
) -> CouponOut:
    coupon = await billing_service.update_coupon(session, coupon_id, payload)
    await session.commit()
    return CouponOut.model_validate(coupon)


@router.get("/health", response_model=Message)
async def billing_health(_admin: AdminUser) -> Message:
    return Message(message="Billing admin is ready.")
