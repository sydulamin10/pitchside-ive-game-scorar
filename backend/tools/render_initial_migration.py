"""Render the initial Alembic migration body without needing a live database.

`alembic revision --autogenerate` has to connect to Postgres to diff the schema.
For the *first* migration there is nothing to diff against: the answer is simply
"create every table, in dependency order, with its indexes". So we build those ops
straight from the metadata and let Alembic render them as Python.

Usage (from the backend directory):

    python tools/render_initial_migration.py > alembic/_generated.txt
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from alembic.autogenerate import render_python_code  # noqa: E402
from alembic.operations import ops  # noqa: E402
from alembic.runtime.migration import MigrationContext  # noqa: E402

import app.models  # noqa: F401,E402  (registers every table)
from app.db.base import Base  # noqa: E402


def main() -> None:
    context = MigrationContext.configure(dialect_name="postgresql")

    upgrade_ops = ops.UpgradeOps(ops=[])
    downgrade_ops = ops.DowngradeOps(ops=[])

    tables = list(Base.metadata.sorted_tables)
    for table in tables:
        upgrade_ops.ops.append(ops.CreateTableOp.from_table(table))
        for index in sorted(table.indexes, key=lambda i: i.name or ""):
            upgrade_ops.ops.append(ops.CreateIndexOp.from_index(index))

    for table in reversed(tables):
        for index in sorted(table.indexes, key=lambda i: i.name or ""):
            downgrade_ops.ops.append(ops.DropIndexOp.from_index(index))
        downgrade_ops.ops.append(ops.DropTableOp.from_table(table))

    print("# ------------------------------- upgrade -------------------------------")
    print(render_python_code(upgrade_ops, migration_context=context))
    print("\n# ------------------------------ downgrade ------------------------------")
    print(render_python_code(downgrade_ops, migration_context=context))


if __name__ == "__main__":
    main()
