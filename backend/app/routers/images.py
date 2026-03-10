from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import List, Optional
import os, uuid, aiofiles

from app.core.deps import get_db, get_current_user
from app.core.config import settings
from app.models.user import User
from app.models.inspection import Inspection
from app.models.image import Image
from app.schemas.image import ImageRecord, ImageUploadItem, ImageUploadResponse, ImageUpdate

router = APIRouter()

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/tiff", "image/webp"}


def _image_to_record(img: Image) -> ImageRecord:
    """Convert a DB Image row to an ImageRecord response."""
    return ImageRecord(
        id=img.id,
        inspection_id=img.inspection_id,
        filename=img.filename,
        original_filename=img.original_filename,
        component_type=img.component_type,
        analysis_status=img.analysis_status,
        url=f"/storage/{img.stored_path}" if img.stored_path else "",
        capture_datetime=img.capture_datetime,
        gps_lat=img.gps_lat,
        gps_lon=img.gps_lon,
        file_size_bytes=img.file_size_bytes,
        content_type=img.content_type,
        blur_detected=img.blur_detected,
        glare_detected=img.glare_detected,
        image_quality_score=img.image_quality_score,
        annotation_status=img.annotation_status,
        num_annotations=img.num_annotations,
        created_at=img.created_at,
    )


@router.post(
    "/inspections/{inspection_id}/images/upload",
    response_model=ImageUploadResponse,
)
async def upload_images(
    inspection_id: str,
    files: List[UploadFile] = File(...),
    component_type: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    inspection = db.query(Inspection).filter(
        Inspection.id == inspection_id,
        Inspection.organization_id == current_user.organization_id,
    ).first()
    if not inspection:
        raise HTTPException(status_code=404, detail="Inspection not found")

    uploaded: List[ImageUploadItem] = []
    for file in files:
        if file.content_type not in ALLOWED_TYPES:
            raise HTTPException(
                status_code=400, detail=f"File type {file.content_type} not allowed"
            )

        file_id = str(uuid.uuid4())
        ext = os.path.splitext(file.filename)[1] or ".jpg"
        rel_path = f"inspections/{inspection_id}/{file_id}{ext}"
        abs_path = os.path.join(settings.STORAGE_BASE_PATH, rel_path)
        os.makedirs(os.path.dirname(abs_path), exist_ok=True)

        # Stream to disk in 256 KB chunks — avoids loading entire file into RAM
        CHUNK = 256 * 1024
        file_size = 0
        async with aiofiles.open(abs_path, "wb") as f:
            while True:
                chunk = await file.read(CHUNK)
                if not chunk:
                    break
                await f.write(chunk)
                file_size += len(chunk)

        img = Image(
            id=file_id,
            inspection_id=inspection_id,
            organization_id=current_user.organization_id,
            filename=file.filename,
            original_filename=file.filename,
            stored_path=rel_path,
            file_size_bytes=file_size,
            content_type=file.content_type,
            component_type=component_type,
            analysis_status="queued",
        )
        db.add(img)
        uploaded.append(ImageUploadItem(id=file_id, filename=file.filename, status="queued"))

    db.commit()
    return ImageUploadResponse(uploaded=len(uploaded), images=uploaded)


@router.get(
    "/inspections/{inspection_id}/images",
    response_model=List[ImageRecord],
)
def get_inspection_images(
    inspection_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Verify the inspection belongs to the user's org
    inspection = db.query(Inspection).filter(
        Inspection.id == inspection_id,
        Inspection.organization_id == current_user.organization_id,
    ).first()
    if not inspection:
        raise HTTPException(status_code=404, detail="Inspection not found")

    images = db.query(Image).filter(
        Image.inspection_id == inspection_id,
        Image.deleted_at.is_(None),
    ).all()
    return [_image_to_record(img) for img in images]


@router.get("/images/gps-points")
def get_image_gps_points(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return all images with GPS coordinates for the org, with detection summary."""
    from sqlalchemy import func
    from app.models.detection import Detection
    from app.models.inspection import Inspection as InspectionModel

    org_id = current_user.organization_id

    rows = (
        db.query(
            Image.id,
            Image.gps_lat,
            Image.gps_lon,
            Image.gps_accuracy_m,
            Image.stored_path,
            Image.filename,
            InspectionModel.id.label("inspection_id"),
            InspectionModel.name.label("inspection_name"),
            func.count(Detection.id).label("detection_count"),
            func.max(Detection.severity).label("max_severity"),
        )
        .join(InspectionModel, Image.inspection_id == InspectionModel.id)
        .outerjoin(Detection, Detection.image_id == Image.id)
        .filter(
            Image.organization_id == org_id,
            Image.gps_lat.isnot(None),
            Image.gps_lon.isnot(None),
            Image.deleted_at.is_(None),
        )
        .group_by(
            Image.id, Image.gps_lat, Image.gps_lon, Image.gps_accuracy_m,
            Image.stored_path, Image.filename,
            InspectionModel.id, InspectionModel.name,
        )
        .all()
    )

    points = [
        {
            "id": row.id,
            "lat": row.gps_lat,
            "lon": row.gps_lon,
            "gps_accuracy_m": row.gps_accuracy_m,
            "inspection_id": row.inspection_id,
            "inspection_name": row.inspection_name,
            "filename": row.filename,
            "detection_count": row.detection_count,
            "max_severity": row.max_severity,
            "thumbnail_url": f"/storage/{row.stored_path}" if row.stored_path else None,
        }
        for row in rows
    ]
    return {"points": points, "count": len(points)}


@router.get(
    "/images/{image_id}",
    response_model=ImageRecord,
)
def get_image(
    image_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    img = db.query(Image).filter(
        Image.id == image_id,
        Image.organization_id == current_user.organization_id,
        Image.deleted_at.is_(None),
    ).first()
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    return _image_to_record(img)


@router.patch(
    "/images/{image_id}",
    response_model=ImageRecord,
)
def update_image(
    image_id: str,
    data: ImageUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    img = db.query(Image).filter(
        Image.id == image_id,
        Image.organization_id == current_user.organization_id,
        Image.deleted_at.is_(None),
    ).first()
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")

    for field, value in data.model_dump(exclude_none=True).items():
        setattr(img, field, value)

    db.commit()
    db.refresh(img)
    return _image_to_record(img)
