"""Schemas for the user dashboard: wallet, top-ups, coupon/support requests."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import Field

from app.models.enums import BillingPlan
from app.schemas.common import ORMSchema, Schema


class AccountOverviewOut(Schema):
    balance: Decimal
    currency: str
    converted_balance_bdt: Decimal | None = None
    exchange_rate_bdt: float | None = None
    live_credits: int
    can_go_live: bool
    pro_until: datetime | None = None
    is_admin: bool
    is_approved: bool
    pending_topups: int
    reason: str | None = None


class WalletTransactionOut(ORMSchema):
    id: uuid.UUID
    amount: Decimal
    balance_after: Decimal
    kind: str
    reference: str | None = None
    note: str | None = None
    created_at: datetime


class TopupCreate(Schema):
    amount: Decimal = Field(gt=0, le=100000, max_digits=10, decimal_places=2)
    method: str = Field(default="manual", max_length=40)
    reference: str | None = Field(default=None, max_length=160)
    note: str | None = Field(default=None, max_length=2000)


class TopupOut(ORMSchema):
    id: uuid.UUID
    user_id: uuid.UUID
    user_email: str | None = None
    user_name: str | None = None
    amount: Decimal
    currency: str
    method: str
    reference: str | None = None
    note: str | None = None
    status: str
    decided_at: datetime | None = None
    created_at: datetime


class PurchaseInput(Schema):
    plan: BillingPlan
    quantity: int = Field(default=1, ge=1, le=500)
    tournament_id: uuid.UUID | None = None
    coupon_code: str | None = Field(default=None, max_length=40)


class CouponRequestCreate(Schema):
    message: str | None = Field(default=None, max_length=2000)


class CouponRequestOut(ORMSchema):
    id: uuid.UUID
    user_id: uuid.UUID
    user_email: str | None = None
    user_name: str | None = None
    message: str | None = None
    status: str
    response: str | None = None
    coupon_code: str | None = None
    decided_at: datetime | None = None
    created_at: datetime


class CouponRequestResolve(Schema):
    status: Literal["approved", "rejected"]
    response: str | None = Field(default=None, max_length=2000)
    coupon_code: str | None = Field(default=None, max_length=40)


class SupportRequestCreate(Schema):
    subject: str = Field(min_length=2, max_length=160)
    message: str = Field(min_length=2, max_length=4000)


class SupportRequestOut(ORMSchema):
    id: uuid.UUID
    user_id: uuid.UUID
    user_email: str | None = None
    user_name: str | None = None
    subject: str
    message: str
    status: str
    response: str | None = None
    decided_at: datetime | None = None
    created_at: datetime


class SupportRequestRespond(Schema):
    response: str | None = Field(default=None, max_length=4000)
    status: Literal["open", "resolved"] = "resolved"
