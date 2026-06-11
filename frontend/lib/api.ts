import axios from 'axios';
import { getToken, clearAuth } from './auth';
import type {
  AuthToken, Asset, Inspection, ImageRecord,
  AnalysisResult, DashboardOverview,
  PredictiveAssetResult, PredictiveRunDetail,
  PredictiveRunSummary, PredictiveRunTriggerResponse,
  StartReviewResponse, SubmitReviewRequest, SubmitReviewResponse,
  CompleteReviewResponse, ReviewDiffResponse,
} from '@/types';

const api = axios.create({ baseURL: '/api/v1' });

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error.response?.status === 401) { clearAuth(); window.location.href = '/login'; }
    return Promise.reject(error);
  }
);

// Auth
export const authApi = {
  login: (email: string, password: string) =>
    api.post<AuthToken>('/auth/login', { email, password }).then(r => r.data),
  register: (email: string, password: string, full_name?: string, organization_name?: string) =>
    api.post<AuthToken>('/auth/register', { email, password, full_name, organization_name }).then(r => r.data),
  me: () => api.get('/auth/me').then(r => r.data),
  updateMe: (data: { full_name?: string; username?: string; organization_name?: string }) =>
    api.patch('/auth/me', data).then(r => r.data),
};

// Dashboard
export const dashboardApi = {
  overview: () => api.get<DashboardOverview>('/dashboard/overview').then(r => r.data),
  defectSummary: () => api.get('/dashboard/defect-summary').then(r => r.data),
  getLiveMissions: () => api.get<{ live_missions: LiveMission[]; count: number }>('/dashboard/live-missions').then(r => r.data),
};

// Missions (GCS)
export const missionsApi = {
  list: (params?: { asset_id?: string; status?: string }) =>
    api.get<{ missions: Mission[]; total: number }>('/missions', { params }).then(r => r.data),
  get: (id: string) => api.get<Mission>(`/missions/${id}`).then(r => r.data),
  getImages: (id: string) => api.get(`/missions/${id}/images`).then(r => r.data),
  getDetections: (id: string) => api.get<MissionDetection[]>(`/missions/${id}/detections`).then(r => r.data),
  getThermalOverlay: (id: string) => api.get<ThermalOverlay>(`/missions/${id}/thermal-overlay`).then(r => r.data),
};

// Assets
export const assetsApi = {
  list: (params?: { infrastructure_type?: string; status?: string }) =>
    api.get<Asset[]>('/assets', { params }).then(r => r.data),
  get: (id: string) => api.get<Asset>(`/assets/${id}`).then(r => r.data),
  create: (data: Partial<Asset>) => api.post<Asset>('/assets', data).then(r => r.data),
  update: (id: string, data: Partial<Asset>) => api.patch<Asset>(`/assets/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/assets/${id}`),
};

// Inspections
export const inspectionsApi = {
  list: (params?: { asset_id?: string }) =>
    api.get<Inspection[]>('/inspections', { params }).then(r => r.data),
  get: (id: string) => api.get<Inspection>(`/inspections/${id}`).then(r => r.data),
  create: (data: Partial<Inspection>) => api.post<Inspection>('/inspections', data).then(r => r.data),
  update: (id: string, data: Partial<Inspection>) => api.patch<Inspection>(`/inspections/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/inspections/${id}`),
};

// Images
export const imagesApi = {
  upload: (inspectionId: string, files: File[], componentType?: string) => {
    const form = new FormData();
    files.forEach(f => form.append('files', f));
    if (componentType) form.append('component_type', componentType);
    return api.post(`/inspections/${inspectionId}/images/upload`, form,
      { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
  },
  uploadPdf: (inspectionId: string, file: File, componentType?: string) => {
    const form = new FormData();
    form.append('file', file);
    if (componentType) form.append('component_type', componentType);
    return api.post(`/inspections/${inspectionId}/images/upload-pdf`, form,
      { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
  },
  list: (inspectionId: string) =>
    api.get<ImageRecord[]>(`/inspections/${inspectionId}/images`).then(r => r.data),
  get: (id: string) => api.get<ImageRecord>(`/images/${id}`).then(r => r.data),
  update: (id: string, data: Partial<ImageRecord>) =>
    api.patch<ImageRecord>(`/images/${id}`, data).then(r => r.data),
  gpsPoints: () => api.get('/images/gps-points').then(r => r.data),
};

// Environmental (live conditions — Open-Meteo, dashboard pills)
export const environmentalApi = {
  getAssetData: () => api.get('/environmental/assets').then(r => r.data),
};

// Sensors (NOAA government data)
export const sensorsApi = {
  getLive: () => api.get('/sensors/live').then(r => r.data),
  getHistory: (params: { asset_id: string; sensor_type: string; start: string; end: string }) =>
    api.get('/sensors/history', { params }).then(r => r.data),
};

// Analysis
export const comparisonPairsApi = {
  get: (beforeInspectionId: string, afterInspectionId: string) =>
    api.get<{ pairs: Record<string, number> }>('/comparison-pairs', {
      params: { before_inspection_id: beforeInspectionId, after_inspection_id: afterInspectionId },
    }).then(r => r.data.pairs),
  save: (beforeInspectionId: string, afterInspectionId: string, pairs: Record<number, number>) =>
    api.put<{ pairs: Record<string, number> }>('/comparison-pairs', {
      before_inspection_id: beforeInspectionId,
      after_inspection_id: afterInspectionId,
      pairs,
    }).then(r => r.data.pairs),
};

export const analysisApi = {
  analyze: (imageId: string) =>
    api.post<AnalysisResult>(`/images/${imageId}/analyze`).then(r => r.data),
  getDetections: (imageId: string) =>
    api.get(`/images/${imageId}/detections`).then(r => r.data),
  getAllDetections: (inspectionId: string) =>
    api.get<Record<string, any>>(`/inspections/${inspectionId}/all-detections`).then(r => r.data),
};

// Engineer Review Flow (CV detection correction)
export const reviewApi = {
  startReview: (inspectionId: string) =>
    api.post<StartReviewResponse>(`/inspections/${inspectionId}/start-review`).then(r => r.data),
  submitImageReview: (imageId: string, body: SubmitReviewRequest) =>
    api.post<SubmitReviewResponse>(`/images/${imageId}/submit-review`, body).then(r => r.data),
  completeReview: (inspectionId: string) =>
    api.post<CompleteReviewResponse>(`/inspections/${inspectionId}/complete-review`).then(r => r.data),
  getReviewDiff: (inspectionId: string) =>
    api.get<ReviewDiffResponse>(`/inspections/${inspectionId}/review-diff`).then(r => r.data),
};

// Predictive Analytics (deterioration / anomaly / priority / TTI)
export const predictiveApi = {
  runAnalysis: () =>
    api.post<PredictiveRunTriggerResponse>('/predictive/run').then(r => r.data),
  getLatest: () =>
    api.get<PredictiveRunDetail>('/predictive/latest').then(r => r.data),
  getRuns: () =>
    api.get<PredictiveRunSummary[]>('/predictive/runs').then(r => r.data),
  getRun: (runId: string) =>
    api.get<PredictiveRunDetail>(`/predictive/runs/${runId}`).then(r => r.data),
  getAssetAnalytics: (assetId: string) =>
    api.get<PredictiveAssetResult>(`/predictive/assets/${assetId}`).then(r => r.data),
};

// Flight Logs
export const flightLogsApi = {
  listByMission: (missionId: string) =>
    api.get(`/flight-logs?mission_id=${missionId}`).then(r => r.data),
  exportByMission: (missionId: string) =>
    api.get(`/flight-logs/mission/${missionId}/export`, { responseType: 'blob' }).then(r => r.data),
};

// Reports (inspection PDF + JSON preview)
export interface ReportNarrative {
  executive_summary: string;
  technical_findings: string;
  risk_assessment: 'critical' | 'high' | 'medium' | 'low';
  risk_score: number;
  recommendations: { action: string; rationale: string }[];
  confidence_note: string | null;
}

export interface ReportMatrixRow {
  code: string; label: string;
  minor: number; moderate: number; advanced: number; severe: number; total: number;
}

export interface ReportImageFinding {
  image_id: string; image_filename: string;
  detections: { damage_code: string; severity_label: string; segment: string }[];
}

export interface ReportPreview {
  metadata: {
    organization_name: string; asset_name: string; location_name: string;
    infrastructure_type: string; inspection_date: string;
    inspection_type: string; inspection_method: string;
    inspector_name: string; total_images: number; status: string;
    inspection_id: string;
  };
  summary: {
    total_detections: number; total_images: number;
    matrix: ReportMatrixRow[];
    column_totals: { minor: number; moderate: number; advanced: number; severe: number; total: number };
  };
  image_findings: ReportImageFinding[];
  narrative: ReportNarrative;
  metrics: {
    total_detections: number;
    overall_risk_score: number;
    high_severity_count: number;
    high_severity_pct: number;
    avg_confidence: number;
    top_3_defects: [string, number][];
    image_count: number;
  };
}

export const reportsApi = {
  preview: (inspectionId: string) =>
    api.get<ReportPreview>(`/reports/inspections/${inspectionId}/preview`).then(r => r.data),
  pdfUrl: (inspectionId: string) =>
    `/api/v1/reports/inspections/${inspectionId}/pdf`,
  downloadPdf: async (inspectionId: string, filename = 'inspection-report.pdf') => {
    const res = await api.get(`/reports/inspections/${inspectionId}/pdf`, { responseType: 'blob' });
    const url = window.URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    window.URL.revokeObjectURL(url);
  },
};

export default api;

// ── GCS types (inline — avoids circular dep with types/index.ts) ──────

export interface Mission {
  id: string;
  asset_id: string;
  inspection_id?: string;
  name: string;
  status: string;
  routine_type: string;
  drone_model?: string;
  total_photos: number;
  photos_uploaded: number;
  photos_analyzed: number;
  actual_start?: string;
  actual_end?: string;
  odm_status?: string;
  waypoints?: unknown[];
  created_at?: string;
}

export interface MissionDetection {
  id: string;
  image_id: string;
  label: string;
  confidence: number;
  severity?: string;
  latitude?: number;
  longitude?: number;
  bbox?: number[];
}

export interface LiveMissionTelemetry {
  latitude?: number;
  longitude?: number;
  altitude_agl?: number;
  heading_deg?: number;
  speed_ms?: number;
  battery_pct?: number;
  flight_mode?: string;
  timestamp?: string;
}

export interface ThermalOverlay {
  mission_id: string;
  has_thermal: boolean;
  captures_count: number;
  temp_min_c?: number | null;
  temp_max_c?: number | null;
  avg_temp_c?: number | null;
  hotspot_count?: number;
  heatmap_paths?: (string | null)[];
}

export interface LiveMission {
  mission_id: string;
  mission_name: string;
  asset_id: string;
  status: string;
  drone_model?: string;
  total_photos: number;
  photos_uploaded: number;
  actual_start?: string;
  telemetry: LiveMissionTelemetry | null;
}
