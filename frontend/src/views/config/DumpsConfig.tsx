import { useState } from 'react';
import { T, DUMP_TYPE } from '../../constants';
import { api } from '../../api';
import type { Dump } from '../../types';

const INP: React.CSSProperties = {
  padding: '7px 10px', background: T.bg, border: `1px solid ${T.border}`,
  borderRadius: 5, fontSize: 11, color: T.text, outline: 'none',
  width: '100%', boxSizing: 'border-box',
};
const BTN: React.CSSProperties = {
  padding: '7px 14px', background: T.amber, border: 'none', borderRadius: 5,
  fontSize: 11, fontWeight: 700, color: '#000', cursor: 'pointer', whiteSpace: 'nowrap',
};

export default function DumpsConfig({ dumps, onRefresh }: { dumps: Dump[]; onRefresh: () => void }) {
  const [f, setF] = useState({ code: '', nom: '', type: 'DUMP' });
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); await api.addDump(f);
    setF({ code: '', nom: '', type: 'DUMP' }); onRefresh();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: '14px 16px' }}>
        <div style={{ color: T.sub, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Ajouter un point de décharge</div>
        <form onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 160px auto', gap: 8, alignItems: 'flex-end' }}>
          <div>
            <label style={{ fontSize: 10, color: T.sub, display: 'block', marginBottom: 3 }}>Code *</label>
            <input required placeholder="DP-03" value={f.code} onChange={e => set('code', e.target.value)} style={INP} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: T.sub, display: 'block', marginBottom: 3 }}>Nom *</label>
            <input required placeholder="Dump Stériles Sud" value={f.nom} onChange={e => set('nom', e.target.value)} style={INP} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: T.sub, display: 'block', marginBottom: 3 }}>Type</label>
            <select value={f.type} onChange={e => set('type', e.target.value)} style={{ ...INP, cursor: 'pointer' }}>
              {Object.entries(DUMP_TYPE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <button type="submit" style={BTN}>Créer</button>
        </form>
      </div>

      <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
        {dumps.length === 0 ? (
          <div style={{ padding: 24, color: T.faint, textAlign: 'center', fontSize: 11 }}>aucun dump</div>
        ) : dumps.map((d, i) => {
          const dt = DUMP_TYPE[d.type] ?? { label: d.type, color: T.sub };
          return (
            <div key={d.id} style={{ padding: '10px 14px', borderBottom: i < dumps.length - 1 ? `1px solid ${T.border2}` : 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ color: dt.color, fontWeight: 700, fontFamily: 'monospace', fontSize: 14, width: 50 }}>{d.code}</span>
                <div>
                  <div style={{ color: T.text, fontSize: 12 }}>{d.nom}</div>
                  <div style={{ fontSize: 10, color: dt.color }}>{dt.label}</div>
                </div>
              </div>
              <button onClick={async () => { if (confirm(`Supprimer ${d.code} ?`)) { await api.delDump(d.id); onRefresh(); } }}
                style={{ padding: '4px 10px', fontSize: 10, border: '1px solid #ef444430', color: '#ef4444', background: 'none', borderRadius: 4, cursor: 'pointer' }}>
                supprimer
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
