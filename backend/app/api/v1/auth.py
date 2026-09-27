"""Authentication endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response, status

from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.core.errors import Unauthorized
from app.core.rate_limit import RateLimit, auth_rate_limit
from app.models.enums import AuditAction
from app.schemas.auth import (
    LoginRequest,
    RefreshRequest,
    RegisterPendingResponse,
    RegisterRequest,
    TokenResponse,
    UserOut,
)
from app.schemas.common import Message
from app.services import audit_service, auth_service

router = APIRouter(prefix="/auth", tags=["auth"])

register_rate_limit = RateLimit("register", 5, 3600)


def _set_refresh_cookie(response: Response, token: str, max_age: int) -> None:
    if not settings.AUTH_REFRESH_COOKIE_ENABLED:
        return
    response.set_cookie(
        settings.AUTH_REFRESH_COOKIE_NAME,
        token,
        max_age=max_age,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        domain=settings.AUTH_REFRESH_COOKIE_DOMAIN,
        path=f"{settings.API_V1_PREFIX}/auth",
    )


def _clear_refresh_cookie(response: Response) -> None:
    if not settings.AUTH_REFRESH_COOKIE_ENABLED:
        return
    response.delete_cookie(
        settings.AUTH_REFRESH_COOKIE_NAME,
        domain=settings.AUTH_REFRESH_COOKIE_DOMAIN,
        path=f"{settings.API_V1_PREFIX}/auth",
    )


def _read_refresh_token(request: Request, payload: RefreshRequest | None) -> str:
    if payload is not None and payload.refresh_token:
        return payload.refresh_token
    cookie = request.cookies.get(settings.AUTH_REFRESH_COOKIE_NAME)
    if cookie:
        return cookie
    raise Unauthorized("No refresh token was supplied.", code="missing_refresh_token")


def _token_response(user: UserOut, issued: auth_service.IssuedTokens) -> TokenResponse:
    return TokenResponse(
        access_token=issued.access_token,
        expires_in=issued.expires_in,
        # When cookies are in use the browser never needs to see this value.
        refresh_token=None if settings.AUTH_REFRESH_COOKIE_ENABLED else issued.refresh_token,
        user=user,
    )


@router.post(
    "/register",
    response_model=TokenResponse | RegisterPendingResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(register_rate_limit)],
    summary="Create an account and sign in",
)
async def register(
    payload: RegisterRequest,
    request: Request,
    response: Response,
    session: SessionDep,
) -> TokenResponse | RegisterPendingResponse:
    user = await auth_service.register(session, payload, request=request)
    if not user.is_approved and not user.is_admin:
        await session.commit()
        return RegisterPendingResponse(
            message="Account created. An administrator must approve it before you can log in.",
            user=UserOut.model_validate(user),
        )
    issued = await auth_service.issue_tokens(session, user, request=request)
    await session.commit()
    _set_refresh_cookie(response, issued.refresh_token, settings.REFRESH_TOKEN_TTL_SECONDS)
    return _token_response(UserOut.model_validate(user), issued)


@router.post(
    "/login",
    response_model=TokenResponse,
    dependencies=[Depends(auth_rate_limit)],
    summary="Sign in with email and password",
)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    session: SessionDep,
) -> TokenResponse:
    user = await auth_service.authenticate(
        session, email=payload.email, password=payload.password, request=request
    )
    issued = await auth_service.issue_tokens(session, user, request=request)
    await session.commit()
    _set_refresh_cookie(response, issued.refresh_token, settings.REFRESH_TOKEN_TTL_SECONDS)
    return _token_response(UserOut.model_validate(user), issued)


@router.post(
    "/refresh",
    response_model=TokenResponse,
    dependencies=[Depends(RateLimit("refresh", 60, 900))],
    summary="Exchange a refresh token for a new access token",
)
async def refresh(
    request: Request,
    response: Response,
    session: SessionDep,
    payload: RefreshRequest | None = None,
) -> TokenResponse:
    raw = _read_refresh_token(request, payload)
    user, issued = await auth_service.rotate_refresh_token(session, raw, request=request)
    await session.commit()
    _set_refresh_cookie(response, issued.refresh_token, settings.REFRESH_TOKEN_TTL_SECONDS)
    return _token_response(UserOut.model_validate(user), issued)


@router.post("/logout", response_model=Message, summary="Sign out of this device")
async def logout(
    request: Request,
    response: Response,
    session: SessionDep,
    payload: RefreshRequest | None = None,
) -> Message:
    try:
        raw = _read_refresh_token(request, payload)
    except Unauthorized:
        raw = None
    if raw:
        await auth_service.revoke_by_raw_token(session, raw)
        await session.commit()
    _clear_refresh_cookie(response)
    return Message(message="Signed out.")


@router.post(
    "/logout-all",
    response_model=Message,
    summary="Sign out everywhere",
)
async def logout_all(
    request: Request,
    response: Response,
    session: SessionDep,
    user: CurrentUser,
) -> Message:
    await auth_service.revoke_all_sessions(session, user.id, reason="logout_all")
    await audit_service.record(
        session,
        AuditAction.USER_LOGOUT,
        actor_user_id=user.id,
        entity_type="user",
        entity_id=user.id,
        context={"scope": "all_devices"},
        request=request,
    )
    await session.commit()
    _clear_refresh_cookie(response)
    return Message(message="Signed out on all devices.")
