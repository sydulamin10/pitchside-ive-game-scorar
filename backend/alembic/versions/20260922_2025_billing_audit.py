"""Allow billing and approval actions in the audit_logs CHECK.

Revision ID: 20260922_2025_billing_audit
Revises: 20260922_1810_billing_approvals
"""

from __future__ import annotations

from alembic import op

revision = "20260922_2025_billing_audit"
down_revision = "20260922_1810_billing_approvals"
branch_labels = None
depends_on = None

AUDIT_ACTIONS = (
    "user.registered",
    "user.login",
    "user.login_failed",
    "user.logout",
    "user.password_changed",
    "user.approved",
    "user.unapproved",
    "billing.payment_recorded",
    "billing.payment_voided",
    "auth.token_reuse_detected",
    "match.created",
    "match.updated",
    "match.deleted",
    "match.completed",
    "delivery.recorded",
    "delivery.edited",
    "delivery.deleted",
    "innings.started",
    "innings.closed",
    "crease.updated",
    "tournament.created",
    "tournament.updated",
)


def upgrade() -> None:
    values = ", ".join(f"'{v}'" for v in AUDIT_ACTIONS)
    op.execute("ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_action")
    op.execute(f"ALTER TABLE audit_logs ADD CONSTRAINT audit_action CHECK (action IN ({values}))")


def downgrade() -> None:
    old = tuple(
        v
        for v in AUDIT_ACTIONS
        if v
        not in {
            "user.approved",
            "user.unapproved",
            "billing.payment_recorded",
            "billing.payment_voided",
        }
    )
    values = ", ".join(f"'{v}'" for v in old)
    op.execute("ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_action")
    op.execute(f"ALTER TABLE audit_logs ADD CONSTRAINT audit_action CHECK (action IN ({values}))")
