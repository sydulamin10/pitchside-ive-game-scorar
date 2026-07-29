"""Fail if the migration history and the ORM models disagree.

Run against a database that has had ``alembic upgrade head`` applied to it:

    alembic upgrade head
    python tools/check_migrations.py

Why this exists: the ORM is what the application reads and writes, and the
migrations are what the database actually got. Nothing enforces that those two
descriptions match — a column added to a model without a migration works
perfectly in every test that builds its schema with ``create_all``, and then
fails in production with ``UndefinedColumn``. This turns that class of mistake
into a red build.

The comparison is alembic's own autogenerate diff, with the same options
``alembic/env.py`` uses, so a difference reported here is exactly what
``alembic revision --autogenerate`` would have written.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Running a file inside tools/ puts tools/ on the path, not the backend root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from alembic.autogenerate import compare_metadata  # noqa: E402
from alembic.runtime.migration import MigrationContext  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402

import app.models  # noqa: E402, F401  (registers every table on Base.metadata)
from app.core.config import settings  # noqa: E402
from app.db.base import Base  # noqa: E402

# Alembic's own bookkeeping table is not in the models and never should be.
IGNORED_TABLES = {"alembic_version", "spatial_ref_sys"}


def _table_of(difference: object) -> str | None:
    """The table a diff entry concerns, across alembic's two entry shapes."""
    if isinstance(difference, list):  # a grouped column diff
        return _table_of(difference[0]) if difference else None
    if isinstance(difference, tuple) and difference:
        for element in difference[1:]:
            if isinstance(element, str):
                return element
            table = getattr(element, "table", None)
            if table is not None:
                return str(getattr(table, "name", table))
            name = getattr(element, "name", None)
            if isinstance(name, str) and difference[0] in {"add_table", "remove_table"}:
                return name
    return None


def main() -> int:
    engine = create_engine(settings.sync_database_url, future=True)
    try:
        with engine.connect() as connection:
            context = MigrationContext.configure(
                connection,
                opts={
                    "compare_type": True,
                    "compare_server_default": True,
                    "target_metadata": Base.metadata,
                },
            )
            differences = compare_metadata(context, Base.metadata)
    finally:
        engine.dispose()

    interesting = [d for d in differences if _table_of(d) not in IGNORED_TABLES]

    if not interesting:
        print(f"Schema matches the models ({len(Base.metadata.tables)} tables).")
        return 0

    print("The database schema does not match the ORM models.")
    print("Generate a migration with:")
    print('  alembic revision --autogenerate -m "describe the change"')
    print()
    for difference in interesting:
        print(f"  {difference!r}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
