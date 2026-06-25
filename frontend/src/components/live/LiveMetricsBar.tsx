import type { CSSProperties } from 'react';
import { useLiveStore } from '../../store';
import { IconTruck, IconFuel, IconProduction, IconAlert, IconActivity } from '../ui/Icons';

// ── pulse style injected once ─────────────────────────────────────────────────
const PULSE_MS = 1200;

function Dot({ active }: { active: boolean }) {
  return (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
      style={{
        backgroundColor: active ? '#22c55e' : '#374151',
        boxShadow: active ? '0 0 6px #22c55e' : 'none',
        transition: 'background-color 0.4s, box-shadow 0.4s',
      }}
    />
  );
}

function Metric({
  icon: Icon, label, value, sub, accent = '#f59e0b', flash = false,
}: {
  icon: React.FC<{ size?: number; className?: string }>;
  label: string;
  value: string;
  sub?: string;
  accent?: string;
  flash?: boolean;
}) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded border transition-all"
      style={{
        borderColor: flash ? accent + '80' : '#1a2740',
        backgroundColor: flash ? accent + '10' : 'transparent',
        transition: `border-color ${PULSE_MS}ms, background-color ${PULSE_MS}ms`,
      }}
    >
      <span className="flex-shrink-0" style={{ color: accent } as CSSProperties}><Icon size={13} /></span>
      <div>
        <div className="text-[10px] text-slate-500 uppercase tracking-wider leading-none">{label}</div>
        <div className="text-[13px] font-mono font-bold leading-tight" style={{ color: accent }}>{value}</div>
        {sub && <div className="text-[10px] text-slate-600 leading-none">{sub}</div>}
      </div>
    </div>
  );
}

function TelemetryAlertBadge() {
  const alerts = useLiveStore((s) => s.telemetryAlerts);
  const clear  = useLiveStore((s) => s.clearTelemetryAlert);
  if (alerts.length === 0) return null;
  const top = alerts[0];
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded border border-red-700/50 bg-red-950/40 cursor-pointer hover:bg-red-950/70 transition-colors"
      onClick={() => clear(top.equipment_id)}
      title={`${top.alerts.map(a => `${a.label}: ${a.value}${a.unit}`).join(' | ')} — cliquer pour effacer`}
    >
      <IconAlert size={13} className="text-red-400 flex-shrink-0" />
      <div>
        <div className="text-[10px] text-red-500 uppercase tracking-wider leading-none font-semibold">
          {top.fleet_number}
        </div>
        <div className="text-[11px] text-red-300 font-mono leading-tight">
          {top.alerts[0].label}: <strong>{top.alerts[0].value}{top.alerts[0].unit}</strong>
          {alerts.length > 1 && <span className="text-red-500 ml-1">+{alerts.length - 1}</span>}
        </div>
      </div>
    </div>
  );
}

export default function LiveMetricsBar() {
  const shift         = useLiveStore((s) => s.shiftProduction);
  const cycles        = useLiveStore((s) => s.sessionCycles);
  const fuelL         = useLiveStore((s) => s.sessionFuelLiters);
  const recentCycles  = useLiveStore((s) => s.recentCycles);
  const downEvents    = useLiveStore((s) => s.downEvents);

  const lastCycle      = recentCycles[0];
  const lastCycleAge   = lastCycle ? (Date.now() - lastCycle.receivedAt) / 1000 : 9999;
  const flashCycle     = lastCycleAge < 8;

  const shiftCycles    = shift?.cycles_count  ?? 0;
  const shiftTonnes    = shift?.actual_tonnes ?? 0;
  const shiftTarget    = shift?.target_tonnes;
  const achievePct     = shift?.achievement_pct;
  const avgPayload     = shift?.avg_payload ?? 0;
  const avgCycleMin    = shift?.avg_cycle_min ?? 0;

  const activeDowns    = downEvents.filter(d => (Date.now() - d.receivedAt) < 3_600_000).length;
  const connected      = cycles > 0 || shiftCycles > 0;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Live indicator */}
      <div className="flex items-center gap-1.5 px-2 py-1 rounded border border-[#1a2740]">
        <Dot active={connected} />
        <span className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">
          {connected ? 'Live' : 'En attente'}
        </span>
      </div>

      {/* Shift production */}
      <Metric
        icon={IconProduction}
        label="Tonnes poste"
        value={shiftTonnes.toLocaleString('fr', { maximumFractionDigits: 0 })}
        sub={shiftTarget ? `${achievePct ?? 0}% objectif` : undefined}
        accent="#22c55e"
      />

      {/* Haul cycles — flashes on new cycle */}
      <Metric
        icon={IconTruck}
        label="Cycles poste"
        value={String(shiftCycles)}
        sub={avgPayload > 0 ? `moy. ${avgPayload.toFixed(0)} t` : undefined}
        accent="#3b82f6"
        flash={flashCycle}
      />

      {/* Avg cycle time */}
      {avgCycleMin > 0 && (
        <Metric
          icon={IconActivity}
          label="Durée cycle"
          value={`${avgCycleMin.toFixed(1)} min`}
          accent="#a855f7"
        />
      )}

      {/* Fuel (session) */}
      {fuelL > 0 && (
        <Metric
          icon={IconFuel}
          label="Carburant (session)"
          value={`${fuelL.toLocaleString('fr', { maximumFractionDigits: 0 })} L`}
          accent="#f59e0b"
        />
      )}

      {/* Down events */}
      {activeDowns > 0 && (
        <Metric
          icon={IconAlert}
          label="Pannes actives"
          value={String(activeDowns)}
          accent="#ef4444"
        />
      )}

      {/* Telemetry alerts */}
      <TelemetryAlertBadge />

      {/* Last cycle detail */}
      {lastCycle && flashCycle && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-blue-700/40 bg-blue-950/30 text-[11px]">
          <span className="text-blue-400 font-mono font-bold">{lastCycle.fleet_number}</span>
          <span className="text-slate-500">→</span>
          <span className="text-slate-300">{lastCycle.dest_name}</span>
          <span className="text-emerald-400 font-mono font-semibold ml-1">{lastCycle.payload_tonnes.toFixed(0)} t</span>
        </div>
      )}
    </div>
  );
}
