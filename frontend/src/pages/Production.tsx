import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productionApi, exportCsv } from '../lib/api';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ComposedChart, Line, Cell, Legend,
} from 'recharts';

// ── Types ──────────────────────────────────────────────────────
interface DailyRow {
  day: string;
  cycles: number;
  actual_tonnes: number;
  plan_tonnes: number;
  avg_payload: number;
  avg_cycle_min: number;
  overloaded_count: number;
}
interface ShiftRow {
  shift_id: string;
  shift_name: string;
  color: string;
  actual_cycles: number;
  actual_tonnes: number;
  plan_tonnes: number;
  plan_cycles: number;
  achievement_pct: number;
  avg_cycle_min: number;
  supervisor: string;
  shift_status: string;
}
interface MaterialRow {
  material: string;
  material_color: string;
  source: string;
  destination: string;
  cycles: number;
  tonnes: number;
  avg_payload: number;
}
interface TruckRow {
  fleet_number: string;
  category: string;
  operator_name: string;
  cycles: number;
  tonnes: number;
  avg_payload: number;
  avg_payload_factor: number;
  avg_cycle_min: number;
  avg_queue_min: number;
  overloaded: number;
  tonnes_per_hour: number;
}

const COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899'];

// ── Achievement badge ──────────────────────────────────────────
function AchievementBadge({ pct }: { pct: number }) {
  const color = pct >= 100 ? 'text-green-400 bg-green-900/30 border-green-700'
    : pct >= 80  ? 'text-yellow-400 bg-yellow-900/30 border-yellow-700'
    : 'text-red-400 bg-red-900/30 border-red-700';
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded border ${color}`}>
      {pct ? `${pct}%` : '—'}
    </span>
  );
}

// ── Main Page ──────────────────────────────────────────────────
export default function Production() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'daily' | 'shifts' | 'materials' | 'trucks'>('daily');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [days, setDays] = useState('14');

  // Daily reconciliation (14d)
  const { data: daily = [], isLoading: dailyLoading } = useQuery<DailyRow[]>({
    queryKey: ['prod-daily', days],
    queryFn: async () => { const r = await productionApi.dailyReconciliation({ days }); return r.data; },
    refetchInterval: 60_000,
  });

  // Shift reconciliation for selected date
  const { data: shifts = [] } = useQuery<ShiftRow[]>({
    queryKey: ['prod-shifts', date],
    queryFn: async () => { const r = await productionApi.shiftReconciliation({ date }); return r.data; },
    refetchInterval: 60_000,
    enabled: tab === 'shifts' || tab === 'daily',
  });

  // Material breakdown
  const { data: materials = [] } = useQuery<MaterialRow[]>({
    queryKey: ['prod-materials', date],
    queryFn: async () => { const r = await productionApi.materials({ date }); return r.data; },
    enabled: tab === 'materials',
  });

  // Truck performance
  const { data: trucks = [] } = useQuery<TruckRow[]>({
    queryKey: ['prod-trucks', date],
    queryFn: async () => { const r = await productionApi.trucks({ date }); return r.data; },
    enabled: tab === 'trucks',
    refetchInterval: 30_000,
  });

  // Plan upsert mutation
  const [planModal, setPlanModal] = useState<ShiftRow | null>(null);
  const [planTarget, setPlanTarget] = useState('');
  const planMutation = useMutation({
    mutationFn: () => productionApi.upsertPlan({ shiftId: planModal?.shift_id, targetTonnes: parseFloat(planTarget) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prod-shifts'] });
      setPlanModal(null);
      setPlanTarget('');
    },
  });

  // Summary for today
  const todayData = daily.find((d) => d.day.startsWith(new Date().toISOString().slice(0, 10)));
  const totalActual = daily.reduce((s, d) => s + Number(d.actual_tonnes || 0), 0);
  const totalPlan   = daily.reduce((s, d) => s + Number(d.plan_tonnes || 0), 0);
  const globalAch   = totalPlan > 0 ? Math.round((totalActual / totalPlan) * 100) : 0;

  // Chart data
  const dailyChartData = [...daily].reverse().map((d) => ({
    day: format(parseISO(d.day), 'dd/MM', { locale: fr }),
    Réalisé: Number(d.actual_tonnes || 0),
    Objectif: Number(d.plan_tonnes || 0),
  }));

  const tabs = [
    { id: 'daily' as const, label: '📅 Réconciliation' },
    { id: 'shifts' as const, label: '🔄 Par Poste' },
    { id: 'materials' as const, label: '⛏ Matières' },
    { id: 'trucks' as const, label: '🚛 Camions' },
  ];

  return (
    <div className="space-y-5">
      {/* KPI summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card">
          <div className="card-header">Tonnes (aujourd'hui)</div>
          <div className="text-2xl font-bold font-mono text-mine-accent">
            {Number(todayData?.actual_tonnes || 0).toLocaleString('fr')} t
          </div>
          {todayData?.plan_tonnes && (
            <div className="text-xs text-mine-muted mt-1">
              Objectif : {Number(todayData.plan_tonnes).toLocaleString('fr')} t
            </div>
          )}
        </div>
        <div className="card">
          <div className="card-header">Cycles (aujourd'hui)</div>
          <div className="text-2xl font-bold font-mono text-blue-400">
            {todayData?.cycles || 0}
          </div>
          <div className="text-xs text-mine-muted mt-1">
            {todayData ? `~${Number(todayData.avg_payload).toFixed(1)} t/cycle` : '—'}
          </div>
        </div>
        <div className="card">
          <div className="card-header">Total {days}j</div>
          <div className="text-2xl font-bold font-mono text-green-400">
            {totalActual.toLocaleString('fr', { maximumFractionDigits: 0 })} t
          </div>
          {totalPlan > 0 && (
            <div className="text-xs text-mine-muted mt-1">
              Plan : {totalPlan.toLocaleString('fr', { maximumFractionDigits: 0 })} t
            </div>
          )}
        </div>
        <div className="card">
          <div className="card-header">Taux réalisation</div>
          <div className={`text-2xl font-bold font-mono ${
            globalAch >= 100 ? 'text-green-400' : globalAch >= 80 ? 'text-yellow-400' : 'text-red-400'
          }`}>{globalAch || '—'}{globalAch ? '%' : ''}</div>
          <div className="text-xs text-mine-muted mt-1">{days} derniers jours</div>
        </div>
      </div>

      {/* Tabs + controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === t.id ? 'bg-mine-accent text-black' : 'text-mine-muted hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {tab === 'daily' ? (
            <select
              className="input text-sm"
              value={days}
              onChange={(e) => setDays(e.target.value)}
            >
              {['7', '14', '30'].map((d) => <option key={d} value={d}>{d} jours</option>)}
            </select>
          ) : (
            <input
              type="date"
              className="input text-sm"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          )}
          <button
            onClick={() => {
              const data = tab === 'trucks' ? trucks : tab === 'materials' ? materials : tab === 'shifts' ? shifts : daily;
              exportCsv(data as unknown as Record<string, unknown>[], `production_${tab}_${date}.csv`);
            }}
            className="btn-secondary text-sm"
          >↓ CSV</button>
        </div>
      </div>

      {/* ── Daily Tab ── */}
      {tab === 'daily' && (
        <div className="space-y-4">
          {/* Area chart actual vs plan */}
          <div className="card">
            <div className="card-header">Tonnes Réalisées vs Objectif ({days} jours)</div>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={dailyChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" />
                <XAxis dataKey="day" stroke="#64748b" tick={{ fontSize: 11 }} />
                <YAxis stroke="#64748b" tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#111827', border: '1px solid #1e2d45', borderRadius: 8 }}
                  formatter={(v: unknown, name) => [`${Number(v).toLocaleString('fr')} t`, name]}
                />
                <Legend />
                <Bar dataKey="Réalisé" fill="#f59e0b" radius={[3, 3, 0, 0]} opacity={0.9} />
                <Line type="monotone" dataKey="Objectif" stroke="#ef4444" strokeWidth={2} dot={false} strokeDasharray="5 5" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Daily table */}
          <div className="card">
            <div className="card-header">Détail Journalier</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-mine-border">
                    {['Date', 'Cycles', 'Tonnes réalisées', 'Objectif', 'Réalisation', 'Payload moy.', 'Cycle moy.', 'Surchargés'].map((h) => (
                      <th key={h} className="text-left py-2.5 px-3 text-xs text-mine-muted font-medium uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dailyLoading ? (
                    <tr><td colSpan={8} className="text-center py-8 text-mine-muted">Chargement...</td></tr>
                  ) : daily.map((d) => {
                    const ach = d.plan_tonnes > 0 ? Math.round((Number(d.actual_tonnes) / Number(d.plan_tonnes)) * 100) : 0;
                    const isToday = d.day.startsWith(new Date().toISOString().slice(0, 10));
                    return (
                      <tr key={d.day} className={`table-row ${isToday ? 'bg-mine-accent/5' : ''}`}>
                        <td className="py-2.5 px-3 font-mono text-xs">
                          {format(parseISO(d.day), 'EEE dd/MM', { locale: fr })}
                          {isToday && <span className="ml-2 text-mine-accent text-xs">·aujourd'hui</span>}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-center">{d.cycles}</td>
                        <td className="py-2.5 px-3 font-mono font-bold text-mine-accent">
                          {Number(d.actual_tonnes).toLocaleString('fr')} t
                        </td>
                        <td className="py-2.5 px-3 font-mono text-mine-muted">
                          {Number(d.plan_tonnes) > 0 ? `${Number(d.plan_tonnes).toLocaleString('fr')} t` : '—'}
                        </td>
                        <td className="py-2.5 px-3">
                          {ach > 0 ? <AchievementBadge pct={ach} /> : '—'}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-xs">{Number(d.avg_payload).toFixed(1)} t</td>
                        <td className="py-2.5 px-3 font-mono text-xs">{Number(d.avg_cycle_min).toFixed(1)} min</td>
                        <td className="py-2.5 px-3 text-center">
                          {Number(d.overloaded_count) > 0
                            ? <span className="text-red-400 font-mono text-xs">{d.overloaded_count}</span>
                            : <span className="text-mine-muted text-xs">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Shifts Tab ── */}
      {tab === 'shifts' && (
        <div className="card">
          <div className="card-header">
            Réconciliation par Poste —{' '}
            {format(parseISO(date), 'EEEE d MMMM yyyy', { locale: fr })}
          </div>
          {shifts.length === 0 ? (
            <div className="text-center py-12 text-mine-muted">Aucune donnée pour cette date</div>
          ) : (
            <div className="space-y-4">
              {shifts.map((s) => {
                const ach = s.achievement_pct ? Math.round(Number(s.achievement_pct)) : 0;
                return (
                  <div key={s.shift_id} className="bg-mine-bg rounded-xl p-5 border border-mine-border">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <div className="font-bold text-base" style={{ color: s.color }}>{s.shift_name}</div>
                        <div className="text-xs text-mine-muted">
                          Superviseur : {s.supervisor || 'Non assigné'} · {s.shift_status}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <AchievementBadge pct={ach} />
                        <button
                          onClick={() => { setPlanModal(s); setPlanTarget(String(s.plan_tonnes || '')); }}
                          className="text-xs text-mine-highlight hover:underline"
                        >
                          ✏ Modifier objectif
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                      {[
                        { label: 'Tonnes réalisées', value: `${Number(s.actual_tonnes).toLocaleString('fr')} t`, color: 'text-mine-accent' },
                        { label: 'Objectif', value: s.plan_tonnes > 0 ? `${Number(s.plan_tonnes).toLocaleString('fr')} t` : '—', color: 'text-mine-muted' },
                        { label: 'Cycles', value: `${s.actual_cycles} / ${s.plan_cycles || '—'}`, color: 'text-blue-400' },
                        { label: 'Cycle moyen', value: `${Number(s.avg_cycle_min).toFixed(1)} min`, color: 'text-green-400' },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="bg-mine-panel rounded-lg p-3">
                          <div className="text-xs text-mine-muted">{label}</div>
                          <div className={`text-base font-bold font-mono ${color}`}>{value}</div>
                        </div>
                      ))}
                    </div>

                    {/* Progress bar */}
                    {s.plan_tonnes > 0 && (
                      <div>
                        <div className="h-3 bg-mine-border rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              ach >= 100 ? 'bg-green-500' : ach >= 80 ? 'bg-mine-accent' : 'bg-red-500'
                            }`}
                            style={{ width: `${Math.min(100, ach)}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-xs text-mine-muted mt-1">
                          <span>{Number(s.actual_tonnes).toLocaleString('fr')} t</span>
                          <span>{Number(s.plan_tonnes).toLocaleString('fr')} t</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Materials Tab ── */}
      {tab === 'materials' && (
        <div className="space-y-4">
          <div className="card">
            <div className="card-header">Répartition par Matière — {format(parseISO(date), 'dd/MM/yyyy')}</div>
            {materials.length === 0 ? (
              <div className="text-center py-12 text-mine-muted">Aucune donnée</div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={materials}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" />
                    <XAxis dataKey="material" stroke="#64748b" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#64748b" tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#111827', border: '1px solid #1e2d45', borderRadius: 8 }}
                      formatter={(v: unknown) => [`${Number(v).toLocaleString('fr')} t`, 'Tonnes']}
                    />
                    <Bar dataKey="tonnes" radius={[4, 4, 0, 0]} name="Tonnes">
                      {materials.map((m, i) => (
                        <Cell key={i} fill={m.material_color || COLORS[i % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="overflow-x-auto mt-3">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-mine-border">
                        {['Matière', 'Source → Dest', 'Cycles', 'Tonnes', 'Payload moy.', 'Surcharge'].map((h) => (
                          <th key={h} className="text-left py-2 px-3 text-xs text-mine-muted font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {materials.map((m, i) => (
                        <tr key={i} className="table-row">
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: m.material_color || '#888' }} />
                              <span className="font-medium">{m.material || 'Inconnu'}</span>
                            </div>
                          </td>
                          <td className="py-2 px-3 text-xs text-mine-muted">{m.source} → {m.destination}</td>
                          <td className="py-2 px-3 font-mono">{m.cycles}</td>
                          <td className="py-2 px-3 font-mono font-bold text-mine-accent">{Number(m.tonnes).toLocaleString('fr')} t</td>
                          <td className="py-2 px-3 font-mono">{Number(m.avg_payload).toFixed(1)} t</td>
                          <td className="py-2 px-3 text-xs text-red-400">—</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Trucks Tab ── */}
      {tab === 'trucks' && (
        <div className="card">
          <div className="card-header">Performance par Camion — {format(parseISO(date), 'dd/MM/yyyy')}</div>
          {trucks.length === 0 ? (
            <div className="text-center py-12 text-mine-muted">Aucune donnée</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-mine-border">
                    {['Camion', 'Opérateur', 'Cycles', 'Tonnes', 'T/h', 'Payload moy.', 'Facteur', 'Cycle moy.', 'File att.', 'Surchargés'].map((h) => (
                      <th key={h} className="text-left py-2.5 px-3 text-xs text-mine-muted font-medium uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trucks.map((t) => {
                    const pf = Number(t.avg_payload_factor);
                    const pfColor = pf >= 1 ? 'text-red-400' : pf >= 0.9 ? 'text-green-400' : 'text-yellow-400';
                    return (
                      <tr key={t.fleet_number} className="table-row">
                        <td className="py-2.5 px-3 font-mono font-bold text-mine-accent">{t.fleet_number}</td>
                        <td className="py-2.5 px-3 text-xs">{t.operator_name || '—'}</td>
                        <td className="py-2.5 px-3 font-mono text-center">{t.cycles}</td>
                        <td className="py-2.5 px-3 font-mono font-bold">
                          {Number(t.tonnes).toLocaleString('fr', { maximumFractionDigits: 0 })} t
                        </td>
                        <td className="py-2.5 px-3 font-mono text-blue-400">
                          {t.tonnes_per_hour ? `${Number(t.tonnes_per_hour).toFixed(0)} t/h` : '—'}
                        </td>
                        <td className="py-2.5 px-3 font-mono">{Number(t.avg_payload).toFixed(1)} t</td>
                        <td className="py-2.5 px-3">
                          <span className={`font-mono font-bold ${pfColor}`}>
                            {(pf * 100).toFixed(0)}%
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-xs">{Number(t.avg_cycle_min).toFixed(1)} min</td>
                        <td className="py-2.5 px-3 font-mono text-xs">
                          <span className={Number(t.avg_queue_min) > 10 ? 'text-red-400' : Number(t.avg_queue_min) > 5 ? 'text-yellow-400' : 'text-slate-400'}>
                            {t.avg_queue_min ? `${Number(t.avg_queue_min).toFixed(1)} min` : '—'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          {Number(t.overloaded) > 0
                            ? <span className="text-red-400 font-mono font-bold">{t.overloaded}</span>
                            : <span className="text-mine-muted">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Plan Edit Modal */}
      {planModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-mine-panel rounded-xl w-full max-w-sm border border-mine-border shadow-2xl p-6">
            <h2 className="text-base font-bold mb-4">Modifier l'objectif</h2>
            <div className="text-sm text-mine-muted mb-4">
              Poste : <span className="font-bold" style={{ color: planModal.color }}>{planModal.shift_name}</span>
            </div>
            <div className="mb-4">
              <label className="text-xs text-mine-muted mb-1 block">Objectif tonnes *</label>
              <input
                type="number"
                className="input w-full"
                value={planTarget}
                onChange={(e) => setPlanTarget(e.target.value)}
                placeholder="ex: 24000"
              />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setPlanModal(null)} className="btn-secondary flex-1">Annuler</button>
              <button
                onClick={() => planMutation.mutate()}
                disabled={!planTarget || planMutation.isPending}
                className="btn-primary flex-1"
              >
                {planMutation.isPending ? '...' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
