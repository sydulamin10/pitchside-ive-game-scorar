"""Encrypted site settings for Facebook Login credentials.

Revision ID: 20260907_1900_app_settings
Revises: 20260907_1740_social_auth
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260907_1900_app_settings"
down_revision = "20260907_1740_social_auth"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("value_encrypted", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("key", name="pk_app_settings"),
    )
    op.create_index("ix_app_settings_created_at", "app_settings", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_app_settings_created_at", table_name="app_settings")
    op.drop_table("app_settings")
