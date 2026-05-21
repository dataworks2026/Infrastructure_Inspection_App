"""In-process WebSocket connection manager.

Drones → mobile clients: fan-out telemetry per drone_id.
Alerts → all fleet subscribers: broadcast on new alert.

SITL integration: Sindhu's MAVLink bridge posts telemetry to
POST /api/v1/telemetry/batch; the telemetry router calls
ws_manager.broadcast_telemetry() to push to subscribed mobile clients.
"""
import json
from typing import Dict, List

from fastapi import WebSocket


class TelemetryWSManager:
    def __init__(self) -> None:
        self._connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, drone_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self._connections.setdefault(drone_id, []).append(ws)

    def disconnect(self, drone_id: str, ws: WebSocket) -> None:
        conns = self._connections.get(drone_id, [])
        if ws in conns:
            conns.remove(ws)

    async def broadcast(self, drone_id: str, payload: dict) -> None:
        dead: List[WebSocket] = []
        for ws in list(self._connections.get(drone_id, [])):
            try:
                await ws.send_text(json.dumps(payload))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(drone_id, ws)


class AlertWSManager:
    def __init__(self) -> None:
        self._connections: List[WebSocket] = []

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._connections.append(ws)

    def disconnect(self, ws: WebSocket) -> None:
        if ws in self._connections:
            self._connections.remove(ws)

    async def broadcast(self, payload: dict) -> None:
        dead: List[WebSocket] = []
        for ws in list(self._connections):
            try:
                await ws.send_text(json.dumps(payload))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


telemetry_manager = TelemetryWSManager()
alert_manager = AlertWSManager()
