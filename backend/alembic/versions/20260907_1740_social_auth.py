"""Add encrypted social OAuth payload on stream sessions.

Revision ID: 20260907_1740_social_auth
Revises: 20260812_1730_crease
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260907_1740_social_auth"
down_revision = "20260812_1730_crease"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("stream_sessions", sa.Column("social_auth_encrypted", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("stream_sessions", "social_auth_encrypted")
