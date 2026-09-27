"""Billing admin: plans, coupons, payments, account approval."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import Field

from app.models.enums import BillingPlan, CouponDiscountType, LiveUsageSource, PaymentStatus
from app.schemas.common import ORMSchema, Schema


class CouponCreate(Schema):
    code: str = Field(min_length=2, max_length=40)
    discount_type: CouponDiscountType
    discount_value: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    max_uses: int | None = Field(default=None, ge=1)
    expires_at: datetime | None = None
    note: str | None = Field(default=None, max_length=240)


class CouponUpdate(Schema):
    is_active: bool | None = None
    max_uses: int | None = Field(default=None, ge=1)
    expires_at: datetime | None = None
    note: str | None = Field(default=None, max_length=240)


class CouponOut(ORMSchema):
    id: uuid.UUID
    code: str
    discount_type: CouponDiscountType
    discount_value: Decimal
    max_uses: int | None
    used_count: int
    expires_at: datetime | None
    is_active: bool
    note: str | None
    created_at: datetime


class QuoteRequest(Schema):
    plan: BillingPlan
    quantity: int = Field(default=1, ge=1, le=500)
    member_discount: bool = False
    coupon_code: str | None = Field(default=None, max_length=40)


class QuoteOut(Schema):
    plan: BillingPlan
    plan_name: str
    quantity: int
    list_amount: Decimal
    member_discount: bool
    coupon_code: str | None = None
    discount_amount: Decimal
    paid_amount: Decimal
    currency: str = "USD"
    live_credits: int = 0
    period_days: int | None = None


class PaymentCreate(Schema):
    user_id: uuid.UUID
    plan: BillingPlan
    quantity: int = Field(default=1, ge=1, le=500)
    member_discount: bool = False
    coupon_code: str | None = Field(default=None, max_length=40)
    paid_amount: Decimal | None = Field(default=None, ge=0, max_digits=10, decimal_places=2)
    tournament_id: uuid.UUID | None = None
    note: str | None = Field(default=None, max_length=2000)


class PaymentOut(ORMSchema):
    id: uuid.UUID
    user_id: uuid.UUID
    user_email: str | None = None
    user_name: str | None = None
    plan: BillingPlan
    quantity: int
    list_amount: Decimal
    member_discount: bool
    discount_amount: Decimal
    paid_amount: Decimal
    currency: str
    status: PaymentStatus
    live_credits: int
    tournament_id: uuid.UUID | None
    period_start: datetime | None
    period_end: datetime | None
    coupon_code: str | None
    note: str | None
    created_by_user_id: uuid.UUID
    created_at: datetime


class EntitlementOut(Schema):
    can_go_live: bool
    live_credits: int
    pro_until: datetime | None = None
    tournament_ids: list[uuid.UUID] = Field(default_factory=list)
    reason: str | None = None


class BillingUserOut(Schema):
    id: uuid.UUID
    email: str
    display_name: str
    role: str
    is_approved: bool
    is_active: bool
    created_at: datetime
    last_login_at: datetime | None
    live_credits: int
    pro_until: datetime | None
    can_go_live: bool


class ApprovalUpdate(Schema):
    is_approved: bool


class CreditGrant(Schema):
    credits: int = Field(ge=0, le=10_000)
    mode: Literal["add", "set"] = "add"
    note: str | None = Field(default=None, max_length=240)


class LiveUsageOut(ORMSchema):
    id: uuid.UUID
    match_id: uuid.UUID
    user_id: uuid.UUID
    source: LiveUsageSource
    created_at: datetime
