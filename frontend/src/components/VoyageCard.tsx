import { T, STATUT_VOYAGE } from '../constants';
import { api } from '../api';
import type { Voyage } from '../types';

interface Props { voyage: Voyage; onRefresh: () => void; }

export default function VoyageCard({ voyage: v, onRefresh }: Props) {
  const sv    = STATUT_VOYAGE[v.statut] ?? { label: v.statut, color: T.sub };
  const pct   = Math.min(Math.round((v.elapsed_min / v.duree_estime_min) * 100), 100);
  const late  = v.elapsed_min > v.duree_estime_min * 1.1 && v.statut === 'EN_ROUTE';
  const hDep  = new Date(v.heure_depart).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  const auDump  = async () => { await api.auDump(v.id);  onRefresh(); };
  const termine = async () => { await api.retour(v.id);  onRefresh(); };
  const annule  = async () => {
    if (!confirm(`Annuler le voyage de ${v.engin} ?`)) return;
    await api.delVoyage(v.id); onRefresh();
  };

  return (
    <div style={{ border: `1px solid ${T.border}`, borderLeft: `3px solid ${sv.color}`, borderRadius: 6, padding: '10px 12px' }}>

      {/* Ligne 1 : HU + statut + temps */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: T.text, fontWeight: 700, fontFamily: 'monospace' }}>{v.engin}</span>
          <span style={{ color: T.faint, fontSize: 10 }}>{v.engin_modele}</span>
          <span style={{ color: sv.color, fontSize: 11 }}>● {sv.label}</span>
          {late && <span style={{ color: '#ef4444', fontSize: 10 }}>en retard</span>}
        </div>
        <span style={{ color: T.faint, fontSize: 11 }}>{Math.round(v.elapsed_min)} min · départ {hDep}</span>
      </div>

      {/* Ligne 2 : route */}
      <div style={{ fontSize: 11, color: T.sub, marginBottom: 5 }}>
        <span style={{ color: '#3b82f6', fontFamily: 'monospace' }}>{v.zone_code}</span>
        <span style={{ margin: '0 6px', color: T.faint }}>→</span>
        <span style={{ color: '#f97316', fontFamily: 'monospace' }}>{v.dump_code}</span>
        <span style={{ color: T.faint }}> — {v.dump_nom}</span>
        {v.operateur    && <span style={{ marginLeft: 12 }}>👷 {v.operateur}</span>}
        {v.payload_t    && <span style={{ marginLeft: 10 }}>{v.payload_t} t</span>}
        {v.type_materiau && <span style={{ marginLeft: 10, color: T.faint }}>{v.type_materiau}</span>}
      </div>

      {/* Barre progression */}
      {v.statut === 'EN_ROUTE' && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ height: 3, background: T.border, borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: late ? '#ef4444' : '#3b82f6', borderRadius: 2, transition: 'width .3s' }} />
          </div>
          <div style={{ fontSize: 10, color: T.faint, marginTop: 2, textAlign: 'right' }}>
            {pct}% · {v.duree_estime_min} min estimées
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6 }}>
        {v.statut === 'EN_ROUTE' && (
          <Btn color="#f97316" onClick={auDump}>au dump</Btn>
        )}
        {['EN_ROUTE', 'AU_DUMP'].includes(v.statut) && (
          <Btn color="#22c55e" onClick={termine}>terminé ✓</Btn>
        )}
        <Btn color="#ef4444" onClick={annule}>annuler</Btn>
      </div>
    </div>
  );
}

function Btn({ color, onClick, children }: { color: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{ padding: '4px 10px', fontSize: 10, border: `1px solid ${color}40`, color, background: 'none', borderRadius: 4, cursor: 'pointer' }}
    >
      {children}
    </button>
  );
}
