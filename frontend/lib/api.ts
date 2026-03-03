import axios from 'axios';
import { getToken, clearAuth } from './auth';
import type {
  AuthToken, Asset, Inspection, ImageRecord,
  AnalysisResult, DashboardOverview
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
  register: (email: string, password: string, full_name?: string) =>
    api.post<AuthToken>('/auth/register', { email, password, full_name }).then(r => r.data),
  me: () => api.get('/auth/me').then(r => r.data),
};

// Dashboard
export const dashboardApi = {
  overview: () => api.get<DashboardOverview>('/dashboard/overview').then(r => r.data),
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
  list: (inspectionId: string) =>
    api.get<ImageRecord[]>(`/inspections/${inspectionId}/images`).then(r => r.data),
  get: (id: string) => api.get<ImageRecord>(`/images/${id}`).then(r => r.data),
};

// Analysis
export const analysisApi = {
  analyze: (imageId: string) =>
    api.post<AnalysisResult>(`/images/${imageId}/analyze`).then(r => r.data),
  getDetections: (imageId: string) =>
    api.get(`/images/${imageId}/detections`).then(r => r.data),
};

export default api;
