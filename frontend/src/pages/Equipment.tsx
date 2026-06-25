import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { equipmentApi, gpsApi, operatorApi } from '../lib/api';
import type { Equipment } from '../types';
import EquipmentDetailModal from '../components/equipment/EquipmentDetailModal';
import { useRole } from '../hooks/useRole';
import { useAuthStore } from '../store';
import {
  IconPlus, IconEdit, IconTrash, IconSearch, IconX, IconSave,
  IconAlert, IconEye,
} from '../components/ui/Icons';

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  TRUCK: 'Camion Benne', EXCAVATOR: 'Excavatrice', LOADER: 'Chargeuse',
  DOZER: 'Bulldozer', DRILL: 'Foreuse', GRADER: 'Niveleuse',
  WATER_TRUCK: 'Camion Citerne', SERVICE: 'Service',
};

const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  AVAILABLE:   { label: 'Disponible',    color: '#22c55e', bg: '#052e16' },
  HAULING:     { label: 'Transport',     color: '#3b82f6', bg: '#0c1a2e' },
  LOADING:     { label: 'Chargement',   color: '#0ea5e9', bg: '#082032' },
  DUMPING:     { label: 'Déchargement', color: '#a855f7', bg: '#1a0a2e' },
  RETURNING:   { label: 'Retour',       color: '#6366f1', bg: '#0d0f2b' },
  QUEUING:     { label: 'File attente', color: '#f59e0b', bg: '#1c1000' },
  IDLE:        { label: 'Inactif',      color: '#94a3b8', bg: '#111827' },
  DOWN:        { label: 'En panne',     color: '#ef4444', bg: '#1c0505' },
  MAINTENANCE: { label: 'Maintenance',  color: '#f97316', bg: '#1c0a00' },
  REFUELING:   { label: 'Carburant',   color: '#eab308', bg: '#1a1200' },
  OPERATING:   { label: 'Opération',   color: '#10b981', bg: '#022c1a' },
  INSPECTION:  { label: 'Inspection',  color: '#64748b', bg: '#0f172a' },
  STANDBY:     { label: 'Standby',     color: '#475569', bg: '#0f172a' },
  BLASTING:    { label: 'Sautage',     color: '#dc2626', bg: '#1c0505' },
};

const ALL_STATUSES = Object.keys(STATUS_CFG);

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusChip({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] || { label: status, color: '#94a3b8', bg: '#111827' };
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold tracking-wide"
      style={{ color: cfg.color, backgroundColor: cfg.bg, border: `1px solid ${cfg.color}33` }}>
      {cfg.label}
    </span>
  );
}

function HealthBar({ score }: { score: number }) {
  const color = score >= 80 ? '#22c55e' : score >= 60 ? '#f59e0b' : '#ef4444';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 bg-[#1a2740] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
      <span className="text-[11px] font-mono w-7 text-right" style={{ color }}>{score}%</span>
    </div>
  );
}

// ─── Equipment Form Modal ─────────────────────────────────────────────────────

type EquipType = { type_id: string; code: string; name: string; category: string; manufacturer: string };
type OpRow = { operator_id: string; first_name: string; last_name: string; employee_no: string };
type LocRow = { location_id: string; name: string; location_type: string };

interface EquipmentFormProps {
  equipment?: Equipment;
  equiptypes: EquipType[];
  operators: OpRow[];
  locations: LocRow[];
  siteId: string;
  onClose: () => void;
  onSaved: () => void;
}

function EquipmentForm({ equipment, equiptypes, operators, locations, siteId, onClose, onSaved }: EquipmentFormProps) {
  const qc = useQueryClient();
  const isEdit = !!equipment;

  const [tab, setTab] = useState<'general' | 'specs' | 'affectation'>('general');
  const [form, setForm] = useState({
    typeId:          equipment?.type_id || equiptypes[0]?.type_id || '',
    fleetNumber:     equipment?.fleet_number || '',
    serialNumber:    equipment?.serial_number || '',
    model:           equipment?.model || '',
    yearManufactured:equipment?.year_manufactured || new Date().getFullYear(),
    payloadCapacity: equipment?.payload_capacity?.toString() || '',
    fuelCapacity:    equipment?.fuel_capacity?.toString() || '',
    currentHours:    equipment?.current_hours?.toString() || '0',
    currentKm:       equipment?.current_km?.toString() || '0',
    status:          equipment?.status || 'AVAILABLE',
    latitude:        equipment?.latitude?.toString() || '',
    longitude:       equipment?.longitude?.toString() || '',
    operatorId:      equipment?.operator_id || '',
    locationId:      '',
  });
  const [error, setError] = useState('');

  const set = (k: keyof typeof form, v: string | number) => setForm(f => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: (body: object) => isEdit
      ? equipmentApi.update(equipment!.equipment_id, body)
      : equipmentApi.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['equipment'] });
      onSaved();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Erreur serveur';
      setError(msg);
    },
  });

  const handleSubmit = () => {
    setError('');
    if (!form.fleetNumber.trim()) { setError('Numéro de flotte requis'); return; }
    if (!form.typeId) { setError('Type d\'équipement requis'); return; }
    if (!form.model.trim()) { setError('Modèle requis'); return; }

    const body: Record<string, unknown> = {
      siteId,
      typeId:           form.typeId,
      fleetNumber:      form.fleetNumber.trim().toUpperCase(),
      serialNumber:     form.serialNumber.trim() || undefined,
      model:            form.model.trim(),
      yearManufactured: Number(form.yearManufactured),
      payloadCapacity:  form.payloadCapacity ? Number(form.payloadCapacity) : undefined,
      fuelCapacity:     form.fuelCapacity ? Number(form.fuelCapacity) : undefined,
      currentHours:     Number(form.currentHours) || 0,
      currentKm:        Number(form.currentKm) || 0,
      status:           form.status,
      latitude:         form.latitude ? Number(form.latitude) : undefined,
      longitude:        form.longitude ? Number(form.longitude) : undefined,
      operatorId:       form.operatorId || undefined,
      locationId:       form.locationId || undefined,
    };

    mutation.mutate(body);
  };

  const tabs = [
    { id: 'general' as const,     label: 'Identification' },
    { id: 'specs' as const,       label: 'Capacités & État' },
    { id: 'affectation' as const, label: 'Affectation' },
  ];

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-[#111827] border border-[#1a2740] rounded-lg w-full max-w-2xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1a2740]">
          <div>
            <h2 className="text-[15px] font-semibold text-white">
              {isEdit ? `Modifier — ${equipment.fleet_number}` : 'Ajouter un équipement'}
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {isEdit ? 'Modification des données de l\'équipement' : 'Enregistrement d\'un nouvel équipement dans la flotte'}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-1">
            <IconX size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#1a2740]">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-5 py-3 text-[12px] font-medium transition-colors border-b-2 ${
                tab === t.id
                  ? 'text-amber-400 border-amber-500'
                  : 'text-slate-500 border-transparent hover:text-slate-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="p-5 max-h-[60vh] overflow-y-auto">
          {tab === 'general' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="field-label">N° Flotte *</label>
                <input value={form.fleetNumber} onChange={e => set('fleetNumber', e.target.value.toUpperCase())}
                  placeholder="ex: DT-101" className="field-input" />
              </div>
              <div>
                <label className="field-label">N° Série</label>
                <input value={form.serialNumber} onChange={e => set('serialNumber', e.target.value)}
                  placeholder="ex: CAT7970001234" className="field-input" />
              </div>
              <div>
                <label className="field-label">Type d'équipement *</label>
                <select value={form.typeId} onChange={e => set('typeId', e.target.value)} className="field-input">
                  <option value="">— Sélectionner —</option>
                  {equiptypes.map(t => (
                    <option key={t.type_id} value={t.type_id}>
                      {CATEGORY_LABELS[t.category] || t.category} — {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label">Modèle *</label>
                <input value={form.model} onChange={e => set('model', e.target.value)}
                  placeholder="ex: CAT 797F" className="field-input" />
              </div>
              <div>
                <label className="field-label">Année de fabrication</label>
                <input type="number" value={form.yearManufactured}
                  onChange={e => set('yearManufactured', Number(e.target.value))}
                  min={1990} max={2030} className="field-input" />
              </div>
              <div>
                <label className="field-label">Statut initial</label>
                <select value={form.status} onChange={e => set('status', e.target.value)} className="field-input">
                  {ALL_STATUSES.map(s => (
                    <option key={s} value={s}>{STATUS_CFG[s]?.label || s}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {tab === 'specs' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="field-label">Capacité de charge (tonnes)</label>
                <input type="number" value={form.payloadCapacity}
                  onChange={e => set('payloadCapacity', e.target.value)}
                  placeholder="ex: 363" step="0.1" min="0" className="field-input" />
              </div>
              <div>
                <label className="field-label">Capacité carburant (litres)</label>
                <input type="number" value={form.fuelCapacity}
                  onChange={e => set('fuelCapacity', e.target.value)}
                  placeholder="ex: 4732" min="0" className="field-input" />
              </div>
              <div>
                <label className="field-label">Heures moteur actuelles (h)</label>
                <input type="number" value={form.currentHours}
                  onChange={e => set('currentHours', e.target.value)}
                  placeholder="ex: 12500" min="0" className="field-input" />
              </div>
              <div>
                <label className="field-label">Kilométrage actuel (km)</label>
                <input type="number" value={form.currentKm}
                  onChange={e => set('currentKm', e.target.value)}
                  placeholder="ex: 95000" min="0" className="field-input" />
              </div>
              <div>
                <label className="field-label">Latitude GPS</label>
                <input type="number" value={form.latitude}
                  onChange={e => set('latitude', e.target.value)}
                  placeholder="ex: -12.495" step="0.0001" className="field-input" />
              </div>
              <div>
                <label className="field-label">Longitude GPS</label>
                <input type="number" value={form.longitude}
                  onChange={e => set('longitude', e.target.value)}
                  placeholder="ex: 27.845" step="0.0001" className="field-input" />
              </div>
            </div>
          )}

          {tab === 'affectation' && (
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="field-label">Opérateur assigné</label>
                <select value={form.operatorId} onChange={e => set('operatorId', e.target.value)} className="field-input">
                  <option value="">— Aucun opérateur —</option>
                  {operators.filter(o => o).map(op => (
                    <option key={op.operator_id} value={op.operator_id}>
                      [{op.employee_no}] {op.first_name} {op.last_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label">Localisation actuelle</label>
                <select value={form.locationId} onChange={e => set('locationId', e.target.value)} className="field-input">
                  <option value="">— Sélectionner une zone —</option>
                  {locations.map(l => (
                    <option key={l.location_id} value={l.location_id}>
                      {l.name} ({l.location_type})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mx-5 mb-1 px-3 py-2 bg-red-950/60 border border-red-700/40 rounded text-[12px] text-red-400 flex items-center gap-2">
            <IconAlert size={13} />{error}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-[#1a2740]">
          <div className="text-[11px] text-slate-600">* champs obligatoires</div>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary text-[13px] px-4 py-2">Annuler</button>
            <button
              onClick={handleSubmit}
              disabled={mutation.isPending}
              className="btn-primary text-[13px] px-4 py-2 flex items-center gap-2"
            >
              <IconSave size={14} />
              {mutation.isPending ? 'Enregistrement...' : isEdit ? 'Enregistrer' : 'Ajouter'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function EquipmentPage() {
  const { isAdmin } = useRole();
  const { user } = useAuthStore();
  const qc = useQueryClient();

  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [statusFilter, setStatusFilter]     = useState('ALL');
  const [search, setSearch]                 = useState('');
  const [editEquip, setEditEquip]           = useState<Equipment | null>(null);
  const [showCreate, setShowCreate]         = useState(false);
  const [detailEquip, setDetailEquip]       = useState<Equipment | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState<Equipment | null>(null);

  const { data: equipment = [], isLoading } = useQuery<Equipment[]>({
    queryKey: ['equipment'],
    queryFn: async () => (await equipmentApi.list()).data,
    refetchInterval: 15_000,
  });

  const { data: equiptypes = [] } = useQuery<EquipType[]>({
    queryKey: ['equipment-types'],
    queryFn: async () => (await equipmentApi.types()).data,
  });

  const { data: operators = [] } = useQuery<OpRow[]>({
    queryKey: ['operators'],
    queryFn: async () => (await operatorApi.list()).data,
    enabled: isAdmin,
  });

  const { data: locations = [] } = useQuery<LocRow[]>({
    queryKey: ['locations'],
    queryFn: async () => (await gpsApi.locations()).data,
    enabled: isAdmin,
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => equipmentApi.deactivate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['equipment'] });
      setConfirmDeactivate(null);
    },
  });

  const categories = [...new Set(equipment.map(e => e.category))].sort();

  const filtered = equipment.filter(e => {
    const catOk = categoryFilter === 'ALL' || e.category === categoryFilter;
    const stsOk = statusFilter === 'ALL' || e.status === statusFilter;
    const srchOk = !search || e.fleet_number.toLowerCase().includes(search.toLowerCase()) ||
                   e.model.toLowerCase().includes(search.toLowerCase()) ||
                   (e.operator_name || '').toLowerCase().includes(search.toLowerCase());
    return catOk && stsOk && srchOk;
  });

  // Summary by category
  type CatSum = { total: number; active: number; down: number; maint: number };
  const summary = categories.reduce<Record<string, CatSum>>((acc, cat) => {
    const items = equipment.filter(e => e.category === cat);
    acc[cat] = {
      total:  items.length,
      active: items.filter(e => ['HAULING','LOADING','DUMPING','RETURNING','OPERATING','QUEUING'].includes(e.status)).length,
      down:   items.filter(e => e.status === 'DOWN').length,
      maint:  items.filter(e => e.status === 'MAINTENANCE').length,
    };
    return acc;
  }, {});

  const activeStatuses = [...new Set(equipment.map(e => e.status))].sort();

  return (
    <div className="space-y-4">
      {/* Category summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {categories.map(cat => {
          const s = summary[cat];
          const active = categoryFilter === cat;
          return (
            <button
              key={cat}
              onClick={() => setCategoryFilter(active ? 'ALL' : cat)}
              className={`text-left p-3 rounded border transition-all ${
                active
                  ? 'bg-amber-500/10 border-amber-500/60'
                  : 'bg-[#111827] border-[#1a2740] hover:border-[#2a3750]'
              }`}
            >
              <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">
                {CATEGORY_LABELS[cat] || cat}
              </div>
              <div className="text-2xl font-bold font-mono text-white">{s.total}</div>
              <div className="flex gap-2 mt-1.5 text-[10px]">
                <span className="text-emerald-400">{s.active} prod.</span>
                {s.down > 0 && <span className="text-red-400">{s.down} panne</span>}
                {s.maint > 0 && <span className="text-orange-400">{s.maint} maint.</span>}
              </div>
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <IconSearch size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher par N° flotte, modèle, opérateur..."
            className="w-full bg-[#111827] border border-[#1a2740] rounded px-3 py-2 pl-8 text-[13px] text-slate-200 placeholder-slate-600 focus:border-amber-500/50 focus:outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="bg-[#111827] border border-[#1a2740] rounded px-3 py-2 text-[13px] text-slate-300 focus:outline-none focus:border-amber-500/50"
        >
          <option value="ALL">Tous les statuts</option>
          {activeStatuses.map(s => (
            <option key={s} value={s}>{STATUS_CFG[s]?.label || s}</option>
          ))}
        </select>
        <div className="text-[11px] text-slate-600 font-mono">{filtered.length} / {equipment.length}</div>
        {isAdmin && (
          <button
            onClick={() => setShowCreate(true)}
            className="btn-primary flex items-center gap-2 text-[13px] px-3 py-2 ml-auto"
          >
            <IconPlus size={14} />
            Ajouter équipement
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-[#111827] border border-[#1a2740] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[#1a2740] bg-[#0d1520]">
                {['N° Flotte', 'Type / Modèle', 'Statut', 'Opérateur', 'Zone / Position', 'Heures', 'Km', 'Santé', 'Actions'].map(h => (
                  <th key={h} className="text-left py-2.5 px-3 text-[10px] text-slate-500 font-semibold uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={9} className="text-center py-12 text-slate-600 text-[13px]">Chargement...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12 text-slate-600 text-[13px]">Aucun équipement trouvé</td></tr>
              ) : filtered.map(eq => (
                <tr key={eq.equipment_id} className="border-b border-[#1a2740]/60 hover:bg-[#1a2740]/30 transition-colors">
                  <td className="py-3 px-3">
                    <button
                      onClick={() => setDetailEquip(eq)}
                      className="font-mono font-bold text-amber-400 hover:text-amber-300 transition-colors text-[13px]"
                    >
                      {eq.fleet_number}
                    </button>
                  </td>
                  <td className="py-3 px-3">
                    <div className="text-slate-200 text-[12px]">{eq.model}</div>
                    <div className="text-[10px] text-slate-600 mt-0.5">{CATEGORY_LABELS[eq.category] || eq.category}</div>
                  </td>
                  <td className="py-3 px-3">
                    <StatusChip status={eq.status} />
                  </td>
                  <td className="py-3 px-3">
                    <span className="text-[12px] text-slate-300">{eq.operator_name || <span className="text-slate-600">—</span>}</span>
                    {eq.employee_no && <div className="text-[10px] text-slate-600 font-mono">{eq.employee_no}</div>}
                  </td>
                  <td className="py-3 px-3">
                    <span className="text-[12px] text-slate-400">{eq.location_name || '—'}</span>
                    {eq.latitude != null && <div className="text-[10px] text-slate-600 font-mono">{Number(eq.latitude).toFixed(3)}, {eq.longitude != null ? Number(eq.longitude).toFixed(3) : ''}</div>}
                  </td>
                  <td className="py-3 px-3 font-mono text-[12px] text-slate-300">
                    {eq.current_hours?.toLocaleString('fr')} h
                  </td>
                  <td className="py-3 px-3 font-mono text-[12px] text-slate-400">
                    {eq.current_km?.toLocaleString('fr')} km
                  </td>
                  <td className="py-3 px-3 w-28">
                    <HealthBar score={eq.health_score ?? 100} />
                  </td>
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setDetailEquip(eq)}
                        className="p-1.5 rounded text-slate-500 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
                        title="Voir détails"
                      >
                        <IconEye size={13} />
                      </button>
                      {isAdmin && (
                        <>
                          <button
                            onClick={() => setEditEquip(eq)}
                            className="p-1.5 rounded text-slate-500 hover:text-sky-400 hover:bg-sky-500/10 transition-colors"
                            title="Modifier"
                          >
                            <IconEdit size={13} />
                          </button>
                          <button
                            onClick={() => setConfirmDeactivate(eq)}
                            className="p-1.5 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Désactiver"
                          >
                            <IconTrash size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <EquipmentForm
          equiptypes={equiptypes}
          operators={operators}
          locations={locations}
          siteId={user?.siteId || ''}
          onClose={() => setShowCreate(false)}
          onSaved={() => setShowCreate(false)}
        />
      )}

      {/* Edit Modal */}
      {editEquip && (
        <EquipmentForm
          equipment={editEquip}
          equiptypes={equiptypes}
          operators={operators}
          locations={locations}
          siteId={user?.siteId || ''}
          onClose={() => setEditEquip(null)}
          onSaved={() => setEditEquip(null)}
        />
      )}

      {/* Detail Modal */}
      {detailEquip && (
        <EquipmentDetailModal equipment={detailEquip} onClose={() => setDetailEquip(null)} />
      )}

      {/* Deactivate Confirm */}
      {confirmDeactivate && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-[#111827] border border-red-700/40 rounded-lg w-full max-w-sm p-5 shadow-2xl">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-full bg-red-950 flex items-center justify-center flex-shrink-0">
                <IconAlert size={16} className="text-red-400" />
              </div>
              <div>
                <div className="text-[14px] font-semibold text-white">Désactiver l'équipement</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Cette action est réversible via la base de données</div>
              </div>
            </div>
            <p className="text-[13px] text-slate-300 mb-4">
              Confirmer la désactivation de <span className="font-mono font-bold text-amber-400">{confirmDeactivate.fleet_number}</span> — {confirmDeactivate.model} ?
              <br /><span className="text-[11px] text-slate-500 mt-1 block">L'équipement sera retiré de la flotte active et son opérateur désassigné.</span>
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => deactivateMutation.mutate(confirmDeactivate.equipment_id)}
                disabled={deactivateMutation.isPending}
                className="flex-1 bg-red-900 hover:bg-red-800 text-red-200 text-[13px] font-semibold px-4 py-2 rounded transition-colors"
              >
                {deactivateMutation.isPending ? 'Traitement...' : 'Désactiver'}
              </button>
              <button
                onClick={() => setConfirmDeactivate(null)}
                className="flex-1 btn-secondary text-[13px]"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
