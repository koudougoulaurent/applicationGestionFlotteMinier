import { useEffect, useState } from 'react';
import { T, MINERAL, DUMP_TYPE, MATERIAUX } from '../constants';
import { api } from '../api';
import type { Zone, Engin } from '../types';

interface Props {
  zones: Zone[];
  defaultZoneId?: number;
  onClose: () => void;
  onSaved: () => void;
}

const now = () => {
  const d = new Date(); d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16);
};

const INP: React.CSSProperties = {
  width: '100%', padding: '7px 10px', background: T.bg,
  border: `1px solid ${T.border}`, borderRadius: 5, fontSize: 12,
  color: T.text, outline: 'none', boxSizing: 'border-box',
};

function Lbl({ children }: { children: React.ReactNode }) {
  return <label style={{ fontSize: 10, color: T.sub, display: 'block', marginBottom: 4 }}>{children}</label>;
}

export default function VoyageModal({ zones, defaultZoneId, onClose, onSaved }: Props) {
  const [step,   setStep]   = useState<'zone' | 'form'>(defaultZoneId ? 'form' : 'zone');
  const [zone,   setZone]   = useState<Zone | null>(zones.find(z => z.id === defaultZoneId) ?? null);
  const [engins, setEngins] = useState<Engin[]>([]);
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');

  const [f, setF] = useState({
    engin_id: '', dump_id: '', operateur: '', type_materiau: '',
    payload_t: '', shift: new Date().getHours() < 18 ? 'J' : 'N',
    heure_depart: now(), notes: '',
  });
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  // Pré-remplir quand la zone change
  useEffect(() => {
    if (!zone) return;
    setF(p => ({
      ...p,
      dump_id: zone.dumps[0]?.id?.toString() ?? '',
      type_materiau: MATERIAUX[zone.type_minerai]?.[0] ?? '',
    }));
    api.engins(zone.id).then((list: Engin[]) => {
      setEngins(list);
      const dispo = list.find(e => e.statut === 'DISPONIBLE');
      if (dispo) setF(p => ({ ...p, engin_id: String(dispo.id) }));
    });
  }, [zone]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!zone) return;
    if (!f.engin_id) { setErr('Sélectionner un engin'); return; }
    if (!f.dump_id)  { setErr('Sélectionner un lieu de déchargement'); return; }
    setSaving(true); setErr('');
    try {
      await api.addVoyage({
        engin_id:     Number(f.engin_id),
        zone_id:      zone.id,
        dump_id:      Number(f.dump_id),
        operateur:    f.operateur    || null,
        type_materiau:f.type_materiau || null,
        payload_t:    f.payload_t    ? Number(f.payload_t) : null,
        shift:        f.shift,
        heure_depart: new Date(f.heure_depart).toISOString(),
        notes:        f.notes        || null,
      });
      onSaved();
    } catch {
      setErr('Erreur réseau');
    } finally {
      setSaving(false);
    }
  };

  const dispos  = engins.filter(e => e.statut === 'DISPONIBLE');
  const occupes = engins.filter(e => e.statut !== 'DISPONIBLE');
  const selDump  = zone?.dumps.find(d => d.id === Number(f.dump_id));
  const selEngin = engins.find(e => e.id === Number(f.engin_id));
  const mc = zone ? (MINERAL[zone.type_minerai]?.color ?? T.sub) : T.sub;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(0,0,0,.75)' }}>
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, width: '100%', maxWidth: step === 'zone' ? 700 : 500, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.6)' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${T.border}`, position: 'sticky', top: 0, background: T.card }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {step === 'form' && !defaultZoneId && (
              <button onClick={() => setStep('zone')} style={{ padding: '3px 8px', background: 'none', border: `1px solid ${T.border}`, color: T.sub, borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>
                ← retour
              </button>
            )}
            <span style={{ color: T.text, fontWeight: 600, fontSize: 13 }}>
              {step === 'zone' ? 'Zone de chargement' : 'Nouveau voyage'}
            </span>
            {step === 'form' && zone && (
              <span style={{ color: mc, fontSize: 12 }}>— {zone.code}</span>
            )}
          </div>
          <button onClick={onClose} style={{ padding: '3px 8px', background: 'none', border: `1px solid ${T.border}`, color: T.sub, borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>
            ✕ fermer
          </button>
        </div>

        {/* ÉTAPE 1 : Sélection zone */}
        {step === 'zone' && (
          <div style={{ padding: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 8 }}>
            {zones.map(z => {
              const m = MINERAL[z.type_minerai] ?? { label: z.type_minerai, color: T.sub };
              return (
                <button key={z.id}
                  onClick={() => { setZone(z); setStep('form'); }}
                  style={{ textAlign: 'left', background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, padding: 12, cursor: 'pointer', outline: 'none', transition: 'border-color .15s' }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = m.color)}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = T.border)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <span style={{ fontSize: 18, fontWeight: 700, color: m.color, fontFamily: 'monospace' }}>{z.code}</span>
                    <span style={{ fontSize: 11, color: z.nb_dispos > 0 ? '#22c55e' : T.sub }}>
                      {z.nb_dispos} dispo{z.nb_dispos !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: T.sub, marginBottom: 5 }}>{z.nom}</div>

                  <div style={{ fontSize: 11, color: T.sub, marginBottom: 4 }}>
                    <span style={{ color: T.amber, fontWeight: 700, marginRight: 6 }}>LU</span>
                    {z.pelle_code
                      ? <><span style={{ color: z.pelle_statut === 'ACTIVE' ? '#22c55e' : '#ef4444', marginRight: 4 }}>●</span><span style={{ color: T.text }}>{z.pelle_code}</span><span style={{ marginLeft: 6, color: T.sub }}>{z.pelle_modele}</span></>
                      : <span style={{ color: T.faint, fontStyle: 'italic' }}>non assignée</span>
                    }
                  </div>

                  <div style={{ fontSize: 10, color: T.faint }}>
                    {z.dumps.length === 0
                      ? 'aucun dump lié'
                      : z.dumps.map(d => `${d.code} (${d.duree_min}min)`).join(' · ')
                    }
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* ÉTAPE 2 : Formulaire */}
        {step === 'form' && zone && (
          <form onSubmit={submit} style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Récap zone */}
            <div style={{ padding: '8px 12px', background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6 }}>
              <div style={{ display: 'flex', gap: 20, fontSize: 11 }}>
                <div>
                  <div style={{ color: T.faint, marginBottom: 1 }}>Zone</div>
                  <span style={{ color: mc, fontWeight: 700, fontFamily: 'monospace' }}>{zone.code}</span>
                  <span style={{ color: T.sub, marginLeft: 8 }}>{zone.nom}</span>
                </div>
                <div>
                  <div style={{ color: T.faint, marginBottom: 1 }}>LU</div>
                  {zone.pelle_code
                    ? <span style={{ color: T.amber }}>{zone.pelle_code} <span style={{ color: T.sub }}>{zone.pelle_modele}</span></span>
                    : <span style={{ color: T.faint }}>non assignée</span>
                  }
                </div>
                <div>
                  <div style={{ color: T.faint, marginBottom: 1 }}>Minerai</div>
                  <span style={{ color: mc }}>{MINERAL[zone.type_minerai]?.label ?? zone.type_minerai}</span>
                </div>
              </div>
            </div>

            {/* HU */}
            <div>
              <Lbl>HU — Engin à dispatcher *</Lbl>
              <select value={f.engin_id} onChange={e => set('engin_id', e.target.value)} style={{ ...INP, cursor: 'pointer' }}>
                <option value="">— sélectionner un engin —</option>
                {dispos.length > 0 && (
                  <optgroup label={`Disponibles (${dispos.length})`}>
                    {dispos.map(e => <option key={e.id} value={e.id}>{e.numero} — {e.modele} — {e.capacite_t} t</option>)}
                  </optgroup>
                )}
                {occupes.length > 0 && (
                  <optgroup label={`Occupés (${occupes.length})`}>
                    {occupes.map(e => <option key={e.id} value={e.id}>{e.numero} [{e.statut.replace(/_/g, ' ')}]</option>)}
                  </optgroup>
                )}
              </select>
              {selEngin && (
                <div style={{ fontSize: 10, color: T.faint, marginTop: 3 }}>
                  capacité {selEngin.capacite_t} t · {selEngin.modele}
                </div>
              )}
            </div>

            {/* Dump */}
            <div>
              <Lbl>Lieu de déchargement *</Lbl>
              <select value={f.dump_id} onChange={e => set('dump_id', e.target.value)} style={{ ...INP, cursor: 'pointer' }}>
                <option value="">— sélectionner —</option>
                {zone.dumps.map(d => {
                  const dt = DUMP_TYPE[d.type] ?? { label: d.type };
                  return <option key={d.id} value={d.id}>{d.code} — {d.nom} [{dt.label}] · {d.distance_km} km · {d.duree_min} min</option>;
                })}
              </select>
              {selDump && (
                <div style={{ fontSize: 10, color: T.faint, marginTop: 3 }}>
                  {selDump.distance_km} km · durée estimée {selDump.duree_min} min
                </div>
              )}
            </div>

            {/* Opérateur + Shift */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <Lbl>Opérateur (chauffeur)</Lbl>
                <input type="text" value={f.operateur} onChange={e => set('operateur', e.target.value)} placeholder="ex : Jean Mukendi" style={INP} />
              </div>
              <div>
                <Lbl>Shift</Lbl>
                <select value={f.shift} onChange={e => set('shift', e.target.value)} style={{ ...INP, cursor: 'pointer' }}>
                  <option value="J">Jour  06h – 18h</option>
                  <option value="N">Nuit  18h – 06h</option>
                </select>
              </div>
            </div>

            {/* Matériau + Payload */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <Lbl>Type de matériau</Lbl>
                <select value={f.type_materiau} onChange={e => set('type_materiau', e.target.value)} style={{ ...INP, cursor: 'pointer' }}>
                  {(MATERIAUX[zone.type_minerai] ?? []).map(m => <option key={m} value={m}>{m}</option>)}
                  <option value="">non spécifié</option>
                </select>
              </div>
              <div>
                <Lbl>Payload — charge nette (t)</Lbl>
                <input
                  type="number" min="0" max="400" step="0.5"
                  value={f.payload_t} onChange={e => set('payload_t', e.target.value)}
                  placeholder={`max ${selEngin?.capacite_t ?? 220} t`}
                  style={INP}
                />
              </div>
            </div>

            {/* Heure départ */}
            <div>
              <Lbl>Heure de départ</Lbl>
              <input type="datetime-local" value={f.heure_depart} onChange={e => set('heure_depart', e.target.value)} style={INP} />
            </div>

            {/* Notes */}
            <div>
              <Lbl>Notes</Lbl>
              <textarea
                value={f.notes} onChange={e => set('notes', e.target.value)}
                rows={2} placeholder="incident, observation, instruction…"
                style={{ ...INP, resize: 'none' }}
              />
            </div>

            {err && (
              <div style={{ padding: '7px 10px', background: '#1a0707', border: '1px solid #ef444430', borderRadius: 5, fontSize: 11, color: '#ef4444' }}>
                {err}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={onClose}
                style={{ flex: 1, padding: '8px', background: 'none', border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 12, color: T.sub, cursor: 'pointer' }}>
                Annuler
              </button>
              <button type="submit" disabled={saving}
                style={{ flex: 2, padding: '8px', background: saving ? '#78350f' : T.amber, border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, color: '#000', cursor: saving ? 'not-allowed' : 'pointer' }}>
                {saving ? 'enregistrement…' : '+ Enregistrer le voyage'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
