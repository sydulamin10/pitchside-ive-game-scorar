"""Account management for the signed-in user."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Request

from app.api.deps import CurrentUser, SessionDep
from app.schemas.auth import PasswordChangeRequest, SessionOut, UserOut
from app.schemas.common import Message
from app.services import auth_service

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserOut, summary="Who am I")
async def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)


@router.post("/me/password", response_model=Message, summary="Change password")
async def change_password(
    payload: PasswordChangeRequest,
    request: Request,
    session: SessionDep,
    user: CurrentUser,
) -> Message:
    await auth_service.change_password(
        session,
        user,
        current_password=payload.current_password,
        new_password=payload.new_password,
        request=request,
    )
    await session.commit()
    return Message(message="Password changed. You have been signed out on your other devices.")


@router.get("/me/sessions", response_model=list[SessionOut], summary="Active sessions")
async def list_sessions(session: SessionDep, user: CurrentUser) -> list[SessionOut]:
    rows = await auth_service.list_sessions(session, user.id)
    return [SessionOut.model_validate(row) for row in rows]


@router.delete("/me/sessions/{session_id}", response_model=Message, summary="Revoke one session")
async def revoke_session(session_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> Message:
    await auth_service.revoke_session(session, session_id=session_id, user_id=user.id)
    await session.commit()
    return Message(message="Session revoked.")
