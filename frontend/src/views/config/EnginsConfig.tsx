import { useState } from 'react';
import { T, STATUT_ENGIN } from '../../constants';
import { api } from '../../api';
import type { Zone, Engin } from '../../types';

const INP: React.CSSProperties = {
  padding: '7px 10px', background: T.bg, border: `1px solid ${T.border}`,
  borderRadius: 5, fontSize: 11, color: T.text, outline: 'none',
  width: '100%', boxSizing: 'border-box',
};
const BTN: React.CSSProperties = {
  padding: '7px 14px', background: T.amber, border: 'none', borderRadius: 5,
  fontSize: 11, fontWeight: 700, color: '#000', cursor: 'pointer', whiteSpace: 'nowrap',
};

interface Props { zones: Zone[]; engins: Engin[]; onRefresh: () => void }

export default function EnginsConfig({ zones, engins, onRefresh }: Props) {
  const [f, setF] = useState({ numero: '', modele: 'CAT 793F', zone_id: '', capacite_t: '220' });
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.addEngin({ ...f, capacite_t: Number(f.capacite_t), zone_id: f.zone_id ? Number(f.zone_id) : null });
    setF({ numero: '', modele: 'CAT 793F', zone_id: '', capacite_t: '220' }); onRefresh();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: '14px 16px' }}>
        <div style={{ color: T.sub, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Ajouter un engin (HU — Haul Unit)</div>
        <form onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: '100px 160px 1fr 90px auto', gap: 8, alignItems: 'flex-end' }}>
          <div>
            <label style={{ fontSize: 10, color: T.sub, display: 'block', marginBottom: 3 }}>N° engin *</label>
            <input required placeholder="TK-010" value={f.numero} onChange={e => set('numero', e.target.value)} style={INP} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: T.sub, display: 'block', marginBottom: 3 }}>Modèle</label>
            <input placeholder="CAT 793F" value={f.modele} onChange={e => set('modele', e.target.value)} style={INP} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: T.sub, display: 'block', marginBottom: 3 }}>Zone assignée</label>
            <select value={f.zone_id} onChange={e => set('zone_id', e.target.value)} style={{ ...INP, cursor: 'pointer' }}>
              <option value="">— aucune —</option>
              {zones.map(z => <option key={z.id} value={z.id}>{z.code} — {z.nom}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 10, color: T.sub, display: 'block', marginBottom: 3 }}>Cap. (t)</label>
            <input type="number" value={f.capacite_t} onChange={e => set('capacite_t', e.target.value)} style={INP} />
          </div>
          <button type="submit" style={BTN}>Ajouter</button>
        </form>
      </div>

      <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead style={{ background: T.card }}>
            <tr style={{ color: T.sub }}>
              {['Numéro', 'Modèle', 'Zone', 'Capacité', 'Statut', ''].map(h => (
                <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 10, borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {engins.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: T.faint }}>aucun engin</td></tr>
            ) : engins.map(e => {
              const se = STATUT_ENGIN[e.statut] ?? { label: e.statut, color: T.sub };
              return (
                <tr key={e.id} style={{ borderBottom: `1px solid ${T.border2}` }}>
                  <td style={{ padding: '8px 12px', fontWeight: 700, color: T.text, fontFamily: 'monospace' }}>{e.numero}</td>
                  <td style={{ padding: '8px 12px', color: T.sub }}>{e.modele}</td>
                  <td style={{ padding: '8px 12px', color: '#3b82f6', fontFamily: 'monospace' }}>{e.zone_code ?? '—'}</td>
                  <td style={{ padding: '8px 12px', color: T.text }}>{e.capacite_t} t</td>
                  <td style={{ padding: '8px 12px' }}>
                    <select
                      value={e.statut}
                      onChange={async ev => { await api.editEngin(e.id, { ...e, statut: ev.target.value }); onRefresh(); }}
                      style={{ ...INP, width: 'auto', cursor: 'pointer', color: se.color, padding: '3px 6px' }}
                    >
                      {Object.entries(STATUT_ENGIN).map(([k, v]) => (
                        <option key={k} value={k}>{v.label}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <button onClick={async () => { if (confirm(`Supprimer ${e.numero} ?`)) { await api.delEngin(e.id); onRefresh(); } }}
                      style={{ padding: '3px 8px', fontSize: 10, border: '1px solid #ef444430', color: '#ef4444', background: 'none', borderRadius: 4, cursor: 'pointer' }}>✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
