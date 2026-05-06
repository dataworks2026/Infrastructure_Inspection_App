from __future__ import annotations
from datetime import date
from typing import List, Optional
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.core.deps import get_db, get_current_user
from app.models.user import User
from app.models.mission import Mission
from app.models.flight_log import FlightLog
from app.models.telemetry_point import TelemetryPoint
from app.schemas.mission import FlightLogCreate, FlightLogResponse

router = APIRouter()


def _log_to_response(log: FlightLog) -> FlightLogResponse:
    return FlightLogResponse(
        id=log.id,
        mission_id=log.mission_id,
        organization_id=log.organization_id,
        pilot_id=log.pilot_id,
        pilot_certificate=log.pilot_certificate,
        flight_date=log.flight_date,
        takeoff_time=log.takeoff_time,
        landing_time=log.landing_time,
        flight_duration_s=log.flight_duration_s,
        takeoff_location=log.takeoff_location,
        landing_location=log.landing_location,
        max_altitude_agl_m=log.max_altitude_agl_m,
        max_distance_m=log.max_distance_m,
        max_speed_ms=log.max_speed_ms,
        weather_conditions=log.weather_conditions,
        incidents=log.incidents,
        notes=log.notes,
        laanc_status=log.laanc_status,
        airspace_class=log.airspace_class,
        preflight_checklist=log.preflight_checklist,
        created_at=log.created_at,
    )


# ── POST /flight-logs ────────────────────────────────────────────────

@router.post("", response_model=FlightLogResponse, status_code=201)
def create_flight_log(
    data: FlightLogCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org_id = current_user.organization_id

    # Verify mission belongs to org
    mission = db.query(Mission).filter(
        Mission.id == data.mission_id,
        Mission.organization_id == org_id,
    ).first()
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")

    log = FlightLog(
        mission_id=data.mission_id,
        organization_id=org_id,
        pilot_id=current_user.id,
        pilot_certificate=data.pilot_certificate,
        flight_date=data.flight_date,
        takeoff_time=data.takeoff_time,
        landing_time=data.landing_time,
        flight_duration_s=data.flight_duration_s,
        takeoff_location=data.takeoff_location,
        landing_location=data.landing_location,
        weather_conditions=data.weather_conditions,
        incidents=data.incidents,
        notes=data.notes,
        laanc_status=data.laanc_status,
        airspace_class=data.airspace_class,
        preflight_checklist=data.preflight_checklist,
    )

    # Auto-populate max stats from telemetry if available
    max_alt = db.query(func.max(TelemetryPoint.altitude_agl)).filter(
        TelemetryPoint.mission_id == data.mission_id,
    ).scalar()
    max_spd = db.query(func.max(TelemetryPoint.speed_ms)).filter(
        TelemetryPoint.mission_id == data.mission_id,
    ).scalar()

    log.max_altitude_agl_m = data.max_altitude_agl_m or max_alt
    log.max_speed_ms = data.max_speed_ms or max_spd
    log.max_distance_m = data.max_distance_m

    db.add(log)
    db.commit()
    db.refresh(log)
    return _log_to_response(log)


# ── GET /flight-logs ─────────────────────────────────────────────────

@router.get("", response_model=List[FlightLogResponse])
def list_flight_logs(
    mission_id: Optional[str] = None,
    flight_date: Optional[date] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(FlightLog).filter(
        FlightLog.organization_id == current_user.organization_id,
    )
    if mission_id:
        q = q.filter(FlightLog.mission_id == mission_id)
    if flight_date:
        q = q.filter(FlightLog.flight_date == flight_date)

    logs = q.order_by(FlightLog.created_at.desc()).all()
    return [_log_to_response(log) for log in logs]


# ── GET /flight-logs/{id} ────────────────────────────────────────────

@router.get("/{log_id}", response_model=FlightLogResponse)
def get_flight_log(
    log_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    log = db.query(FlightLog).filter(
        FlightLog.id == log_id,
        FlightLog.organization_id == current_user.organization_id,
    ).first()
    if not log:
        raise HTTPException(status_code=404, detail="Flight log not found")
    return _log_to_response(log)


# ── GET /flight-logs/{id}/export — PDF ───────────────────────────────

@router.get("/{log_id}/export")
def export_flight_log_pdf(
    log_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    log = db.query(FlightLog).filter(
        FlightLog.id == log_id,
        FlightLog.organization_id == current_user.organization_id,
    ).first()
    if not log:
        raise HTTPException(status_code=404, detail="Flight log not found")

    # Get mission + pilot info
    mission = db.query(Mission).filter(Mission.id == log.mission_id).first()
    pilot = db.query(User).filter(User.id == log.pilot_id).first() if log.pilot_id else None

    # Build simple HTML report
    html = f"""
    <html><head><style>
        body {{ font-family: Arial, sans-serif; margin: 40px; }}
        h1 {{ color: #1a365d; border-bottom: 2px solid #1a365d; padding-bottom: 10px; }}
        table {{ width: 100%; border-collapse: collapse; margin-top: 20px; }}
        td, th {{ border: 1px solid #ccc; padding: 8px; text-align: left; }}
        th {{ background: #f0f0f0; width: 200px; }}
        .section {{ margin-top: 30px; }}
        h2 {{ color: #2d3748; }}
    </style></head><body>
    <h1>Flight Log Report</h1>
    <table>
        <tr><th>Mission</th><td>{mission.name if mission else 'N/A'}</td></tr>
        <tr><th>Pilot</th><td>{pilot.full_name if pilot and hasattr(pilot, 'full_name') else (pilot.email if pilot else 'N/A')}</td></tr>
        <tr><th>Pilot Certificate</th><td>{log.pilot_certificate or 'N/A'}</td></tr>
        <tr><th>Flight Date</th><td>{log.flight_date or 'N/A'}</td></tr>
        <tr><th>Takeoff Time</th><td>{log.takeoff_time or 'N/A'}</td></tr>
        <tr><th>Landing Time</th><td>{log.landing_time or 'N/A'}</td></tr>
        <tr><th>Duration</th><td>{log.flight_duration_s or 'N/A'} seconds</td></tr>
        <tr><th>Drone Model</th><td>{mission.drone_model if mission else 'N/A'}</td></tr>
        <tr><th>Drone Serial</th><td>{mission.drone_serial if mission else 'N/A'}</td></tr>
    </table>

    <div class="section">
    <h2>Flight Statistics</h2>
    <table>
        <tr><th>Max Altitude (AGL)</th><td>{log.max_altitude_agl_m or 'N/A'} m</td></tr>
        <tr><th>Max Distance</th><td>{log.max_distance_m or 'N/A'} m</td></tr>
        <tr><th>Max Speed</th><td>{log.max_speed_ms or 'N/A'} m/s</td></tr>
    </table>
    </div>

    <div class="section">
    <h2>Compliance</h2>
    <table>
        <tr><th>LAANC Status</th><td>{log.laanc_status or 'N/A'}</td></tr>
        <tr><th>Airspace Class</th><td>{log.airspace_class or 'N/A'}</td></tr>
    </table>
    </div>

    <div class="section">
    <h2>Weather Conditions</h2>
    <p>{log.weather_conditions or 'Not recorded'}</p>
    </div>

    <div class="section">
    <h2>Notes</h2>
    <p>{log.notes or 'None'}</p>
    </div>

    <div class="section">
    <h2>Incidents</h2>
    <p>{log.incidents or 'None reported'}</p>
    </div>
    </body></html>
    """

    buf = BytesIO(html.encode("utf-8"))
    return StreamingResponse(
        buf,
        media_type="text/html",
        headers={
            "Content-Disposition": f'attachment; filename="flight_log_{log_id}.html"'
        },
    )
