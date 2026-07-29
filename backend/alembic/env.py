"""Alembic environment.

Runs migrations through the *synchronous* psycopg driver even though the app is
async: migrations are a one-shot administrative task, and a sync connection keeps
this file simple and easy to run from CI or a shell.

The URL always comes from application settings, so `alembic upgrade head` can
never be aimed at a different database than the one the app talks to.
"""

from __future__ import annotations

from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

# Importing the models package registers every table on Base.metadata.
import app.models  # noqa: F401
from alembic import context
from app.core.config import settings
from app.db.base import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

config.set_main_option("sqlalchemy.url", settings.sync_database_url.replace("%", "%%"))

target_metadata = Base.metadata


def include_object(object_, name, type_, reflected, compare_to):  # type: ignore[no-untyped-def]
    """Keep autogenerate focused on this application's own tables."""
    return not (type_ == "table" and name in {"spatial_ref_sys"})


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
            include_object=include_object,
            # One transaction for the whole upgrade: a failed migration leaves no
            # half-applied schema behind.
            transaction_per_migration=False,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
