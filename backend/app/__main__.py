"""Run the API: ``python -m app``.

Containers invoke uvicorn directly, so this exists for local development — and to
make one platform detail impossible to get wrong. psycopg's async driver refuses to
run on Windows' proactor event loop, and uvicorn picks the loop itself: it hard-codes
the proactor loop unless it is reloading in a subprocess, which is why
``uvicorn app.main:app`` fails on Windows while ``uvicorn app.main:app --reload``
works. Asking for ``loop="none"`` hands the choice back to the event loop policy that
``app.main`` sets, so both cases behave the same.
"""

from __future__ import annotations

import os
import sys


def main() -> None:
    import uvicorn

    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    reload = os.getenv("RELOAD", "1" if os.getenv("ENV", "development") == "development" else "0")

    uvicorn.run(
        "app.main:app",
        host=host,
        port=port,
        reload=reload not in {"0", "false", "False", ""},
        # See the module docstring: on Windows the loop must come from the policy.
        loop="none" if sys.platform == "win32" else "auto",
        log_config=None,  # app.core.logging owns the logging configuration
        access_log=False,  # RequestContextMiddleware emits structured access logs
        proxy_headers=True,
        forwarded_allow_ips=os.getenv("FORWARDED_ALLOW_IPS", "127.0.0.1"),
    )


if __name__ == "__main__":
    main()
