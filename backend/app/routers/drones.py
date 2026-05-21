"""D-4: Drone fleet REST endpoints + /ws/drones/{id}/telemetry WebSocket."""
from __future__ import annotations
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.core.deps import get_db, get_current_user
from app.models.drone import Drone
from app.models.user import User
from app.schemas.gcs import (
    DroneCreate, DroneUpdate, DroneRead, DroneBattery, DroneCapabilities,
    GcsCameraLens, DroneStatus, DroneModel, WsTelemetryMessage,
)
from app.services.ws_manager import telemetry_manager

router = APIRouter()


def _to_read(d: Drone) -> DroneRead:
    return DroneRead(
        id=d.id,
        name=d.name,
        serial=d.serial,
        model=DroneModel(d.model),
        fw_version=d.fw_version or "",
        bay=d.bay or "",
        status=DroneStatus(d.status),
        live_telemetry=None,   # injected by WS; REST snapshot returns None
        current_mission_id=d.current_mission_id,
        battery=DroneBattery(
            pct=d.battery_pct or 0.0,
            voltage=d.battery_voltage or 0.0,
            temp_c=d.battery_temp_c or 0.0,
            cycles=d.battery_cycles or 0,
            pack=d.battery_pack or "",
        ),
        capabilities=DroneCapabilities(
            lenses=[GcsCameraLens(l) for l in (d.capabilities_lenses or [])],
            max_flight_time_min=d.capabilities_max_flight_time_min or 0.0,
            max_alt_agl=d.capabilities_max_alt_agl or 0.0,
        ),
        last_seen_at=(d.last_seen_at.isoformat() if d.last_seen_at else ""),
    )


# ── REST: fleet list ──────────────────────────────────────────────────────────

@router.get("/", response_model=List[DroneRead])
def list_drones(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return [_to_read(d) for d in db.query(Drone).all()]


@router.get("/{drone_id}", response_model=DroneRead)
def get_drone(
    drone_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    d = db.query(Drone).filter(Drone.id == drone_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Drone not found")
    return _to_read(d)


@router.post("/", response_model=DroneRead, status_code=201)
def create_drone(
    payload: DroneCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    if db.query(Drone).filter(Drone.id == payload.id).first():
        raise HTTPException(status_code=409, detail="Drone id already exists")
    d = Drone(
        id=payload.id,
        name=payload.name,
        serial=payload.serial,
        model=payload.model.value,
        fw_version=payload.fw_version,
        bay=payload.bay,
        battery_pct=payload.battery_pct,
        battery_voltage=payload.battery_voltage,
        battery_temp_c=payload.battery_temp_c,
        battery_cycles=payload.battery_cycles,
        battery_pack=payload.battery_pack,
        capabilities_lenses=[l.value for l in (payload.capabilities_lenses or [])],
        capabilities_max_flight_time_min=payload.capabilities_max_flight_time_min,
        capabilities_max_alt_agl=payload.capabilities_max_alt_agl,
    )
    db.add(d)
    db.commit()
    db.refresh(d)
    return _to_read(d)


@router.patch("/{drone_id}", response_model=DroneRead)
def update_drone(
    drone_id: str,
    payload: DroneUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    d = db.query(Drone).filter(Drone.id == drone_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Drone not found")
    update_data = payload.model_dump(exclude_none=True, by_alias=False)
    if "capabilities_lenses" in update_data:
        update_data["capabilities_lenses"] = [l.value for l in update_data["capabilities_lenses"]]
    if "status" in update_data:
        update_data["status"] = update_data["status"].value
    for k, v in update_data.items():
        setattr(d, k, v)
    db.commit()
    db.refresh(d)
    return _to_read(d)


# ── WebSocket: /ws/drones/{drone_id}/telemetry ────────────────────────────────

@router.websocket("/ws/{drone_id}/telemetry")
async def drone_telemetry_ws(
    drone_id: str,
    websocket: WebSocket,
    db: Session = Depends(get_db),
):
    drone = db.query(Drone).filter(Drone.id == drone_id).first()
    if not drone:
        await websocket.close(code=4404)
        return

    await telemetry_manager.connect(drone_id, websocket)
    try:
        while True:
            # Keep connection alive; server pushes telemetry via broadcast
            await websocket.receive_text()
    except WebSocketDisconnect:
        telemetry_manager.disconnect(drone_id, websocket)
