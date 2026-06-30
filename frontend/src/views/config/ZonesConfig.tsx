import { useState } from 'react';
import { T, MINERAL, DUMP_TYPE } from '../../constants';
import { api } from '../../api';
import type { Zone, Dump } from '../../types';

const INP: React.CSSProperties = {
  padding: '7px 10px', background: T.bg, border: `1px solid ${T.border}`,
  borderRadius: 5, fontSize: 11, color: T.text, outline: 'none',
  width: '100%', boxSizing: 'border-box',
};
const BTN: React.CSSProperties = {
  padding: '7px 14px', background: T.amber, border: 'none', borderRadius: 5,
  fontSize: 11, fontWeight: 700, color: '#000', cursor: 'pointer', whiteSpace: 'nowrap',
};
function Lbl({ children }: { children: React.ReactNode }) {
  return <label style={{ fontSize: 10, color: T.sub, display: 'block', marginBottom: 3 }}>{children}</label>;
}

interface Props { zones: Zone[]; dumps: Dump[]; onRefresh: () => void }

export default function ZonesConfig({ zones, dumps, onRefresh }: Props) {
  const [f, setF]    = useState({ code: '', nom: '', type_minerai: 'MINERAL_CUIVRE', capacite_queue: '4', couleur: 'blue' });
  const [links, setLinks] = useState<{ dump_id: string; distance_km: string; duree_min: string }[]>([]);
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  // Ajout lien dump sur zone existante
  const [linkZone, setLinkZone]         = useState('');
  const [linkDump,  setLinkDump]         = useState('');
  const [linkDist,  setLinkDist]         = useState('3');
  const [linkDur,   setLinkDur]          = useState('25');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await api.addZone(f);
    if (r?.id) {
      for (const l of links.filter(x => x.dump_id))
        await api.linkDump(r.id, { dump_id: Number(l.dump_id), distance_km: Number(l.distance_km) || 3, duree_min: Number(l.duree_min) || 25 });
    }
    setF({ code: '', nom: '', type_minerai: 'MINERAL_CUIVRE', capacite_queue: '4', couleur: 'blue' });
    setLinks([]); onRefresh();
  };

  const addLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkZone || !linkDump) return;
    await api.linkDump(Number(linkZone), { dump_id: Number(linkDump), distance_km: Number(linkDist) || 3, duree_min: Number(linkDur) || 25 });
    setLinkDump(''); setLinkDist('3'); setLinkDur('25'); onRefresh();
  };

  const unlink = async (zId: number, dId: number) => {
    await api.unlinkDump(zId, dId); onRefresh();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Créer une zone */}
      <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: '14px 16px' }}>
        <div style={{ color: T.sub, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Créer une zone de chargement</div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 180px 80px', gap: 8 }}>
            <div><Lbl>Code *</Lbl><input required placeholder="EX4" value={f.code} onChange={e => set('code', e.target.value)} style={INP} /></div>
            <div><Lbl>Nom *</Lbl><input required placeholder="Chantier Nord Fosse C" value={f.nom} onChange={e => set('nom', e.target.value)} style={INP} /></div>
            <div><Lbl>Type minerai</Lbl>
              <select value={f.type_minerai} onChange={e => set('type_minerai', e.target.value)} style={{ ...INP, cursor: 'pointer' }}>
                {Object.entries(MINERAL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div><Lbl>File max</Lbl><input type="number" min="1" max="20" value={f.capacite_queue} onChange={e => set('capacite_queue', e.target.value)} style={INP} /></div>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Lbl>Dumps liés (à la création)</Lbl>
              <button type="button" onClick={() => setLinks(p => [...p, { dump_id: '', distance_km: '3', duree_min: '25' }])}
                style={{ fontSize: 10, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer' }}>+ ajouter</button>
            </div>
            {links.map((l, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 28px', gap: 6, marginBottom: 5 }}>
                <select value={l.dump_id} onChange={e => setLinks(p => p.map((x, j) => j === i ? { ...x, dump_id: e.target.value } : x))} style={{ ...INP, cursor: 'pointer' }}>
                  <option value="">— dump —</option>
                  {dumps.map(d => <option key={d.id} value={d.id}>{d.code} — {d.nom}</option>)}
                </select>
                <input type="number" placeholder="km" value={l.distance_km} onChange={e => setLinks(p => p.map((x, j) => j === i ? { ...x, distance_km: e.target.value } : x))} style={INP} />
                <input type="number" placeholder="min" value={l.duree_min} onChange={e => setLinks(p => p.map((x, j) => j === i ? { ...x, duree_min: e.target.value } : x))} style={INP} />
                <button type="button" onClick={() => setLinks(p => p.filter((_, j) => j !== i))} style={{ background: 'none', border: `1px solid #ef444440`, color: '#ef4444', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>✕</button>
              </div>
            ))}
          </div>
          <div><button type="submit" style={BTN}>Créer la zone</button></div>
        </form>
      </div>

      {/* Liens zone→dump sur zones existantes */}
      <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: '14px 16px' }}>
        <div style={{ color: T.sub, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Lier un dump à une zone existante</div>
        <form onSubmit={addLink} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 70px 70px auto', gap: 8, alignItems: 'flex-end' }}>
          <div><Lbl>Zone</Lbl>
            <select value={linkZone} onChange={e => setLinkZone(e.target.value)} style={{ ...INP, cursor: 'pointer' }}>
              <option value="">— zone —</option>
              {zones.map(z => <option key={z.id} value={z.id}>{z.code} — {z.nom}</option>)}
            </select>
          </div>
          <div><Lbl>Dump</Lbl>
            <select value={linkDump} onChange={e => setLinkDump(e.target.value)} style={{ ...INP, cursor: 'pointer' }}>
              <option value="">— dump —</option>
              {dumps.map(d => <option key={d.id} value={d.id}>{d.code} — {d.nom}</option>)}
            </select>
          </div>
          <div><Lbl>Dist (km)</Lbl><input type="number" value={linkDist} onChange={e => setLinkDist(e.target.value)} style={INP} /></div>
          <div><Lbl>Durée (min)</Lbl><input type="number" value={linkDur} onChange={e => setLinkDur(e.target.value)} style={INP} /></div>
          <button type="submit" style={BTN}>Lier</button>
        </form>
      </div>

      {/* Liste zones */}
      <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
        {zones.length === 0 ? (
          <div style={{ padding: 24, color: T.faint, textAlign: 'center', fontSize: 11 }}>aucune zone</div>
        ) : zones.map((z, i) => {
          const mc = MINERAL[z.type_minerai]?.color ?? T.sub;
          return (
            <div key={z.id} style={{ padding: '10px 14px', borderBottom: i < zones.length - 1 ? `1px solid ${T.border2}` : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: z.dumps.length > 0 ? 6 : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ color: mc, fontWeight: 700, fontFamily: 'monospace', fontSize: 15, width: 44 }}>{z.code}</span>
                  <div>
                    <div style={{ color: T.text, fontSize: 12 }}>{z.nom}</div>
                    <div style={{ color: T.sub, fontSize: 10 }}>{MINERAL[z.type_minerai]?.label} · {z.nb_engins} engins · queue {z.capacite_queue}</div>
                  </div>
                </div>
                <button onClick={async () => { if (confirm(`Supprimer ${z.code} ?`)) { await api.delZone(z.id); onRefresh(); } }}
                  style={{ padding: '4px 10px', fontSize: 10, border: '1px solid #ef444430', color: '#ef4444', background: 'none', borderRadius: 4, cursor: 'pointer' }}>
                  supprimer
                </button>
              </div>
              {z.dumps.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingLeft: 54 }}>
                  {z.dumps.map(d => {
                    const dt = DUMP_TYPE[d.type] ?? { label: d.type, color: T.sub };
                    return (
                      <div key={d.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', background: T.bg, border: `1px solid ${T.border}`, borderRadius: 4, fontSize: 10 }}>
                        <span style={{ color: dt.color }}>▸</span>
                        <span style={{ color: T.text, fontFamily: 'monospace' }}>{d.code}</span>
                        <span style={{ color: T.sub }}>{d.distance_km}km · {d.duree_min}min</span>
                        <button onClick={() => unlink(z.id, d.id)}
                          style={{ marginLeft: 2, background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 10, padding: 0 }}>✕</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
