import axios from 'axios';

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('fms_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Handle auth errors globally
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('fms_token');
      localStorage.removeItem('fms_user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;

// Typed helpers
export const authApi = {
  login:      (u: string, p: string) => api.post('/auth/login', { username: u, password: p }),
  verifyMfa:  (mfa_session: string, otp: string) => api.post('/auth/mfa/verify', { mfa_session, otp }),
  me:         () => api.get('/auth/me'),
  mfaStatus:  () => api.get('/auth/mfa/status'),
  mfaSetup:   () => api.get('/auth/mfa/setup'),
  mfaEnable:  (otp: string) => api.post('/auth/mfa/enable', { otp }),
  mfaDisable: (otp: string) => api.delete('/auth/mfa/disable', { data: { otp } }),
};

export const equipmentApi = {
  list:         (params?: Record<string, string>) => api.get('/equipment', { params }),
  types:        ()                               => api.get('/equipment/types'),
  get:          (id: string)                     => api.get(`/equipment/${id}`),
  create:       (body: object)                   => api.post('/equipment', body),
  update:       (id: string, body: object)       => api.put(`/equipment/${id}`, body),
  updateStatus: (id: string, body: object)       => api.patch(`/equipment/${id}/status`, body),
  deactivate:   (id: string)                     => api.delete(`/equipment/${id}`),
  timeline:     (id: string, params?: Record<string, string>) => api.get(`/equipment/${id}/timeline`, { params }),
  kpi:          (id: string, params?: Record<string, string>) => api.get(`/equipment/${id}/kpi`, { params }),
};

export const dispatchApi = {
  list: (params?: Record<string, string>) => api.get('/dispatch', { params }),
  create: (body: object) => api.post('/dispatch', body),
  update: (id: string, body: object) => api.patch(`/dispatch/${id}`, body),
  suggest: (params?: Record<string, string>) => api.get('/dispatch/suggest', { params }),
};

export const cyclesApi = {
  list: (params?: Record<string, string>) => api.get('/cycles', { params }),
  create: (body: object) => api.post('/cycles', body),
  complete: (id: string, body: object) => api.patch(`/cycles/${id}/complete`, body),
  productionSummary: (params?: Record<string, string>) => api.get('/production/summary', { params }),
};

export const maintenanceApi = {
  listWorkOrders: (params?: Record<string, string>) => api.get('/maintenance/work-orders', { params }),
  createWorkOrder: (body: object) => api.post('/maintenance/work-orders', body),
  closeWorkOrder: (id: string, body: object) => api.patch(`/maintenance/work-orders/${id}/close`, body),
  breakdowns: (params?: Record<string, string>) => api.get('/maintenance/breakdowns', { params }),
  due: () => api.get('/maintenance/due'),
  health: () => api.get('/maintenance/health'),
};

export const fuelApi = {
  transactions: (params?: Record<string, string>) => api.get('/fuel/transactions', { params }),
  createTransaction: (body: object) => api.post('/fuel/transactions', body),
  summary: (params?: Record<string, string>) => api.get('/fuel/summary', { params }),
  stations: () => api.get('/fuel/stations'),
};

export const kpiApi = {
  dashboard: (params?: Record<string, string>) => api.get('/kpi/dashboard', { params }),
  availability: (params?: Record<string, string>) => api.get('/kpi/availability', { params }),
  cycleTime: (params?: Record<string, string>) => api.get('/kpi/cycle-time', { params }),
  alarms: (params?: Record<string, string>) => api.get('/kpi/alarms', { params }),
  acknowledgeAlarm: (id: string) => api.patch(`/kpi/alarms/${id}/acknowledge`),
};

export const gpsApi = {
  positions: (params?: Record<string, string>) => api.get('/gps/positions', { params }),
  trail: (id: string, minutes?: number) => api.get(`/gps/trail/${id}`, { params: { minutes } }),
  locations: (params?: Record<string, string>) => api.get('/locations', { params }),
};

export const operatorApi = {
  list:       (params?: Record<string, string>) => api.get('/operators', { params }),
  stats:      (id: string, params?: Record<string, string>) => api.get(`/operators/${id}/stats`, { params }),
  create:     (body: object)               => api.post('/operators', body),
  update:     (id: string, body: object)   => api.put(`/operators/${id}`, body),
  deactivate: (id: string)                 => api.delete(`/operators/${id}`),
};

export const tyreApi = {
  list: (params?: Record<string, string>) => api.get('/tyres', { params }),
  summary: () => api.get('/tyres/summary'),
  byEquipment: (id: string) => api.get(`/tyres/equipment/${id}`),
  history: (id: string) => api.get(`/tyres/${id}/history`),
  create: (body: object) => api.post('/tyres', body),
  install: (body: object) => api.post('/tyres/install', body),
  remove: (installationId: string, body: object) => api.patch(`/tyres/installation/${installationId}/remove`, body),
  // Nouveaux endpoints TKPH
  tkph:       (params?: Record<string, string>) => api.get('/tyres/tkph', { params }),
  overloaded: (params?: Record<string, string>) => api.get('/tyres/overloaded', { params }),
  calculate:  (body: object) => api.post('/tyres/calculate', body),
};

export const shiftApi = {
  list: (params?: Record<string, string>) => api.get('/shifts', { params }),
  current: () => api.get('/shifts/current'),
  create: (body: object) => api.post('/shifts', body),
  close: (id: string) => api.patch(`/shifts/${id}/close`),
  report: (id: string) => api.get(`/shifts/${id}/report`),
  assignOperator: (body: object) => api.post('/shifts/assign-operator', body),
};

export const telemetryApi = {
  fleet: () => api.get('/telemetry/fleet'),
  latest: (equipmentId: string) => api.get(`/telemetry/${equipmentId}`),
  history: (equipmentId: string, params?: Record<string, string>) => api.get(`/telemetry/${equipmentId}/history`, { params }),
  ingest: (equipmentId: string, body: object) => api.post(`/telemetry/${equipmentId}`, body),
  weather: () => api.get('/weather'),
};

export const materialsApi = {
  list: () => api.get('/materials'),
};

export const productionApi = {
  dailyReconciliation: (params?: Record<string, string>) => api.get('/production/reconciliation/daily', { params }),
  shiftReconciliation: (params?: Record<string, string>) => api.get('/production/reconciliation/shifts', { params }),
  materials: (params?: Record<string, string>) => api.get('/production/materials', { params }),
  trucks: (params?: Record<string, string>) => api.get('/production/trucks', { params }),
  upsertPlan: (body: object) => api.post('/production/plan', body),
  // Nouveaux endpoints Production Live
  kpi:     (params?: Record<string, string>) => api.get('/production/kpi', { params }),
  hourly:  (params?: Record<string, string>) => api.get('/production/hourly', { params }),
  loaders: (params?: Record<string, string>) => api.get('/production/loaders', { params }),
};

export const roadsApi = {
  list: () => api.get('/roads'),
  recordCondition: (body: object) => api.post('/roads/condition', body),
  clearCondition: (id: string) => api.patch(`/roads/condition/${id}/clear`),
};

// ── Module 5 : Simulation ────────────────────────────────────────────────────
export const simulationApi = {
  status:         () => api.get('/simulation/status'),
  start:          (body: object) => api.post('/simulation/start', body),
  stop:           () => api.post('/simulation/stop'),
  pause:          () => api.post('/simulation/pause'),
  resume:         () => api.post('/simulation/resume'),
  setSpeed:       (multiplier: number) => api.patch('/simulation/speed', { multiplier }),
  scenarios:      (params?: Record<string, string>) => api.get('/simulation/scenarios', { params }),
  events:         (params?: Record<string, string>) => api.get('/simulation/events', { params }),
  bnrSummary:     (params?: Record<string, string>) => api.get('/simulation/sensors/bnr', { params }),
  generateBNR:    (body: object) => api.post('/simulation/sensors/bnr/generate', body),
  bnrHistory:     (stationId: string, hours?: number) =>
    api.get(`/simulation/sensors/bnr/${stationId}/history`, { params: { hours } }),
};

// ── Modules IA 2, 3, 4 ───────────────────────────────────────────────────────
export const aiApi = {
  dashboard:              (siteId?: string) => api.get('/ai/dashboard', { params: { siteId } }),
  routeOptimize:          (body: object) => api.post('/ai/route-optimize', body),
  rebuildGraph:           (body: object) => api.post('/ai/route-graph/rebuild', body),
  graphStats:             () => api.get('/ai/route-graph/stats'),
  dispatchOptimize:       (siteId?: string) => api.get('/ai/dispatch-optimize', { params: { siteId } }),
  dispatchApply:          (body: object) => api.post('/ai/dispatch-apply', body),
  dispatchHistory:        (params?: Record<string, string>) => api.get('/ai/dispatch-history', { params }),
  predictSite:            (siteId?: string) => api.get('/ai/maintenance-predict', { params: { siteId } }),
  predictEquipment:       (equipmentId: string) => api.get(`/ai/maintenance-predict/${equipmentId}`),
  maintenanceHistory:     (equipmentId: string, params?: Record<string, string>) =>
    api.get(`/ai/maintenance-history/${equipmentId}`, { params }),
};

export const materialApi = {
  breakdown:   (params?: Record<string, string>) => api.get('/material/breakdown', { params }),
  flow:        (params?: Record<string, string>) => api.get('/material/flow', { params }),
  misdirected: (params?: Record<string, string>) => api.get('/material/misdirected', { params }),
  record:      (body: object) => api.post('/material/record', body),
  gradeTrend:  (params?: Record<string, string>) => api.get('/material/grade-trend', { params }),
};

export const delayApi = {
  active:     (params?: Record<string, string>) => api.get('/delays/active', { params }),
  shift:      (params?: Record<string, string>) => api.get('/delays/shift', { params }),
  summary:    (params?: Record<string, string>) => api.get('/delays/summary', { params }),
  categories: () => api.get('/delays/categories'),
  open:       (body: object) => api.post('/delays/open', body),
  close:      (eventId: string) => api.post(`/delays/close/${eventId}`, {}),
  autoDetect: (body: object) => api.post('/delays/auto-detect', body),
};

export const speedApi = {
  violations: (params?: Record<string, string>) => api.get('/speed/violations', { params }),
  summary:    (params?: Record<string, string>) => api.get('/speed/summary', { params }),
  limits:     (params?: Record<string, string>) => api.get('/speed/limits', { params }),
  check:      (body: object) => api.post('/speed/check', body),
};

export const shiftReportApi = {
  list:     (params?: Record<string, string>) => api.get('/shift-reports', { params }),
  get:      (shiftId: string) => api.get(`/shift-reports/${shiftId}`),
  generate: (body: object) => api.post('/shift-reports/generate', body),
};

// ── Export CSV helper ───────────────────────────────────────────────
export const exportCsv = (rows: Record<string, unknown>[], filename: string): void => {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(','),
    ...rows.map((row) =>
      headers.map((h) => {
        const val = row[h] ?? '';
        return String(val).includes(',') ? `"${val}"` : val;
      }).join(',')
    ),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};
