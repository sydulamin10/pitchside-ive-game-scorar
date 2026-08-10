"""Media upload endpoints (signed R2 PUT or local development store)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response

from app.api.deps import CurrentUser
from app.core.rate_limit import write_rate_limit
from app.schemas.media import MediaUploadUrlRequest, MediaUploadUrlResponse
from app.services import media_service

router = APIRouter(prefix="/media", tags=["media"])


@router.post(
    "/upload-url",
    response_model=MediaUploadUrlResponse,
    dependencies=[Depends(write_rate_limit)],
    summary="Mint a signed upload URL for a logo or photo",
)
async def mint_upload_url(
    payload: MediaUploadUrlRequest, user: CurrentUser
) -> MediaUploadUrlResponse:
    return media_service.create_upload_url(user_id=str(user.id), payload=payload)


@router.put(
    "/local/{token}",
    status_code=204,
    summary="Accept a local development media upload",
    include_in_schema=True,
)
async def put_local_upload(token: str, request: Request) -> Response:
    body = await request.body()
    media_service.store_local_upload(
        token=token,
        body=body,
        content_type=request.headers.get("content-type"),
    )
    return Response(status_code=204)
