import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dispatchApi, cyclesApi, equipmentApi, gpsApi, materialsApi } from '../lib/api';
import type { DispatchAssignment, HaulCycle, Equipment } from '../types';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useRole } from '../hooks/useRole';
import { useLiveStore } from '../store';

const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  PENDING:      { label: 'En attente',   color: '#f59e0b', bg: '#f59e0b22' },
  ACKNOWLEDGED: { label: 'Accusé',       color: '#3b82f6', bg: '#3b82f622' },
  IN_PROGRESS:  { label: 'En cours',     color: '#10b981', bg: '#10b98122' },
  COMPLETED:    { label: 'Terminé',      color: '#64748b', bg: '#64748b22' },
  CANCELLED:    { label: 'Annulé',       color: '#ef4444', bg: '#ef444422' },
};

const PHASE_LABELS: Record<string, { label: string; color: string }> = {
  QUEUE_AT_SHOVEL: { label: 'File pelle',   color: '#f59e0b' },
  LOADING:         { label: 'Chargement',   color: '#3b82f6' },
  HAULING:         { label: 'Transport',    color: '#22c55e' },
  QUEUE_AT_DUMP:   { label: 'File dump',    color: '#f97316' },
  DUMPING:         { label: 'Déchargement', color: '#a855f7' },
  RETURNING:       { label: 'Retour',       color: '#64748b' },
};

function fmt(seconds?: number | string | null) {
  if (!seconds) return '—';
  const s = Number(seconds);
  if (!s) return '—';
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function pfColor(pf: number | null) {
  if (pf === null) return '';
  if (pf >= 95) return 'text-green-400';
  if (pf >= 85) return 'text-yellow-400';
  return 'text-red-400';
}

// ── Queue zone card ─────────────────────────────────────────────────
interface QueueZone {
  location_id: string;
  location_name: string;
  queue_type: 'QUEUE_AT_SHOVEL' | 'QUEUE_AT_DUMP';
  truck_count: number;
  avg_wait_min: number;
}
function QueuePanel({ zones }: { zones: QueueZone[] }) {
  if (zones.length === 0) return null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
      {zones.map((z) => {
        const isShovel = z.queue_type === 'QUEUE_AT_SHOVEL';
        const color = isShovel ? '#3b82f6' : '#f97316';
        const critical = z.truck_count >= 3 || Number(z.avg_wait_min) > 15;
        return (
          <div
            key={z.location_id + z.queue_type}
            className="rounded-lg border px-3 py-2"
            style={{ borderColor: critical ? '#ef444450' : '#1a2740', backgroundColor: critical ? '#ef444408' : '#111827' }}
          >
            <div className="text-[10px] uppercase tracking-wider font-semibold mb-0.5" style={{ color }}>
              {isShovel ? 'Pelle' : 'Dump'} · {z.location_name}
            </div>
            <div className="flex items-end gap-2">
              <div className="text-[22px] font-bold font-mono leading-none" style={{ color: critical ? '#ef4444' : 'white' }}>
                {z.truck_count}
              </div>
              <div className="text-[10px] text-slate-500 mb-0.5">camion{z.truck_count > 1 ? 's' : ''}</div>
            </div>
            {Number(z.avg_wait_min) > 0 && (
              <div className="text-[10px] text-slate-500 mt-0.5">
                Attente moy.: {Number(z.avg_wait_min).toFixed(0)} min
                {critical && <span className="text-red-400 ml-1">⚠</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Dispatch form ───────────────────────────────────────────────────
interface FormState {
  truckId: string; loaderId: string; sourceLocationId: string;
  destLocationId: string; materialId: string; priority: string;
}

function DispatchForm({
  onClose, onCreate,
}: {
  onClose: () => void;
  onCreate: (body: object) => void;
}) {
  const [form, setForm] = useState<FormState>({
    truckId: '', loaderId: '', sourceLocationId: '',
    destLocationId: '', materialId: '', priority: '1',
  });

  const { data: equipment = [] } = useQuery<Equipment[]>({
    queryKey: ['equipment-all'],
    queryFn: async () => (await equipmentApi.list()).data,
  });

  const { data: locations = [] } = useQuery<{ location_id: string; name: string; location_type: string }[]>({
    queryKey: ['locations'],
    queryFn: async () => (await gpsApi.locations()).data,
  });

  const { data: materials = [] } = useQuery<{ material_id: string; name: string; category: string; color: string }[]>({
    queryKey: ['materials'],
    queryFn: async () => (await materialsApi.list()).data,
  });

  const trucks    = equipment.filter((e) => (e as any).category === 'TRUCK' && !['DOWN','MAINTENANCE'].includes(e.status));
  const loaders   = equipment.filter((e) => ['EXCAVATOR','LOADER'].includes((e as any).category) && !['DOWN','MAINTENANCE'].includes(e.status));
  const pitLocs   = locations.filter((l) => ['PIT','BLAST_ZONE'].includes(l.location_type));
  const dumpLocs  = locations.filter((l) => ['DUMP','STOCKPILE','CRUSHER'].includes(l.location_type));

  const f = (key: keyof FormState, value: string) => setForm((s) => ({ ...s, [key]: value }));

  const valid = form.truckId && form.sourceLocationId && form.destLocationId;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[#111827] border border-[#1a2740] rounded-xl w-full max-w-lg p-5">
        <h3 className="text-[15px] font-semibold mb-4 text-slate-100">Nouvelle Mission de Dispatch</h3>
        <div className="space-y-3">

          {/* Truck */}
          <div>
            <label className="block text-[11px] text-slate-500 mb-1 uppercase tracking-wide">Camion *</label>
            <select value={form.truckId} onChange={(e) => f('truckId', e.target.value)}
              className="w-full bg-[#0d1520] border border-[#1a2740] rounded-lg px-3 py-2 text-sm text-slate-200">
              <option value="">— Sélectionner —</option>
              {trucks.map((t) => (
                <option key={t.equipment_id} value={t.equipment_id}>
                  {t.fleet_number} · {t.model} · {t.status}
                </option>
              ))}
            </select>
          </div>

          {/* Loader */}
          <div>
            <label className="block text-[11px] text-slate-500 mb-1 uppercase tracking-wide">Pelle / Chargeur</label>
            <select value={form.loaderId} onChange={(e) => f('loaderId', e.target.value)}
              className="w-full bg-[#0d1520] border border-[#1a2740] rounded-lg px-3 py-2 text-sm text-slate-200">
              <option value="">— Optionnel —</option>
              {loaders.map((l) => (
                <option key={l.equipment_id} value={l.equipment_id}>
                  {l.fleet_number} · {l.model}
                </option>
              ))}
            </select>
          </div>

          {/* Source + Dest */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-slate-500 mb-1 uppercase tracking-wide">Zone source *</label>
              <select value={form.sourceLocationId} onChange={(e) => f('sourceLocationId', e.target.value)}
                className="w-full bg-[#0d1520] border border-[#1a2740] rounded-lg px-3 py-2 text-sm text-slate-200">
                <option value="">— Source —</option>
                {pitLocs.map((l) => (
                  <option key={l.location_id} value={l.location_id}>{l.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1 uppercase tracking-wide">Destination *</label>
              <select value={form.destLocationId} onChange={(e) => f('destLocationId', e.target.value)}
                className="w-full bg-[#0d1520] border border-[#1a2740] rounded-lg px-3 py-2 text-sm text-slate-200">
                <option value="">— Destination —</option>
                {dumpLocs.map((l) => (
                  <option key={l.location_id} value={l.location_id}>{l.name} ({l.location_type})</option>
                ))}
              </select>
            </div>
          </div>

          {/* Material + Priority */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-slate-500 mb-1 uppercase tracking-wide">Matériau</label>
              <select value={form.materialId} onChange={(e) => f('materialId', e.target.value)}
                className="w-full bg-[#0d1520] border border-[#1a2740] rounded-lg px-3 py-2 text-sm text-slate-200">
                <option value="">— Non spécifié —</option>
                {materials.map((m) => (
                  <option key={m.material_id} value={m.material_id}>{m.name} ({m.category})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1 uppercase tracking-wide">Priorité</label>
              <select value={form.priority} onChange={(e) => f('priority', e.target.value)}
                className="w-full bg-[#0d1520] border border-[#1a2740] rounded-lg px-3 py-2 text-sm text-slate-200">
                {[['1','Normale'],['2','Haute'],['3','Urgente']].map(([v,l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="flex gap-3 mt-5">
          <button
            onClick={() => valid && onCreate({
              truckId: form.truckId,
              loaderId: form.loaderId || undefined,
              sourceLocationId: form.sourceLocationId,
              destLocationId: form.destLocationId,
              materialId: form.materialId || undefined,
              priority: parseInt(form.priority),
            })}
            disabled={!valid}
            className="flex-1 py-2 rounded-lg font-semibold text-sm transition-all"
            style={{ backgroundColor: valid ? '#f59e0b' : '#1a2740', color: valid ? '#000' : '#475569' }}
          >
            Créer
          </button>
          <button onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-[#1a2740] text-slate-400 text-sm hover:text-slate-200 transition-colors">
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main ────────────────────────────────────────────────────────────
export default function Dispatch() {
  const { isDispatcher } = useRole();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'dispatch' | 'cycles'>('dispatch');
  const [showForm, setShowForm] = useState(false);

  // Live queue from Socket.io store
  const dispatchEvents = useLiveStore((s) => s.dispatchEvents);

  const { data: dispatches = [], isLoading: dLoading } = useQuery<DispatchAssignment[]>({
    queryKey: ['dispatch'],
    queryFn: async () => (await dispatchApi.list()).data,
    refetchInterval: 10_000,
  });

  const { data: cycles = [], isLoading: cLoading } = useQuery<HaulCycle[]>({
    queryKey: ['cycles'],
    queryFn: async () => (await cyclesApi.list({ limit: '50' })).data,
    refetchInterval: 15_000,
  });

  const { data: suggestions } = useQuery({
    queryKey: ['dispatch-suggest'],
    queryFn: async () => (await dispatchApi.suggest()).data,
    refetchInterval: 30_000,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => dispatchApi.update(id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dispatch'] }),
  });

  const createMutation = useMutation({
    mutationFn: (body: object) => dispatchApi.create(body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dispatch'] }); setShowForm(false); },
  });

  const active    = dispatches.filter((d) => ['PENDING','ACKNOWLEDGED','IN_PROGRESS'].includes(d.status));
  const completed = dispatches.filter((d) => d.status === 'COMPLETED');

  // Derive queue from active dispatches (client-side approximation)
  const queueMap: Record<string, QueueZone> = {};
  for (const d of active) {
    if (['PENDING','ACKNOWLEDGED'].includes(d.status) && d.source_location_id) {
      const k = d.source_location_id + '_SHOVEL';
      if (!queueMap[k]) queueMap[k] = { location_id: d.source_location_id, location_name: d.source_name || '?', queue_type: 'QUEUE_AT_SHOVEL', truck_count: 0, avg_wait_min: 0 };
      queueMap[k].truck_count++;
    }
    if (d.status === 'IN_PROGRESS' && d.dest_location_id) {
      const k = d.dest_location_id + '_DUMP';
      if (!queueMap[k]) queueMap[k] = { location_id: d.dest_location_id, location_name: d.dest_name || '?', queue_type: 'QUEUE_AT_DUMP', truck_count: 0, avg_wait_min: 0 };
      queueMap[k].truck_count++;
    }
  }
  const queueZones = Object.values(queueMap).filter((z) => z.truck_count > 0);

  return (
    <div className="space-y-4">

      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-[#111827] border border-[#1a2740] rounded-lg p-4 text-center">
          <div className="text-[26px] font-bold font-mono text-blue-400">{active.length}</div>
          <div className="text-[11px] text-slate-500 uppercase tracking-wide mt-0.5">Missions actives</div>
        </div>
        <div className="bg-[#111827] border border-[#1a2740] rounded-lg p-4 text-center">
          <div className="text-[26px] font-bold font-mono text-green-400">{completed.length}</div>
          <div className="text-[11px] text-slate-500 uppercase tracking-wide mt-0.5">Complétées</div>
        </div>
        <div className="bg-[#111827] border border-[#1a2740] rounded-lg p-4 text-center">
          <div className="text-[26px] font-bold font-mono text-amber-400">{cycles.filter((c) => !c.cycle_end).length}</div>
          <div className="text-[11px] text-slate-500 uppercase tracking-wide mt-0.5">Cycles en cours</div>
        </div>
        <div className="bg-[#111827] border border-[#1a2740] rounded-lg p-4 text-center">
          <div className="text-[26px] font-bold font-mono text-purple-400">
            {(suggestions as any)?.availableTrucks ?? '—'}
          </div>
          <div className="text-[11px] text-slate-500 uppercase tracking-wide mt-0.5">Camions disponibles</div>
        </div>
      </div>

      {/* Queue panel */}
      {queueZones.length > 0 && (
        <div className="bg-[#111827] border border-[#1a2740] rounded-lg p-3">
          <div className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mb-2.5">
            Files d'attente en temps réel
          </div>
          <QueuePanel zones={queueZones} />
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-[#111827] border border-[#1a2740] rounded-lg p-1 w-fit">
        {(['dispatch', 'cycles'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-[13px] font-medium transition-colors
              ${tab === t ? 'bg-amber-500 text-black' : 'text-slate-400 hover:text-slate-200'}`}>
            {t === 'dispatch' ? 'Dispatch' : 'Cycles'}
          </button>
        ))}
        {isDispatcher && (
          <button onClick={() => setShowForm(true)}
            className="ml-3 px-3 py-1.5 rounded-lg bg-amber-500 text-black text-[12px] font-bold hover:bg-amber-400 transition-colors">
            + Mission
          </button>
        )}
      </div>

      {/* ── Dispatch tab ─────────────────────────────────────────── */}
      {tab === 'dispatch' && (
        <div className="space-y-4">

          {/* Suggestions */}
          {(suggestions as any)?.suggestions?.length > 0 && (
            <div className="bg-[#111827] border border-amber-500/20 rounded-lg p-4">
              <div className="text-[10px] text-amber-400 uppercase tracking-widest font-semibold mb-3">
                Suggestions optimisées
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {(suggestions as any).suggestions.slice(0, 3).map((s: any, i: number) => (
                  <div key={i} className="bg-[#0d1520] rounded-lg p-3 space-y-1.5 border border-[#1a2740]">
                    <div className="flex justify-between items-center">
                      <span className="font-mono font-bold text-amber-400 text-[13px]">{s.truckNumber}</span>
                      <span className="text-slate-500 text-[11px]">→ {s.loaderNumber}</span>
                    </div>
                    <div className="text-[11px] text-slate-400">{s.sourceName} → {s.destName}</div>
                    <div className="text-[11px] text-slate-500">Attente estimée: {Math.round(s.estimatedQueueMin || 0)} min</div>
                    {isDispatcher && (
                      <button
                        onClick={() => createMutation.mutate({
                          truckId: s.truckId, loaderId: s.loaderId,
                          sourceLocationId: s.sourceLocationId, destLocationId: s.destLocationId,
                        })}
                        className="w-full py-1 rounded-md bg-amber-500 text-black text-[11px] font-bold hover:bg-amber-400 transition-colors">
                        Assigner
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Missions table */}
          <div className="bg-[#111827] border border-[#1a2740] rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-[#1a2740]">
              <span className="text-[12px] text-slate-400 uppercase tracking-widest font-semibold">
                Missions en cours ({active.length})
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#1a2740]">
                    {['Camion','Chargeur','Source','Destination','Matériau','Assigné','Statut',''].map((h) => (
                      <th key={h} className="text-left py-2.5 px-3 text-[10px] text-slate-500 font-medium uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dLoading ? (
                    <tr><td colSpan={8} className="text-center py-8 text-slate-600 text-[13px]">Chargement...</td></tr>
                  ) : active.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-8 text-slate-600 text-[13px]">Aucune mission active</td></tr>
                  ) : active.map((d) => {
                    const cfg = STATUS_CFG[d.status] || STATUS_CFG.PENDING;
                    return (
                      <tr key={d.assignment_id} className="border-b border-[#1a2740]/50 hover:bg-[#0d1520] transition-colors">
                        <td className="py-2.5 px-3 font-mono font-bold text-amber-400 text-[13px]">{d.truck_number}</td>
                        <td className="py-2.5 px-3 text-[12px] text-slate-400">{(d as any).loader_number || '—'}</td>
                        <td className="py-2.5 px-3 text-[12px]">
                          <div className="text-slate-200">{(d as any).source_name}</div>
                          <div className="text-slate-600 text-[10px]">{(d as any).source_type}</div>
                        </td>
                        <td className="py-2.5 px-3 text-[12px]">
                          <div className="text-slate-200">{(d as any).dest_name}</div>
                          <div className="text-slate-600 text-[10px]">{(d as any).dest_type}</div>
                        </td>
                        <td className="py-2.5 px-3">
                          {(d as any).material_name ? (
                            <span className="flex items-center gap-1.5 text-[11px]">
                              <span className="w-2 h-2 rounded-full flex-shrink-0"
                                style={{ backgroundColor: (d as any).material_color || '#888' }} />
                              {(d as any).material_name}
                            </span>
                          ) : <span className="text-slate-600">—</span>}
                        </td>
                        <td className="py-2.5 px-3 text-[11px] font-mono text-slate-500">
                          {format(parseISO(d.assigned_time), 'HH:mm', { locale: fr })}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold"
                            style={{ color: cfg.color, backgroundColor: cfg.bg }}>
                            {cfg.label}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          {d.status !== 'COMPLETED' && isDispatcher && (
                            <div className="flex gap-2">
                              {d.status === 'PENDING' && (
                                <button onClick={() => updateMutation.mutate({ id: d.assignment_id, status: 'IN_PROGRESS' })}
                                  className="text-[11px] text-blue-400 hover:underline">Démarrer</button>
                              )}
                              <button onClick={() => updateMutation.mutate({ id: d.assignment_id, status: 'COMPLETED' })}
                                className="text-[11px] text-green-400 hover:underline">Terminer</button>
                            </div>
                          )}
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

      {/* ── Cycles tab ───────────────────────────────────────────── */}
      {tab === 'cycles' && (
        <div className="bg-[#111827] border border-[#1a2740] rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-[#1a2740]">
            <span className="text-[12px] text-slate-400 uppercase tracking-widest font-semibold">
              Cycles récents — phases détaillées
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1a2740]">
                  {['Camion','Route','Opérateur','Début','File','Charg.','Transport','Dump','Retour','Total','Payload','Facteur'].map((h) => (
                    <th key={h} className="text-left py-2.5 px-2 text-[10px] text-slate-500 font-medium uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cLoading ? (
                  <tr><td colSpan={12} className="text-center py-8 text-slate-600">Chargement...</td></tr>
                ) : cycles.map((c) => {
                  const pf = c.payload_factor ? Number(c.payload_factor) * 100 : null;
                  const inProgress = !c.cycle_end;
                  return (
                    <tr key={c.cycle_id}
                      className={`border-b border-[#1a2740]/50 transition-colors ${inProgress ? 'bg-blue-950/10' : 'hover:bg-[#0d1520]'}`}>
                      <td className="py-2 px-2">
                        <div className="font-mono font-bold text-amber-400 text-[12px]">{c.truck_number}</div>
                        {inProgress && <div className="text-[9px] text-blue-400 animate-pulse">EN COURS</div>}
                      </td>
                      <td className="py-2 px-2 text-[11px]">
                        <div className="text-slate-200">{c.source_name}</div>
                        <div className="text-slate-600">→ {c.dest_name}</div>
                      </td>
                      <td className="py-2 px-2 text-[11px] text-slate-500">{c.operator_name || '—'}</td>
                      <td className="py-2 px-2 text-[11px] font-mono text-slate-500">
                        {format(parseISO(c.cycle_start), 'HH:mm')}
                      </td>
                      {/* Phases */}
                      <td className="py-2 px-2 text-[11px] font-mono"
                        style={{ color: PHASE_LABELS.QUEUE_AT_SHOVEL.color }}>
                        {fmt(c.queue_duration_s)}
                      </td>
                      <td className="py-2 px-2 text-[11px] font-mono"
                        style={{ color: PHASE_LABELS.LOADING.color }}>
                        {fmt(c.loading_duration_s)}
                      </td>
                      <td className="py-2 px-2 text-[11px] font-mono"
                        style={{ color: PHASE_LABELS.HAULING.color }}>
                        {fmt(c.haul_duration_s)}
                      </td>
                      <td className="py-2 px-2 text-[11px] font-mono"
                        style={{ color: PHASE_LABELS.DUMPING.color }}>
                        {fmt(c.dump_duration_s)}
                      </td>
                      <td className="py-2 px-2 text-[11px] font-mono"
                        style={{ color: PHASE_LABELS.RETURNING.color }}>
                        {fmt(c.return_duration_s)}
                      </td>
                      <td className="py-2 px-2 text-[12px] font-mono font-bold text-slate-200">
                        {fmt(c.total_duration_s)}
                      </td>
                      <td className="py-2 px-2 text-[12px] font-mono">
                        <span className={c.overloaded ? 'text-red-400 font-bold' : 'text-slate-200'}>
                          {c.payload_tonnes ? `${Number(c.payload_tonnes).toFixed(0)} t` : '—'}
                        </span>
                        {c.overloaded && <div className="text-[9px] text-red-400">SURCHARGÉ</div>}
                      </td>
                      <td className="py-2 px-2 text-[12px] font-mono">
                        {pf ? <span className={pfColor(pf)}>{pf.toFixed(0)}%</span> : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent dispatch events from Socket */}
      {dispatchEvents.length > 0 && (
        <div className="bg-[#111827] border border-[#1a2740] rounded-lg p-4">
          <div className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mb-3">
            Événements temps réel (session)
          </div>
          <div className="space-y-1.5">
            {dispatchEvents.slice(0, 5).map((ev, i) => (
              <div key={i} className="text-[12px] flex items-center gap-2 text-slate-400">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
                <span className="text-green-300 font-mono">{ev.fleet_number}</span>
                <span>assigné</span>
                <span>{ev.source_name} → {ev.dest_name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {showForm && (
        <DispatchForm
          onClose={() => setShowForm(false)}
          onCreate={(body) => createMutation.mutate(body)}
        />
      )}
    </div>
  );
}
