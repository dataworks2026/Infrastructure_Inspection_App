from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.deps import get_db, get_current_user
from app.models.user import User
from app.models.mission import Mission
from app.models.image import Image
from app.schemas.mission import OdmProcessRequest, OdmStatusResponse
from app.services.odm_service import start_odm_processing, get_odm_result_paths

router = APIRouter()


def _get_mission_or_404(mission_id: str, db: Session, current_user: User) -> Mission:
    m = db.query(Mission).filter(
        Mission.id == mission_id,
        Mission.organization_id == current_user.organization_id,
    ).first()
    if not m:
        raise HTTPException(status_code=404, detail="Mission not found")
    return m


# ── P1-15: POST /odm/process ─────────────────────────────────────────

@router.post("/process")
def process_odm(
    data: OdmProcessRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    m = _get_mission_or_404(data.mission_id, db, current_user)

    # Validate mission has images
    image_count = db.query(Image).filter(Image.mission_id == m.id).count()
    if image_count == 0:
        raise HTTPException(status_code=400, detail="Mission has no images to process")

    if m.odm_status == "processing":
        raise HTTPException(status_code=400, detail="ODM processing already in progress")

    job_id = start_odm_processing(m.id, db)

    m.status = "processing_3d"
    db.commit()

    return {"job_id": job_id, "mission_id": m.id, "status": "processing"}


# ── P1-15: GET /odm/{mission_id}/status ───────────────────────────────

@router.get("/{mission_id}/status", response_model=OdmStatusResponse)
def get_odm_status(
    mission_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    m = _get_mission_or_404(mission_id, db, current_user)
    return OdmStatusResponse(
        mission_id=m.id,
        odm_job_id=m.odm_job_id,
        odm_status=m.odm_status,
    )


# ── P1-15: GET /odm/{mission_id}/result ───────────────────────────────

@router.get("/{mission_id}/result")
def get_odm_result(
    mission_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    m = _get_mission_or_404(mission_id, db, current_user)

    if m.odm_status != "completed":
        raise HTTPException(
            status_code=400,
            detail=f"ODM processing not completed (status: {m.odm_status})",
        )

    results = get_odm_result_paths(m.id)
    if not results:
        raise HTTPException(status_code=404, detail="No ODM output files found")

    return {
        "mission_id": m.id,
        "odm_status": m.odm_status,
        "outputs": results,
    }
