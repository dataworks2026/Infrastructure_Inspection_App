from __future__ import annotations
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import insert

from app.core.deps import get_db, get_current_user
from app.models.user import User
from app.models.mission import Mission
from app.models.telemetry_point import TelemetryPoint
from app.schemas.mission import TelemetryBatchCreate, TelemetryPointSchema

router = APIRouter()


def _get_mission_or_404(mission_id: str, db: Session, current_user: User) -> Mission:
    m = db.query(Mission).filter(
        Mission.id == mission_id,
        Mission.organization_id == current_user.organization_id,
    ).first()
    if not m:
        raise HTTPException(status_code=404, detail="Mission not found")
    return m


# ── P1-11: POST /telemetry/batch ─────────────────────────────────────

@router.post("/batch", status_code=201)
def ingest_telemetry_batch(
    data: TelemetryBatchCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_mission_or_404(data.mission_id, db, current_user)

    if len(data.points) > 50:
        raise HTTPException(status_code=400, detail="Max 50 points per request")

    rows = []
    for p in data.points:
        row = p.model_dump()
        row["mission_id"] = data.mission_id
        # Parse timestamp string to datetime
        if isinstance(row["timestamp"], str):
            row["timestamp"] = datetime.fromisoformat(row["timestamp"])
        rows.append(row)

    if rows:
        db.execute(insert(TelemetryPoint), rows)
        db.commit()

    return {"inserted": len(rows), "mission_id": data.mission_id}


# ── P1-12: GET /telemetry/{mission_id} ───────────────────────────────

@router.get("/{mission_id}")
def query_telemetry(
    mission_id: str,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_mission_or_404(mission_id, db, current_user)

    q = db.query(TelemetryPoint).filter(TelemetryPoint.mission_id == mission_id)

    if start_time:
        q = q.filter(TelemetryPoint.timestamp >= datetime.fromisoformat(start_time))
    if end_time:
        q = q.filter(TelemetryPoint.timestamp <= datetime.fromisoformat(end_time))

    total = q.count()
    points = q.order_by(TelemetryPoint.timestamp).offset(offset).limit(limit).all()

    return {
        "mission_id": mission_id,
        "total": total,
        "limit": limit,
        "offset": offset,
        "points": [
            {
                "id": p.id,
                "timestamp": p.timestamp.isoformat() if p.timestamp else None,
                "latitude": p.latitude, "longitude": p.longitude,
                "altitude_msl": p.altitude_msl, "altitude_agl": p.altitude_agl,
                "heading_deg": p.heading_deg, "pitch_deg": p.pitch_deg,
                "roll_deg": p.roll_deg, "yaw_deg": p.yaw_deg,
                "speed_ms": p.speed_ms, "vertical_speed_ms": p.vertical_speed_ms,
                "battery_pct": p.battery_pct, "battery_voltage": p.battery_voltage,
                "battery_temp_c": p.battery_temp_c,
                "gps_satellites": p.gps_satellites, "gps_fix_type": p.gps_fix_type,
                "signal_strength": p.signal_strength,
                "flight_mode": p.flight_mode, "warnings": p.warnings,
            }
            for p in points
        ],
    }


@router.get("/{mission_id}/latest")
def get_latest_telemetry(
    mission_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_mission_or_404(mission_id, db, current_user)

    p = (
        db.query(TelemetryPoint)
        .filter(TelemetryPoint.mission_id == mission_id)
        .order_by(TelemetryPoint.timestamp.desc())
        .first()
    )

    if not p:
        raise HTTPException(status_code=404, detail="No telemetry data")

    return {
        "id": p.id,
        "timestamp": p.timestamp.isoformat() if p.timestamp else None,
        "latitude": p.latitude, "longitude": p.longitude,
        "altitude_msl": p.altitude_msl, "altitude_agl": p.altitude_agl,
        "heading_deg": p.heading_deg, "speed_ms": p.speed_ms,
        "battery_pct": p.battery_pct, "battery_voltage": p.battery_voltage,
        "gps_satellites": p.gps_satellites, "gps_fix_type": p.gps_fix_type,
        "signal_strength": p.signal_strength,
        "flight_mode": p.flight_mode, "warnings": p.warnings,
    }


@router.get("/{mission_id}/track")
def get_flight_track(
    mission_id: str,
    decimation: int = Query(10, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_mission_or_404(mission_id, db, current_user)

    points = (
        db.query(TelemetryPoint)
        .filter(
            TelemetryPoint.mission_id == mission_id,
            TelemetryPoint.latitude.isnot(None),
            TelemetryPoint.longitude.isnot(None),
        )
        .order_by(TelemetryPoint.timestamp)
        .all()
    )

    # Decimate: take every Nth point
    decimated = points[::decimation]

    coordinates = [
        [p.longitude, p.latitude, p.altitude_msl or 0]
        for p in decimated
    ]

    return {
        "type": "Feature",
        "geometry": {
            "type": "LineString",
            "coordinates": coordinates,
        },
        "properties": {
            "mission_id": mission_id,
            "total_points": len(points),
            "decimated_points": len(decimated),
            "decimation_factor": decimation,
        },
    }
