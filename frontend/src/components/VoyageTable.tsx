import { useState } from 'react';
import { api } from '../api';
import type { Voyage } from '../types';

interface Props { voyages: Voyage[]; onRefresh: () => void; }

const STATUT: Record<string, { label: string; cls: string }> = {
  EN_COURS: { label: 'En cours', cls: 'bg-blue-900/50 text-blue-300' },
  COMPLETE:  { label: 'Terminé',  cls: 'bg-green-900/50 text-green-300' },
  ANNULE:    { label: 'Annulé',   cls: 'bg-red-900/50 text-red-300' },
};

export default function VoyageTable({ voyages, onRefresh }: Props) {
  const [deleting, setDeleting] = useState<number | null>(null);

  const handleDelete = async (id: number) => {
    setDeleting(id);
    await api.delVoyage(id);
    onRefresh();
    setDeleting(null);
  };

  const handleTerminer = async (id: number) => {
    await api.terminer(id);
    onRefresh();
  };

  if (voyages.length === 0) {
    return (
      <div className="text-center text-slate-600 py-8 text-sm">
        Aucun voyage enregistré
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[#1a2740]">
            {['Engin','Zone','Dump','Opérateur','Matériau','Payload','Départ','Durée','Statut',''].map(h => (
              <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {voyages.map(v => {
            const s = STATUT[v.statut] ?? STATUT.EN_COURS;
            const dur = v.duree_min ? `${Math.round(v.duree_min)} min` : '—';
            return (
              <tr key={v.id} className="border-b border-[#1a2740]/50 hover:bg-white/[0.02] transition-colors">
                <td className="px-3 py-2 font-mono font-semibold text-slate-200">{v.engin}</td>
                <td className="px-3 py-2 text-slate-400">{v.zone_code}</td>
                <td className="px-3 py-2 font-semibold text-slate-300">{v.dump_code}</td>
                <td className="px-3 py-2 text-slate-400">{v.operateur ?? '—'}</td>
                <td className="px-3 py-2 text-slate-400">{v.materiau ?? '—'}</td>
                <td className="px-3 py-2 text-slate-300">{v.payload_t ? `${v.payload_t}t` : '—'}</td>
                <td className="px-3 py-2 text-slate-400">
                  {new Date(v.heure_depart).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}
                </td>
                <td className="px-3 py-2 text-slate-400">{dur}</td>
                <td className="px-3 py-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${s.cls}`}>{s.label}</span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    {v.statut === 'EN_COURS' && (
                      <button onClick={() => handleTerminer(v.id)}
                        className="text-[9px] px-1.5 py-0.5 rounded bg-green-900/40 text-green-400 hover:bg-green-800/50">
                        ✓
                      </button>
                    )}
                    <button onClick={() => handleDelete(v.id)} disabled={deleting === v.id}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-red-900/30 text-red-400 hover:bg-red-800/40 disabled:opacity-40">
                      ✕
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
