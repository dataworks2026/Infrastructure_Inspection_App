export type InfrastructureType = 'wind_turbine' | 'coastal' | 'pier' | 'railway';
export type AssetStatus = 'active' | 'maintenance' | 'decommissioned';
export type InspectionStatus = 'pending' | 'processing' | 'completed' | 'pending_review' | 'review_completed' | 'failed';
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
  inspector_name?: string | null;
  inspection_type?: string | null;
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
  // Engineer Review Flow fields (returned by backend in detection payloads)
  source?: 'cv_model' | 'engineer_added';
  is_locked?: boolean;
  reviewed?: boolean;
  reviewed_by?: string | null;
  // Engineer review outcome — CV: 'accepted' | 'rejected' | 'modified' | null (unreviewed);
  // engineer_added: 'modified' | 'added'.
  review_action?: 'accepted' | 'rejected' | 'modified' | 'added' | null;
  // Annotation-taxonomy fields (upgraded Engineer Review Mode)
  shape_type?: 'rect' | 'ellipse';
  domain_metadata?: { code?: string; segments?: string[]; segment?: string; defect_id?: string } | null;
}

// ── Engineer Review Flow ────────────────────────────────────

export type ReviewAction = 'accepted' | 'rejected' | 'modified' | 'added';
export type Severity = 'S1' | 'S2' | 'S3' | 'S4';

export interface CorrectedDetection {
  damage_type: string;
  severity: Severity;
  bbox: BoundingBox;
  confidence_score: number;
  // Annotation-taxonomy fields (upgraded Engineer Review Mode)
  damage_code?: string;
  structural_segments?: string[];
  defect_id?: string;
  shape_type?: 'rect' | 'ellipse';
}

export interface DetectionReviewItem {
  cv_detection_id: string | null;
  action: ReviewAction;
  corrected_detection?: CorrectedDetection;
  notes?: string;
}

export interface SubmitReviewRequest {
  reviews: DetectionReviewItem[];
}

export interface StartReviewResponse {
  inspection_id: string;
  status: InspectionStatus;
  locked_detections_count: number;
}

export interface SubmitReviewResponse {
  image_id: string;
  reviews_written: number;
  cv_accepted: number;
  cv_rejected: number;
  cv_modified: number;
  engineer_added: number;
}

export interface ReviewSummary {
  total_cv_detections: number;
  accepted: number;
  rejected: number;
  modified: number;
  engineer_added: number;
  final_verified_count: number;
  cv_accuracy_pct: number;
}

export interface CompleteReviewResponse {
  inspection_id: string;
  status: InspectionStatus;
  summary: ReviewSummary;
}

export interface ReopenInspectionReviewResponse {
  inspection_id: string;
  status: string;
  cleared_reviews: number;
  removed_engineer_detections: number;
  reset_cv_detections: number;
}

export interface ReopenImageReviewResponse {
  image_id: string;
  inspection_id: string;
  status: string;
  cleared_reviews: number;
  removed_engineer_detections: number;
  reset_cv_detections: number;
}

export interface ReviewTotals {
  cv_detections: number;
  accepted: number;
  rejected: number;
  modified: number;
  engineer_added: number;
  final_count: number;
  accuracy_pct: number;
}

export interface PerImageAction {
  cv_detection_id: string | null;
  engineer_detection_id: string | null;
  action: ReviewAction;
  notes: string | null;
}

export interface PerImageDiff {
  image_id: string;
  filename: string;
  cv_count: number;
  final_count: number;
  accuracy_pct: number;
  actions: PerImageAction[];
}

export interface DamageTypeAccuracy {
  cv: number;
  accepted: number;
  rejected: number;
  modified: number;
  pct: number;
}

export interface ModificationDelta {
  bbox_changed: boolean;
  bbox_before?: BoundingBox;
  bbox_after?: BoundingBox;
  damage_type_changed: boolean;
  damage_type_before?: string;
  damage_type_after?: string;
  severity_changed: boolean;
  severity_before?: string;
  severity_after?: string;
}

export interface ModificationEntry {
  cv_detection_id: string;
  image_filename: string;
  delta: ModificationDelta;
  notes: string | null;
}

export interface ReviewDiffResponse {
  inspection_id: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  totals: ReviewTotals;
  per_image: PerImageDiff[];
  damage_type_accuracy: Record<string, DamageTypeAccuracy>;
  modifications: ModificationEntry[];
}

export interface ReviewStatsOverall {
  reviewed_inspections: number;
  total_cv_detections: number;
  accepted: number;
  rejected: number;
  modified: number;
  engineer_added: number;
  avg_accuracy_pct: number;
}

export interface ReviewStatsRecent {
  inspection_id: string;
  name: string | null;
  reviewed_at: string | null;
  accuracy_pct: number;
  cv_detections: number;
}

export interface ReviewStatsResponse {
  overall: ReviewStatsOverall;
  by_damage_type: Record<string, DamageTypeAccuracy>;
  recent: ReviewStatsRecent[];
}

export interface UpdateAssetTypeResponse {
  image_id: string;
  asset_type: string;
}

export interface ImageRecord {
  id: string;
  filename: string;
  component_type?: string;
  analysis_status: AnalysisStatus;
  url: string;
  domain_metadata?: { asset_type?: string } | null;
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
  /** Authoritative per-asset severity totals (asset_id → {S1..S4}). */
  asset_severity?: Record<string, { S1: number; S2: number; S3: number; S4: number }>;
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
  // V3 — M2 LightGBM forecast fields.
  // null when the model file is absent or the asset has < 2 inspections.
  forecast_severity_next?: number | null;   // 1..4
  forecast_confidence?: string | null;      // High | Medium | Low
  forecast_horizon_days?: number | null;    // days to next inspection
  forecast_note?: string | null;            // plain-language summary
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
