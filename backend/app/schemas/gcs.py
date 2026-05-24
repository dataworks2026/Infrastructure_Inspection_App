"""GCS Phase D schemas — all camelCase via alias_generator to match shared.ts."""
from __future__ import annotations
from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Tuple
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


# ── camelCase base ─────────────────────────────────────────────────────────────

class GcsBase(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


# ── D-3: RoutineId (canonical GCS enum — matches mobile shared.ts) ─────────────

class RoutineId(str, Enum):
    ORBIT       = "ORBIT"
    FACADE      = "FACADE"
    GRID        = "GRID"
    PERIMETER   = "PERIMETER"
    CORRIDOR    = "CORRIDOR"
    MANUAL      = "MANUAL"

    @classmethod
    def _missing_(cls, value: object) -> "RoutineId | None":
        if isinstance(value, str):
            for member in cls:
                if member.value == value.upper():
                    return member
        return None


# ── D-4: Drone enums ───────────────────────────────────────────────────────────

class DroneStatus(str, Enum):
    preflight   = "preflight"
    flying      = "flying"
    returning   = "returning"
    idle        = "idle"
    charging    = "charging"
    offline     = "offline"
    maintenance = "maintenance"


class DroneModel(str, Enum):
    M350        = "M350"
    M300        = "M300"
    M30T        = "M30T"
    Mavic3T     = "Mavic 3T"
    Anafi       = "Anafi"


class GcsCameraLens(str, Enum):
    WIDE = "WIDE"
    ZOOM = "ZOOM"
    IR   = "IR"
    LRF  = "LRF"


class RtkStatus(str, Enum):
    FIX   = "FIX"
    FLOAT = "FLOAT"
    NONE  = "NONE"


# ── D-4: LiveTelemetry sub-schemas ─────────────────────────────────────────────

class TelemetryPosition(GcsBase):
    lat: float
    lng: float
    altitude_agl: float
    altitude_msl: float


class TelemetryGimbal(GcsBase):
    pitch: float
    yaw: float


class TelemetryBattery(GcsBase):
    pct: float
    voltage: float
    temp_c: float


class TelemetryLink(GcsBase):
    strength_dbm: float
    quality: int


class TelemetryGps(GcsBase):
    sats: int
    hdop: float


class TelemetryWind(GcsBase):
    ms: float
    bearing: float


class LiveTelemetry(GcsBase):
    ts: str                         # ISO datetime string
    position: TelemetryPosition
    heading: float
    speed: float
    vspeed: float
    gimbal: TelemetryGimbal
    home_distance_m: float
    home_bearing_deg: float
    battery: TelemetryBattery
    link: TelemetryLink
    gps: TelemetryGps
    rtk: RtkStatus
    wind_estimate: TelemetryWind


# ── D-4: Drone schemas ─────────────────────────────────────────────────────────

class DroneBattery(GcsBase):
    pct: float
    voltage: float
    temp_c: float
    cycles: int
    pack: str


class DroneCapabilities(GcsBase):
    lenses: List[GcsCameraLens]
    max_flight_time_min: float
    max_alt_agl: float


class DroneRead(GcsBase):
    id: str
    name: str
    serial: str
    model: DroneModel
    fw_version: str
    bay: str
    status: DroneStatus
    live_telemetry: Optional[LiveTelemetry] = None
    current_mission_id: Optional[str] = None
    battery: DroneBattery
    capabilities: DroneCapabilities
    last_seen_at: str


class DroneCreate(GcsBase):
    id: str                         # human-readable, set by caller: "M350-A"
    name: str
    serial: str
    model: DroneModel
    fw_version: Optional[str] = None
    bay: Optional[str] = None
    battery_pct: Optional[float] = None
    battery_voltage: Optional[float] = None
    battery_temp_c: Optional[float] = None
    battery_cycles: Optional[int] = None
    battery_pack: Optional[str] = None
    capabilities_lenses: Optional[List[GcsCameraLens]] = None
    capabilities_max_flight_time_min: Optional[float] = None
    capabilities_max_alt_agl: Optional[float] = None


class DroneUpdate(GcsBase):
    name: Optional[str] = None
    fw_version: Optional[str] = None
    bay: Optional[str] = None
    status: Optional[DroneStatus] = None
    current_mission_id: Optional[str] = None
    battery_pct: Optional[float] = None
    battery_voltage: Optional[float] = None
    battery_temp_c: Optional[float] = None
    battery_cycles: Optional[int] = None
    battery_pack: Optional[str] = None
    capabilities_lenses: Optional[List[GcsCameraLens]] = None
    capabilities_max_flight_time_min: Optional[float] = None
    capabilities_max_alt_agl: Optional[float] = None


# ── D-4: WebSocket message envelopes ──────────────────────────────────────────

class WsTelemetryMessage(GcsBase):
    type: Literal["telemetry"] = "telemetry"
    drone_id: str
    data: LiveTelemetry


class WsAlertMessage(GcsBase):
    type: Literal["alert"] = "alert"
    data: "AlertRead"


# ── D-5: Alert ────────────────────────────────────────────────────────────────

class AlertTone(str, Enum):
    red   = "red"
    amber = "amber"


class AlertCategory(str, Enum):
    drone_offline    = "drone_offline"
    battery_service  = "battery_service"
    weather          = "weather"
    airspace         = "airspace"
    other            = "other"


class AlertAction(GcsBase):
    label: str
    href: Optional[str] = None


class AlertRead(GcsBase):
    id: str
    tone: AlertTone
    category: AlertCategory
    text: str
    action: AlertAction
    created_at: str
    acknowledged_by: Optional[str] = None
    acknowledged_at: Optional[str] = None


class AlertCreate(GcsBase):
    tone: AlertTone
    category: AlertCategory
    text: str
    action: AlertAction


# ── D-5: Geofence ─────────────────────────────────────────────────────────────

class NoFlyZone(GcsBase):
    name: str
    polygon: List[Tuple[float, float]]
    active_from: Optional[str] = None
    active_until: Optional[str] = None


class GeofenceRead(GcsBase):
    id: str
    name: str
    site_id: str
    polygon: List[Tuple[float, float]]
    max_alt_agl: float
    no_fly_zones: Optional[List[NoFlyZone]] = None
    notes: Optional[str] = None


class GeofenceCreate(GcsBase):
    name: str
    site_id: str
    polygon: List[Tuple[float, float]]
    max_alt_agl: float
    no_fly_zones: Optional[List[NoFlyZone]] = None
    notes: Optional[str] = None


class GeofenceUpdate(GcsBase):
    name: Optional[str] = None
    site_id: Optional[str] = None
    polygon: Optional[List[Tuple[float, float]]] = None
    max_alt_agl: Optional[float] = None
    no_fly_zones: Optional[List[NoFlyZone]] = None
    notes: Optional[str] = None


# ── D-5: Pilot ────────────────────────────────────────────────────────────────

class LicenseKind(str, Enum):
    Part107    = "Part107"
    EASA_A1A3  = "EASA_A1A3"
    EASA_A2    = "EASA_A2"
    other      = "other"


class PilotRole(str, Enum):
    pilot      = "pilot"
    dispatcher = "dispatcher"
    admin      = "admin"


class PilotLicense(GcsBase):
    kind: LicenseKind
    number: str
    expires_at: str


class PilotInsurance(GcsBase):
    carrier: str
    coverage_usd: float
    active_until: str


class PilotRead(GcsBase):
    id: str
    name: str
    initials: str
    email: str
    license: PilotLicense
    insurance: Optional[PilotInsurance] = None
    role: PilotRole
    active: bool


class PilotCreate(GcsBase):
    name: str
    initials: str
    email: str
    license: PilotLicense
    insurance: Optional[PilotInsurance] = None
    role: PilotRole = PilotRole.pilot
    active: bool = True
    user_id: Optional[str] = None   # link to auth user


class PilotUpdate(GcsBase):
    name: Optional[str] = None
    initials: Optional[str] = None
    license: Optional[PilotLicense] = None
    insurance: Optional[PilotInsurance] = None
    role: Optional[PilotRole] = None
    active: Optional[bool] = None


# ── D-5: Fleet snapshot ───────────────────────────────────────────────────────

class FleetKpis(GcsBase):
    elapsed_today: int       # seconds
    photos_today: int
    data_mb_today: float
    qa_queue_count: int


class FleetMission(GcsBase):
    id: str
    name: str
    asset_id: str
    drone_id: str
    operator_id: str
    state: Literal["scheduled", "in_flight", "complete", "cancelled"]
    scheduled_at: str
    started_at: Optional[str] = None
    progress: Optional[float] = None
    photos_captured: Optional[int] = None
    photos_planned: Optional[int] = None
    eta_seconds: Optional[int] = None
    completed_at: Optional[str] = None
    duration_sec: Optional[int] = None
    cancellation_reason: Optional[str] = None


class FleetSnapshot(GcsBase):
    drones: List[DroneRead]
    missions_today: List[FleetMission]
    alerts: List[AlertRead]
    kpis: FleetKpis


# ── D-6: MissionRecord value objects ──────────────────────────────────────────

class TelemetrySample(GcsBase):
    """Compact post-flight sample — matches TS TelemetrySample exactly."""
    t: float                       # seconds since takeoff
    alt: float
    batt: float
    spd: float
    vspd: Optional[float] = None
    heading: Optional[float] = None
    lat: Optional[float] = None
    lng: Optional[float] = None


class UploadState(str, Enum):
    uploaded  = "uploaded"
    uploading = "uploading"
    queued    = "queued"
    failed    = "failed"


class CaptureEvent(GcsBase):
    id: str
    t: float
    wp: int
    lens_id: GcsCameraLens
    format: str
    bytes: int
    upload_state: UploadState
    storage_uri: Optional[str] = None
    exif: Optional[Dict[str, Any]] = None


class LogEvent(BaseModel):
    """Uses plain BaseModel — no camelCase needed, matches TS LogEvent short fields."""
    t: float
    tone: Literal["cyan", "amber", "green", "blue", "red"]
    icon: str
    label: str
    detail: str
    source: Literal["pilot", "flight_ctrl", "mission_engine", "cloud_sync"]


# ── D-6: MissionRecord ────────────────────────────────────────────────────────

class MissionRecordOutcome(str, Enum):
    complete   = "complete"
    aborted    = "aborted"
    land_safe  = "land_safe"
    crash      = "crash"


class MissionRecordStats(GcsBase):
    duration_sec: int
    total_distance_m: float
    max_alt_agl: float
    avg_speed: float
    max_speed: float
    battery_start_pct: float
    battery_end_pct: float
    photos_planned: int
    photos_captured: int
    data_mb: float
    plan_deviation_max_m: float


class FlownAt(GcsBase):
    start: str
    end: str


class MissionRecordRead(GcsBase):
    id: str
    plan: Dict[str, Any]
    flown_at: FlownAt
    drone_id: str
    pilot_id: str
    outcome: MissionRecordOutcome
    reason_if_not_complete: Optional[str] = None
    stats: MissionRecordStats
    telemetry: List[TelemetrySample]
    captures: List[CaptureEvent]
    events: List[LogEvent]


class MissionRecordCreate(GcsBase):
    id: str
    plan_snapshot: Dict[str, Any]
    flown_at_start: str
    flown_at_end: str
    drone_id: str
    pilot_id: str
    mission_id: Optional[str] = None
    outcome: MissionRecordOutcome
    reason_if_not_complete: Optional[str] = None
    stats: MissionRecordStats
    telemetry_inline: Optional[List[TelemetrySample]] = None
    captures_json: Optional[List[CaptureEvent]] = None
    events_json: Optional[List[LogEvent]] = None
    telemetry_uri: Optional[str] = None


# Resolve forward ref for WsAlertMessage
WsAlertMessage.model_rebuild()
