import { useQuery } from '@tanstack/react-query';
import {
  AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { kpiApi } from '../lib/api';
import type { DashboardKpi } from '../types';
import { useRealtimeStore, useLiveStore } from '../store';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import LiveMetricsBar from '../components/live/LiveMetricsBar';
import LiveFeed from '../components/live/LiveFeed';

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({
  title, value, unit, sub, accent = '#f59e0b', live = false,
}: {
  title: string; value: string | number; unit?: string;
  sub?: string; accent?: string; live?: boolean;
}) {
  return (
    <div
      className="bg-[#111827] border rounded-lg p-4 transition-all"
      style={{ borderColor: live ? accent + '50' : '#1a2740' }}
    >
      {live && (
        <div className="flex items-center gap-1 mb-1">
          <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: accent }} />
          <span className="text-[9px] uppercase tracking-widest font-semibold" style={{ color: accent }}>Live</span>
        </div>
      )}
      <div className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mb-1">{title}</div>
      <div className="text-[26px] font-bold font-mono leading-tight" style={{ color: accent }}>
        {value}
        {unit && <span className="text-[14px] font-normal text-slate-500 ml-1">{unit}</span>}
      </div>
      {sub && <div className="text-[11px] text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

// ── Gauge Ring ────────────────────────────────────────────────────────────────

function GaugeRing({ value, color, label }: { value: number; color: string; label: string }) {
  const pct  = Math.min(100, Math.max(0, Math.round(value)));
  const r    = 40;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="96" height="96" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r={r} fill="none" stroke="#1e2d45" strokeWidth="8" />
        <circle
          cx="48" cy="48" r={r} fill="none" stroke={color}
          strokeWidth="8" strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round" transform="rotate(-90 48 48)"
        />
        <text x="48" y="44" textAnchor="middle" fill="white" fontSize="16" fontWeight="bold" fontFamily="monospace">{pct}%</text>
        <text x="48" y="58" textAnchor="middle" fill="#64748b" fontSize="9">{label}</text>
      </svg>
    </div>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-1.5 bg-[#1a2740] rounded-full overflow-hidden mt-1">
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: color }} />
    </div>
  );
}

const SEVERITY_COLORS: Record<string, string> = {
  EMERGENCY: '#ef4444', CRITICAL: '#f97316', WARNING: '#eab308', INFO: '#3b82f6',
};

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { activeAlarms }   = useRealtimeStore();
  const shiftProd          = useLiveStore((s) => s.shiftProduction);
  const sessionCycles      = useLiveStore((s) => s.sessionCycles);
  const sessionTonnes      = useLiveStore((s) => s.sessionTonnes);

  const { data, isLoading } = useQuery<DashboardKpi>({
    queryKey: ['kpi'],
    queryFn: async () => (await kpiApi.dashboard()).data,
    refetchInterval: 30_000,
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-600 text-[13px]">Chargement des données...</div>
      </div>
    );
  }

  const { fleet, production, kpi, hourlyTrend, statusDist, maintenance, fuel, plan } = data;

  const achievePct = plan && plan.target_tonnes > 0
    ? Math.min(100, Math.round((plan.actual_tonnes / plan.target_tonnes) * 100))
    : null;

  const trendData = hourlyTrend.map((h) => ({
    ...h,
    hour: format(parseISO(h.hour), 'HH:mm', { locale: fr }),
  }));

  // Prefer live shift data when available — coerce all DB values to Number
  const liveCycles = Number(shiftProd?.cycles_count ?? production.cycles_today ?? 0);
  const liveTonnes = Number(shiftProd?.actual_tonnes ?? production.tonnes_today ?? 0);
  const liveAvgMin = Number(shiftProd?.avg_cycle_min ?? production.avg_cycle_min ?? 0);
  const avgPayload  = Number(shiftProd?.avg_payload ?? production.avg_payload ?? 0);
  const _rawTarget  = shiftProd?.target_tonnes ?? plan?.target_tonnes;
  const liveTarget  = _rawTarget != null ? Number(_rawTarget) : undefined;
  const liveAchiev  = shiftProd?.achievement_pct != null
    ? Number(shiftProd.achievement_pct)
    : achievePct;

  return (
    <div className="space-y-4">

      {/* ── Live metrics bar ────────────────────────────────────────────────── */}
      <div className="bg-[#0d1520] border border-[#1a2740] rounded-lg px-4 py-2.5">
        <LiveMetricsBar />
      </div>

      {/* ── KPI Cards — ligne 1 (production) ────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          title="Tonnes poste"
          value={liveTonnes.toLocaleString('fr', { maximumFractionDigits: 0 })}
          unit="t"
          sub={liveTarget ? `Plan: ${liveTarget.toLocaleString('fr', { maximumFractionDigits: 0 })} t` : undefined}
          accent="#22c55e"
          live={!!shiftProd}
        />
        <KpiCard
          title="Cycles effectués"
          value={liveCycles}
          sub={`Payload moy.: ${avgPayload.toFixed(1)} t`}
          accent="#3b82f6"
          live={!!shiftProd}
        />
        <KpiCard
          title="Durée cycle moy."
          value={liveAvgMin > 0 ? liveAvgMin.toFixed(1) : '—'}
          unit="min"
          sub="Objectif: < 42 min"
          accent={liveAvgMin > 45 ? '#ef4444' : '#22c55e'}
          live={!!shiftProd}
        />
        <KpiCard
          title="Carburant (jour)"
          value={(fuel.liters_today ?? 0).toLocaleString('fr', { maximumFractionDigits: 0 })}
          unit="L"
          sub={`Coût: $${(fuel.cost_today ?? 0).toLocaleString('fr', { maximumFractionDigits: 0 })}`}
          accent="#f59e0b"
        />
      </div>

      {/* ── KPI Cards — ligne 2 (flotte + OT) ──────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          title="Camions actifs"
          value={`${fleet.active_trucks ?? 0} / ${fleet.total_trucks ?? 0}`}
          sub={`${fleet.down_trucks ?? 0} panne · ${fleet.maint_trucks ?? 0} maint.`}
          accent="#60a5fa"
        />
        <KpiCard
          title="Pannes actives"
          value={maintenance.active_breakdowns ?? 0}
          sub={`${maintenance.open_wos ?? 0} OT ouverts · ${maintenance.urgent_wos ?? 0} urgents`}
          accent={(maintenance.active_breakdowns ?? 0) > 0 ? '#ef4444' : '#22c55e'}
        />
        <KpiCard
          title="Alarmes non ack."
          value={activeAlarms.filter((a) => !a.acknowledged).length}
          sub={`Critiques: ${activeAlarms.filter((a) => a.severity === 'CRITICAL' || a.severity === 'EMERGENCY').length}`}
          accent={activeAlarms.filter((a) => !a.acknowledged).length > 0 ? '#eab308' : '#22c55e'}
          live={activeAlarms.length > 0}
        />
        {liveAchiev !== null ? (
          <KpiCard
            title="Atteinte plan"
            value={liveAchiev}
            unit="%"
            sub={`${liveTonnes.toLocaleString('fr', { maximumFractionDigits: 0 })} / ${(liveTarget ?? 0).toLocaleString('fr', { maximumFractionDigits: 0 })} t`}
            accent={liveAchiev >= 90 ? '#22c55e' : liveAchiev >= 70 ? '#eab308' : '#ef4444'}
            live={!!shiftProd}
          />
        ) : (
          <KpiCard
            title="Excavateurs"
            value={`${fleet.active_excavators ?? 0} / ${fleet.total_excavators ?? 0}`}
            sub="En production"
            accent="#a855f7"
          />
        )}
      </div>

      {/* ── OEE + Trend ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* OEE Panel */}
        <div className="bg-[#111827] border border-[#1a2740] rounded-lg p-4">
          <div className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mb-3">Indicateurs OEE</div>
          <div className="flex justify-around">
            <GaugeRing value={kpi.oee}          color="#f59e0b" label="OEE" />
            <GaugeRing value={kpi.availability} color="#22c55e" label="Dispo." />
            <GaugeRing value={kpi.utilization}  color="#3b82f6" label="Util." />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-1 text-center">
            {[
              { label: 'OEE',          v: kpi.oee,          c: '#f59e0b' },
              { label: 'Disponibilité',v: kpi.availability, c: '#22c55e' },
              { label: 'Utilisation',  v: kpi.utilization,  c: '#3b82f6' },
            ].map(({ label, v, c }) => (
              <div key={label}>
                <div className="text-[18px] font-bold font-mono" style={{ color: c }}>{v}%</div>
                <div className="text-[10px] text-slate-500">{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Hourly production trend */}
        <div className="bg-[#111827] border border-[#1a2740] rounded-lg p-4 col-span-2">
          <div className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mb-3">Production horaire</div>
          <ResponsiveContainer width="100%" height={170}>
            <AreaChart data={trendData}>
              <defs>
                <linearGradient id="tGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" />
              <XAxis dataKey="hour" stroke="#475569" tick={{ fontSize: 10 }} />
              <YAxis stroke="#475569" tick={{ fontSize: 10 }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#111827', border: '1px solid #1e2d45', borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: '#e2e8f0' }}
              />
              <Area type="monotone" dataKey="tonnes" stroke="#f59e0b" fill="url(#tGrad)" strokeWidth={2} name="Tonnes" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Fleet status + Live feed + Alarms ───────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">

        {/* Fleet status pie */}
        <div className="bg-[#111827] border border-[#1a2740] rounded-lg p-4">
          <div className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mb-3">Répartition flotte</div>
          <div className="flex items-center gap-3">
            <ResponsiveContainer width={130} height={130}>
              <PieChart>
                <Pie
                  data={statusDist}
                  dataKey="count"
                  nameKey="status"
                  cx="50%" cy="50%"
                  outerRadius={60} innerRadius={35}
                >
                  {statusDist.map((entry, i) => (
                    <Cell key={i} fill={entry.color || '#475569'} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-1 min-w-0">
              {statusDist.map((s, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="text-[11px] text-slate-400 truncate">{s.status}</span>
                  </div>
                  <span className="text-[12px] font-mono font-bold text-slate-300 flex-shrink-0 ml-1">{s.count}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Plan progress */}
          {liveAchiev !== null && liveTarget != null && (
            <div className="mt-4 pt-3 border-t border-[#1a2740]">
              <div className="flex justify-between text-[11px] mb-1">
                <span className="text-slate-500">Plan poste</span>
                <span className="font-mono text-slate-300">{liveAchiev}%</span>
              </div>
              <ProgressBar
                pct={liveAchiev}
                color={liveAchiev >= 90 ? '#22c55e' : liveAchiev >= 70 ? '#eab308' : '#ef4444'}
              />
            </div>
          )}
          {/* Session counter */}
          {sessionCycles > 0 && (
            <div className="mt-3 flex items-center justify-between text-[11px]">
              <span className="text-slate-600">Nouveaux cycles (session)</span>
              <span className="font-mono text-blue-400 font-bold">+{sessionCycles} · +{sessionTonnes.toFixed(0)} t</span>
            </div>
          )}
        </div>

        {/* Live event feed */}
        <div className="bg-[#111827] border border-[#1a2740] rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Flux temps réel</div>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          <LiveFeed maxItems={8} />
        </div>

        {/* Active alarms */}
        <div className="bg-[#111827] border border-[#1a2740] rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Alarmes actives</div>
            {activeAlarms.length > 0 && (
              <span className="text-[11px] font-mono font-bold text-red-400">{activeAlarms.length}</span>
            )}
          </div>
          <div className="space-y-2 max-h-52 overflow-auto">
            {activeAlarms.length === 0 ? (
              <div className="text-center text-slate-600 py-6 text-[12px]">Aucune alarme active</div>
            ) : (
              activeAlarms.slice(0, 8).map((a) => (
                <div
                  key={a.alarm_id}
                  className="flex items-start gap-2 p-2 bg-[#0d1520] rounded border border-[#1a2740]"
                >
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5"
                    style={{
                      backgroundColor: (SEVERITY_COLORS[a.severity] || '#475569') + '22',
                      color: SEVERITY_COLORS[a.severity] || '#94a3b8',
                    }}
                  >
                    {a.severity}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-semibold text-slate-200 truncate">{a.fleet_number} — {a.alarm_code}</div>
                    <div className="text-[10px] text-slate-500 truncate">{a.message}</div>
                  </div>
                  {!a.acknowledged && (
                    <span className="alarm-critical text-red-400 text-[10px] flex-shrink-0">●</span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
