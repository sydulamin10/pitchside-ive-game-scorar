"""Add projection-only crease override columns on innings.

Revision ID: 20260812_1730_crease
Revises: 20260729_1600_camera_token
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260812_1730_crease"
down_revision = "20260729_1600_camera_token"
branch_labels = None
depends_on = None

_AUDIT_ACTIONS = (
    "user.registered",
    "user.login",
    "user.login_failed",
    "user.logout",
    "user.password_changed",
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
    op.add_column(
        "innings",
        sa.Column("crease_after_sequence", sa.Integer(), nullable=True),
    )
    op.add_column(
        "innings",
        sa.Column("crease_striker_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "innings",
        sa.Column("crease_non_striker_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "innings",
        sa.Column("crease_bowler_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        op.f("fk_innings_crease_striker_id_match_players"),
        "innings",
        "match_players",
        ["crease_striker_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        op.f("fk_innings_crease_non_striker_id_match_players"),
        "innings",
        "match_players",
        ["crease_non_striker_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        op.f("fk_innings_crease_bowler_id_match_players"),
        "innings",
        "match_players",
        ["crease_bowler_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # Expand the VARCHAR CHECK so crease.updated can be audited.
    op.execute("ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_action")
    values = ", ".join(f"'{v}'" for v in _AUDIT_ACTIONS)
    op.execute(f"ALTER TABLE audit_logs ADD CONSTRAINT audit_action CHECK (action IN ({values}))")


def downgrade() -> None:
    old = tuple(v for v in _AUDIT_ACTIONS if v != "crease.updated")
    op.execute("ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_action")
    values = ", ".join(f"'{v}'" for v in old)
    op.execute(f"ALTER TABLE audit_logs ADD CONSTRAINT audit_action CHECK (action IN ({values}))")

    op.drop_constraint(
        op.f("fk_innings_crease_bowler_id_match_players"), "innings", type_="foreignkey"
    )
    op.drop_constraint(
        op.f("fk_innings_crease_non_striker_id_match_players"),
        "innings",
        type_="foreignkey",
    )
    op.drop_constraint(
        op.f("fk_innings_crease_striker_id_match_players"), "innings", type_="foreignkey"
    )
    op.drop_column("innings", "crease_bowler_id")
    op.drop_column("innings", "crease_non_striker_id")
    op.drop_column("innings", "crease_striker_id")
    op.drop_column("innings", "crease_after_sequence")
