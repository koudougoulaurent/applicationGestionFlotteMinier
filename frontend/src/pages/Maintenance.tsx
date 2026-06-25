import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { maintenanceApi } from '../lib/api';
import { WorkOrder, Breakdown } from '../types';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useRole } from '../hooks/useRole';

const PRIORITY_CONFIG: Record<string, { color: string; bg: string }> = {
  LOW:       { color: '#64748b', bg: '#64748b22' },
  NORMAL:    { color: '#3b82f6', bg: '#3b82f622' },
  HIGH:      { color: '#f59e0b', bg: '#f59e0b22' },
  URGENT:    { color: '#f97316', bg: '#f97316 22' },
  EMERGENCY: { color: '#ef4444', bg: '#ef444422' },
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  OPEN:        { label: 'Ouvert',      color: '#3b82f6' },
  SCHEDULED:   { label: 'Planifié',   color: '#8b5cf6' },
  IN_PROGRESS: { label: 'En cours',   color: '#f59e0b' },
  ON_HOLD:     { label: 'En attente', color: '#64748b' },
  COMPLETED:   { label: 'Terminé',    color: '#10b981' },
  CANCELLED:   { label: 'Annulé',     color: '#ef4444' },
};

export default function Maintenance() {
  const { isAdmin } = useRole();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'wo' | 'due' | 'health' | 'breakdowns'>('wo');
  const [showNewWO, setShowNewWO] = useState(false);
  const [newWO, setNewWO] = useState({
    equipmentId: '', woType: 'CORRECTIVE', priority: 'NORMAL',
    title: '', description: '', estimatedHours: '',
  });

  const { data: workOrders = [], isLoading: woLoading } = useQuery<WorkOrder[]>({
    queryKey: ['work-orders'],
    queryFn: async () => { const r = await maintenanceApi.listWorkOrders(); return r.data; },
    refetchInterval: 30_000,
  });

  const { data: due = [] } = useQuery({
    queryKey: ['maintenance-due'],
    queryFn: async () => { const r = await maintenanceApi.due(); return r.data; },
  });

  const { data: health = [] } = useQuery({
    queryKey: ['maintenance-health'],
    queryFn: async () => { const r = await maintenanceApi.health(); return r.data; },
  });

  const { data: breakdowns = [] } = useQuery<Breakdown[]>({
    queryKey: ['breakdowns'],
    queryFn: async () => { const r = await maintenanceApi.breakdowns(); return r.data; },
    refetchInterval: 30_000,
  });

  const createWOMutation = useMutation({
    mutationFn: (body: object) => maintenanceApi.createWorkOrder(body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['work-orders'] }); setShowNewWO(false); },
  });

  const createPMMutation = useMutation({
    mutationFn: (body: object) => maintenanceApi.createWorkOrder(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['work-orders'] });
      qc.invalidateQueries({ queryKey: ['maintenance-due'] });
    },
  });

  const closeWOMutation = useMutation({
    mutationFn: (id: string) => maintenanceApi.closeWorkOrder(id, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work-orders'] }),
  });

  const openWOs = workOrders.filter((w) => !['COMPLETED','CANCELLED'].includes(w.status));
  const emergencies = workOrders.filter((w) => w.priority === 'EMERGENCY' && !['COMPLETED','CANCELLED'].includes(w.status));

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card text-center">
          <div className="text-2xl font-bold font-mono text-blue-400">{openWOs.length}</div>
          <div className="text-xs text-mine-muted">OT Ouverts</div>
        </div>
        <div className="card text-center">
          <div className={`text-2xl font-bold font-mono ${emergencies.length > 0 ? 'text-red-400 alarm-critical' : 'text-green-400'}`}>
            {emergencies.length}
          </div>
          <div className="text-xs text-mine-muted">Urgences</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-bold font-mono text-yellow-400">
            {(due as Array<{ urgency: string }>).filter((d) => d.urgency !== 'OK').length}
          </div>
          <div className="text-xs text-mine-muted">PM à planifier</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-bold font-mono text-orange-400">{breakdowns.length}</div>
          <div className="text-xs text-mine-muted">Pannes Récentes</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-mine-panel rounded-lg p-1 w-fit">
        {([
          ['wo', '📋 Ordres de Travail'],
          ['due', '⏰ PM à faire'],
          ['health', '❤️ Santé Flotte'],
          ['breakdowns', '🔴 Pannes'],
        ] as const).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors
              ${tab === t ? 'bg-mine-accent text-black' : 'text-mine-muted hover:text-mine-text'}`}
          >
            {label}
          </button>
        ))}
        {isAdmin && <button onClick={() => setShowNewWO(true)} className="ml-4 btn-primary text-xs px-3 py-1.5">
          + Nouvel OT
        </button>}
      </div>

      {/* Work Orders */}
      {tab === 'wo' && (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-mine-border">
                  {['N° OT', 'Équipement', 'Type', 'Priorité', 'Titre', 'Statut', 'Ouvert le', 'Tâches', ''].map((h) => (
                    <th key={h} className="text-left py-2.5 px-3 text-xs text-mine-muted font-medium uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {woLoading ? (
                  <tr><td colSpan={9} className="text-center py-6 text-mine-muted">Chargement...</td></tr>
                ) : workOrders.map((wo) => {
                  const pCfg = PRIORITY_CONFIG[wo.priority] || PRIORITY_CONFIG.NORMAL;
                  const sCfg = STATUS_CONFIG[wo.status] || STATUS_CONFIG.OPEN;
                  return (
                    <tr key={wo.work_order_id} className="table-row">
                      <td className="py-2.5 px-3 font-mono text-mine-accent text-xs">{wo.work_order_no}</td>
                      <td className="py-2.5 px-3 text-xs">
                        <div className="font-semibold">{wo.fleet_number}</div>
                        <div className="text-mine-muted">{wo.category}</div>
                      </td>
                      <td className="py-2.5 px-3 text-xs text-mine-muted">{wo.wo_type}</td>
                      <td className="py-2.5 px-3">
                        <span className="badge text-xs font-bold"
                          style={{ color: pCfg.color, backgroundColor: pCfg.bg }}>
                          {wo.priority}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-xs max-w-[200px] truncate">{wo.title}</td>
                      <td className="py-2.5 px-3">
                        <span className="text-xs font-semibold" style={{ color: sCfg.color }}>
                          {sCfg.label}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-xs text-mine-muted">
                        {format(parseISO(wo.opened_at), 'dd/MM HH:mm', { locale: fr })}
                      </td>
                      <td className="py-2.5 px-3 text-xs font-mono">
                        {wo.tasks_done}/{wo.task_count}
                      </td>
                      <td className="py-2.5 px-3">
                        {!['COMPLETED','CANCELLED'].includes(wo.status) && (
                          <button
                            onClick={() => closeWOMutation.mutate(wo.work_order_id)}
                            className="text-xs text-green-400 hover:underline"
                          >
                            Clore
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PM Due */}
      {tab === 'due' && (
        <div className="card">
          <div className="card-header">Maintenance Préventive à Planifier</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-mine-border">
                  {['Équipement', 'Modèle', 'Heures Actuelles', 'Type PM', 'Échéance (h)', 'Écart', 'Urgence', ''].map((h) => (
                    <th key={h} className="text-left py-2.5 px-3 text-xs text-mine-muted font-medium uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(due as Array<{
                  equipment_id: string; fleet_number: string; model: string; current_hours: number;
                  maintenance_type: string; description: string; next_due_hours: number; hours_remaining: number; urgency: string;
                }>).map((d, i) => (
                  <tr key={i} className="table-row">
                    <td className="py-2.5 px-3 font-mono font-bold text-mine-accent text-sm">{d.fleet_number}</td>
                    <td className="py-2.5 px-3 text-xs text-mine-muted">{d.model}</td>
                    <td className="py-2.5 px-3 font-mono text-xs">{Number(d.current_hours)?.toLocaleString('fr')} h</td>
                    <td className="py-2.5 px-3 text-xs">{d.maintenance_type}</td>
                    <td className="py-2.5 px-3 font-mono text-xs">{Number(d.next_due_hours)?.toLocaleString('fr')} h</td>
                    <td className="py-2.5 px-3 font-mono text-xs">
                      <span className={Number(d.hours_remaining) < 0 ? 'text-red-400' : Number(d.hours_remaining) < 50 ? 'text-yellow-400' : 'text-green-400'}>
                        {Number(d.hours_remaining) < 0 ? `−${Math.abs(Number(d.hours_remaining))} h` : `+${Number(d.hours_remaining)} h`}
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={`badge text-xs font-bold ${
                        d.urgency === 'OVERDUE' ? 'bg-red-900/50 text-red-400' :
                        d.urgency === 'DUE_SOON' ? 'bg-yellow-900/50 text-yellow-400' :
                        'bg-green-900/50 text-green-400'
                      }`}>
                        {d.urgency === 'OVERDUE' ? 'DÉPASSÉ' : d.urgency === 'DUE_SOON' ? 'BIENTÔT' : 'OK'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      {d.urgency !== 'OK' && isAdmin && (
                        <button
                          disabled={createPMMutation.isPending}
                          onClick={() => {
                            if (!confirm(`Créer un OT PM "${d.maintenance_type}" pour ${d.fleet_number} ?`)) return;
                            createPMMutation.mutate({
                              equipmentId: d.equipment_id,
                              woType: 'PREVENTIVE',
                              priority: d.urgency === 'OVERDUE' ? 'URGENT' : 'HIGH',
                              title: `${d.maintenance_type} — ${d.fleet_number}`,
                              description: d.description || `Maintenance préventive ${d.maintenance_type} — dû à ${Number(d.next_due_hours).toLocaleString('fr')}h (actuel: ${Number(d.current_hours).toLocaleString('fr')}h)`,
                            });
                          }}
                          className="text-xs text-amber-400 hover:underline whitespace-nowrap"
                        >
                          Créer OT
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Health */}
      {tab === 'health' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {(health as Array<{
            equipment_id: string; fleet_number: string; model: string;
            category: string; current_hours: number; health_score: number;
            open_wos: number; active_breakdowns: number;
          }>).map((eq) => (
            <div key={eq.equipment_id} className="card">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className="font-mono font-bold text-mine-accent">{eq.fleet_number}</div>
                  <div className="text-xs text-mine-muted">{eq.model} · {eq.category}</div>
                </div>
                <div className={`text-2xl font-bold font-mono ${
                  eq.health_score >= 80 ? 'text-green-400' : eq.health_score >= 60 ? 'text-yellow-400' : 'text-red-400'
                }`}>
                  {eq.health_score}
                </div>
              </div>
              <div className="h-1.5 bg-mine-border rounded-full overflow-hidden mb-3">
                <div
                  className={`h-full rounded-full ${eq.health_score >= 80 ? 'bg-green-500' : eq.health_score >= 60 ? 'bg-yellow-500' : 'bg-red-500'}`}
                  style={{ width: `${eq.health_score}%` }}
                />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="text-mine-muted">Heures: <span className="text-mine-text font-mono">{eq.current_hours?.toLocaleString('fr')}</span></div>
                <div className="text-mine-muted">OT ouverts: <span className={eq.open_wos > 0 ? 'text-yellow-400' : 'text-mine-text'}>{eq.open_wos}</span></div>
                {eq.active_breakdowns > 0 && (
                  <div className="text-red-400 col-span-2">⚠ {eq.active_breakdowns} panne active</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Breakdowns */}
      {tab === 'breakdowns' && (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-mine-border">
                  {['Équipement', 'Système', 'Composant', 'Sévérité', 'Description', 'Détecté le', 'Durée Arrêt', 'Statut'].map((h) => (
                    <th key={h} className="text-left py-2.5 px-3 text-xs text-mine-muted font-medium uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {breakdowns.map((b) => (
                  <tr key={b.breakdown_id} className="table-row">
                    <td className="py-2.5 px-3 font-mono font-bold text-mine-accent text-sm">{b.fleet_number}</td>
                    <td className="py-2.5 px-3 text-xs">{b.system || '—'}</td>
                    <td className="py-2.5 px-3 text-xs">{b.component || '—'}</td>
                    <td className="py-2.5 px-3">
                      <span className={`badge text-xs font-bold ${
                        b.severity === 'CRITICAL' ? 'bg-red-900/50 text-red-400' :
                        b.severity === 'HIGH'     ? 'bg-orange-900/50 text-orange-400' :
                        'bg-yellow-900/50 text-yellow-400'
                      }`}>
                        {b.severity}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-xs text-mine-muted max-w-[200px] truncate">{b.description}</td>
                    <td className="py-2.5 px-3 text-xs font-mono text-mine-muted">
                      {format(parseISO(b.detected_time), 'dd/MM HH:mm')}
                    </td>
                    <td className="py-2.5 px-3 text-xs font-mono">
                      {b.downtime_hours ? `${b.downtime_hours}h` : '—'}
                    </td>
                    <td className="py-2.5 px-3">
                      {b.repaired_time ? (
                        <span className="text-xs text-green-400">Réparé</span>
                      ) : (
                        <span className="text-xs text-red-400 alarm-critical">En cours</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* New WO Modal */}
      {showNewWO && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-lg border-mine-border/80">
            <h3 className="text-base font-semibold mb-4">Nouvel Ordre de Travail</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-mine-muted mb-1">ID Équipement</label>
                <input value={newWO.equipmentId} onChange={(e) => setNewWO({ ...newWO, equipmentId: e.target.value })}
                  placeholder="UUID équipement"
                  className="w-full bg-mine-bg border border-mine-border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-mine-muted mb-1">Type</label>
                  <select value={newWO.woType} onChange={(e) => setNewWO({ ...newWO, woType: e.target.value })}
                    className="w-full bg-mine-bg border border-mine-border rounded-lg px-3 py-2 text-sm">
                    {['PREVENTIVE','CORRECTIVE','BREAKDOWN','PREDICTIVE','INSPECTION'].map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-mine-muted mb-1">Priorité</label>
                  <select value={newWO.priority} onChange={(e) => setNewWO({ ...newWO, priority: e.target.value })}
                    className="w-full bg-mine-bg border border-mine-border rounded-lg px-3 py-2 text-sm">
                    {['LOW','NORMAL','HIGH','URGENT','EMERGENCY'].map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-mine-muted mb-1">Titre</label>
                <input value={newWO.title} onChange={(e) => setNewWO({ ...newWO, title: e.target.value })}
                  placeholder="Description courte"
                  className="w-full bg-mine-bg border border-mine-border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-mine-muted mb-1">Description</label>
                <textarea value={newWO.description} onChange={(e) => setNewWO({ ...newWO, description: e.target.value })}
                  rows={3} placeholder="Détails..."
                  className="w-full bg-mine-bg border border-mine-border rounded-lg px-3 py-2 text-sm resize-none" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => createWOMutation.mutate(newWO)} disabled={createWOMutation.isPending}
                className="btn-primary flex-1">
                Créer
              </button>
              <button onClick={() => setShowNewWO(false)} className="btn-secondary flex-1">Annuler</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
