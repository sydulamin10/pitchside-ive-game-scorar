"""Public site content (WhatsApp, FAQ, tutorials) with admin management."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter

from app.api.deps import AdminUser, SessionDep
from app.schemas.common import Message
from app.schemas.content import (
    SiteContentUpdate,
    TutorialCreate,
    TutorialOut,
    TutorialUpdate,
)
from app.services import content_service

router = APIRouter(prefix="/content", tags=["content"])


# ----------------------------------------------------------------- public reads


@router.get("/site", summary="Public site content (WhatsApp, FAQ, rates)")
async def get_site(session: SessionDep) -> dict[str, Any]:
    return await content_service.public_site(session)


@router.get("/tutorials", response_model=list[TutorialOut], summary="Active tutorials")
async def list_tutorials(session: SessionDep) -> list[TutorialOut]:
    rows = await content_service.list_tutorials(session, active_only=True)
    return [TutorialOut.model_validate(content_service.tutorial_out(r)) for r in rows]


# ------------------------------------------------------------------ admin writes


@router.put("/admin/site", summary="Update site content")
async def update_site(
    payload: SiteContentUpdate, session: SessionDep, _admin: AdminUser
) -> dict[str, Any]:
    await content_service.save_site(session, payload.model_dump(exclude_unset=True))
    await session.commit()
    return await content_service.public_site(session)


@router.get(
    "/admin/tutorials", response_model=list[TutorialOut], summary="All tutorials (admin)"
)
async def admin_list_tutorials(session: SessionDep, _admin: AdminUser) -> list[TutorialOut]:
    rows = await content_service.list_tutorials(session)
    return [TutorialOut.model_validate(content_service.tutorial_out(r)) for r in rows]


@router.post("/admin/tutorials", response_model=TutorialOut, summary="Add a tutorial")
async def create_tutorial(
    payload: TutorialCreate, session: SessionDep, _admin: AdminUser
) -> TutorialOut:
    row = await content_service.create_tutorial(
        session,
        title=payload.title,
        url=payload.url,
        description=payload.description,
        sort_order=payload.sort_order,
        is_active=payload.is_active,
    )
    await session.commit()
    return TutorialOut.model_validate(content_service.tutorial_out(row))


@router.patch(
    "/admin/tutorials/{tutorial_id}", response_model=TutorialOut, summary="Edit a tutorial"
)
async def update_tutorial(
    tutorial_id: uuid.UUID,
    payload: TutorialUpdate,
    session: SessionDep,
    _admin: AdminUser,
) -> TutorialOut:
    row = await content_service.update_tutorial(
        session, tutorial_id, payload.model_dump(exclude_unset=True)
    )
    await session.commit()
    return TutorialOut.model_validate(content_service.tutorial_out(row))


@router.delete("/admin/tutorials/{tutorial_id}", response_model=Message)
async def delete_tutorial(
    tutorial_id: uuid.UUID, session: SessionDep, _admin: AdminUser
) -> Message:
    await content_service.delete_tutorial(session, tutorial_id)
    await session.commit()
    return Message(message="Tutorial removed.")
