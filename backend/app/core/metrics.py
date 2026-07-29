"""Prometheus instrumentation.

Deliberately small: four series that answer the questions that actually matter in
production (is it up, is it slow, is it erroring, how many people are watching).
Path labels use the *route template* rather than the raw URL, so a thousand match
slugs do not turn into a thousand time series.
"""

from __future__ import annotations

import time

from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest
from starlette.types import ASGIApp, Message, Receive, Scope, Send

REQUESTS = Counter(
    "http_requests_total",
    "HTTP requests by method, route template and status class.",
    ("method", "route", "status"),
)
LATENCY = Histogram(
    "http_request_duration_seconds",
    "Request latency by route template.",
    ("method", "route"),
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
)
DELIVERIES = Counter("deliveries_recorded_total", "Balls accepted by the scoring engine.")
STREAM_CLIENTS = Gauge("realtime_stream_clients", "Currently connected server-sent-event clients.")


def render_latest() -> tuple[str, str]:
    return generate_latest().decode("utf-8"), CONTENT_TYPE_LATEST


class MetricsMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("path") == "/metrics":
            await self.app(scope, receive, send)
            return

        started = time.perf_counter()
        status_code = 500

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            # Resolved by Starlette during routing; falls back to "unmatched" for
            # 404s so unknown URLs cannot create unbounded label cardinality.
            route = scope.get("route")
            template = getattr(route, "path", None) or "unmatched"
            method = scope.get("method", "GET")
            REQUESTS.labels(method, template, f"{status_code // 100}xx").inc()
            LATENCY.labels(method, template).observe(time.perf_counter() - started)
