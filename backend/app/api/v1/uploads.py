import uuid
import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from app.dependencies import get_current_user
from app.models.user import User
from app.config import get_settings

router = APIRouter()

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".pdf", ".webp"}
ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp", "application/pdf"}


@router.post("/proof")
async def upload_proof(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    settings = get_settings()

    # Validate file extension
    ext = Path(file.filename).suffix.lower() if file.filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"File type '{ext}' not allowed. Accepted: {', '.join(ALLOWED_EXTENSIONS)}",
        )

    # Validate MIME type
    if file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Content type '{file.content_type}' not allowed",
        )

    # Validate file size
    contents = await file.read()
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(contents) > max_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum {settings.max_upload_size_mb}MB",
        )

    # Generate unique filename and save
    unique_name = f"{uuid.uuid4().hex}{ext}"
    proof_dir = os.path.join(settings.upload_dir, "proofs")
    os.makedirs(proof_dir, exist_ok=True)
    file_path = os.path.join(proof_dir, unique_name)

    with open(file_path, "wb") as f:
        f.write(contents)

    proof_url = f"{settings.backend_url}/uploads/proofs/{unique_name}"
    return {"proof_url": proof_url, "filename": unique_name}
