"""D-4/D-5: Fleet snapshot endpoint + /ws/fleet/alerts WebSocket."""
from __future__ import annotations
from typing import List

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.core.deps import get_db, get_current_user
from app.models.drone import Drone
from app.models.alert import Alert
from app.models.user import User
from app.schemas.gcs import (
    AlertRead, AlertTone, AlertCategory, AlertAction,
    DroneRead, DroneBattery, DroneCapabilities, DroneStatus, DroneModel, GcsCameraLens,
    FleetSnapshot, FleetKpis,
)
from app.services.ws_manager import alert_manager

router = APIRouter()


def _drone_to_read(d: Drone) -> DroneRead:
    return DroneRead(
        id=d.id,
        name=d.name,
        serial=d.serial,
        model=DroneModel(d.model),
        fw_version=d.fw_version or "",
        bay=d.bay or "",
        status=DroneStatus(d.status),
        live_telemetry=None,
        current_mission_id=d.current_mission_id,
        battery=DroneBattery(
            pct=d.battery_pct or 0.0,
            voltage=d.battery_voltage or 0.0,
            temp_c=d.battery_temp_c or 0.0,
            cycles=d.battery_cycles or 0,
            pack=d.battery_pack or "",
        ),
        capabilities=DroneCapabilities(
            lenses=[GcsCameraLens(lens) for lens in (d.capabilities_lenses or [])],
            max_flight_time_min=d.capabilities_max_flight_time_min or 0.0,
            max_alt_agl=d.capabilities_max_alt_agl or 0.0,
        ),
        last_seen_at=(d.last_seen_at.isoformat() if d.last_seen_at else ""),
    )


def _alert_to_read(a: Alert) -> AlertRead:
    return AlertRead(
        id=a.id,
        tone=AlertTone(a.tone),
        category=AlertCategory(a.category),
        text=a.text,
        action=AlertAction(label=a.action_label, href=a.action_href),
        created_at=a.created_at.isoformat(),
        acknowledged_by=a.acknowledged_by,
        acknowledged_at=(a.acknowledged_at.isoformat() if a.acknowledged_at else None),
    )


@router.get("/snapshot", response_model=FleetSnapshot)
def fleet_snapshot(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    drones = [_drone_to_read(d) for d in db.query(Drone).all()]
    unacked_alerts = [
        _alert_to_read(a)
        for a in db.query(Alert).filter(Alert.acknowledged_at.is_(None)).all()
    ]
    return FleetSnapshot(
        drones=drones,
        missions_today=[],      # populated by mission engine
        alerts=unacked_alerts,
        kpis=FleetKpis(elapsed_today=0, photos_today=0, data_mb_today=0.0, qa_queue_count=0),
    )


@router.get("/alerts", response_model=List[AlertRead])
def list_alerts(
    ack: bool = False,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(Alert)
    if not ack:
        q = q.filter(Alert.acknowledged_at.is_(None))
    return [_alert_to_read(a) for a in q.order_by(Alert.created_at.desc()).all()]


# ── WebSocket: /ws/fleet/alerts ───────────────────────────────────────────────

@router.websocket("/ws/alerts")
async def fleet_alerts_ws(websocket: WebSocket):
    await alert_manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        alert_manager.disconnect(websocket)
