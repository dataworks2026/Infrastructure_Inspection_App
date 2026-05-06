from __future__ import annotations
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
import os, uuid, json, aiofiles

from app.core.deps import get_db, get_current_user
from app.core.config import settings
from app.models.user import User
from app.models.mission import Mission
from app.models.mission_waypoint import MissionWaypoint
from app.models.inspection import Inspection
from app.models.image import Image
from app.models.asset import Asset
from app.models.detection import Detection
from app.schemas.mission import (
    MissionCreate, MissionUpdate, MissionResponse, MissionListResponse,
    MissionStatusResponse, WaypointCreate, WaypointResponse,
)
from app.services.model_router import ModelRouter

router = APIRouter()
model_router = ModelRouter()

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/tiff", "image/webp"}

# ── Valid state transitions ───────────────────────────────────────────
VALID_TRANSITIONS = {
    "planned":        {"preflight", "aborted", "failed"},
    "preflight":      {"in_progress", "aborted", "failed"},
    "in_progress":    {"paused", "uploading", "aborted", "failed"},
    "paused":         {"in_progress", "aborted", "failed"},
    "uploading":      {"analyzing", "aborted", "failed"},
    "analyzing":      {"processing_3d", "completed", "aborted", "failed"},
    "processing_3d":  {"completed", "aborted", "failed"},
}


def _mission_to_response(m: Mission, waypoints: list | None = None) -> MissionResponse:
    wp_list = None
    if waypoints is not None:
        wp_list = [
            WaypointResponse(
                id=w.id, mission_id=w.mission_id,
                sequence_index=w.sequence_index, latitude=w.latitude,
                longitude=w.longitude, altitude_m=w.altitude_m,
                speed_ms=w.speed_ms, gimbal_pitch=w.gimbal_pitch,
                gimbal_yaw=w.gimbal_yaw, heading_deg=w.heading_deg,
                action=w.action, hover_time_s=w.hover_time_s,
                reached_at=w.reached_at, photo_taken=w.photo_taken,
                image_id=w.image_id,
            )
            for w in waypoints
        ]
    return MissionResponse(
        id=m.id, organization_id=m.organization_id,
        inspection_id=m.inspection_id, asset_id=m.asset_id,
        created_by=m.created_by, name=m.name, description=m.description,
        routine_type=m.routine_type, status=m.status,
        drone_model=m.drone_model, drone_serial=m.drone_serial,
        sensor_payload=m.sensor_payload, routine_params=m.routine_params,
        area_of_interest=m.area_of_interest,
        laanc_authorization_id=m.laanc_authorization_id,
        preflight_checklist=m.preflight_checklist,
        planned_start=m.planned_start, actual_start=m.actual_start,
        actual_end=m.actual_end, flight_duration_s=m.flight_duration_s,
        total_waypoints=m.total_waypoints, total_photos=m.total_photos,
        photos_uploaded=m.photos_uploaded, photos_analyzed=m.photos_analyzed,
        odm_job_id=m.odm_job_id, odm_status=m.odm_status,
        waypoints=wp_list, created_at=m.created_at, updated_at=m.updated_at,
    )


def _get_mission_or_404(
    mission_id: str, db: Session, current_user: User
) -> Mission:
    m = db.query(Mission).filter(
        Mission.id == mission_id,
        Mission.organization_id == current_user.organization_id,
    ).first()
    if not m:
        raise HTTPException(status_code=404, detail="Mission not found")
    return m


def _transition(mission: Mission, target: str) -> None:
    allowed = VALID_TRANSITIONS.get(mission.status, set())
    if target not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot transition from '{mission.status}' to '{target}'",
        )
    mission.status = target


# ── P1-2: POST /missions ─────────────────────────────────────────────

@router.post("", response_model=MissionResponse, status_code=201)
def create_mission(
    data: MissionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org_id = current_user.organization_id

    asset = db.query(Asset).filter(
        Asset.id == data.asset_id,
        Asset.organization_id == org_id,
    ).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    # Auto-create inspection linked to this mission
    inspection = Inspection(
        asset_id=data.asset_id,
        organization_id=org_id,
        name=f"Mission: {data.name}",
        status="pending",
        equipment_model=data.drone_model,
        inspection_type="drone",
        inspection_method="automated",
        created_by=current_user.id,
    )
    db.add(inspection)
    db.flush()

    mission = Mission(
        organization_id=org_id,
        inspection_id=inspection.id,
        asset_id=data.asset_id,
        created_by=current_user.id,
        name=data.name,
        description=data.description,
        routine_type=data.routine_type.value,
        status="planned",
        drone_model=data.drone_model,
        drone_serial=data.drone_serial,
        sensor_payload=data.sensor_payload,
        routine_params=data.routine_params,
        area_of_interest=data.area_of_interest,
        laanc_authorization_id=data.laanc_authorization_id,
        preflight_checklist=data.preflight_checklist,
        planned_start=data.planned_start,
    )
    db.add(mission)
    db.flush()

    inspection.mission_id = mission.id

    waypoints = []
    if data.waypoints:
        for wp in data.waypoints:
            w = MissionWaypoint(
                mission_id=mission.id,
                sequence_index=wp.sequence_index,
                latitude=wp.latitude, longitude=wp.longitude,
                altitude_m=wp.altitude_m, speed_ms=wp.speed_ms,
                gimbal_pitch=wp.gimbal_pitch, gimbal_yaw=wp.gimbal_yaw,
                heading_deg=wp.heading_deg, action=wp.action.value,
                hover_time_s=wp.hover_time_s,
            )
            db.add(w)
            waypoints.append(w)
        mission.total_waypoints = len(waypoints)

    db.commit()
    db.refresh(mission)
    return _mission_to_response(mission, waypoints)


# ── P1-3: GET /missions ──────────────────────────────────────────────

@router.get("", response_model=MissionListResponse)
def list_missions(
    asset_id: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Mission).filter(
        Mission.organization_id == current_user.organization_id,
    )
    if asset_id:
        q = q.filter(Mission.asset_id == asset_id)
    if status:
        q = q.filter(Mission.status == status)

    missions = q.order_by(Mission.created_at.desc()).all()
    return MissionListResponse(
        missions=[_mission_to_response(m) for m in missions],
        total=len(missions),
    )


# ── P1-4: GET /missions/{id} ─────────────────────────────────────────

@router.get("/{mission_id}", response_model=MissionResponse)
def get_mission(
    mission_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    m = _get_mission_or_404(mission_id, db, current_user)
    waypoints = (
        db.query(MissionWaypoint)
        .filter(MissionWaypoint.mission_id == mission_id)
        .order_by(MissionWaypoint.sequence_index)
        .all()
    )
    return _mission_to_response(m, waypoints)


# ── P1-5: PATCH /missions/{id} ───────────────────────────────────────

@router.patch("/{mission_id}", response_model=MissionResponse)
def update_mission(
    mission_id: str,
    data: MissionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    m = _get_mission_or_404(mission_id, db, current_user)
    if m.status in ("completed", "aborted", "failed"):
        raise HTTPException(status_code=400, detail="Cannot update a finalized mission")

    for field, value in data.model_dump(exclude_none=True).items():
        if field == "status":
            _transition(m, value.value if hasattr(value, "value") else value)
        else:
            setattr(m, field, value)

    db.commit()
    db.refresh(m)
    return _mission_to_response(m)


# ── P1-6: State transitions ──────────────────────────────────────────

@router.post("/{mission_id}/start", response_model=MissionStatusResponse)
def start_mission(
    mission_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    m = _get_mission_or_404(mission_id, db, current_user)
    if m.status == "planned":
        m.status = "preflight"
    _transition(m, "in_progress")
    m.actual_start = datetime.utcnow()
    db.commit()
    return MissionStatusResponse(id=m.id, status=m.status)


@router.post("/{mission_id}/pause", response_model=MissionStatusResponse)
def pause_mission(
    mission_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    m = _get_mission_or_404(mission_id, db, current_user)
    _transition(m, "paused")
    db.commit()
    return MissionStatusResponse(id=m.id, status=m.status)


@router.post("/{mission_id}/resume", response_model=MissionStatusResponse)
def resume_mission(
    mission_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    m = _get_mission_or_404(mission_id, db, current_user)
    _transition(m, "in_progress")
    db.commit()
    return MissionStatusResponse(id=m.id, status=m.status)


@router.post("/{mission_id}/abort", response_model=MissionStatusResponse)
def abort_mission(
    mission_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    m = _get_mission_or_404(mission_id, db, current_user)
    if m.status in ("completed", "aborted", "failed"):
        raise HTTPException(status_code=400, detail="Mission already finalized")
    m.status = "aborted"
    m.actual_end = datetime.utcnow()
    if m.actual_start:
        m.flight_duration_s = int((m.actual_end - m.actual_start).total_seconds())
    db.commit()
    return MissionStatusResponse(id=m.id, status=m.status)


@router.post("/{mission_id}/complete", response_model=MissionStatusResponse)
def complete_mission(
    mission_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    m = _get_mission_or_404(mission_id, db, current_user)
    _transition(m, "uploading")
    m.actual_end = datetime.utcnow()
    if m.actual_start:
        m.flight_duration_s = int((m.actual_end - m.actual_start).total_seconds())
    db.commit()
    return MissionStatusResponse(id=m.id, status=m.status)


# ── P1-7: Waypoints ──────────────────────────────────────────────────

@router.get("/{mission_id}/waypoints", response_model=List[WaypointResponse])
def get_waypoints(
    mission_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_mission_or_404(mission_id, db, current_user)
    wps = (
        db.query(MissionWaypoint)
        .filter(MissionWaypoint.mission_id == mission_id)
        .order_by(MissionWaypoint.sequence_index)
        .all()
    )
    return [
        WaypointResponse(
            id=w.id, mission_id=w.mission_id,
            sequence_index=w.sequence_index, latitude=w.latitude,
            longitude=w.longitude, altitude_m=w.altitude_m,
            speed_ms=w.speed_ms, gimbal_pitch=w.gimbal_pitch,
            gimbal_yaw=w.gimbal_yaw, heading_deg=w.heading_deg,
            action=w.action, hover_time_s=w.hover_time_s,
            reached_at=w.reached_at, photo_taken=w.photo_taken,
            image_id=w.image_id,
        )
        for w in wps
    ]


@router.put("/{mission_id}/waypoints", response_model=List[WaypointResponse])
def replace_waypoints(
    mission_id: str,
    waypoints: List[WaypointCreate],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    m = _get_mission_or_404(mission_id, db, current_user)

    db.query(MissionWaypoint).filter(
        MissionWaypoint.mission_id == mission_id
    ).delete()

    new_wps = []
    for wp in waypoints:
        w = MissionWaypoint(
            mission_id=mission_id,
            sequence_index=wp.sequence_index,
            latitude=wp.latitude, longitude=wp.longitude,
            altitude_m=wp.altitude_m, speed_ms=wp.speed_ms,
            gimbal_pitch=wp.gimbal_pitch, gimbal_yaw=wp.gimbal_yaw,
            heading_deg=wp.heading_deg, action=wp.action.value,
            hover_time_s=wp.hover_time_s,
        )
        db.add(w)
        new_wps.append(w)

    m.total_waypoints = len(new_wps)
    db.commit()

    for w in new_wps:
        db.refresh(w)

    return [
        WaypointResponse(
            id=w.id, mission_id=w.mission_id,
            sequence_index=w.sequence_index, latitude=w.latitude,
            longitude=w.longitude, altitude_m=w.altitude_m,
            speed_ms=w.speed_ms, gimbal_pitch=w.gimbal_pitch,
            gimbal_yaw=w.gimbal_yaw, heading_deg=w.heading_deg,
            action=w.action, hover_time_s=w.hover_time_s,
            reached_at=w.reached_at, photo_taken=w.photo_taken,
            image_id=w.image_id,
        )
        for w in new_wps
    ]


@router.patch("/{mission_id}/waypoints/{sequence_index}", response_model=WaypointResponse)
def update_waypoint(
    mission_id: str,
    sequence_index: int,
    reached_at: Optional[datetime] = None,
    photo_taken: Optional[bool] = None,
    image_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_mission_or_404(mission_id, db, current_user)
    wp = db.query(MissionWaypoint).filter(
        MissionWaypoint.mission_id == mission_id,
        MissionWaypoint.sequence_index == sequence_index,
    ).first()
    if not wp:
        raise HTTPException(status_code=404, detail="Waypoint not found")

    if reached_at is not None:
        wp.reached_at = reached_at
    if photo_taken is not None:
        wp.photo_taken = photo_taken
    if image_id is not None:
        wp.image_id = image_id

    db.commit()
    db.refresh(wp)
    return WaypointResponse(
        id=wp.id, mission_id=wp.mission_id,
        sequence_index=wp.sequence_index, latitude=wp.latitude,
        longitude=wp.longitude, altitude_m=wp.altitude_m,
        speed_ms=wp.speed_ms, gimbal_pitch=wp.gimbal_pitch,
        gimbal_yaw=wp.gimbal_yaw, heading_deg=wp.heading_deg,
        action=wp.action, hover_time_s=wp.hover_time_s,
        reached_at=wp.reached_at, photo_taken=wp.photo_taken,
        image_id=wp.image_id,
    )


# ── P1-8: POST /missions/{id}/images/upload ──────────────────────────

@router.post("/{mission_id}/images/upload")
async def upload_mission_image(
    mission_id: str,
    file: UploadFile = File(...),
    metadata: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    m = _get_mission_or_404(mission_id, db, current_user)

    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail=f"File type {file.content_type} not allowed")

    meta = {}
    if metadata:
        try:
            meta = json.loads(metadata)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid metadata JSON")

    file_id = str(uuid.uuid4())
    ext = os.path.splitext(file.filename)[1] or ".jpg"
    rel_path = f"inspections/{m.inspection_id}/{file_id}{ext}"
    abs_path = os.path.join(settings.STORAGE_BASE_PATH, rel_path)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)

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
        inspection_id=m.inspection_id,
        organization_id=current_user.organization_id,
        mission_id=m.id,
        filename=file.filename,
        original_filename=file.filename,
        stored_path=rel_path,
        file_size_bytes=file_size,
        content_type=file.content_type,
        analysis_status="queued",
        camera_lens=meta.get("camera_lens"),
        altitude_agl_m=meta.get("altitude_agl_m"),
        gimbal_pitch_deg=meta.get("gimbal_pitch_deg"),
        drone_heading_deg=meta.get("drone_heading_deg"),
        gps_lat=meta.get("gps_lat"),
        gps_lon=meta.get("gps_lon"),
    )
    db.add(img)

    m.total_photos = (m.total_photos or 0) + 1
    m.photos_uploaded = (m.photos_uploaded or 0) + 1

    wp_idx = meta.get("waypoint_index")
    if wp_idx is not None:
        wp = db.query(MissionWaypoint).filter(
            MissionWaypoint.mission_id == m.id,
            MissionWaypoint.sequence_index == wp_idx,
        ).first()
        if wp:
            wp.photo_taken = True
            wp.image_id = file_id

    db.commit()
    return {"image_id": file_id, "stored_path": rel_path}


# ── P1-9: POST /missions/{id}/analyze-all ─────────────────────────────

@router.post("/{mission_id}/analyze-all")
def analyze_all_mission_images(
    mission_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    m = _get_mission_or_404(mission_id, db, current_user)

    images = db.query(Image).filter(
        Image.mission_id == m.id,
        Image.analysis_status == "queued",
    ).all()

    if not images:
        raise HTTPException(status_code=400, detail="No queued images to analyze")

    m.status = "analyzing"
    db.commit()

    asset = db.query(Asset).filter(Asset.id == m.asset_id).first()
    infra_type = asset.infrastructure_type if asset else "unknown"

    analyzed = 0
    failed = 0
    for img in images:
        img.analysis_status = "processing"
        db.commit()
        try:
            abs_path = os.path.join(settings.STORAGE_BASE_PATH, img.stored_path)
            result = model_router.analyze(infra_type, abs_path)

            db.query(Detection).filter(Detection.image_id == img.id).delete()

            for det in result["detections"]:
                d = Detection(
                    image_id=img.id,
                    infrastructure_type=infra_type,
                    damage_type=det["damage_type"],
                    confidence=det["confidence"],
                    bbox_x1=det["bbox"]["x1"],
                    bbox_y1=det["bbox"]["y1"],
                    bbox_x2=det["bbox"]["x2"],
                    bbox_y2=det["bbox"]["y2"],
                    severity=det.get("severity"),
                    annotated_image_path=result.get("annotated_image_path"),
                    raw_yolo_output=det,
                )
                db.add(d)

            img.analysis_status = "completed"
            analyzed += 1
        except Exception:
            img.analysis_status = "failed"
            failed += 1

        db.commit()

    m.photos_analyzed = (m.photos_analyzed or 0) + analyzed

    all_imgs = db.query(Image).filter(Image.mission_id == m.id).all()
    all_done = all(i.analysis_status in ("completed", "failed") for i in all_imgs)
    if all_done:
        m.status = "processing_3d"

    db.commit()
    return {
        "mission_id": m.id,
        "analyzed": analyzed,
        "failed": failed,
        "status": m.status,
    }


# ── GET /missions/{id}/detections — aggregate all detections for twin ──

@router.get("/{mission_id}/detections")
def get_mission_detections(
    mission_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    m = _get_mission_or_404(mission_id, db, current_user)
    image_ids = [i.id for i in db.query(Image.id).filter(Image.mission_id == m.id).all()]
    if not image_ids:
        return []
    detections = db.query(Detection).filter(Detection.image_id.in_(image_ids)).all()
    return [
        {
            "id": d.id,
            "image_id": d.image_id,
            "label": d.damage_type or "Unknown defect",
            "severity": d.severity or "S2",
            "confidence": d.confidence_score or d.confidence or 0.0,
            "bbox": d.bounding_box,
        }
        for d in detections
    ]


# ── P1-10: GET /missions/{id}/status ─────────────────────────────────

@router.get("/{mission_id}/status")
def get_mission_status(
    mission_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    m = _get_mission_or_404(mission_id, db, current_user)
    return {
        "status": m.status,
        "total_photos": m.total_photos,
        "photos_uploaded": m.photos_uploaded,
        "photos_analyzed": m.photos_analyzed,
        "odm_status": m.odm_status,
    }
