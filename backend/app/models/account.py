"""User wallet balance, top-up requests, coupon requests, and support tickets.

These are all *additive* to the existing billing system. A wallet holds stored
value a user tops up (manually approved by an admin for now, but the data model
is ready for an online gateway). Spending the balance records a normal
``billing_payments`` row, so entitlements keep flowing through one code path.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models._columns import fk_uuid


class WalletAccount(TimestampMixin, Base):
    """One stored-value balance per user. Created lazily on first use."""

    __tablename__ = "wallet_accounts"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    balance: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, default=Decimal("0")
    )
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="USD")


class WalletTransaction(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Audit ledger for every change to a wallet balance."""

    __tablename__ = "wallet_transactions"

    user_id: Mapped[uuid.UUID] = fk_uuid("users.id", ondelete="CASCADE")
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    balance_after: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    reference: Mapped[str | None] = mapped_column(String(120), default=None)
    note: Mapped[str | None] = mapped_column(Text, default=None)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), default=None
    )


class WalletTopup(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A request to add balance. Admin approves it today; a gateway can later."""

    __tablename__ = "wallet_topups"

    user_id: Mapped[uuid.UUID] = fk_uuid("users.id", ondelete="CASCADE")
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="USD")
    method: Mapped[str] = mapped_column(String(40), nullable=False, default="manual")
    reference: Mapped[str | None] = mapped_column(String(160), default=None)
    note: Mapped[str | None] = mapped_column(Text, default=None)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    decided_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), default=None
    )
    decided_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=None
    )


class CouponRequest(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A user asking the admin for a discount coupon."""

    __tablename__ = "coupon_requests"

    user_id: Mapped[uuid.UUID] = fk_uuid("users.id", ondelete="CASCADE")
    message: Mapped[str | None] = mapped_column(Text, default=None)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    response: Mapped[str | None] = mapped_column(Text, default=None)
    coupon_code: Mapped[str | None] = mapped_column(String(40), default=None)
    decided_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), default=None
    )
    decided_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=None
    )


class SupportRequest(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """An ODCC support ticket raised from the user dashboard."""

    __tablename__ = "support_requests"

    user_id: Mapped[uuid.UUID] = fk_uuid("users.id", ondelete="CASCADE")
    subject: Mapped[str] = mapped_column(String(160), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open")
    response: Mapped[str | None] = mapped_column(Text, default=None)
    decided_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), default=None
    )
    decided_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=None
    )


class TutorialVideo(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """An admin-managed YouTube tutorial shown on the broadcast page."""

    __tablename__ = "tutorial_videos"

    title: Mapped[str] = mapped_column(String(160), nullable=False)
    youtube_id: Mapped[str] = mapped_column(String(32), nullable=False)
    url: Mapped[str] = mapped_column(String(400), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, default=None)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(nullable=False, default=True)


class SiteContent(TimestampMixin, Base):
    """Admin-editable, publicly readable site content (WhatsApp number, FAQ, …).

    Unlike ``app_settings`` (which stores *encrypted* operator secrets), this is
    plain JSON meant to be served to the marketing and dashboard pages.
    """

    __tablename__ = "site_content"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
