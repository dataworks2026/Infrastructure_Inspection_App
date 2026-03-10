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

export interface DashboardOverview {
  total_assets: number;
  active_assets: number;
  total_inspections: number;
  pending_inspections: number;
  total_images: number;
  total_detections: number;
  assets_by_type: Record<string, number>;
  recent_inspections: Array<{id: string; name: string; asset_id: string; status: string; created_at: string}>;
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
