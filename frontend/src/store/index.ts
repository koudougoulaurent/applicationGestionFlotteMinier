import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthUser, Alarm, GpsPosition } from '../types';
import type {
  CycleCompletePayload, ShiftProductionPayload, FuelEventPayload,
  EquipmentStatusPayload, DispatchAssignedPayload, TelemetryAlertPayload,
} from '../lib/socket';

// ── Auth ──────────────────────────────────────────────────────────────────────

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  setAuth: (token: string, user: AuthUser) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => {
        localStorage.setItem('fms_token', token);
        set({ token, user });
      },
      logout: () => {
        localStorage.removeItem('fms_token');
        localStorage.removeItem('fms_user');
        set({ token: null, user: null });
      },
    }),
    { name: 'fms-auth' }
  )
);

// ── Live metrics ──────────────────────────────────────────────────────────────

export interface LiveCycleEvent extends CycleCompletePayload {
  receivedAt: number;
}
export interface LiveFuelEvent extends FuelEventPayload {
  receivedAt: number;
}
export interface LiveDownEvent extends EquipmentStatusPayload {
  receivedAt: number;
}
export interface LiveDispatchEvent extends DispatchAssignedPayload {
  receivedAt: number;
}
export interface LiveTelemetryAlert extends TelemetryAlertPayload {
  receivedAt: number;
}

interface LiveMetricsState {
  /* shift running totals — updated by production:shift */
  shiftProduction: ShiftProductionPayload | null;

  /* cumulative session counters (reset on page reload) */
  sessionCycles:       number;
  sessionTonnes:       number;
  sessionFuelLiters:   number;
  sessionFuelCost:     number;

  /* live event feeds (newest first, capped at 50) */
  recentCycles:        LiveCycleEvent[];
  recentFuelEvents:    LiveFuelEvent[];
  downEvents:          LiveDownEvent[];
  dispatchEvents:      LiveDispatchEvent[];
  telemetryAlerts:     LiveTelemetryAlert[];

  /* last flash timestamp per equipment (for UI pulse) */
  lastCycleFlash:      Record<string, number>;

  /* actions */
  onCycleComplete:     (d: CycleCompletePayload)     => void;
  onShiftProduction:   (d: ShiftProductionPayload)   => void;
  onFuelEvent:         (d: FuelEventPayload)          => void;
  onEquipmentDown:     (d: EquipmentStatusPayload)   => void;
  onDispatchAssigned:  (d: DispatchAssignedPayload)  => void;
  onTelemetryAlert:    (d: TelemetryAlertPayload)    => void;
  clearTelemetryAlert: (equipmentId: string)         => void;
}

const cap = <T>(arr: T[], max = 50) => arr.slice(0, max);

export const useLiveStore = create<LiveMetricsState>((set) => ({
  shiftProduction:  null,
  sessionCycles:    0,
  sessionTonnes:    0,
  sessionFuelLiters:0,
  sessionFuelCost:  0,
  recentCycles:     [],
  recentFuelEvents: [],
  downEvents:       [],
  dispatchEvents:   [],
  telemetryAlerts:  [],
  lastCycleFlash:   {},

  onCycleComplete: (d) => set((s) => ({
    sessionCycles:   s.sessionCycles + 1,
    sessionTonnes:   s.sessionTonnes + (d.payload_tonnes || 0),
    recentCycles:    cap([{ ...d, receivedAt: Date.now() }, ...s.recentCycles]),
    lastCycleFlash:  { ...s.lastCycleFlash, [d.truck_id]: Date.now() },
  })),

  onShiftProduction: (d) => set({ shiftProduction: d }),

  onFuelEvent: (d) => set((s) => ({
    sessionFuelLiters: s.sessionFuelLiters + (d.quantity_liters || 0),
    sessionFuelCost:   s.sessionFuelCost + (d.total_cost || 0),
    recentFuelEvents:  cap([{ ...d, receivedAt: Date.now() }, ...s.recentFuelEvents]),
  })),

  onEquipmentDown: (d) => set((s) => ({
    downEvents: cap([{ ...d, receivedAt: Date.now() }, ...s.downEvents]),
  })),

  onDispatchAssigned: (d) => set((s) => ({
    dispatchEvents: cap([{ ...d, receivedAt: Date.now() }, ...s.dispatchEvents]),
  })),

  onTelemetryAlert: (d) => set((s) => ({
    telemetryAlerts: cap([
      { ...d, receivedAt: Date.now() },
      ...s.telemetryAlerts.filter((a) => a.equipment_id !== d.equipment_id),
    ]),
  })),

  clearTelemetryAlert: (equipmentId) => set((s) => ({
    telemetryAlerts: s.telemetryAlerts.filter((a) => a.equipment_id !== equipmentId),
  })),
}));

// ── GPS / Fleet / Alarms ──────────────────────────────────────────────────────

interface RealtimeState {
  positions: Record<string, GpsPosition>;
  fleetStatus: Record<string, number>;
  activeAlarms: Alarm[];
  setPositions: (positions: GpsPosition[]) => void;
  setFleetStatus: (status: Record<string, number>) => void;
  setAlarms: (alarms: Alarm[]) => void;
}

export const useRealtimeStore = create<RealtimeState>((set) => ({
  positions: {},
  fleetStatus: {},
  activeAlarms: [],
  setPositions: (positions) =>
    set((state) => ({
      positions: {
        ...state.positions,
        ...Object.fromEntries(positions.map((p) => [p.equipment_id, p])),
      },
    })),
  setFleetStatus: (fleetStatus) => set({ fleetStatus }),
  setAlarms: (activeAlarms) => set({ activeAlarms: activeAlarms as Alarm[] }),
}));
