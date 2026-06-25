import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { roadsApi } from '../lib/api';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';

interface HaulRoad {
  road_id: string;
  road_name: string;
  distance_km: number;
  avg_gradient: number;
  speed_limit_kmh: number;
  road_class: string;
  start_location: string;
  end_location: string;
  active: boolean;
}

interface RoadCondition {
  condition_id: string;
  road_id: string;
  road_name: string;
  distance_km: number;
  road_class: string;
  start_location: string;
  end_location: string;
  condition_type: string;
  severity: string;
  description: string;
  speed_reduction_kmh: number;
  closed: boolean;
  recorded_at: string;
  valid_until?: string;
}

const CONDITION_TYPES = [
  'WET', 'MUDDY', 'DUSTY', 'POTHOLE', 'GRAVEL_LOOSE',
  'STEEP_GRADE', 'NARROW', 'CONSTRUCTION', 'WASHED_OUT', 'ICY',
];

const SEVERITY_CFG: Record<string, { cls: string; label: string }> = {
  LOW:      { cls: 'bg-yellow-900/40 text-yellow-300 border border-yellow-700', label: 'Faible' },
  MEDIUM:   { cls: 'bg-orange-900/40 text-orange-300 border border-orange-700', label: 'Modéré' },
  HIGH:     { cls: 'bg-red-900/40 text-red-300 border border-red-700', label: 'Élevé' },
  CRITICAL: { cls: 'bg-red-900/60 text-red-200 border border-red-500 font-bold', label: 'Critique' },
};

const CLASS_COLORS: Record<string, string> = {
  PRIMARY:   'border-l-mine-accent',
  SECONDARY: 'border-l-blue-500',
  SERVICE:   'border-l-gray-500',
};

function SeverityBadge({ s }: { s: string }) {
  const c = SEVERITY_CFG[s] || SEVERITY_CFG.LOW;
  return <span className={`text-xs px-2 py-0.5 rounded ${c.cls}`}>{c.label}</span>;
}

interface AddConditionModalProps {
  road: HaulRoad;
  onClose: () => void;
}
function AddConditionModal({ road, onClose }: AddConditionModalProps) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    conditionType: '', severity: 'LOW', description: '',
    speedReduction: '0', closedFlag: false,
    validHours: '4',
  });

  const mutation = useMutation({
    mutationFn: () => roadsApi.recordCondition({
      roadId: road.road_id,
      conditionType: form.conditionType,
      severity: form.severity,
      description: form.description || undefined,
      speedReduction: parseInt(form.speedReduction) || 0,
      closedFlag: form.closedFlag,
      validUntil: new Date(Date.now() + parseInt(form.validHours) * 3600000).toISOString(),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['roads'] }); onClose(); },
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-mine-panel rounded-xl w-full max-w-md border border-mine-border shadow-2xl">
        <div className="flex justify-between items-center p-5 border-b border-mine-border">
          <h2 className="font-bold">Signaler une condition</h2>
          <button onClick={onClose} className="text-mine-muted hover:text-white">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-mine-bg rounded-lg p-3 text-sm">
            <span className="text-mine-muted">Route :</span>
            <span className="ml-2 font-semibold">{road.road_name}</span>
            <span className="ml-2 text-mine-muted text-xs">{road.start_location} → {road.end_location}</span>
          </div>

          <div>
            <label className="text-xs text-mine-muted mb-1 block">Type de condition *</label>
            <select className="input w-full" value={form.conditionType} onChange={set('conditionType')}>
              <option value="">-- Choisir --</option>
              {CONDITION_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-mine-muted mb-1 block">Sévérité</label>
              <select className="input w-full" value={form.severity} onChange={set('severity')}>
                {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((s) => (
                  <option key={s} value={s}>{SEVERITY_CFG[s].label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-mine-muted mb-1 block">Réduction vitesse (km/h)</label>
              <input type="number" className="input w-full" value={form.speedReduction} onChange={set('speedReduction')} min="0" max="80" />
            </div>
          </div>

          <div>
            <label className="text-xs text-mine-muted mb-1 block">Description</label>
            <textarea
              className="input w-full h-16 resize-none"
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              placeholder="Détails de la condition..."
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <label className="text-xs text-mine-muted mb-1 block">Durée de validité (heures)</label>
              <select className="input" value={form.validHours} onChange={set('validHours')}>
                {['1', '2', '4', '8', '12', '24'].map((h) => <option key={h} value={h}>{h}h</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="closed"
                checked={form.closedFlag}
                onChange={(e) => setForm((p) => ({ ...p, closedFlag: e.target.checked }))}
                className="w-4 h-4"
              />
              <label htmlFor="closed" className="text-sm text-red-400 font-medium">Route FERMÉE</label>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 p-5 border-t border-mine-border">
          <button onClick={onClose} className="btn-secondary">Annuler</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!form.conditionType || mutation.isPending}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              form.closedFlag ? 'bg-red-700 hover:bg-red-600 text-white' : 'btn-primary'
            }`}
          >
            {mutation.isPending ? 'Signalement...' : form.closedFlag ? '🚫 Fermer la route' : 'Signaler'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Roads() {
  const qc = useQueryClient();
  const [addModal, setAddModal] = useState<HaulRoad | null>(null);

  const { data, isLoading } = useQuery<{ conditions: RoadCondition[]; roads: HaulRoad[] }>({
    queryKey: ['roads'],
    queryFn: async () => { const r = await roadsApi.list(); return r.data; },
    refetchInterval: 30_000,
  });

  const clearMutation = useMutation({
    mutationFn: (id: string) => roadsApi.clearCondition(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roads'] }),
  });

  const conditions = data?.conditions || [];
  const roads = data?.roads || [];

  // Map condition by road_id for quick lookup
  const condByRoad: Record<string, RoadCondition> = {};
  conditions.forEach((c) => { condByRoad[c.road_id] = c; });

  const closedCount = conditions.filter((c) => c.closed).length;
  const alertCount  = conditions.filter((c) => c.severity === 'HIGH' || c.severity === 'CRITICAL').length;

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Routes totales', value: roads.length, color: 'text-mine-accent' },
          { label: 'Actives', value: roads.filter((r) => r.active).length, color: 'text-green-400' },
          { label: 'Alertes conditions', value: alertCount, color: alertCount > 0 ? 'text-yellow-400' : 'text-mine-muted' },
          { label: 'Routes fermées', value: closedCount, color: closedCount > 0 ? 'text-red-400' : 'text-mine-muted' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card">
            <div className="card-header">{label}</div>
            <div className={`text-2xl font-bold font-mono ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* Active conditions banner */}
      {closedCount > 0 && (
        <div className="bg-red-900/30 border border-red-700 rounded-xl p-4">
          <div className="text-sm font-bold text-red-300 mb-2">🚫 {closedCount} route(s) fermée(s)</div>
          <div className="flex flex-wrap gap-2">
            {conditions.filter((c) => c.closed).map((c) => (
              <span key={c.condition_id} className="bg-red-900/50 border border-red-700 text-red-300 text-xs px-2.5 py-1 rounded-lg">
                {c.road_name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Roads grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {isLoading ? (
          <div className="col-span-2 text-center py-12 text-mine-muted">Chargement...</div>
        ) : roads.map((road) => {
          const cond = condByRoad[road.road_id];
          const isClosed = cond?.closed;
          const hasCondition = !!cond;

          return (
            <div
              key={road.road_id}
              className={`card border-l-4 ${CLASS_COLORS[road.road_class] || 'border-l-mine-border'} ${
                isClosed ? 'opacity-75 border-red-700' : ''
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{road.road_name}</span>
                    {isClosed && (
                      <span className="text-xs font-bold text-red-400 bg-red-900/40 border border-red-700 px-1.5 py-0.5 rounded">
                        FERMÉE
                      </span>
                    )}
                    <span className="text-xs text-mine-muted bg-mine-bg px-1.5 py-0.5 rounded">
                      {road.road_class}
                    </span>
                  </div>
                  <div className="text-xs text-mine-muted mt-0.5">
                    {road.start_location} → {road.end_location}
                  </div>
                </div>
                {!isClosed && (
                  <button
                    onClick={() => setAddModal(road)}
                    className="text-xs text-mine-highlight hover:underline shrink-0"
                  >
                    + Signaler
                  </button>
                )}
              </div>

              {/* Road specs */}
              <div className="flex gap-4 text-xs text-mine-muted mb-3">
                <span>📏 {road.distance_km} km</span>
                <span>📐 {road.avg_gradient > 0 ? '+' : ''}{road.avg_gradient}%</span>
                <span>🚦 {road.speed_limit_kmh} km/h</span>
              </div>

              {/* Current condition */}
              {hasCondition ? (
                <div className={`rounded-lg p-3 border ${
                  isClosed ? 'bg-red-900/20 border-red-700' :
                  cond.severity === 'HIGH' ? 'bg-orange-900/20 border-orange-700' :
                  'bg-yellow-900/20 border-yellow-700'
                }`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold">{cond.condition_type.replace('_', ' ')}</span>
                      <SeverityBadge s={cond.severity} />
                    </div>
                    <button
                      onClick={() => clearMutation.mutate(cond.condition_id)}
                      disabled={clearMutation.isPending}
                      className="text-xs text-mine-muted hover:text-green-400"
                    >
                      ✓ Lever
                    </button>
                  </div>
                  {cond.description && (
                    <div className="text-xs text-mine-muted mb-1">{cond.description}</div>
                  )}
                  <div className="flex items-center gap-4 text-xs text-mine-muted">
                    {cond.speed_reduction_kmh > 0 && (
                      <span>🐢 -{cond.speed_reduction_kmh} km/h</span>
                    )}
                    <span>
                      {format(parseISO(cond.recorded_at), 'HH:mm', { locale: fr })}
                    </span>
                    {cond.valid_until && (
                      <span>→ {format(parseISO(cond.valid_until), 'HH:mm')}</span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-green-400">
                  <span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>
                  Conditions normales
                </div>
              )}
            </div>
          );
        })}
      </div>

      {addModal && <AddConditionModal road={addModal} onClose={() => setAddModal(null)} />}
    </div>
  );
}
