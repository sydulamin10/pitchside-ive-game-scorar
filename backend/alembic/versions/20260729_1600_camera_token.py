"""Add camera_token for external cameraman Go Live links.

Revision ID: 20260729_1600_camera_token
Revises: 20260729_1500_broadcast
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260729_1600_camera_token"
down_revision = "20260729_1500_broadcast"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "stream_sessions",
        sa.Column("camera_token", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "stream_sessions",
        sa.Column("publisher_claimed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "uq_stream_sessions_camera_token",
        "stream_sessions",
        ["camera_token"],
        unique=True,
        postgresql_where=sa.text("camera_token IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_stream_sessions_camera_token", table_name="stream_sessions")
    op.drop_column("stream_sessions", "publisher_claimed_at")
    op.drop_column("stream_sessions", "camera_token")
