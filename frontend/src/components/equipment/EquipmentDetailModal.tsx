import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { equipmentApi, maintenanceApi, tyreApi } from '../../lib/api';
import type { Equipment, WorkOrder, TyreInstallation } from '../../types';
import { format, parseISO, formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

// ── Status Timeline Entry ───────────────────────────────────────
interface TimelineEntry {
  status: string;
  start_time: string;
  end_time?: string;
  duration_h?: number;
  reason?: string;
  color: string;
}

// ── KPI Ring ───────────────────────────────────────────────────
function KpiRing({ value, label, color, unit = '%' }: { value: number; label: string; color: string; unit?: string }) {
  const pct = Math.min(100, Math.max(0, value));
  const r = 24; const cx = 32; const cy = 32;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="64" height="64">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e2d45" strokeWidth="5" />
        <circle
          cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
        />
        <text x={cx} y={cy + 5} textAnchor="middle" fill="white" fontSize="12" fontWeight="bold" fontFamily="monospace">
          {pct.toFixed(0)}{unit === '%' ? '' : ''}
        </text>
      </svg>
      <div className="text-xs text-mine-muted text-center">{label}</div>
    </div>
  );
}

// ── Health Bar ──────────────────────────────────────────────────
function HealthBar({ score }: { score: number }) {
  const color = score >= 80 ? 'bg-green-500' : score >= 60 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-mine-border rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className={`text-xs font-mono font-bold w-8 text-right ${
        score >= 80 ? 'text-green-400' : score >= 60 ? 'text-yellow-400' : 'text-red-400'
      }`}>{score}</span>
    </div>
  );
}

// ── Main Modal ─────────────────────────────────────────────────
interface Props { equipment: Equipment; onClose: () => void; }

export default function EquipmentDetailModal({ equipment, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<'overview' | 'timeline' | 'maintenance' | 'tyres'>('overview');

  // KPI data
  const { data: kpi } = useQuery({
    queryKey: ['equipment-kpi', equipment.equipment_id],
    queryFn: async () => { const r = await equipmentApi.kpi(equipment.equipment_id, { days: '7' }); return r.data; },
  });

  // Status timeline
  const { data: timeline = [] } = useQuery<TimelineEntry[]>({
    queryKey: ['equipment-timeline', equipment.equipment_id],
    queryFn: async () => { const r = await equipmentApi.timeline(equipment.equipment_id, { limit: '30' }); return r.data; },
    enabled: activeTab === 'timeline',
  });

  // Work orders
  const { data: workOrders = [] } = useQuery<WorkOrder[]>({
    queryKey: ['equipment-work-orders', equipment.equipment_id],
    queryFn: async () => {
      const r = await maintenanceApi.listWorkOrders({ equipmentId: equipment.equipment_id, limit: '20' });
      return r.data;
    },
    enabled: activeTab === 'maintenance',
  });

  // Installed tyres
  const { data: tyres = [] } = useQuery<TyreInstallation[]>({
    queryKey: ['equipment-tyres', equipment.equipment_id],
    queryFn: async () => { const r = await tyreApi.byEquipment(equipment.equipment_id); return r.data; },
    enabled: activeTab === 'tyres',
  });

  const kpiData = kpi as {
    daily: Array<{ day: string; operating_h: number; idle_h: number; down_h: number; utilization_pct: number }>;
    totals: { total_hours: number; operating_h: number; cycles: number; tonnes: number;
               avg_cycle_min: number; utilization_pct: number; availability_pct: number; payload_factor_pct: number };
  } | undefined;

  const chartData = (kpiData?.daily || []).map((d) => ({
    day: format(parseISO(d.day), 'dd/MM'),
    'Opération': parseFloat(d.operating_h?.toString() || '0').toFixed(1),
    'Inactif': parseFloat(d.idle_h?.toString() || '0').toFixed(1),
    'Panne': parseFloat(d.down_h?.toString() || '0').toFixed(1),
  }));

  const totals = kpiData?.totals;

  const tabs = [
    { id: 'overview' as const, label: 'Aperçu' },
    { id: 'timeline' as const, label: 'Historique Statuts' },
    { id: 'maintenance' as const, label: 'OT Maintenance' },
    { id: 'tyres' as const, label: 'Pneus' },
  ];

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-mine-panel rounded-2xl w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col border border-mine-border shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-mine-border shrink-0">
          <div className="flex items-center gap-4">
            <div
              className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl font-bold"
              style={{ backgroundColor: `${equipment.status_color}20`, color: equipment.status_color }}
            >
              {equipment.category === 'TRUCK' ? '🚛' : equipment.category === 'EXCAVATOR' ? '⛏' : '🚜'}
            </div>
            <div>
              <div className="text-xl font-bold font-mono text-mine-accent">{equipment.fleet_number}</div>
              <div className="text-sm text-mine-muted">{equipment.type_name} — {equipment.manufacturer}</div>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className="text-xs px-2 py-0.5 rounded font-medium"
                  style={{ backgroundColor: `${equipment.status_color}30`, color: equipment.status_color }}
                >
                  {equipment.status}
                </span>
                {equipment.operator_name && (
                  <span className="text-xs text-mine-muted">👷 {equipment.operator_name}</span>
                )}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-mine-muted hover:text-white text-2xl">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-4 border-b border-mine-border shrink-0">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors border-b-2 -mb-px ${
                activeTab === t.id
                  ? 'border-mine-accent text-mine-accent'
                  : 'border-transparent text-mine-muted hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 p-6">

          {/* ── Overview ── */}
          {activeTab === 'overview' && (
            <div className="space-y-5">
              {/* Specs */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Heures moteur', value: `${equipment.current_hours.toLocaleString('fr')} h`, color: 'text-mine-accent' },
                  { label: 'Kilométrage', value: `${equipment.current_km.toLocaleString('fr')} km`, color: 'text-blue-400' },
                  { label: 'Capacité utile', value: `${equipment.payload_capacity} t`, color: 'text-green-400' },
                  { label: 'Score santé', value: `${equipment.health_score}/100`, color: equipment.health_score >= 80 ? 'text-green-400' : equipment.health_score >= 60 ? 'text-yellow-400' : 'text-red-400' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-mine-bg rounded-lg p-3">
                    <div className="text-xs text-mine-muted">{label}</div>
                    <div className={`text-lg font-bold font-mono ${color}`}>{value}</div>
                  </div>
                ))}
              </div>

              {/* Health bar */}
              <div className="bg-mine-bg rounded-lg p-4">
                <div className="text-xs text-mine-muted mb-2">Indice de santé global</div>
                <HealthBar score={equipment.health_score} />
              </div>

              {/* KPI rings (7 days) */}
              {totals && (
                <div className="bg-mine-bg rounded-xl p-4">
                  <div className="text-sm font-semibold mb-4">KPIs — 7 derniers jours</div>
                  <div className="flex justify-around flex-wrap gap-4">
                    <KpiRing value={totals.utilization_pct || 0} label="Utilisation" color="#f59e0b" />
                    <KpiRing value={totals.availability_pct || 0} label="Disponibilité" color="#22c55e" />
                    <KpiRing value={totals.payload_factor_pct || 0} label="Facteur charge" color="#3b82f6" />
                    <div className="flex flex-col items-center gap-1">
                      <div className="w-16 h-16 bg-mine-panel rounded-full flex items-center justify-center">
                        <div>
                          <div className="text-center font-mono font-bold text-mine-accent text-sm">{totals.cycles || 0}</div>
                          <div className="text-xs text-mine-muted text-center">cycles</div>
                        </div>
                      </div>
                      <div className="text-xs text-mine-muted text-center">Cycles</div>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <div className="w-16 h-16 bg-mine-panel rounded-full flex items-center justify-center">
                        <div>
                          <div className="text-center font-mono font-bold text-green-400 text-sm">
                            {Number(totals.tonnes || 0).toFixed(0)}t
                          </div>
                        </div>
                      </div>
                      <div className="text-xs text-mine-muted text-center">Tonnes</div>
                    </div>
                  </div>

                  {/* Chart */}
                  {chartData.length > 0 && (
                    <div className="mt-4">
                      <div className="text-xs text-mine-muted mb-2">Répartition des heures par jour</div>
                      <ResponsiveContainer width="100%" height={140}>
                        <AreaChart data={chartData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" />
                          <XAxis dataKey="day" stroke="#64748b" tick={{ fontSize: 10 }} />
                          <YAxis stroke="#64748b" tick={{ fontSize: 10 }} unit="h" />
                          <Tooltip
                            contentStyle={{ backgroundColor: '#111827', border: '1px solid #1e2d45', borderRadius: 8 }}
                            formatter={(v: unknown, name) => [`${v}h`, name]}
                          />
                          <Area type="monotone" dataKey="Opération" stroke="#3b82f6" fill="#3b82f620" strokeWidth={2} />
                          <Area type="monotone" dataKey="Inactif" stroke="#f59e0b" fill="#f59e0b20" strokeWidth={2} />
                          <Area type="monotone" dataKey="Panne" stroke="#ef4444" fill="#ef444420" strokeWidth={2} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              )}

              {/* Location */}
              {equipment.location_name && (
                <div className="bg-mine-bg rounded-lg p-3 flex items-center gap-3 text-sm">
                  <span className="text-mine-muted">📍 Position actuelle :</span>
                  <span className="font-semibold">{equipment.location_name}</span>
                  {equipment.latitude && (
                    <span className="text-mine-muted font-mono text-xs ml-auto">
                      {Number(equipment.latitude).toFixed(4)}, {Number(equipment.longitude).toFixed(4)}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Timeline ── */}
          {activeTab === 'timeline' && (
            <div className="space-y-2">
              {timeline.length === 0 ? (
                <div className="text-center py-12 text-mine-muted">Aucun historique de statut</div>
              ) : timeline.map((entry, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="flex flex-col items-center">
                    <div className="w-3 h-3 rounded-full mt-1.5" style={{ backgroundColor: entry.color || '#64748b' }} />
                    {i < timeline.length - 1 && <div className="w-0.5 h-full bg-mine-border mt-1 flex-1 min-h-[20px]" />}
                  </div>
                  <div className="bg-mine-bg rounded-lg p-3 flex-1 mb-1">
                    <div className="flex items-center justify-between">
                      <span
                        className="text-xs font-bold px-2 py-0.5 rounded"
                        style={{ backgroundColor: `${entry.color}30`, color: entry.color }}
                      >
                        {entry.status}
                      </span>
                      {entry.duration_h !== undefined && entry.duration_h > 0 && (
                        <span className="text-xs font-mono text-mine-muted">
                          {Number(entry.duration_h).toFixed(1)}h
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-mine-muted mt-1.5 font-mono">
                      {format(parseISO(entry.start_time), 'dd/MM/yy HH:mm', { locale: fr })}
                      {entry.end_time
                        ? ` → ${format(parseISO(entry.end_time), 'HH:mm')}`
                        : ' → En cours'}
                    </div>
                    {!entry.end_time && (
                      <div className="text-xs text-mine-accent mt-0.5">
                        Depuis {formatDistanceToNow(parseISO(entry.start_time), { locale: fr })}
                      </div>
                    )}
                    {entry.reason && <div className="text-xs text-mine-muted mt-1">Raison : {entry.reason}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Maintenance ── */}
          {activeTab === 'maintenance' && (
            <div className="space-y-2">
              {workOrders.length === 0 ? (
                <div className="text-center py-12 text-mine-muted">Aucun OT pour cet équipement</div>
              ) : workOrders.map((wo) => {
                const priorityColor: Record<string, string> = {
                  EMERGENCY: 'text-red-400', URGENT: 'text-orange-400',
                  HIGH: 'text-yellow-400', NORMAL: 'text-blue-400', LOW: 'text-mine-muted',
                };
                return (
                  <div key={wo.work_order_id} className="bg-mine-bg rounded-lg p-4 border border-mine-border">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="font-mono text-xs text-mine-muted">{wo.work_order_no}</div>
                        <div className="font-semibold mt-0.5">{wo.title}</div>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className={`font-bold ${priorityColor[wo.priority]}`}>{wo.priority}</span>
                        <span className="bg-mine-panel px-2 py-0.5 rounded">{wo.status}</span>
                      </div>
                    </div>
                    {wo.description && <div className="text-xs text-mine-muted mb-2">{wo.description}</div>}
                    <div className="flex items-center gap-4 text-xs text-mine-muted">
                      <span>Type: {wo.wo_type}</span>
                      {wo.estimated_hours && <span>Estimé: {wo.estimated_hours}h</span>}
                      {wo.actual_hours && <span>Réel: {wo.actual_hours}h</span>}
                      <span className="ml-auto">{format(parseISO(wo.opened_at), 'dd/MM/yy')}</span>
                    </div>
                    {wo.task_count > 0 && (
                      <div className="mt-2">
                        <div className="flex justify-between text-xs text-mine-muted mb-1">
                          <span>Tâches</span>
                          <span>{wo.tasks_done}/{wo.task_count}</span>
                        </div>
                        <div className="h-1.5 bg-mine-border rounded-full overflow-hidden">
                          <div
                            className="h-full bg-mine-accent rounded-full"
                            style={{ width: `${(wo.tasks_done / wo.task_count) * 100}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Tyres ── */}
          {activeTab === 'tyres' && (
            <div>
              {tyres.length === 0 ? (
                <div className="text-center py-12 text-mine-muted">Aucun pneu monté sur cet équipement</div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {tyres.map((t) => {
                    const h = t.hours_on_wheel_current || 0;
                    const pct = Math.min(100, (h / 12000) * 100);
                    const barColor = pct > 85 ? 'bg-red-500' : pct > 60 ? 'bg-yellow-500' : 'bg-green-500';
                    return (
                      <div key={t.installation_id} className="bg-mine-bg rounded-xl p-4 border border-mine-border">
                        <div className="flex justify-between items-center mb-2">
                          <div className="text-xs font-bold text-mine-accent">{t.position_code}</div>
                          <div className="text-xs text-mine-muted font-mono">{t.install_date ? format(parseISO(t.install_date), 'dd/MM/yy') : '—'}</div>
                        </div>
                        <div className="font-mono text-sm font-bold">{t.serial_number}</div>
                        <div className="text-xs text-mine-muted">{t.manufacturer} {t.model}</div>
                        <div className="text-xs text-mine-muted mt-0.5">{t.size}</div>
                        <div className="mt-3">
                          <div className="flex justify-between text-xs text-mine-muted mb-1">
                            <span>Heures sur roue</span>
                            <span className={pct > 85 ? 'text-red-400' : pct > 60 ? 'text-yellow-400' : 'text-green-400'}>
                              {h.toLocaleString('fr')} / 12 000h
                            </span>
                          </div>
                          <div className="h-2 bg-mine-border rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
