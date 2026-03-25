from __future__ import annotations
from datetime import datetime, date
from enum import Enum
from typing import List, Optional
from pydantic import BaseModel


# ── Enums ──────────────────────────────────────────────────────────────

class RoutineType(str, Enum):
    sweep = "sweep"
    orbit = "orbit"
    traverse = "traverse"
    grid = "grid"
    crawl = "crawl"
    scout = "scout"


class MissionStatus(str, Enum):
    planned = "planned"
    preflight = "preflight"
    in_progress = "in_progress"
    paused = "paused"
    uploading = "uploading"
    analyzing = "analyzing"
    processing_3d = "processing_3d"
    completed = "completed"
    aborted = "aborted"
    failed = "failed"


class WaypointAction(str, Enum):
    photo_all = "photo_all"
    photo_zoom = "photo_zoom"
    photo_thermal = "photo_thermal"
    photo_wide = "photo_wide"
    hover = "hover"
    none = "none"


class CameraLens(str, Enum):
    zoom = "zoom"
    wide = "wide"
    thermal = "thermal"
    laser_rangefinder = "laser_rangefinder"


# ── Waypoints ──────────────────────────────────────────────────────────

class WaypointCreate(BaseModel):
    sequence_index: int
    latitude: float
    longitude: float
    altitude_m: float
    speed_ms: Optional[float] = None
    gimbal_pitch: Optional[float] = None
    gimbal_yaw: Optional[float] = None
    heading_deg: Optional[float] = None
    action: WaypointAction = WaypointAction.photo_all
    hover_time_s: Optional[float] = None


class WaypointResponse(WaypointCreate):
    id: str
    mission_id: str
    reached_at: Optional[datetime] = None
    photo_taken: bool = False
    image_id: Optional[str] = None

    class Config:
        from_attributes = True


# ── Routine Params ─────────────────────────────────────────────────────

class SweepParams(BaseModel):
    altitude_m: float
    speed_ms: float
    line_spacing_m: float
    heading_deg: float
    overlap_pct: Optional[float] = 80.0


class OrbitParams(BaseModel):
    center_lat: float
    center_lon: float
    radius_m: float
    altitude_m: float
    speed_ms: float
    num_points: int
    gimbal_pitch: Optional[float] = -45.0


class GridParams(BaseModel):
    altitude_m: float
    speed_ms: float
    spacing_m: float
    overlap_pct: Optional[float] = 75.0
    cross_hatch: Optional[bool] = False


class TraverseParams(BaseModel):
    altitude_m: float
    speed_ms: float
    waypoints: List[WaypointCreate]


class CrawlParams(BaseModel):
    altitude_m: float
    speed_ms: float
    distance_to_subject_m: float
    vertical_step_m: float
    horizontal_step_m: float


class ScoutParams(BaseModel):
    altitude_m: float
    speed_ms: float
    loiter_time_s: Optional[float] = 5.0


# ── Mission ────────────────────────────────────────────────────────────

class MissionCreate(BaseModel):
    asset_id: str
    inspection_id: Optional[str] = None
    name: str
    description: Optional[str] = None
    routine_type: RoutineType
    drone_model: Optional[str] = None
    drone_serial: Optional[str] = None
    sensor_payload: Optional[str] = None
    routine_params: Optional[dict] = None
    area_of_interest: Optional[dict] = None
    laanc_authorization_id: Optional[str] = None
    preflight_checklist: Optional[dict] = None
    planned_start: Optional[datetime] = None
    waypoints: Optional[List[WaypointCreate]] = None


class MissionUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[MissionStatus] = None
    drone_model: Optional[str] = None
    drone_serial: Optional[str] = None
    sensor_payload: Optional[str] = None
    routine_params: Optional[dict] = None
    area_of_interest: Optional[dict] = None
    laanc_authorization_id: Optional[str] = None
    preflight_checklist: Optional[dict] = None
    planned_start: Optional[datetime] = None


class MissionResponse(BaseModel):
    id: str
    organization_id: Optional[str] = None
    inspection_id: Optional[str] = None
    asset_id: str
    created_by: Optional[str] = None
    name: str
    description: Optional[str] = None
    routine_type: str
    status: str
    drone_model: Optional[str] = None
    drone_serial: Optional[str] = None
    sensor_payload: Optional[str] = None
    routine_params: Optional[dict] = None
    area_of_interest: Optional[dict] = None
    laanc_authorization_id: Optional[str] = None
    preflight_checklist: Optional[dict] = None
    planned_start: Optional[datetime] = None
    actual_start: Optional[datetime] = None
    actual_end: Optional[datetime] = None
    flight_duration_s: Optional[int] = None
    total_waypoints: Optional[int] = None
    total_photos: int = 0
    photos_uploaded: int = 0
    photos_analyzed: int = 0
    odm_job_id: Optional[str] = None
    odm_status: Optional[str] = None
    waypoints: Optional[List[WaypointResponse]] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class MissionListResponse(BaseModel):
    missions: List[MissionResponse]
    total: int


class MissionStatusResponse(BaseModel):
    id: str
    status: str


# ── Telemetry ──────────────────────────────────────────────────────────

class TelemetryPointSchema(BaseModel):
    timestamp: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    altitude_msl: Optional[float] = None
    altitude_agl: Optional[float] = None
    heading_deg: Optional[float] = None
    pitch_deg: Optional[float] = None
    roll_deg: Optional[float] = None
    yaw_deg: Optional[float] = None
    speed_ms: Optional[float] = None
    vertical_speed_ms: Optional[float] = None
    battery_pct: Optional[float] = None
    battery_voltage: Optional[float] = None
    battery_temp_c: Optional[float] = None
    gps_satellites: Optional[int] = None
    gps_fix_type: Optional[str] = None
    signal_strength: Optional[int] = None
    flight_mode: Optional[str] = None
    warnings: Optional[List[str]] = None


class TelemetryBatchCreate(BaseModel):
    mission_id: str
    points: List[TelemetryPointSchema]


# ── Flight Log ─────────────────────────────────────────────────────────

class FlightLogCreate(BaseModel):
    mission_id: str
    pilot_certificate: Optional[str] = None
    flight_date: Optional[date] = None
    takeoff_time: Optional[datetime] = None
    landing_time: Optional[datetime] = None
    flight_duration_s: Optional[int] = None
    takeoff_location: Optional[dict] = None
    landing_location: Optional[dict] = None
    max_altitude_agl_m: Optional[float] = None
    max_distance_m: Optional[float] = None
    max_speed_ms: Optional[float] = None
    weather_conditions: Optional[dict] = None
    incidents: Optional[dict] = None
    notes: Optional[str] = None
    laanc_status: Optional[str] = None
    airspace_class: Optional[str] = None
    preflight_checklist: Optional[dict] = None


class FlightLogResponse(FlightLogCreate):
    id: str
    organization_id: Optional[str] = None
    pilot_id: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── ODM ────────────────────────────────────────────────────────────────

class OdmProcessRequest(BaseModel):
    mission_id: str


class OdmStatusResponse(BaseModel):
    mission_id: str
    odm_job_id: Optional[str] = None
    odm_status: Optional[str] = None


# ── Thermal ────────────────────────────────────────────────────────────

class ThermalProcessRequest(BaseModel):
    image_id: str


class ThermalCaptureResponse(BaseModel):
    id: str
    image_id: str
    mission_id: Optional[str] = None
    min_temp_c: Optional[float] = None
    max_temp_c: Optional[float] = None
    avg_temp_c: Optional[float] = None
    raw_thermal_path: Optional[str] = None
    heatmap_path: Optional[str] = None
    palette: str = "ironbow"
    radiometric_data: Optional[dict] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True
