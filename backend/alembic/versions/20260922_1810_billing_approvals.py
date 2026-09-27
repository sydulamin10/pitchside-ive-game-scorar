"""Account approval, coupons, payments, and live-broadcast usage.

Revision ID: 20260922_1810_billing_approvals
Revises: 20260907_1900_app_settings
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260922_1810_billing_approvals"
down_revision = "20260907_1900_app_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_approved", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )
    op.alter_column("users", "is_approved", server_default=sa.text("false"))

    op.create_table(
        "billing_coupons",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("code", sa.String(length=40), nullable=False),
        sa.Column("discount_type", sa.String(length=40), nullable=False),
        sa.Column("discount_value", sa.Numeric(10, 2), nullable=False),
        sa.Column("max_uses", sa.Integer(), nullable=True),
        sa.Column("used_count", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("note", sa.String(length=240), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_billing_coupons"),
        sa.UniqueConstraint("code", name="uq_billing_coupons_code"),
        sa.CheckConstraint(
            "discount_type IN ('percent', 'amount')",
            name="ck_billing_coupons_coupon_discount_type",
        ),
    )
    op.create_index("ix_billing_coupons_created_at", "billing_coupons", ["created_at"])

    op.create_table(
        "billing_payments",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("created_by_user_id", sa.UUID(), nullable=False),
        sa.Column("coupon_id", sa.UUID(), nullable=True),
        sa.Column("tournament_id", sa.UUID(), nullable=True),
        sa.Column("plan", sa.String(length=40), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("list_amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("member_discount", sa.Boolean(), nullable=False),
        sa.Column("discount_amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("paid_amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("currency", sa.String(length=8), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("live_credits", sa.Integer(), nullable=False),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("coupon_code", sa.String(length=40), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_billing_payments_user_id_users", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["users.id"],
            name="fk_billing_payments_created_by_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["coupon_id"],
            ["billing_coupons.id"],
            name="fk_billing_payments_coupon_id_billing_coupons",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["tournament_id"],
            ["tournaments.id"],
            name="fk_billing_payments_tournament_id_tournaments",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_billing_payments"),
        sa.CheckConstraint(
            "plan IN ('free', 'live_match', 'pro', 'tournament')",
            name="ck_billing_payments_billing_plan",
        ),
        sa.CheckConstraint(
            "status IN ('paid', 'void')",
            name="ck_billing_payments_payment_status",
        ),
    )
    op.create_index("ix_billing_payments_user_id", "billing_payments", ["user_id"])
    op.create_index("ix_billing_payments_created_by_user_id", "billing_payments", ["created_by_user_id"])
    op.create_index("ix_billing_payments_created_at", "billing_payments", ["created_at"])

    op.create_table(
        "billing_live_usage",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("match_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("payment_id", sa.UUID(), nullable=True),
        sa.Column("source", sa.String(length=40), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["match_id"], ["matches.id"], name="fk_billing_live_usage_match_id_matches", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_billing_live_usage_user_id_users", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["payment_id"],
            ["billing_payments.id"],
            name="fk_billing_live_usage_payment_id_billing_payments",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_billing_live_usage"),
        sa.UniqueConstraint("match_id", name="uq_billing_live_usage_match"),
        sa.CheckConstraint(
            "source IN ('credit', 'pro', 'tournament', 'admin')",
            name="ck_billing_live_usage_live_usage_source",
        ),
    )
    op.create_index("ix_billing_live_usage_match_id", "billing_live_usage", ["match_id"])
    op.create_index("ix_billing_live_usage_user_id", "billing_live_usage", ["user_id"])
    op.create_index("ix_billing_live_usage_created_at", "billing_live_usage", ["created_at"])

    # Existing accounts keep live broadcast for a year so current matches stay on air.
    op.execute(
        sa.text(
            """
            INSERT INTO billing_payments (
                user_id, created_by_user_id, plan, quantity, list_amount, member_discount,
                discount_amount, paid_amount, currency, status, live_credits,
                period_start, period_end, note
            )
            SELECT
                id, id, 'pro', 1, 0, false,
                0, 0, 'USD', 'paid', 0,
                now(), now() + interval '365 days',
                'Grandfathered at billing launch'
            FROM users
            """
        )
    )


def downgrade() -> None:
    op.drop_index("ix_billing_live_usage_created_at", table_name="billing_live_usage")
    op.drop_index("ix_billing_live_usage_user_id", table_name="billing_live_usage")
    op.drop_index("ix_billing_live_usage_match_id", table_name="billing_live_usage")
    op.drop_table("billing_live_usage")
    op.drop_index("ix_billing_payments_created_at", table_name="billing_payments")
    op.drop_index("ix_billing_payments_created_by_user_id", table_name="billing_payments")
    op.drop_index("ix_billing_payments_user_id", table_name="billing_payments")
    op.drop_table("billing_payments")
    op.drop_index("ix_billing_coupons_created_at", table_name="billing_coupons")
    op.drop_table("billing_coupons")
    op.drop_column("users", "is_approved")
