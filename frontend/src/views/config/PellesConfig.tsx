import { useEffect, useState } from 'react';
import { T } from '../../constants';
import { api } from '../../api';
import type { Pelle, Zone } from '../../types';

const INP: React.CSSProperties = {
  padding: '7px 10px', background: T.bg, border: `1px solid ${T.border}`,
  borderRadius: 5, fontSize: 11, color: T.text, outline: 'none',
  width: '100%', boxSizing: 'border-box',
};
const BTN: React.CSSProperties = {
  padding: '7px 14px', background: T.amber, border: 'none', borderRadius: 5,
  fontSize: 11, fontWeight: 700, color: '#000', cursor: 'pointer', whiteSpace: 'nowrap',
};

export default function PellesConfig({ zones, onRefresh }: { zones: Zone[]; onRefresh: () => void }) {
  const [pelles, setPelles] = useState<Pelle[]>([]);
  const [f, setF] = useState({ code: '', modele: 'CAT 6060', operateur: '' });
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  useEffect(() => { api.pelles().then(setPelles); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); await api.addPelle(f);
    setF({ code: '', modele: 'CAT 6060', operateur: '' });
    api.pelles().then(setPelles); onRefresh();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: '14px 16px' }}>
        <div style={{ color: T.sub, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Ajouter une pelle (LU — Load Unit)</div>
        <form onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: '90px 160px 1fr auto', gap: 8, alignItems: 'flex-end' }}>
          <div>
            <label style={{ fontSize: 10, color: T.sub, display: 'block', marginBottom: 3 }}>Code *</label>
            <input required placeholder="PE-04" value={f.code} onChange={e => set('code', e.target.value)} style={INP} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: T.sub, display: 'block', marginBottom: 3 }}>Modèle</label>
            <input placeholder="CAT 6060" value={f.modele} onChange={e => set('modele', e.target.value)} style={INP} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: T.sub, display: 'block', marginBottom: 3 }}>Opérateur</label>
            <input placeholder="Nom du pelleteur" value={f.operateur} onChange={e => set('operateur', e.target.value)} style={INP} />
          </div>
          <button type="submit" style={BTN}>Ajouter</button>
        </form>
      </div>

      <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead style={{ background: T.card }}>
            <tr style={{ color: T.sub }}>
              {['Code', 'Modèle', 'Opérateur', 'Statut', 'Zone assignée', ''].map(h => (
                <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 10, borderBottom: `1px solid ${T.border}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pelles.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: T.faint }}>aucune pelle</td></tr>
            ) : pelles.map(p => {
              const zone = zones.find(z => z.pelle_id === p.id);
              return (
                <tr key={p.id} style={{ borderBottom: `1px solid ${T.border2}` }}>
                  <td style={{ padding: '8px 12px', fontWeight: 700, color: T.amber, fontFamily: 'monospace' }}>{p.code}</td>
                  <td style={{ padding: '8px 12px', color: T.sub }}>{p.modele}</td>
                  <td style={{ padding: '8px 12px', color: T.sub }}>{p.operateur ?? '—'}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{ color: p.statut === 'ACTIVE' ? '#22c55e' : '#ef4444', fontSize: 10 }}>● {p.statut}</span>
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    {zone
                      ? <span style={{ color: '#3b82f6', fontFamily: 'monospace' }}>{zone.code}</span>
                      : <span style={{ color: T.faint }}>non assignée</span>
                    }
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <button onClick={async () => { if (confirm(`Supprimer ${p.code} ?`)) { await api.delPelle(p.id); api.pelles().then(setPelles); onRefresh(); } }}
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
