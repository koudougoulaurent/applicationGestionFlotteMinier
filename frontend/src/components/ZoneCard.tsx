import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Zone, Dump, Engin, Voyage } from '../types';
import VoyageModal from './VoyageModal';

interface Props {
  zone: Zone;
  allDumps: Dump[];
  onRefresh: () => void;
}

const COLORS: Record<string, string> = {
  blue:   'border-blue-600/40 bg-blue-950/20',
  slate:  'border-slate-600/40 bg-slate-900/30',
  amber:  'border-amber-600/40 bg-amber-950/20',
  green:  'border-green-600/40 bg-green-950/20',
  red:    'border-red-600/40 bg-red-950/20',
};
const ACCENT: Record<string, string> = {
  blue: 'text-blue-400',  slate: 'text-slate-300',
  amber: 'text-amber-400', green: 'text-green-400', red: 'text-red-400',
};

export default function ZoneCard({ zone, allDumps, onRefresh }: Props) {
  const [engins,  setEngins]  = useState<Engin[]>([]);
  const [actifs,  setActifs]  = useState<Voyage[]>([]);
  const [modal,   setModal]   = useState(false);
  const [open,    setOpen]    = useState(true);

  const couleur = zone.couleur ?? 'blue';
  const cardCls = COLORS[couleur] ?? COLORS.blue;
  const accCls  = ACCENT[couleur] ?? ACCENT.blue;

  const load = async () => {
    const [e, v] = await Promise.all([
      api.engins(zone.id),
      api.voyages({ zone_id: String(zone.id), statut: 'EN_COURS', limit: '20' }),
    ]);
    setEngins(e);
    setActifs(v);
  };

  useEffect(() => { load(); }, [zone.id]);

  const terminer = async (voyageId: number) => {
    await api.terminer(voyageId);
    load(); onRefresh();
  };

  const enRoute  = engins.filter(e => e.statut_voyage === 'EN_COURS').length;
  const dispos   = engins.filter(e => !e.statut_voyage).length;

  return (
    <>
      <div className={`border rounded-xl overflow-hidden ${cardCls}`}>

        {/* ── Header zone ── */}
        <div
          className="flex items-center justify-between px-4 py-3 cursor-pointer select-none"
          onClick={() => setOpen(o => !o)}
        >
          <div className="flex items-center gap-3">
            <div className={`text-lg font-black font-mono ${accCls}`}>{zone.code}</div>
            <div>
              <div className="text-sm font-semibold text-white">{zone.nom}</div>
              {zone.materiau && <div className="text-xs text-slate-500">{zone.materiau}</div>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Compteurs */}
            <div className="flex gap-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300">
                {dispos} DISPO
              </span>
              {enRoute > 0 && (
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-900/60 text-blue-300">
                  {enRoute} EN ROUTE
                </span>
              )}
            </div>
            <span className="text-slate-600 text-xs">{open ? '▲' : '▼'}</span>
          </div>
        </div>

        {open && (
          <div className="px-4 pb-4 space-y-3">

            {/* ── Ligne visuelle : zone → camions en route → dumps ── */}
            {actifs.length > 0 && (
              <div className="space-y-1.5">
                {actifs.map(v => (
                  <div key={v.id} className="flex items-center gap-2 bg-black/20 rounded-lg px-3 py-2">
                    <span className="text-base">🚛</span>
                    <span className="text-xs font-mono text-slate-300 w-16 shrink-0">{v.engin}</span>
                    {/* ligne pointillée */}
                    <div className="flex-1 flex items-center gap-0.5 overflow-hidden">
                      {Array.from({ length: 12 }).map((_, i) => (
                        <div key={i} className="h-px w-2 bg-blue-700/60 shrink-0" />
                      ))}
                    </div>
                    <span className="text-[10px] font-bold text-slate-400 shrink-0">{v.dump_code}</span>
                    <span className="text-[10px] text-slate-600 shrink-0">
                      {new Date(v.heure_depart).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <button
                      onClick={() => terminer(v.id)}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-green-900/50 text-green-400 hover:bg-green-800/60 shrink-0"
                    >
                      ✓ Arrivé
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* ── Liste engins ── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {engins.map(e => (
                <div key={e.id}
                  className="flex items-center gap-1.5 bg-black/20 rounded px-2 py-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${e.statut_voyage ? 'bg-blue-400' : 'bg-emerald-400'}`} />
                  <span className="text-xs font-mono text-slate-300">{e.numero}</span>
                  <span className="text-[10px] text-slate-600 ml-auto">{e.capacite_t}t</span>
                </div>
              ))}
            </div>

            {/* ── Dumps de cette zone ── */}
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-[10px] text-slate-600 uppercase tracking-wider">Dumps →</span>
              {zone.dumps.map(d => (
                <span key={d.id}
                  className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                  {d.code}
                </span>
              ))}
              {zone.dumps.length === 0 && (
                <span className="text-[10px] text-slate-600 italic">Aucun dump lié</span>
              )}
            </div>

            {/* ── Bouton ajouter voyage ── */}
            <button
              onClick={() => setModal(true)}
              className="w-full py-2 mt-1 border border-dashed border-blue-700/50 rounded-lg text-xs font-semibold text-blue-400 hover:bg-blue-950/30 hover:border-blue-500 transition-colors"
            >
              + Ajouter un voyage depuis {zone.code}
            </button>

          </div>
        )}
      </div>

      {modal && (
        <VoyageModal
          zone={zone}
          allDumps={allDumps}
          onClose={() => setModal(false)}
          onSaved={() => { setModal(false); load(); onRefresh(); }}
        />
      )}
    </>
  );
}
