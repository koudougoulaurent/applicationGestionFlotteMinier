import { io, Socket } from 'socket.io-client';
import type { GpsPosition } from '../types';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io('/', {
      auth: { token: localStorage.getItem('fms_token') },
      transports: ['websocket', 'polling'],
    });
    socket.on('connect',       () => console.log('[WS] connected:', socket?.id));
    socket.on('disconnect',    () => console.log('[WS] disconnected'));
    socket.on('connect_error', (e) => console.error('[WS] error:', e.message));
  }
  return socket;
}

export function joinSite(siteId: string): void {
  getSocket().emit('join:site', siteId);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type GpsUpdateCallback      = (positions: GpsPosition[]) => void;
export type FleetStatusCallback    = (status: Record<string, number>) => void;
export type AlarmCallback          = (alarms: unknown[]) => void;

export interface CycleCompletePayload {
  cycle_id: string;
  truck_id: string;
  fleet_number: string;
  payload_tonnes: number;
  duration_s: number;
  source_name: string;
  dest_name: string;
  material_name: string | null;
  material_color: string | null;
  shift_id: string;
  timestamp: string;
}

export interface ShiftProductionPayload {
  shift_id: string;
  cycles_count: number;
  actual_tonnes: number;
  avg_payload: number;
  fuel_consumed_l: number;
  avg_cycle_min: number;
  target_tonnes: number | null;
  achievement_pct: number | null;
  updated_at: string;
}

export interface FuelEventPayload {
  transaction_id: string;
  equipment_id: string;
  fleet_number: string;
  category: string;
  quantity_liters: number;
  unit_cost: number | null;
  total_cost: number | null;
  timestamp: string;
}

export interface EquipmentStatusPayload {
  equipment_id: string;
  fleet_number: string;
  category: string;
  previous_status: string;
  new_status: string;
  reason: string | null;
  timestamp: string;
}

export interface DispatchAssignedPayload {
  assignment_id: string;
  truck_id: string;
  fleet_number: string;
  category: string;
  source_name: string;
  dest_name: string;
  material_name: string | null;
  priority: number;
  timestamp: string;
}

export interface DispatchUpdatedPayload {
  assignment_id: string;
  truck_id: string;
  status: string;
  timestamp: string;
}

export interface TelemetryAlertPayload {
  equipment_id: string;
  fleet_number: string;
  category: string;
  alerts: { type: string; label: string; value: number; threshold: number; unit: string; high: boolean }[];
  timestamp: string;
}

// ── Subscriptions ─────────────────────────────────────────────────────────────

function sub<T>(event: string, cb: (d: T) => void): () => void {
  const s = getSocket();
  s.on(event, cb);
  return () => s.off(event, cb);
}

export const onGpsUpdate          = (cb: GpsUpdateCallback)                      => sub<GpsPosition[]>('gps:update', cb);
export const onFleetStatus        = (cb: FleetStatusCallback)                    => sub<Record<string,number>>('fleet:status', cb);
export const onAlarms             = (cb: AlarmCallback)                          => sub<unknown[]>('alarms:update', cb);
export const onCycleComplete      = (cb: (d: CycleCompletePayload) => void)      => sub<CycleCompletePayload>('cycle:complete', cb);
export const onShiftProduction    = (cb: (d: ShiftProductionPayload) => void)    => sub<ShiftProductionPayload>('production:shift', cb);
export const onFuelEvent          = (cb: (d: FuelEventPayload) => void)          => sub<FuelEventPayload>('fuel:event', cb);
export const onEquipmentStatus    = (cb: (d: EquipmentStatusPayload) => void)    => sub<EquipmentStatusPayload>('equipment:status', cb);
export const onEquipmentDown      = (cb: (d: EquipmentStatusPayload) => void)    => sub<EquipmentStatusPayload>('equipment:down', cb);
export const onDispatchAssigned   = (cb: (d: DispatchAssignedPayload) => void)   => sub<DispatchAssignedPayload>('dispatch:assigned', cb);
export const onDispatchUpdated    = (cb: (d: DispatchUpdatedPayload) => void)    => sub<DispatchUpdatedPayload>('dispatch:updated', cb);
export const onTelemetryAlert     = (cb: (d: TelemetryAlertPayload) => void)     => sub<TelemetryAlertPayload>('telemetry:alert', cb);

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
