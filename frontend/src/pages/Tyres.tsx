import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tyreApi } from '../lib/api';
import { Tyre, TyreInstallation } from '../types';

const POSITIONS = ['FL', 'FR', 'RL1', 'RL2', 'RR1', 'RR2', 'RL3', 'RR3'];

const positionLabel: Record<string, string> = {
  FL: 'Avant-Gauche', FR: 'Avant-Droit',
  RL1: 'Arrière-Gauche Int.', RL2: 'Arrière-Gauche Ext.',
  RR1: 'Arrière-Droit Int.',  RR2: 'Arrière-Droit Ext.',
  RL3: 'Arrière-G3', RR3: 'Arrière-D3',
};

function statusBadge(s: string) {
  const colors: Record<string, string> = {
    NEW: 'bg-blue-900/40 text-blue-300 border border-blue-700',
    INSTALLED: 'bg-green-900/40 text-green-300 border border-green-700',
    SCRAPPED: 'bg-red-900/40 text-red-300 border border-red-700',
  };
  const labels: Record<string, string> = { NEW: 'Stock', INSTALLED: 'Monté', SCRAPPED: 'Mis au rebut' };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[s] || ''}`}>
      {labels[s] || s}
    </span>
  );
}

function hoursBar(hours: number, max = 12000) {
  const pct = Math.min(100, (hours / max) * 100);
  const color = pct > 85 ? 'bg-red-500' : pct > 60 ? 'bg-yellow-500' : 'bg-green-500';
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 bg-mine-border rounded-full overflow-hidden min-w-[60px]">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-mine-muted w-16 text-right">
        {hours.toLocaleString('fr')} h
      </span>
    </div>
  );
}

// ── Add Tyre Modal ──────────────────────────────────────────────
interface AddTyreModalProps { onClose: () => void; }
function AddTyreModal({ onClose }: AddTyreModalProps) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    serialNumber: '', manufacturer: '', model: '', size: '',
    plyRating: '', purchaseDate: '', purchaseCost: '',
  });

  const mutation = useMutation({
    mutationFn: () => tyreApi.create({
      serialNumber: form.serialNumber,
      manufacturer: form.manufacturer,
      model: form.model || undefined,
      size: form.size || undefined,
      plyRating: form.plyRating ? parseInt(form.plyRating) : undefined,
      purchaseDate: form.purchaseDate || undefined,
      purchaseCost: form.purchaseCost ? parseFloat(form.purchaseCost) : undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tyres'] }); onClose(); },
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-mine-panel rounded-xl w-full max-w-lg border border-mine-border shadow-2xl">
        <div className="flex justify-between items-center p-5 border-b border-mine-border">
          <h2 className="text-lg font-bold">Ajouter un Pneu en Stock</h2>
          <button onClick={onClose} className="text-mine-muted hover:text-white">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'N° Série *', key: 'serialNumber' },
              { label: 'Fabricant *', key: 'manufacturer' },
              { label: 'Modèle', key: 'model' },
              { label: 'Taille', key: 'size', placeholder: 'ex: 27.00R49' },
              { label: 'Couches (PR)', key: 'plyRating', type: 'number' },
              { label: 'Coût achat (USD)', key: 'purchaseCost', type: 'number' },
            ].map(({ label, key, type = 'text', placeholder }) => (
              <div key={key}>
                <label className="text-xs text-mine-muted mb-1 block">{label}</label>
                <input type={type} placeholder={placeholder}
                  className="input w-full" value={form[key as keyof typeof form]}
                  onChange={set(key)} />
              </div>
            ))}
            <div>
              <label className="text-xs text-mine-muted mb-1 block">Date d'achat</label>
              <input type="date" className="input w-full" value={form.purchaseDate}
                onChange={set('purchaseDate')} />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 p-5 border-t border-mine-border">
          <button onClick={onClose} className="btn-secondary">Annuler</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!form.serialNumber || !form.manufacturer || mutation.isPending}
            className="btn-primary"
          >
            {mutation.isPending ? 'Création...' : 'Créer'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Install Tyre Modal ──────────────────────────────────────────────
interface InstallModalProps { tyre: Tyre; onClose: () => void; }
function InstallModal({ tyre, onClose }: InstallModalProps) {
  const qc = useQueryClient();
  const { data: equipment = [] } = useQuery<Array<{ equipment_id: string; fleet_number: string }>>({
    queryKey: ['equipment-list-simple'],
    queryFn: async () => {
      const { equipmentApi } = await import('../lib/api');
      const r = await equipmentApi.list({ category: 'TRUCK' });
      return r.data;
    },
  });

  const [form, setForm] = useState({
    equipmentId: '', positionCode: '', installDate: new Date().toISOString().slice(0, 10),
  });

  const mutation = useMutation({
    mutationFn: () => tyreApi.install({
      tyreId: tyre.tyre_id,
      equipmentId: form.equipmentId,
      positionCode: form.positionCode,
      installDate: form.installDate,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tyres'] }); onClose(); },
  });

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-mine-panel rounded-xl w-full max-w-md border border-mine-border shadow-2xl">
        <div className="flex justify-between items-center p-5 border-b border-mine-border">
          <h2 className="text-lg font-bold">Monter le Pneu</h2>
          <button onClick={onClose} className="text-mine-muted hover:text-white">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-mine-bg rounded-lg p-3 text-sm">
            <span className="text-mine-muted">Pneu :</span>
            <span className="ml-2 font-mono font-bold text-mine-accent">{tyre.serial_number}</span>
            <span className="ml-2 text-mine-muted">{tyre.manufacturer} {tyre.model} {tyre.size}</span>
          </div>
          <div>
            <label className="text-xs text-mine-muted mb-1 block">Équipement *</label>
            <select className="input w-full" value={form.equipmentId}
              onChange={(e) => setForm((p) => ({ ...p, equipmentId: e.target.value }))}>
              <option value="">-- Choisir --</option>
              {equipment.map((eq) => (
                <option key={eq.equipment_id} value={eq.equipment_id}>{eq.fleet_number}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-mine-muted mb-1 block">Position *</label>
            <select className="input w-full" value={form.positionCode}
              onChange={(e) => setForm((p) => ({ ...p, positionCode: e.target.value }))}>
              <option value="">-- Choisir --</option>
              {POSITIONS.map((p) => (
                <option key={p} value={p}>{p} — {positionLabel[p]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-mine-muted mb-1 block">Date de montage</label>
            <input type="date" className="input w-full" value={form.installDate}
              onChange={(e) => setForm((p) => ({ ...p, installDate: e.target.value }))} />
          </div>
        </div>
        <div className="flex justify-end gap-3 p-5 border-t border-mine-border">
          <button onClick={onClose} className="btn-secondary">Annuler</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!form.equipmentId || !form.positionCode || mutation.isPending}
            className="btn-primary"
          >
            {mutation.isPending ? 'Montage...' : 'Monter'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Equipment Tyre View ─────────────────────────────────────────
interface EquipmentTyresProps { equipmentId: string; fleetNumber: string; onClose: () => void; }
function EquipmentTyresPanel({ equipmentId, fleetNumber, onClose }: EquipmentTyresProps) {
  const { data: installs = [] } = useQuery<TyreInstallation[]>({
    queryKey: ['tyres-by-equipment', equipmentId],
    queryFn: async () => { const r = await tyreApi.byEquipment(equipmentId); return r.data; },
  });

  const qc = useQueryClient();
  const removeMut = useMutation({
    mutationFn: (installId: string) => tyreApi.remove(installId, { scrapped: false }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tyres'] }); qc.invalidateQueries({ queryKey: ['tyres-by-equipment', equipmentId] }); },
  });

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-mine-panel rounded-xl w-full max-w-2xl border border-mine-border shadow-2xl">
        <div className="flex justify-between items-center p-5 border-b border-mine-border">
          <h2 className="text-lg font-bold">Pneus de {fleetNumber}</h2>
          <button onClick={onClose} className="text-mine-muted hover:text-white">✕</button>
        </div>
        <div className="p-5 grid grid-cols-2 gap-3">
          {installs.length === 0 ? (
            <div className="col-span-2 text-center py-6 text-mine-muted">Aucun pneu monté</div>
          ) : installs.map((inst) => (
            <div key={inst.installation_id} className="bg-mine-bg rounded-lg p-4 border border-mine-border">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="text-xs font-bold text-mine-accent uppercase">{inst.position_code}</div>
                  <div className="text-xs text-mine-muted">{positionLabel[inst.position_code] || inst.position_code}</div>
                </div>
                <button
                  onClick={() => removeMut.mutate(inst.installation_id)}
                  className="text-xs text-red-400 hover:text-red-300"
                >Démonter</button>
              </div>
              <div className="text-sm font-mono font-bold">{inst.serial_number}</div>
              <div className="text-xs text-mine-muted">{inst.manufacturer} {inst.model}</div>
              <div className="text-xs text-mine-muted mt-1">{inst.size}</div>
              <div className="mt-2">
                {hoursBar(inst.hours_on_wheel_current || 0)}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end p-5 border-t border-mine-border">
          <button onClick={onClose} className="btn-secondary">Fermer</button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────
export default function Tyres() {
  const [showAdd, setShowAdd] = useState(false);
  const [installTyre, setInstallTyre] = useState<Tyre | null>(null);
  const [viewEquip, setViewEquip] = useState<{ id: string; fn: string } | null>(null);
  const [tab, setTab] = useState<'stock' | 'installed' | 'eol'>('installed');

  const { data: tyres = [], isLoading } = useQuery<Tyre[]>({
    queryKey: ['tyres'],
    queryFn: async () => { const r = await tyreApi.list(); return r.data; },
    refetchInterval: 60_000,
  });

  const { data: summaryData } = useQuery<{
    summary: { total_tyres: string; in_stock: string; installed: string; scrapped: string; near_end_of_life: string };
    nearEndOfLife: Tyre[];
  }>({
    queryKey: ['tyre-summary'],
    queryFn: async () => { const r = await tyreApi.summary(); return r.data; },
    refetchInterval: 60_000,
  });

  const summary = summaryData?.summary;
  const nearEOL = summaryData?.nearEndOfLife || [];

  const shown = tyres.filter((t) => {
    if (tab === 'stock')    return t.status === 'NEW';
    if (tab === 'installed') return t.status === 'INSTALLED';
    if (tab === 'eol')      return (t.hours_since_install || 0) > 8000;
    return true;
  });

  const tabs = [
    { id: 'installed', label: 'Montés', count: parseInt(summary?.installed || '0') },
    { id: 'stock', label: 'En Stock', count: parseInt(summary?.in_stock || '0') },
    { id: 'eol', label: '⚠ Fin de vie', count: nearEOL.length },
  ] as const;

  return (
    <div className="space-y-5">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Pneus', value: summary?.total_tyres, color: 'text-mine-accent' },
          { label: 'Montés', value: summary?.installed, color: 'text-green-400' },
          { label: 'En Stock', value: summary?.in_stock, color: 'text-blue-400' },
          { label: 'Fin de vie (>8000h)', value: nearEOL.length, color: 'text-red-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card">
            <div className="card-header">{label}</div>
            <div className={`text-3xl font-bold font-mono ${color}`}>{value ?? '—'}</div>
          </div>
        ))}
      </div>

      {/* Fin de vie alert */}
      {nearEOL.length > 0 && (
        <div className="bg-red-900/30 border border-red-700 rounded-xl p-4">
          <div className="text-sm font-semibold text-red-300 mb-2">
            ⚠ {nearEOL.length} pneu(x) en fin de vie (plus de 8 000 h)
          </div>
          <div className="flex flex-wrap gap-2">
            {nearEOL.slice(0, 6).map((t, i) => (
              <span key={i} className="bg-red-900/50 text-red-300 text-xs px-2 py-1 rounded border border-red-700">
                {t.fleet_number} — {t.position_code} — {Number(t.hours_since_install).toLocaleString('fr')} h
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Tabs + action */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
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
                {t.count > 0 && (
                  <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                    tab === t.id ? 'bg-black/30 text-black' : 'bg-mine-border text-mine-muted'
                  }`}>{t.count}</span>
                )}
              </button>
            ))}
          </div>
          <button onClick={() => setShowAdd(true)} className="btn-primary text-sm">
            + Nouveau pneu
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-mine-border">
                {['N° Série', 'Fabricant', 'Modèle', 'Taille', 'Statut', 'Engin', 'Position', 'Heures sur roue', ''].map((h) => (
                  <th key={h} className="text-left py-2.5 px-3 text-xs text-mine-muted font-medium uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={9} className="text-center py-8 text-mine-muted">Chargement...</td></tr>
              ) : shown.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-8 text-mine-muted">Aucun pneu dans cette catégorie</td></tr>
              ) : shown.map((t) => (
                <tr key={t.tyre_id} className="table-row">
                  <td className="py-2.5 px-3 font-mono text-mine-accent font-bold text-sm">{t.serial_number}</td>
                  <td className="py-2.5 px-3">{t.manufacturer}</td>
                  <td className="py-2.5 px-3 text-mine-muted">{t.model || '—'}</td>
                  <td className="py-2.5 px-3 font-mono text-xs">{t.size || '—'}</td>
                  <td className="py-2.5 px-3">{statusBadge(t.status)}</td>
                  <td className="py-2.5 px-3">
                    {t.fleet_number ? (
                      <button
                        onClick={() => setViewEquip({ id: t.equipment_id!, fn: t.fleet_number! })}
                        className="text-mine-highlight hover:underline font-mono text-sm"
                      >{t.fleet_number}</button>
                    ) : <span className="text-mine-muted">—</span>}
                  </td>
                  <td className="py-2.5 px-3">
                    {t.position_code ? (
                      <span className="font-mono text-xs bg-mine-bg px-2 py-0.5 rounded">
                        {t.position_code}
                      </span>
                    ) : <span className="text-mine-muted">—</span>}
                  </td>
                  <td className="py-2.5 px-3 min-w-[140px]">
                    {t.status === 'INSTALLED' ? hoursBar(t.hours_since_install || 0) : '—'}
                  </td>
                  <td className="py-2.5 px-3">
                    {t.status === 'NEW' && (
                      <button onClick={() => setInstallTyre(t)} className="text-xs text-mine-accent hover:underline">
                        Monter
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && <AddTyreModal onClose={() => setShowAdd(false)} />}
      {installTyre && <InstallModal tyre={installTyre} onClose={() => setInstallTyre(null)} />}
      {viewEquip && (
        <EquipmentTyresPanel
          equipmentId={viewEquip.id}
          fleetNumber={viewEquip.fn}
          onClose={() => setViewEquip(null)}
        />
      )}
    </div>
  );
}
