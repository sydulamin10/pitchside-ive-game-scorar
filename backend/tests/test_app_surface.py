"""The parts of the HTTP surface that hold regardless of database state."""

from __future__ import annotations

import pytest


def test_healthz_is_cheap_and_public(client):
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_root_advertises_the_api(client):
    body = client.get("/").json()
    assert body["status"] == "ok"
    assert body["api"] == "/api/v1"


def test_robots_disallows_crawling_the_api(client):
    response = client.get("/robots.txt")
    assert response.status_code == 200
    assert "Disallow: /" in response.text


def test_security_headers_are_applied(client):
    headers = client.get("/healthz").headers
    assert headers["x-content-type-options"] == "nosniff"
    assert headers["x-frame-options"] == "DENY"
    assert headers["referrer-policy"] == "no-referrer"
    assert headers["cross-origin-resource-policy"] == "cross-origin"
    assert "default-src 'none'" in headers["content-security-policy"]


def test_every_response_carries_a_request_id(client):
    assert client.get("/healthz").headers["x-request-id"]


def test_a_client_supplied_request_id_is_echoed_when_it_is_safe(client):
    response = client.get("/healthz", headers={"X-Request-Id": "abc-123"})
    assert response.headers["x-request-id"] == "abc-123"


def test_a_hostile_request_id_is_replaced(client):
    response = client.get("/healthz", headers={"X-Request-Id": "line\nbreak"})
    assert response.headers["x-request-id"] != "line\nbreak"


def test_unknown_routes_use_the_error_envelope(client):
    response = client.get("/api/v1/does-not-exist")
    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "not_found"
    assert error["message"]


def test_protected_routes_require_a_token(client):
    response = client.get("/api/v1/users/me")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"
    assert response.headers["www-authenticate"] == "Bearer"


def test_a_garbage_token_is_rejected_without_leaking_detail(client):
    response = client.get("/api/v1/users/me", headers={"Authorization": "Bearer not-a-jwt"})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_token"


def test_validation_errors_list_the_offending_fields(client):
    response = client.post("/api/v1/auth/register", json={"email": "nope", "password": "short"})
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert {field["field"] for field in error["details"]["fields"]} >= {"email"}


def test_unknown_fields_are_refused_rather_than_ignored(client):
    response = client.post(
        "/api/v1/auth/login",
        json={
            "email": "someone@example.test",
            "password": "correct horse battery staple",
            "admin": True,
        },
    )
    assert response.status_code == 422


def test_oversized_bodies_are_rejected_before_parsing(client):
    response = client.post(
        "/api/v1/auth/login",
        content=b"x" * 2_000_000,
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "payload_too_large"


def test_cors_allows_the_configured_web_origin(client):
    response = client.options(
        "/api/v1/auth/login",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_cors_allows_authorized_match_create_preflight(client):
    response = client.options(
        "/api/v1/matches",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type,accept",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    allowed = response.headers.get("access-control-allow-headers", "").lower()
    assert "authorization" in allowed
    assert "content-type" in allowed


def test_cors_refuses_an_unknown_origin(client):
    response = client.options(
        "/api/v1/auth/login",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"},
    )
    assert "access-control-allow-origin" not in response.headers


def test_openapi_document_is_complete(client):
    schema = client.get("/openapi.json").json()
    paths = schema["paths"]
    for expected in (
        "/api/v1/auth/login",
        "/api/v1/matches",
        "/api/v1/matches/{match_id}/deliveries",
        "/api/v1/public/matches/{slug}",
        "/api/v1/stream/matches/{slug}",
        "/api/v1/tournaments/{tournament_id}/standings",
        "/api/v1/tools/coin-flip",
    ):
        assert expected in paths, f"{expected} is missing from the OpenAPI document"


@pytest.mark.parametrize("slug", ["ab", "Not-Lower", "trailing-", "with space"])
def test_public_slugs_are_validated_before_touching_the_database(client, slug):
    response = client.get(f"/api/v1/public/matches/{slug}")
    assert response.status_code == 422
