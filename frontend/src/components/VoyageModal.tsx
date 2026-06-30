import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Zone, Dump, Engin } from '../types';

interface Props {
  zone: Zone;
  allDumps: Dump[];
  onClose: () => void;
  onSaved: () => void;
}

const now = () => {
  const d = new Date();
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16);
};

export default function VoyageModal({ zone, allDumps, onClose, onSaved }: Props) {
  const [engins, setEngins] = useState<Engin[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const dumpsDispos = allDumps.filter(d => zone.dumps.some(zd => zd.id === d.id));

  const [form, setForm] = useState({
    engin_id:      '',
    dump_id:       dumpsDispos[0]?.id?.toString() ?? '',
    operateur:     '',
    materiau:      zone.materiau ?? '',
    payload_t:     '',
    shift:         'J',
    heure_depart:  now(),
    notes:         '',
  });

  useEffect(() => {
    api.engins(zone.id).then(setEngins);
  }, [zone.id]);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.engin_id)  { setErr('Sélectionner un engin'); return; }
    if (!form.dump_id)   { setErr('Sélectionner un dump'); return; }
    setSaving(true); setErr('');
    try {
      await api.addVoyage({
        engin_id:     Number(form.engin_id),
        zone_id:      zone.id,
        dump_id:      Number(form.dump_id),
        operateur:    form.operateur || null,
        materiau:     form.materiau  || null,
        payload_t:    form.payload_t ? Number(form.payload_t) : null,
        shift:        form.shift,
        heure_depart: new Date(form.heure_depart).toISOString(),
        notes:        form.notes || null,
      });
      onSaved();
    } catch {
      setErr('Erreur lors de l\'enregistrement');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#0d1520] border border-[#1a2740] rounded-xl shadow-2xl w-full max-w-lg">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1a2740]">
          <div>
            <div className="text-sm font-bold text-white">Nouveau Voyage</div>
            <div className="text-xs text-slate-400 mt-0.5">{zone.code} — {zone.nom}</div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-lg leading-none">✕</button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">

          {/* Engin + Dump */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Engin <span className="text-red-400">*</span></label>
              <select value={form.engin_id} onChange={e => set('engin_id', e.target.value)}
                className="w-full bg-[#1a2740] border border-[#2a3750] rounded px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500">
                <option value="">— Sélectionner —</option>
                {engins.map(en => (
                  <option key={en.id} value={en.id}>
                    {en.numero} ({en.capacite_t}t){en.statut_voyage ? ' ⚠ EN COURS' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Dump <span className="text-red-400">*</span></label>
              <select value={form.dump_id} onChange={e => set('dump_id', e.target.value)}
                className="w-full bg-[#1a2740] border border-[#2a3750] rounded px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500">
                <option value="">— Sélectionner —</option>
                {dumpsDispos.map(d => (
                  <option key={d.id} value={d.id}>{d.code} — {d.nom}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Opérateur + Shift */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Opérateur</label>
              <input type="text" value={form.operateur} onChange={e => set('operateur', e.target.value)}
                placeholder="Nom du chauffeur"
                className="w-full bg-[#1a2740] border border-[#2a3750] rounded px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Shift</label>
              <select value={form.shift} onChange={e => set('shift', e.target.value)}
                className="w-full bg-[#1a2740] border border-[#2a3750] rounded px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500">
                <option value="J">Jour</option>
                <option value="N">Nuit</option>
              </select>
            </div>
          </div>

          {/* Matériau + Payload */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Matériau</label>
              <input type="text" value={form.materiau} onChange={e => set('materiau', e.target.value)}
                placeholder="ex. Minerai de cuivre"
                className="w-full bg-[#1a2740] border border-[#2a3750] rounded px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Payload (tonnes)</label>
              <input type="number" min="0" max="300" step="0.1" value={form.payload_t} onChange={e => set('payload_t', e.target.value)}
                placeholder="220"
                className="w-full bg-[#1a2740] border border-[#2a3750] rounded px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500" />
            </div>
          </div>

          {/* Heure départ */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Heure de départ</label>
            <input type="datetime-local" value={form.heure_depart} onChange={e => set('heure_depart', e.target.value)}
              className="w-full bg-[#1a2740] border border-[#2a3750] rounded px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500" />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
              placeholder="Observations, incidents…"
              className="w-full bg-[#1a2740] border border-[#2a3750] rounded px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500 resize-none" />
          </div>

          {err && <p className="text-xs text-red-400">{err}</p>}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2 border border-[#2a3750] rounded text-xs text-slate-400 hover:bg-[#1a2740] transition-colors">
              Annuler
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-xs font-semibold text-white transition-colors">
              {saving ? 'Enregistrement…' : 'Enregistrer le voyage'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}
