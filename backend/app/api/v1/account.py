"""User dashboard self-service: wallet, top-ups, purchases, coupon/support."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Query

from app.api.deps import AdminUser, CurrentUser, PaginationDep, SessionDep
from app.models.account import CouponRequest, SupportRequest, WalletTopup
from app.models.enums import RequestStatus, SupportStatus
from app.models.user import User
from app.schemas.account import (
    AccountOverviewOut,
    CouponRequestCreate,
    CouponRequestOut,
    CouponRequestResolve,
    PurchaseInput,
    SupportRequestCreate,
    SupportRequestOut,
    SupportRequestRespond,
    TopupCreate,
    TopupOut,
    WalletTransactionOut,
)
from app.schemas.billing import PaymentOut
from app.services import account_service, billing_service

router = APIRouter(prefix="/account", tags=["account"])


def _topup_out(row: WalletTopup, user: User | None = None) -> dict[str, Any]:
    return {
        "id": row.id,
        "user_id": row.user_id,
        "user_email": user.email if user else None,
        "user_name": user.display_name if user else None,
        "amount": row.amount,
        "currency": row.currency,
        "method": row.method,
        "reference": row.reference,
        "note": row.note,
        "status": row.status,
        "decided_at": row.decided_at,
        "created_at": row.created_at,
    }


def _coupon_req_out(row: CouponRequest, user: User | None = None) -> dict[str, Any]:
    return {
        "id": row.id,
        "user_id": row.user_id,
        "user_email": user.email if user else None,
        "user_name": user.display_name if user else None,
        "message": row.message,
        "status": row.status,
        "response": row.response,
        "coupon_code": row.coupon_code,
        "decided_at": row.decided_at,
        "created_at": row.created_at,
    }


def _support_out(row: SupportRequest, user: User | None = None) -> dict[str, Any]:
    return {
        "id": row.id,
        "user_id": row.user_id,
        "user_email": user.email if user else None,
        "user_name": user.display_name if user else None,
        "subject": row.subject,
        "message": row.message,
        "status": row.status,
        "response": row.response,
        "decided_at": row.decided_at,
        "created_at": row.created_at,
    }


# --------------------------------------------------------------- user: overview


@router.get("/overview", response_model=AccountOverviewOut)
async def overview(session: SessionDep, user: CurrentUser) -> AccountOverviewOut:
    data = await account_service.account_overview(session, user)
    await session.commit()
    return AccountOverviewOut.model_validate(data)


@router.get("/transactions", response_model=list[WalletTransactionOut])
async def transactions(session: SessionDep, user: CurrentUser) -> list[WalletTransactionOut]:
    rows = await account_service.list_transactions(session, user.id)
    return [WalletTransactionOut.model_validate(r) for r in rows]


# ----------------------------------------------------------------- user: top-ups


@router.post("/topups", response_model=TopupOut)
async def create_topup(
    payload: TopupCreate, session: SessionDep, user: CurrentUser
) -> TopupOut:
    row = await account_service.create_topup(
        session,
        user,
        amount=payload.amount,
        method=payload.method,
        reference=payload.reference,
        note=payload.note,
    )
    await session.commit()
    return TopupOut.model_validate(_topup_out(row, user))


@router.get("/topups", response_model=list[TopupOut])
async def my_topups(session: SessionDep, user: CurrentUser) -> list[TopupOut]:
    rows = await account_service.list_topups(session, user.id)
    return [TopupOut.model_validate(_topup_out(r, user)) for r in rows]


# ---------------------------------------------------------------- user: purchase


@router.post("/purchase", response_model=PaymentOut)
async def purchase(
    payload: PurchaseInput, session: SessionDep, user: CurrentUser
) -> PaymentOut:
    row = await account_service.purchase_with_balance(
        session,
        user,
        plan=payload.plan,
        quantity=payload.quantity,
        tournament_id=payload.tournament_id,
        coupon_code=payload.coupon_code,
    )
    await session.commit()
    await session.refresh(row)
    return PaymentOut.model_validate(billing_service.payment_out(row))


@router.get("/payments", response_model=list[PaymentOut])
async def my_payments(
    session: SessionDep, user: CurrentUser, pagination: PaginationDep
) -> list[PaymentOut]:
    rows = await billing_service.list_payments(
        session, user_id=user.id, limit=pagination.limit, offset=pagination.offset
    )
    return [PaymentOut.model_validate(billing_service.payment_out(r)) for r in rows]


# --------------------------------------------------------- user: coupon requests


@router.post("/coupon-requests", response_model=CouponRequestOut)
async def create_coupon_request(
    payload: CouponRequestCreate, session: SessionDep, user: CurrentUser
) -> CouponRequestOut:
    row = await account_service.create_coupon_request(session, user, message=payload.message)
    await session.commit()
    return CouponRequestOut.model_validate(_coupon_req_out(row, user))


@router.get("/coupon-requests", response_model=list[CouponRequestOut])
async def my_coupon_requests(
    session: SessionDep, user: CurrentUser
) -> list[CouponRequestOut]:
    rows = await account_service.list_coupon_requests(session, user_id=user.id)
    return [CouponRequestOut.model_validate(_coupon_req_out(r, u)) for r, u in rows]


# -------------------------------------------------------- user: support requests


@router.post("/support-requests", response_model=SupportRequestOut)
async def create_support_request(
    payload: SupportRequestCreate, session: SessionDep, user: CurrentUser
) -> SupportRequestOut:
    row = await account_service.create_support_request(
        session, user, subject=payload.subject, message=payload.message
    )
    await session.commit()
    return SupportRequestOut.model_validate(_support_out(row, user))


@router.get("/support-requests", response_model=list[SupportRequestOut])
async def my_support_requests(
    session: SessionDep, user: CurrentUser
) -> list[SupportRequestOut]:
    rows = await account_service.list_support_requests(session, user_id=user.id)
    return [SupportRequestOut.model_validate(_support_out(r, u)) for r, u in rows]


# ================================================================ admin review


@router.get("/admin/topups", response_model=list[TopupOut])
async def admin_topups(
    session: SessionDep,
    _admin: AdminUser,
    pagination: PaginationDep,
    status: str | None = Query(default=None),
) -> list[TopupOut]:
    rows = await account_service.list_all_topups(
        session, status=status, limit=pagination.limit, offset=pagination.offset
    )
    return [TopupOut.model_validate(_topup_out(r, u)) for r, u in rows]


@router.post("/admin/topups/{topup_id}/approve", response_model=TopupOut)
async def admin_approve_topup(
    topup_id: uuid.UUID, session: SessionDep, admin: AdminUser
) -> TopupOut:
    row = await account_service.approve_topup(session, admin, topup_id)
    await session.commit()
    user = await session.get(User, row.user_id)
    return TopupOut.model_validate(_topup_out(row, user))


@router.post("/admin/topups/{topup_id}/reject", response_model=TopupOut)
async def admin_reject_topup(
    topup_id: uuid.UUID, session: SessionDep, admin: AdminUser
) -> TopupOut:
    row = await account_service.reject_topup(session, admin, topup_id)
    await session.commit()
    user = await session.get(User, row.user_id)
    return TopupOut.model_validate(_topup_out(row, user))


@router.get("/admin/coupon-requests", response_model=list[CouponRequestOut])
async def admin_coupon_requests(
    session: SessionDep, _admin: AdminUser, status: str | None = Query(default=None)
) -> list[CouponRequestOut]:
    rows = await account_service.list_coupon_requests(session, status=status)
    return [CouponRequestOut.model_validate(_coupon_req_out(r, u)) for r, u in rows]


@router.post("/admin/coupon-requests/{request_id}/resolve", response_model=CouponRequestOut)
async def admin_resolve_coupon_request(
    request_id: uuid.UUID,
    payload: CouponRequestResolve,
    session: SessionDep,
    admin: AdminUser,
) -> CouponRequestOut:
    row = await account_service.resolve_coupon_request(
        session,
        admin,
        request_id,
        status=RequestStatus(payload.status),
        response=payload.response,
        coupon_code=payload.coupon_code,
    )
    await session.commit()
    user = await session.get(User, row.user_id)
    return CouponRequestOut.model_validate(_coupon_req_out(row, user))


@router.get("/admin/support-requests", response_model=list[SupportRequestOut])
async def admin_support_requests(
    session: SessionDep, _admin: AdminUser, status: str | None = Query(default=None)
) -> list[SupportRequestOut]:
    rows = await account_service.list_support_requests(session, status=status)
    return [SupportRequestOut.model_validate(_support_out(r, u)) for r, u in rows]


@router.post("/admin/support-requests/{request_id}/respond", response_model=SupportRequestOut)
async def admin_respond_support_request(
    request_id: uuid.UUID,
    payload: SupportRequestRespond,
    session: SessionDep,
    admin: AdminUser,
) -> SupportRequestOut:
    row = await account_service.respond_support_request(
        session,
        admin,
        request_id,
        response=payload.response,
        status=SupportStatus(payload.status),
    )
    await session.commit()
    user = await session.get(User, row.user_id)
    return SupportRequestOut.model_validate(_support_out(row, user))
