"""D-6: MissionRecord endpoints (immutable post-flight records)."""
from __future__ import annotations
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.deps import get_db, get_current_user
from app.models.mission_record import MissionRecord
from app.models.user import User
from app.schemas.gcs import (
    MissionRecordCreate, MissionRecordRead, MissionRecordStats,
    FlownAt, MissionRecordOutcome,
    TelemetrySample, CaptureEvent, LogEvent,
)

router = APIRouter()


def _to_read(r: MissionRecord) -> MissionRecordRead:
    stats = MissionRecordStats(
        duration_sec=r.stats_duration_sec,
        total_distance_m=r.stats_total_distance_m,
        max_alt_agl=r.stats_max_alt_agl,
        avg_speed=r.stats_avg_speed,
        max_speed=r.stats_max_speed,
        battery_start_pct=r.stats_battery_start_pct,
        battery_end_pct=r.stats_battery_end_pct,
        photos_planned=r.stats_photos_planned,
        photos_captured=r.stats_photos_captured,
        data_mb=r.stats_data_mb,
        plan_deviation_max_m=r.stats_plan_deviation_max_m,
    )
    telemetry = [TelemetrySample(**s) for s in (r.telemetry_inline or [])]
    captures = [CaptureEvent(**c) for c in (r.captures_json or [])]
    events = [LogEvent(**e) for e in (r.events_json or [])]

    return MissionRecordRead(
        id=r.id,
        plan=r.plan_snapshot,
        flown_at=FlownAt(
            start=r.flown_at_start.isoformat(),
            end=r.flown_at_end.isoformat(),
        ),
        drone_id=r.drone_id,
        pilot_id=r.pilot_id,
        outcome=MissionRecordOutcome(r.outcome),
        reason_if_not_complete=r.reason_if_not_complete,
        stats=stats,
        telemetry=telemetry,
        captures=captures,
        events=events,
    )


@router.get("/", response_model=List[MissionRecordRead])
def list_mission_records(
    drone_id: Optional[str] = None,
    pilot_id: Optional[str] = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(MissionRecord)
    if drone_id:
        q = q.filter(MissionRecord.drone_id == drone_id)
    if pilot_id:
        q = q.filter(MissionRecord.pilot_id == pilot_id)
    return [_to_read(r) for r in q.order_by(MissionRecord.created_at.desc()).all()]


@router.get("/{record_id}", response_model=MissionRecordRead)
def get_mission_record(
    record_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    r = db.query(MissionRecord).filter(MissionRecord.id == record_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Mission record not found")
    return _to_read(r)


@router.post("/", response_model=MissionRecordRead, status_code=201)
def create_mission_record(
    payload: MissionRecordCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    if db.query(MissionRecord).filter(MissionRecord.id == payload.id).first():
        raise HTTPException(status_code=409, detail="Mission record id already exists")

    r = MissionRecord(
        id=payload.id,
        plan_snapshot=payload.plan_snapshot,
        flown_at_start=datetime.fromisoformat(payload.flown_at_start),
        flown_at_end=datetime.fromisoformat(payload.flown_at_end),
        drone_id=payload.drone_id,
        pilot_id=payload.pilot_id,
        mission_id=payload.mission_id,
        outcome=payload.outcome.value,
        reason_if_not_complete=payload.reason_if_not_complete,
        stats_duration_sec=payload.stats.duration_sec,
        stats_total_distance_m=payload.stats.total_distance_m,
        stats_max_alt_agl=payload.stats.max_alt_agl,
        stats_avg_speed=payload.stats.avg_speed,
        stats_max_speed=payload.stats.max_speed,
        stats_battery_start_pct=payload.stats.battery_start_pct,
        stats_battery_end_pct=payload.stats.battery_end_pct,
        stats_photos_planned=payload.stats.photos_planned,
        stats_photos_captured=payload.stats.photos_captured,
        stats_data_mb=payload.stats.data_mb,
        stats_plan_deviation_max_m=payload.stats.plan_deviation_max_m,
        telemetry_inline=(
            [s.model_dump(by_alias=False) for s in payload.telemetry_inline]
            if payload.telemetry_inline else None
        ),
        captures_json=(
            [c.model_dump(by_alias=False) for c in payload.captures_json]
            if payload.captures_json else None
        ),
        events_json=(
            [e.model_dump() for e in payload.events_json]
            if payload.events_json else None
        ),
        telemetry_uri=payload.telemetry_uri,
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return _to_read(r)
