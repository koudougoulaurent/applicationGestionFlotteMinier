import { useCallback, useEffect, useState } from 'react';
import { T, STATUT_VOYAGE } from '../constants';
import { api } from '../api';
import type { Zone, Dump, Voyage } from '../types';

interface Props { zones: Zone[]; dumps: Dump[] }

const SEL: React.CSSProperties = {
  padding: '5px 8px', background: '#161922', border: '1px solid #252a38',
  borderRadius: 5, fontSize: 11, color: '#d4d8e2', outline: 'none', cursor: 'pointer',
};
const fmt = (s: string) =>
  new Date(s).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function Tbtn({ color, onClick, children }: { color: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ padding: '3px 8px', fontSize: 10, border: `1px solid ${color}40`, color, background: 'none', borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap' }}>
      {children}
    </button>
  );
}

export default function HistoriqueView({ zones, dumps }: Props) {
  const [voyages, setVoyages] = useState<Voyage[]>([]);
  const [fZone,   setFZone]   = useState('');
  const [fDump,   setFDump]   = useState('');
  const [fStatut, setFStatut] = useState('');

  const load = useCallback(async () => {
    const p: Record<string, string> = {};
    if (fZone)   p.zone_id = fZone;
    if (fDump)   p.dump_id = fDump;
    if (fStatut) p.statut  = fStatut;
    setVoyages(await api.voyages(p));
  }, [fZone, fDump, fStatut]);

  useEffect(() => { load(); }, [load]);

  // Agrégats rapides
  const totalTonnes = voyages.reduce((s, v) => s + Number(v.payload_t ?? 0), 0);
  const completes   = voyages.filter(v => v.statut === 'COMPLETE');
  const avgCycle    = completes.length
    ? completes.reduce((s, v) => s + v.duree_reelle_min, 0) / completes.length
    : 0;

  return (
    <div>
      {/* Filtres */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={fZone}   onChange={e => setFZone(e.target.value)}   style={SEL}>
          <option value="">toutes les zones</option>
          {zones.map(z => <option key={z.id} value={z.id}>{z.code} — {z.nom}</option>)}
        </select>
        <select value={fDump}   onChange={e => setFDump(e.target.value)}   style={SEL}>
          <option value="">tous les dumps</option>
          {dumps.map(d => <option key={d.id} value={d.id}>{d.code} — {d.nom}</option>)}
        </select>
        <select value={fStatut} onChange={e => setFStatut(e.target.value)} style={SEL}>
          <option value="">tous les statuts</option>
          {Object.entries(STATUT_VOYAGE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button onClick={load} style={{ ...SEL, color: T.amber }}>↻ actualiser</button>

        {/* Agrégats */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 14, fontSize: 11 }}>
          <span style={{ color: T.sub }}>{voyages.length} voyage{voyages.length !== 1 ? 's' : ''}</span>
          <span style={{ color: T.sub }}>{Math.round(totalTonnes)} t total</span>
          {avgCycle > 0 && <span style={{ color: T.sub }}>cycle moy. {Math.round(avgCycle)} min</span>}
        </div>
      </div>

      {/* Table */}
      <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead style={{ background: T.card }}>
              <tr style={{ color: T.sub }}>
                {['HU','Zone','Dump','Opérateur','Matériau','Payload','Shift','Départ','Durée','Statut',''].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 600, borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {voyages.length === 0 ? (
                <tr><td colSpan={11} style={{ padding: 32, textAlign: 'center', color: T.faint }}>aucun voyage</td></tr>
              ) : voyages.map(v => {
                const sv = STATUT_VOYAGE[v.statut] ?? { label: v.statut, color: T.sub };
                return (
                  <tr key={v.id} style={{ borderBottom: `1px solid ${T.border2}` }}>
                    <td style={{ padding: '8px 12px', fontWeight: 700, color: T.text, fontFamily: 'monospace' }}>{v.engin}</td>
                    <td style={{ padding: '8px 12px', color: '#3b82f6', fontFamily: 'monospace' }}>{v.zone_code}</td>
                    <td style={{ padding: '8px 12px', color: '#f97316', fontFamily: 'monospace' }}>{v.dump_code}</td>
                    <td style={{ padding: '8px 12px', color: T.sub }}>{v.operateur ?? '—'}</td>
                    <td style={{ padding: '8px 12px', color: T.sub, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.type_materiau ?? '—'}</td>
                    <td style={{ padding: '8px 12px', color: T.text, whiteSpace: 'nowrap' }}>{v.payload_t ? `${v.payload_t} t` : '—'}</td>
                    <td style={{ padding: '8px 12px', color: T.sub }}>{v.shift === 'J' ? 'Jour' : 'Nuit'}</td>
                    <td style={{ padding: '8px 12px', color: T.sub, whiteSpace: 'nowrap' }}>{fmt(v.heure_depart)}</td>
                    <td style={{ padding: '8px 12px', color: T.sub, whiteSpace: 'nowrap' }}>
                      {v.statut === 'COMPLETE' ? `${Math.round(v.duree_reelle_min)} min` : `${Math.round(v.elapsed_min)} min`}
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{ color: sv.color, fontSize: 10 }}>● {sv.label}</span>
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {v.statut === 'EN_ROUTE' && (
                          <Tbtn color="#f97316" onClick={async () => { await api.auDump(v.id); load(); }}>dump</Tbtn>
                        )}
                        {['EN_ROUTE','AU_DUMP'].includes(v.statut) && (
                          <Tbtn color="#22c55e" onClick={async () => { await api.retour(v.id); load(); }}>✓</Tbtn>
                        )}
                        <Tbtn color="#ef4444" onClick={async () => { if (confirm('Supprimer ?')) { await api.delVoyage(v.id); load(); } }}>✕</Tbtn>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
