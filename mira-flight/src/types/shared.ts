// ── Mira Flight GCS — Shared Type Contract ────────────────────────────
// Must stay 1:1 with backend/app/schemas/mission.py

// ── Enums / Unions ────────────────────────────────────────────────────

export type RoutineType =
  | "sweep"
  | "orbit"
  | "traverse"
  | "grid"
  | "crawl"
  | "scout";

export type MissionStatus =
  | "planned"
  | "preflight"
  | "in_progress"
  | "paused"
  | "uploading"
  | "analyzing"
  | "processing_3d"
  | "completed"
  | "aborted"
  | "failed";

export type WaypointAction =
  | "photo_all"
  | "photo_zoom"
  | "photo_thermal"
  | "photo_wide"
  | "hover"
  | "none";

export type CameraLens =
  | "zoom"
  | "wide"
  | "thermal"
  | "laser_rangefinder";

export type GpsFixType = "rtk_fixed" | "rtk_float" | "3d_fix";

// ── Routine Params ────────────────────────────────────────────────────

export interface SweepParams {
  altitude_m: number;
  speed_ms: number;
  line_spacing_m: number;
  heading_deg: number;
  overlap_pct?: number;
}

export interface OrbitParams {
  center_lat: number;
  center_lon: number;
  radius_m: number;
  altitude_m: number;
  speed_ms: number;
  num_points: number;
  gimbal_pitch?: number;
}

export interface GridParams {
  altitude_m: number;
  speed_ms: number;
  spacing_m: number;
  overlap_pct?: number;
  cross_hatch?: boolean;
}

export interface TraverseParams {
  altitude_m: number;
  speed_ms: number;
  waypoints: Waypoint[];
}

export interface CrawlParams {
  altitude_m: number;
  speed_ms: number;
  distance_to_subject_m: number;
  vertical_step_m: number;
  horizontal_step_m: number;
}

export interface ScoutParams {
  altitude_m: number;
  speed_ms: number;
  loiter_time_s?: number;
}

// ── Waypoint ──────────────────────────────────────────────────────────

export interface Waypoint {
  sequence_index: number;
  latitude: number;
  longitude: number;
  altitude_m: number;
  speed_ms?: number;
  gimbal_pitch?: number;
  gimbal_yaw?: number;
  heading_deg?: number;
  action: WaypointAction;
  hover_time_s?: number;
}

// ── Telemetry ─────────────────────────────────────────────────────────

export interface TelemetryPoint {
  timestamp: string;
  latitude?: number;
  longitude?: number;
  altitude_msl?: number;
  altitude_agl?: number;
  heading_deg?: number;
  pitch_deg?: number;
  roll_deg?: number;
  yaw_deg?: number;
  speed_ms?: number;
  vertical_speed_ms?: number;
  battery_pct?: number;
  battery_voltage?: number;
  battery_temp_c?: number;
  gps_satellites?: number;
  gps_fix_type?: GpsFixType;
  signal_strength?: number;
  flight_mode?: string;
  warnings?: string[];
}

export interface TelemetryBatch {
  mission_id: string;
  points: TelemetryPoint[];
}

// ── Mission ───────────────────────────────────────────────────────────

export interface MissionCreate {
  asset_id: string;
  inspection_id?: string;
  name: string;
  description?: string;
  routine_type: RoutineType;
  drone_model?: string;
  drone_serial?: string;
  sensor_payload?: string;
  routine_params?: Record<string, unknown>;
  area_of_interest?: Record<string, unknown>;
  laanc_authorization_id?: string;
  preflight_checklist?: Record<string, unknown>;
  planned_start?: string;
  waypoints?: Waypoint[];
}

export interface Mission {
  id: string;
  organization_id?: string;
  inspection_id?: string;
  asset_id: string;
  created_by?: string;
  name: string;
  description?: string;
  routine_type: RoutineType;
  status: MissionStatus;
  drone_model?: string;
  drone_serial?: string;
  sensor_payload?: string;
  routine_params?: Record<string, unknown>;
  area_of_interest?: Record<string, unknown>;
  laanc_authorization_id?: string;
  preflight_checklist?: Record<string, unknown>;
  planned_start?: string;
  actual_start?: string;
  actual_end?: string;
  flight_duration_s?: number;
  total_waypoints?: number;
  total_photos: number;
  photos_uploaded: number;
  photos_analyzed: number;
  odm_job_id?: string;
  odm_status?: string;
  waypoints?: Waypoint[];
  created_at?: string;
  updated_at?: string;
}

// ── Drone State & Adapter ─────────────────────────────────────────────

export interface DroneState {
  connected: boolean;
  armed: boolean;
  flying: boolean;
  latitude: number;
  longitude: number;
  altitude_agl: number;
  heading_deg: number;
  battery_pct: number;
  gps_fix_type: GpsFixType;
  gps_satellites: number;
  signal_strength: number;
  flight_mode: string;
}

export interface DroneAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getState(): DroneState;
  arm(): Promise<void>;
  takeoff(altitude_m: number): Promise<void>;
  land(): Promise<void>;
  returnToHome(): Promise<void>;
  uploadWaypoints(waypoints: Waypoint[]): Promise<void>;
  startWaypointMission(): Promise<void>;
  onWaypointReached(cb: (index: number) => void): () => void;
  capturePhoto(
    lens: CameraLens,
  ): Promise<{ localPath: string; metadata: unknown }>;
  captureAllLenses(): Promise<
    { lens: CameraLens; localPath: string; metadata: unknown }[]
  >;
  setGimbal(pitch: number, yaw: number): Promise<void>;
  onTelemetry(cb: (point: TelemetryPoint) => void): () => void;
}

// ── Compliance ────────────────────────────────────────────────────────

export interface ChecklistItem {
  key: string;
  label: string;
  checked: boolean;
  required: boolean;
}

export interface PreflightResult {
  passed: boolean;
  items: ChecklistItem[];
  completed_at: string;
  pilot_name: string;
  pilot_certificate: string;
}
