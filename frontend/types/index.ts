export type InfrastructureType = 'wind_turbine' | 'coastal' | 'pier' | 'railway';
export type AssetStatus = 'active' | 'maintenance' | 'decommissioned';
export type InspectionStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type AnalysisStatus = 'queued' | 'processing' | 'completed' | 'failed';
export type UserRole = 'admin' | 'analyst' | 'viewer';

export interface User {
  id: string;
  email: string;
  full_name?: string;
  username?: string;
  role: UserRole;
  organization_id?: string;
  organization_name?: string;
}

export interface Asset {
  id: string;
  name: string;
  infrastructure_type: InfrastructureType;
  location_name?: string;
  latitude?: number;
  longitude?: number;
  status: AssetStatus;
  created_at: string;
  inspection_count: number;
  image_count: number;
  last_inspection_at?: string;
}

export interface Inspection {
  id: string;
  asset_id: string;
  name: string;
  inspected_at?: string;
  weather_conditions?: string;
  inspector_name?: string;
  status: InspectionStatus;
  created_at: string;
  image_count: number;
}

export interface BoundingBox {
  x1: number; y1: number; x2: number; y2: number;
}

export interface Detection {
  id: string;
  image_id: string;
  infrastructure_type: InfrastructureType;
  damage_type: string;
  confidence: number;
  bbox: BoundingBox;
  severity?: string;
  created_at: string;
}

export interface ImageRecord {
  id: string;
  filename: string;
  component_type?: string;
  analysis_status: AnalysisStatus;
  url: string;
}

export interface AnalysisResult {
  image_id: string;
  status: string;
  infrastructure_type: InfrastructureType;
  total_detections: number;
  detections: Detection[];
  annotated_image_url?: string;
  message: string;
}

export interface DashboardDetection {
  damage_type: string;
  confidence: number;
  severity: string | null;
  bbox: { x1: number; y1: number; x2: number; y2: number };
}

export interface DashboardAnalyzedImage {
  id: string;
  filename: string;
  url: string;
  inspection_id: string;
  inspection_name: string;
  asset_id: string;
  asset_name: string;
  detection_count: number;
  max_severity: string | null;
  damage_types: { damage_type: string; count: number }[];
  detections: DashboardDetection[];
}

export interface DashboardAssetHealth {
  id: string;
  name: string;
  infrastructure_type: string;
  status: string;
  inspection_count: number;
  total_detections: number;
  worst_severity: string | null;
}

export interface DashboardOverview {
  total_assets: number;
  active_assets: number;
  total_inspections: number;
  pending_inspections: number;
  total_images: number;
  total_detections: number;
  fleet_health_pct: number;
  assets_by_type: Record<string, number>;
  severity_breakdown: Record<string, number>;
  recent_inspections: Array<{id: string; name: string; asset_id: string; status: string; created_at: string}>;
  recent_analyzed_images: DashboardAnalyzedImage[];
  asset_health: DashboardAssetHealth[];
}

// ── Sensors (NOAA) ──────────────────────────────────────────
export interface SensorAssetLive {
  asset_name: string;
  location_name: string | null;
  latitude: number;
  longitude: number;
  temperature_f: number | null;
  water_level_ft: number | null;
  wind_speed_kn: number | null;
  wind_direction_deg: number | null;
  wind_gust_kn: number | null;
  wind_speed_mph: number | null;
  wave_height_m: number | null;
  wave_period_s: number | null;
  water_temp_f: number | null;
  air_temp_ndbc_f: number | null;
  sources: { coops_station: string; ndbc_station: string };
}

export interface SensorLiveResponse {
  assets: Record<string, SensorAssetLive>;
  updated_at: number;
}

export interface SensorHistoryReading {
  t: string;   // timestamp
  v: string;   // value
  f?: string;  // flags
  s?: string;  // speed (wind)
  d?: string;  // direction (wind)
  g?: string;  // gust (wind)
}

export interface SensorHistoryResponse {
  asset_id: number;
  sensor_type: string;
  station: string;
  start: string;
  end: string;
  readings: SensorHistoryReading[];
}

export interface AuthToken {
  access_token: string;
  token_type: string;
  user_id: string;
  email: string;
  full_name?: string;
  username?: string;
  role: UserRole;
  organization_id?: string;
  organization_name?: string;
}

// ── Predictive Analytics ────────────────────────────────────
// Shape of responses from /api/v1/predictive/*. Field names match
// the backend Pydantic schemas (app/schemas/predictive.py) which
// in turn mirror the engine's V2 output DataFrame.

export type PredictivePriorityLabel =
  | 'Critical' | 'High' | 'Medium' | 'Low' | 'Minimal';

export type PredictiveTrendDirection =
  | 'accelerating' | 'worsening' | 'stable' | 'improving' | 'fluctuating';

export type PredictiveTtiLabel =
  | 'Immediate' | 'Near-term' | 'Medium-term' | 'Long-term' | 'Not applicable';

export type PredictiveRunStatus = 'running' | 'completed' | 'failed';

export interface SeverityHistoryPoint {
  date: string;       // 'YYYY-MM-DD'
  severity: number;   // 1..4
}

export interface PredictiveAnalyticsReason {
  reason_code: string;          // e.g. 'deterioration' | 'anomaly' | 'tti' | 'current_severity'
  reason_category?: string;     // e.g. 'trend' | 'anomaly' | 'projection' | 'severity'
  reason_text: string;
  weight?: number;              // 0..1, null for informational reasons (e.g. TTI)
  display_order?: number;
}

export interface PredictiveAssetResult {
  asset_id: string;
  asset_name: string;
  asset_type?: string;
  priority_rank: number;
  priority_score: number;
  priority_label: PredictivePriorityLabel;
  latest_severity: number;          // 1..4
  trend_direction: PredictiveTrendDirection;
  severity_change_rate: number;     // per year
  acceleration: boolean;
  has_anomaly: boolean;
  anomaly_reason?: string;
  tti_days?: number;
  tti_label: PredictiveTtiLabel;
  tti_note: string;
  // Chronological severity timeline for sparkline rendering;
  // empty list when the run was older than the history feature.
  severity_history: SeverityHistoryPoint[];
  // Per-component breakdown of how the score was reached.
  // Empty list for runs that pre-date reason persistence.
  reasons: PredictiveAnalyticsReason[];
}

export interface PredictiveRunTriggerResponse {
  run_id: string;
  status: PredictiveRunStatus;
  total_items_analyzed: number;
  message: string;
}

export interface PredictiveRunSummary {
  id: string;
  status: PredictiveRunStatus;
  created_at: string;                // ISO 8601
  completed_at?: string;
  total_items_analyzed: number;
  processing_time_ms?: number;
  engine_version: string;
  schema_version: string;
}

export interface PredictiveRunDetail extends PredictiveRunSummary {
  results: PredictiveAssetResult[];
}
