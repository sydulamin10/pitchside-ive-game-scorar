"""Apply Alembic migrations at process start.

Render's free plan skips pre-deploy commands, and a sleeping Neon instance
often refuses the first connection. Running ``upgrade head`` here — with
retries — is what keeps ``POST /matches`` from querying columns that do not
exist yet. The operation is idempotent.
"""

from __future__ import annotations

import time
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy.exc import OperationalError

from app.core.logging import get_logger

logger = get_logger(__name__)

_ROOT = Path(__file__).resolve().parents[2]
# Neon + Render free both sleep. Eight attempts with growing delays covers a
# typical cold start without making a real migration failure look like a hang.
_ATTEMPTS = 8


def upgrade_to_head() -> None:
    """Bring the connected database to the latest revision.

    Retries connection failures so a Neon cold start does not take the
    container down on the first try.
    """
    config = Config(str(_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(_ROOT / "alembic"))

    last_error: BaseException | None = None
    for attempt in range(1, _ATTEMPTS + 1):
        try:
            command.upgrade(config, "head")
            logger.info("database_migrations_applied", attempt=attempt)
            return
        except OperationalError as exc:
            last_error = exc
            logger.warning(
                "database_migrations_retry",
                attempt=attempt,
                error=str(exc),
            )
            time.sleep(min(12, 2 * attempt))
    assert last_error is not None
    raise last_error
