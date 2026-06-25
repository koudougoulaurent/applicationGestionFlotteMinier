import { useEffect } from 'react';
import {
  joinSite,
  onGpsUpdate, onFleetStatus, onAlarms,
  onCycleComplete, onShiftProduction, onFuelEvent,
  onEquipmentDown, onDispatchAssigned, onDispatchUpdated,
  onTelemetryAlert,
} from '../lib/socket';
import { useRealtimeStore, useAuthStore, useLiveStore } from '../store';
import { useQueryClient } from '@tanstack/react-query';

export function useRealtime() {
  const { user }                    = useAuthStore();
  const { setPositions, setFleetStatus, setAlarms } = useRealtimeStore();
  const live                        = useLiveStore();
  const qc                          = useQueryClient();

  useEffect(() => {
    if (!user?.siteId) return;

    joinSite(user.siteId);

    // ── GPS + fleet + alarms (existing) ─────────────────────────────────────
    const off: (() => void)[] = [
      onGpsUpdate(setPositions),
      onFleetStatus(setFleetStatus),
      onAlarms((a) => setAlarms(a as Parameters<typeof setAlarms>[0])),

      // ── Haul cycles ─────────────────────────────────────────────────────
      onCycleComplete((d) => {
        live.onCycleComplete(d);
        // Invalidate relevant queries so tables refresh
        qc.invalidateQueries({ queryKey: ['cycles'] });
        qc.invalidateQueries({ queryKey: ['kpi'] });
      }),

      // ── Production shift KPIs ────────────────────────────────────────────
      onShiftProduction(live.onShiftProduction),

      // ── Fuel events ──────────────────────────────────────────────────────
      onFuelEvent((d) => {
        live.onFuelEvent(d);
        qc.invalidateQueries({ queryKey: ['fuel'] });
      }),

      // ── Equipment status changes ─────────────────────────────────────────
      onEquipmentDown((d) => {
        live.onEquipmentDown(d);
        qc.invalidateQueries({ queryKey: ['equipment'] });
        qc.invalidateQueries({ queryKey: ['kpi'] });
      }),

      // ── Dispatch events ──────────────────────────────────────────────────
      onDispatchAssigned((d) => {
        live.onDispatchAssigned(d);
        qc.invalidateQueries({ queryKey: ['dispatch'] });
        qc.invalidateQueries({ queryKey: ['equipment'] });
      }),

      onDispatchUpdated(() => {
        qc.invalidateQueries({ queryKey: ['dispatch'] });
      }),

      // ── Telemetry alerts ─────────────────────────────────────────────────
      onTelemetryAlert(live.onTelemetryAlert),
    ];

    return () => off.forEach((fn) => fn());
  }, [user?.siteId]); // eslint-disable-line react-hooks/exhaustive-deps
}
