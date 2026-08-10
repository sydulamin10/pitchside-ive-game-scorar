"""Extend team/player profiles with branding, bio, and public slugs.

Revision ID: 0002_profiles_media
Revises: 0001_initial
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0002_profiles_media"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("teams", sa.Column("public_slug", sa.String(length=120), nullable=True))
    op.add_column("teams", sa.Column("cover_url", sa.String(length=512), nullable=True))
    op.add_column("teams", sa.Column("secondary_color", sa.String(length=9), nullable=True))
    op.add_column("teams", sa.Column("founded_year", sa.SmallInteger(), nullable=True))
    op.add_column("teams", sa.Column("description", sa.Text(), nullable=True))
    op.add_column("teams", sa.Column("coach_name", sa.String(length=80), nullable=True))
    op.add_column("teams", sa.Column("manager_name", sa.String(length=80), nullable=True))
    op.add_column("teams", sa.Column("owner_label", sa.String(length=80), nullable=True))
    op.add_column("teams", sa.Column("sponsor", sa.String(length=120), nullable=True))
    op.add_column("teams", sa.Column("contact_email", sa.String(length=254), nullable=True))
    op.add_column("teams", sa.Column("contact_phone", sa.String(length=40), nullable=True))
    op.add_column(
        "teams",
        sa.Column(
            "social_links",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
    )
    op.create_index(
        "uq_teams_public_slug",
        "teams",
        ["public_slug"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL AND public_slug IS NOT NULL"),
    )

    op.add_column("players", sa.Column("nickname", sa.String(length=40), nullable=True))
    op.add_column("players", sa.Column("public_slug", sa.String(length=120), nullable=True))
    op.add_column("players", sa.Column("photo_url", sa.String(length=512), nullable=True))
    op.add_column("players", sa.Column("cover_url", sa.String(length=512), nullable=True))
    op.add_column("players", sa.Column("date_of_birth", sa.Date(), nullable=True))
    op.add_column("players", sa.Column("nationality", sa.String(length=80), nullable=True))
    op.add_column("players", sa.Column("location", sa.String(length=120), nullable=True))
    op.add_column("players", sa.Column("height_cm", sa.Float(), nullable=True))
    op.add_column("players", sa.Column("weight_kg", sa.Float(), nullable=True))
    op.add_column("players", sa.Column("bio", sa.Text(), nullable=True))
    op.add_column("players", sa.Column("career_summary", sa.Text(), nullable=True))
    op.add_column(
        "players",
        sa.Column(
            "social_links",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
    )
    op.create_index(
        "uq_players_public_slug",
        "players",
        ["public_slug"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL AND public_slug IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_players_public_slug", table_name="players")
    op.drop_column("players", "social_links")
    op.drop_column("players", "career_summary")
    op.drop_column("players", "bio")
    op.drop_column("players", "weight_kg")
    op.drop_column("players", "height_cm")
    op.drop_column("players", "location")
    op.drop_column("players", "nationality")
    op.drop_column("players", "date_of_birth")
    op.drop_column("players", "cover_url")
    op.drop_column("players", "photo_url")
    op.drop_column("players", "public_slug")
    op.drop_column("players", "nickname")

    op.drop_index("uq_teams_public_slug", table_name="teams")
    op.drop_column("teams", "social_links")
    op.drop_column("teams", "contact_phone")
    op.drop_column("teams", "contact_email")
    op.drop_column("teams", "sponsor")
    op.drop_column("teams", "owner_label")
    op.drop_column("teams", "manager_name")
    op.drop_column("teams", "coach_name")
    op.drop_column("teams", "description")
    op.drop_column("teams", "founded_year")
    op.drop_column("teams", "secondary_color")
    op.drop_column("teams", "cover_url")
    op.drop_column("teams", "public_slug")
