from __future__ import annotations
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.deps import get_db, get_current_user
from app.models.user import User
from app.models.image import Image
from app.models.mission import Mission
from app.models.thermal_capture import ThermalCapture
from app.schemas.mission import ThermalProcessRequest, ThermalCaptureResponse
from app.services.thermal_service import process_thermal_image

router = APIRouter()


def _capture_to_response(c: ThermalCapture) -> ThermalCaptureResponse:
    return ThermalCaptureResponse(
        id=c.id,
        image_id=c.image_id,
        mission_id=c.mission_id,
        min_temp_c=c.min_temp_c,
        max_temp_c=c.max_temp_c,
        avg_temp_c=c.avg_temp_c,
        raw_thermal_path=c.raw_thermal_path,
        heatmap_path=f"/storage/{c.heatmap_path}" if c.heatmap_path else None,
        palette=c.palette,
        radiometric_data=c.radiometric_data,
        created_at=c.created_at,
    )


# ── P1-17: POST /thermal/process ─────────────────────────────────────

@router.post("/process", response_model=ThermalCaptureResponse)
def process_thermal(
    data: ThermalProcessRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    img = db.query(Image).filter(
        Image.id == data.image_id,
        Image.organization_id == current_user.organization_id,
    ).first()
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")

    existing = db.query(ThermalCapture).filter(
        ThermalCapture.image_id == data.image_id,
    ).first()
    if existing:
        return _capture_to_response(existing)

    try:
        capture = process_thermal_image(data.image_id, db)
        return _capture_to_response(capture)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Image file not found on disk")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Thermal processing failed: {str(e)}")


# ── P1-17: GET /thermal/{image_id} ───────────────────────────────────

@router.get("/{image_id}", response_model=ThermalCaptureResponse)
def get_thermal_capture(
    image_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    img = db.query(Image).filter(
        Image.id == image_id,
        Image.organization_id == current_user.organization_id,
    ).first()
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")

    capture = db.query(ThermalCapture).filter(
        ThermalCapture.image_id == image_id,
    ).first()
    if not capture:
        raise HTTPException(status_code=404, detail="No thermal data for this image")

    return _capture_to_response(capture)


# ── P1-17: GET /thermal/mission/{mission_id} ──────────────────────────

@router.get("/mission/{mission_id}", response_model=List[ThermalCaptureResponse])
def get_mission_thermal_captures(
    mission_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mission = db.query(Mission).filter(
        Mission.id == mission_id,
        Mission.organization_id == current_user.organization_id,
    ).first()
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")

    captures = db.query(ThermalCapture).filter(
        ThermalCapture.mission_id == mission_id,
    ).all()

    return [_capture_to_response(c) for c in captures]
