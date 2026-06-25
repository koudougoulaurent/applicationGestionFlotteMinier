import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { shiftApi } from '../lib/api';
import { Shift } from '../types';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

function shiftStatusBadge(s: string) {
  const cfg: Record<string, { cls: string; label: string }> = {
    ACTIVE:  { cls: 'bg-green-900/40 text-green-300 border border-green-700', label: 'En cours' },
    CLOSED:  { cls: 'bg-mine-border text-mine-muted border border-mine-border', label: 'Terminé' },
    PLANNED: { cls: 'bg-blue-900/40 text-blue-300 border border-blue-700', label: 'Planifié' },
  };
  const c = cfg[s] || cfg.CLOSED;
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${c.cls}`}>{c.label}</span>;
}

// ── Shift Report Modal ──────────────────────────────────────────
interface ShiftReportModalProps { shift: Shift; onClose: () => void; }
function ShiftReportModal({ shift, onClose }: ShiftReportModalProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['shift-report', shift.shift_id],
    queryFn: async () => { const r = await shiftApi.report(shift.shift_id); return r.data; },
  });

  const prodData = (data?.production || []) as Array<{
    material: string; material_color: string; source: string; dest: string;
    cycles: number; total_tonnes: number; avg_payload: number; avg_cycle_min: number;
  }>;
  const fuel = data?.fuel as { total_liters: number; total_cost: number; transactions: number } | undefined;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-mine-panel rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto border border-mine-border shadow-2xl">
        <div className="flex justify-between items-center p-5 border-b border-mine-border sticky top-0 bg-mine-panel">
          <div>
            <h2 className="text-lg font-bold">Rapport de Poste</h2>
            <div className="text-sm text-mine-muted">
              {shift.shift_name} — {format(parseISO(shift.shift_date), 'EEEE d MMMM yyyy', { locale: fr })}
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={() => window.print()} className="btn-secondary text-sm">🖨 Imprimer</button>
            <button onClick={onClose} className="text-mine-muted hover:text-white">✕</button>
          </div>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-mine-muted">Chargement du rapport...</div>
        ) : (
          <div className="p-5 space-y-5">
            {/* Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Tonnes totales', value: `${Number(shift.total_tonnes || 0).toLocaleString('fr')} t`, color: 'text-mine-accent' },
                { label: 'Cycles', value: shift.cycle_count || 0, color: 'text-blue-400' },
                { label: 'Opérateurs', value: shift.operator_count || 0, color: 'text-green-400' },
                { label: 'Carburant', value: fuel ? `${Number(fuel.total_liters).toLocaleString('fr')} L` : '—', color: 'text-orange-400' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-mine-bg rounded-lg p-3">
                  <div className="text-xs text-mine-muted">{label}</div>
                  <div className={`text-xl font-bold font-mono ${color}`}>{value}</div>
                </div>
              ))}
            </div>

            {/* Achievement */}
            {shift.target_tonnes && (
              <div className="bg-mine-bg rounded-lg p-4">
                <div className="flex justify-between mb-2">
                  <span className="text-sm">Avancement vs Objectif</span>
                  <span className={`font-bold ${(shift.achievement_pct || 0) >= 100 ? 'text-green-400' : 'text-yellow-400'}`}>
                    {shift.achievement_pct || 0}%
                  </span>
                </div>
                <div className="h-3 bg-mine-border rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${(shift.achievement_pct || 0) >= 100 ? 'bg-green-500' : 'bg-mine-accent'}`}
                    style={{ width: `${Math.min(100, shift.achievement_pct || 0)}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-mine-muted mt-1.5">
                  <span>Réalisé : {Number(shift.total_tonnes || 0).toLocaleString('fr')} t</span>
                  <span>Cible : {Number(shift.target_tonnes).toLocaleString('fr')} t</span>
                </div>
              </div>
            )}

            {/* Production by material */}
            {prodData.length > 0 && (
              <div className="bg-mine-bg rounded-lg p-4">
                <div className="text-sm font-semibold mb-3">Production par Flux</div>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={prodData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" />
                    <XAxis dataKey="material" stroke="#64748b" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#64748b" tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#111827', border: '1px solid #1e2d45', borderRadius: 8 }}
                      formatter={(v: unknown) => [`${Number(v).toLocaleString('fr')} t`, 'Tonnes']}
                    />
                    <Bar dataKey="total_tonnes" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Tonnes" />
                  </BarChart>
                </ResponsiveContainer>
                <table className="w-full text-sm mt-3">
                  <thead>
                    <tr className="border-b border-mine-border">
                      {['Matière', 'Source → Dest', 'Cycles', 'Tonnes', 'Payload moy.', 'Cycle moy.'].map((h) => (
                        <th key={h} className="text-left py-1.5 px-2 text-xs text-mine-muted">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {prodData.map((row, i) => (
                      <tr key={i} className="border-b border-mine-border/50">
                        <td className="py-1.5 px-2 text-mine-accent font-medium">{row.material || '—'}</td>
                        <td className="py-1.5 px-2 text-xs text-mine-muted">{row.source} → {row.dest}</td>
                        <td className="py-1.5 px-2 font-mono">{row.cycles}</td>
                        <td className="py-1.5 px-2 font-mono font-bold">{Number(row.total_tonnes).toLocaleString('fr')} t</td>
                        <td className="py-1.5 px-2 font-mono">{Number(row.avg_payload).toFixed(1)} t</td>
                        <td className="py-1.5 px-2 font-mono">{Number(row.avg_cycle_min).toFixed(1)} min</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Alarms */}
            {(data?.alarms || []).length > 0 && (
              <div className="bg-mine-bg rounded-lg p-4">
                <div className="text-sm font-semibold mb-3">Alarmes du Poste ({data.alarms.length})</div>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {(data.alarms as Array<{ alarm_code: string; severity: string; event_time: string; message: string; fleet_number: string }>).map((a, i) => {
                    const sc: Record<string, string> = { CRITICAL: 'text-red-400', WARNING: 'text-yellow-400', INFO: 'text-blue-400' };
                    return (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <span className={`font-bold ${sc[a.severity] || 'text-white'}`}>[{a.severity}]</span>
                        <span className="text-mine-accent font-mono">{a.fleet_number}</span>
                        <span className="text-mine-muted">{a.alarm_code}</span>
                        <span className="text-mine-muted">—</span>
                        <span>{a.message}</span>
                        <span className="ml-auto text-mine-muted">
                          {format(parseISO(a.event_time), 'HH:mm')}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────
export default function Shifts() {
  const qc = useQueryClient();
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);

  const { data: current } = useQuery({
    queryKey: ['shift-current'],
    queryFn: async () => { const r = await shiftApi.current(); return r.data; },
    refetchInterval: 30_000,
  });

  const { data: shifts = [], isLoading } = useQuery<Shift[]>({
    queryKey: ['shifts'],
    queryFn: async () => { const r = await shiftApi.list(); return r.data; },
    refetchInterval: 60_000,
  });

  const closeMutation = useMutation({
    mutationFn: (id: string) => shiftApi.close(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['shift-current'] }); qc.invalidateQueries({ queryKey: ['shifts'] }); },
  });

  const currentShift = current?.shift as (Shift & { achievement_pct?: number }) | null;
  const equipStatus = (current?.equipStatus || []) as Array<{ category: string; status: string; color: string; count: number }>;
  const hourlyProd = (current?.hourlyProd || []) as Array<{ hour: string; cycles: number; tonnes: number }>;

  return (
    <div className="space-y-5">
      {/* Current Shift Banner */}
      {currentShift ? (
        <div className="bg-mine-panel border border-green-700 rounded-xl p-5">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
              <div>
                <div className="text-lg font-bold">
                  Poste en cours :
                  <span className="ml-2" style={{ color: currentShift.color }}>{currentShift.shift_name}</span>
                </div>
                <div className="text-sm text-mine-muted">
                  Depuis {format(parseISO(currentShift.start_time), 'HH:mm', { locale: fr })} —
                  Superviseur : {currentShift.supervisor_name || 'Non assigné'}
                </div>
              </div>
            </div>
            <button
              onClick={() => closeMutation.mutate(currentShift.shift_id)}
              className="btn-secondary text-sm border-red-700 text-red-400 hover:bg-red-900/30"
              disabled={closeMutation.isPending}
            >
              {closeMutation.isPending ? 'Clôture...' : 'Clôturer le poste'}
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {[
              { label: 'Tonnes', value: `${Number(currentShift.total_tonnes || 0).toLocaleString('fr')} t`, color: 'text-mine-accent' },
              { label: 'Cycles', value: currentShift.cycle_count || 0, color: 'text-blue-400' },
              { label: 'Opérateurs', value: currentShift.operator_count || 0, color: 'text-green-400' },
              { label: 'Avancement', value: currentShift.achievement_pct ? `${currentShift.achievement_pct}%` : '—', color: 'text-yellow-400' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-mine-bg rounded-lg p-3">
                <div className="text-xs text-mine-muted">{label}</div>
                <div className={`text-xl font-bold font-mono ${color}`}>{value}</div>
              </div>
            ))}
          </div>

          {/* Equipment status grid */}
          {equipStatus.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {equipStatus.map((es, i) => (
                <div key={i} className="flex items-center gap-2 bg-mine-bg px-3 py-1.5 rounded-lg text-xs">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: es.color || '#64748b' }} />
                  <span className="text-mine-muted">{es.category}</span>
                  <span className="font-bold">{es.status}</span>
                  <span className="font-mono text-mine-accent">×{es.count}</span>
                </div>
              ))}
            </div>
          )}

          {/* Hourly production chart */}
          {hourlyProd.length > 0 && (
            <div className="bg-mine-bg rounded-lg p-3">
              <div className="text-xs text-mine-muted mb-2">Production horaire ce poste</div>
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={hourlyProd}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" />
                  <XAxis dataKey="hour" stroke="#64748b" tick={{ fontSize: 10 }}
                    tickFormatter={(v) => format(parseISO(v), 'HH:mm')} />
                  <YAxis stroke="#64748b" tick={{ fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#111827', border: '1px solid #1e2d45', borderRadius: 8 }}
                    labelFormatter={(v) => format(parseISO(String(v)), 'HH:mm')}
                    formatter={(v: unknown, name) => [`${Number(v).toLocaleString('fr')}${name === 'tonnes' ? ' t' : ''}`, name]}
                  />
                  <Bar dataKey="tonnes" fill="#f59e0b" radius={[2, 2, 0, 0]} name="Tonnes" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-mine-panel border border-mine-border rounded-xl p-6 flex items-center justify-between">
          <div>
            <div className="text-mine-muted text-sm">Aucun poste actif en ce moment</div>
          </div>
        </div>
      )}

      {/* Shift History */}
      <div className="card">
        <div className="card-header">Historique des Postes</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-mine-border">
                {['Date', 'Poste', 'Superviseur', 'Début', 'Fin', 'Opérateurs', 'Cycles', 'Tonnes', 'Statut', ''].map((h) => (
                  <th key={h} className="text-left py-2.5 px-3 text-xs text-mine-muted font-medium uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={10} className="text-center py-8 text-mine-muted">Chargement...</td></tr>
              ) : shifts.map((s) => (
                <tr key={s.shift_id} className="table-row">
                  <td className="py-2.5 px-3 font-mono text-xs text-mine-muted">
                    {format(parseISO(s.shift_date), 'dd/MM/yy')}
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="font-semibold" style={{ color: s.color }}>{s.shift_name}</span>
                  </td>
                  <td className="py-2.5 px-3 text-xs">{s.supervisor_name || '—'}</td>
                  <td className="py-2.5 px-3 font-mono text-xs">
                    {s.start_time ? format(parseISO(s.start_time), 'HH:mm') : '—'}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-xs text-mine-muted">
                    {s.end_time ? format(parseISO(s.end_time), 'HH:mm') : '—'}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-center">{s.operator_count || 0}</td>
                  <td className="py-2.5 px-3 font-mono text-center">{s.cycle_count || 0}</td>
                  <td className="py-2.5 px-3 font-mono font-bold text-mine-accent">
                    {Number(s.total_tonnes || 0).toLocaleString('fr')} t
                  </td>
                  <td className="py-2.5 px-3">{shiftStatusBadge(s.status)}</td>
                  <td className="py-2.5 px-3">
                    <button
                      onClick={() => setSelectedShift(s)}
                      className="text-xs text-mine-highlight hover:underline"
                    >Rapport</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedShift && (
        <ShiftReportModal shift={selectedShift} onClose={() => setSelectedShift(null)} />
      )}
    </div>
  );
}
