"""Plans, coupons, payments, and per-match live-broadcast usage."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models._columns import enum_type, fk_uuid
from app.models.enums import BillingPlan, CouponDiscountType, LiveUsageSource, PaymentStatus

if TYPE_CHECKING:
    from app.models.user import User


class Coupon(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "billing_coupons"
    __table_args__ = (UniqueConstraint("code", name="uq_billing_coupons_code"),)

    code: Mapped[str] = mapped_column(String(40), nullable=False)
    discount_type: Mapped[CouponDiscountType] = mapped_column(
        enum_type(CouponDiscountType, "coupon_discount_type"), nullable=False
    )
    discount_value: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    max_uses: Mapped[int | None] = mapped_column(Integer, default=None)
    used_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    note: Mapped[str | None] = mapped_column(String(240), default=None)


class Payment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "billing_payments"

    user_id: Mapped[uuid.UUID] = fk_uuid("users.id", ondelete="CASCADE")
    created_by_user_id: Mapped[uuid.UUID] = fk_uuid("users.id", ondelete="RESTRICT")
    coupon_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("billing_coupons.id", ondelete="SET NULL"), default=None
    )
    tournament_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("tournaments.id", ondelete="SET NULL"), default=None
    )
    plan: Mapped[BillingPlan] = mapped_column(
        enum_type(BillingPlan, "billing_plan"), nullable=False
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    list_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    member_discount: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    discount_amount: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, default=Decimal("0")
    )
    paid_amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="USD")
    status: Mapped[PaymentStatus] = mapped_column(
        enum_type(PaymentStatus, "payment_status"), nullable=False, default=PaymentStatus.PAID
    )
    live_credits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    coupon_code: Mapped[str | None] = mapped_column(String(40), default=None)
    note: Mapped[str | None] = mapped_column(Text, default=None)

    user: Mapped[User] = relationship(foreign_keys=[user_id])
    created_by: Mapped[User] = relationship(foreign_keys=[created_by_user_id])
    coupon: Mapped[Coupon | None] = relationship()


class LiveUsage(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "billing_live_usage"
    __table_args__ = (UniqueConstraint("match_id", name="uq_billing_live_usage_match"),)

    match_id: Mapped[uuid.UUID] = fk_uuid("matches.id", ondelete="CASCADE")
    user_id: Mapped[uuid.UUID] = fk_uuid("users.id", ondelete="CASCADE")
    payment_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("billing_payments.id", ondelete="SET NULL"), default=None
    )
    source: Mapped[LiveUsageSource] = mapped_column(
        enum_type(LiveUsageSource, "live_usage_source"), nullable=False
    )
