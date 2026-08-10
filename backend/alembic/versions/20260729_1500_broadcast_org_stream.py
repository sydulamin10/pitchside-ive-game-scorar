"""Broadcast org: awards, memberships, stream sessions.

Revision ID: 20260729_1500_broadcast
Revises: 0002_profiles_media
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260729_1500_broadcast"
down_revision = "0002_profiles_media"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "player_awards",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "player_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("players.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "team_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("teams.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("kind", sa.String(length=40), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("awarded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("image_url", sa.String(length=512), nullable=True),
        sa.Column(
            "created_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.CheckConstraint(
            "kind IN ('trophy', 'certificate', 'achievement')",
            name="ck_player_awards_kind",
        ),
    )
    op.create_index("ix_player_awards_player", "player_awards", ["player_id", "awarded_at"])
    op.create_index("ix_player_awards_player_id", "player_awards", ["player_id"])

    op.create_table(
        "team_memberships",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "team_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("teams.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "player_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("players.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("role", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("invited_email", sa.String(length=320), nullable=True),
        sa.Column("invite_token", sa.String(length=64), nullable=True),
        sa.Column(
            "invited_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "role IN ('owner', 'manager', 'coach', 'captain', 'vice_captain', 'player')",
            name="ck_team_memberships_role",
        ),
        sa.CheckConstraint(
            "status IN ('active', 'invited', 'requested', 'rejected', 'left')",
            name="ck_team_memberships_status",
        ),
        sa.UniqueConstraint("team_id", "user_id", name="uq_team_memberships_team_user"),
        sa.UniqueConstraint("invite_token", name="uq_team_memberships_invite_token"),
    )
    op.create_index("ix_team_memberships_team_id", "team_memberships", ["team_id"])
    op.create_index("ix_team_memberships_user_id", "team_memberships", ["user_id"])
    op.create_index("ix_team_memberships_invited_email", "team_memberships", ["invited_email"])
    op.create_index(
        "ix_team_memberships_user_active",
        "team_memberships",
        ["user_id", "status"],
        postgresql_where=sa.text("status = 'active'"),
    )

    op.execute(
        """
        INSERT INTO team_memberships (
            id, created_at, updated_at, team_id, user_id, role, status
        )
        SELECT
            gen_random_uuid(),
            now(),
            now(),
            t.id,
            t.owner_user_id,
            'owner',
            'active'
        FROM teams t
        WHERE t.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM team_memberships m
            WHERE m.team_id = t.id AND m.user_id = t.owner_user_id
          )
        """
    )

    op.create_table(
        "stream_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "match_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("matches.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("destination_label", sa.String(length=120), nullable=True),
        sa.Column("rtmp_url", sa.String(length=512), nullable=True),
        sa.Column("stream_key_encrypted", sa.Text(), nullable=True),
        sa.Column("whip_path", sa.String(length=160), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('idle', 'preview', 'live', 'ended', 'error')",
            name="ck_stream_sessions_status",
        ),
    )
    op.create_index("ix_stream_sessions_match_id", "stream_sessions", ["match_id"])
    op.create_index(
        "ix_stream_sessions_created_by_user_id", "stream_sessions", ["created_by_user_id"]
    )
    op.create_index("ix_stream_sessions_match_status", "stream_sessions", ["match_id", "status"])
    op.create_index("ix_stream_sessions_status", "stream_sessions", ["status"])


def downgrade() -> None:
    op.drop_index("ix_stream_sessions_status", table_name="stream_sessions")
    op.drop_index("ix_stream_sessions_match_status", table_name="stream_sessions")
    op.drop_index("ix_stream_sessions_created_by_user_id", table_name="stream_sessions")
    op.drop_index("ix_stream_sessions_match_id", table_name="stream_sessions")
    op.drop_table("stream_sessions")

    op.drop_index("ix_team_memberships_user_active", table_name="team_memberships")
    op.drop_index("ix_team_memberships_invited_email", table_name="team_memberships")
    op.drop_index("ix_team_memberships_user_id", table_name="team_memberships")
    op.drop_index("ix_team_memberships_team_id", table_name="team_memberships")
    op.drop_table("team_memberships")

    op.drop_index("ix_player_awards_player_id", table_name="player_awards")
    op.drop_index("ix_player_awards_player", table_name="player_awards")
    op.drop_table("player_awards")
