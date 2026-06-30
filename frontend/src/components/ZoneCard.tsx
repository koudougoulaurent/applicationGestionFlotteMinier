import { T, MINERAL, DUMP_TYPE } from '../constants';
import type { Zone } from '../types';

interface Props {
  zone: Zone;
  onDispatch: () => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '6px 12px', borderBottom: `1px solid ${T.border}`, fontSize: 11 }}>
      <span style={{ color: T.faint, fontSize: 10, width: 88, flexShrink: 0, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
      <span style={{ flex: 1 }}>{children}</span>
    </div>
  );
}

export default function ZoneCard({ zone, onDispatch }: Props) {
  const min    = MINERAL[zone.type_minerai] ?? { label: zone.type_minerai, color: T.sub };
  const active = zone.pelle_statut === 'ACTIVE';
  const luColor = zone.pelle_code ? (active ? '#22c55e' : '#ef4444') : T.faint;

  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>

      {/* ── LU — entité principale ── */}
      <div style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}`, background: `${luColor}08` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: T.amber, letterSpacing: 1 }}>LU</span>
          <span style={{ color: luColor }}>●</span>
          {zone.pelle_code ? (
            <span style={{ fontSize: 17, fontWeight: 700, color: T.text, fontFamily: 'monospace', letterSpacing: 1 }}>{zone.pelle_code}</span>
          ) : (
            <span style={{ fontSize: 13, color: T.faint, fontStyle: 'italic' }}>pelle non assignée</span>
          )}
          {zone.pelle_statut && zone.pelle_statut !== 'ACTIVE' && (
            <span style={{ fontSize: 9, color: '#ef4444', marginLeft: 4 }}>({zone.pelle_statut.replace(/_/g, ' ')})</span>
          )}
        </div>
        {zone.pelle_code && (
          <div style={{ display: 'flex', gap: 10, fontSize: 10, color: T.sub, paddingLeft: 34 }}>
            <span>{zone.pelle_modele}</span>
            {zone.pelle_operateur && <span style={{ color: T.faint }}>· {zone.pelle_operateur}</span>}
          </div>
        )}
      </div>

      {/* ── Attributs de la zone ── */}
      <Row label="Zone de chargement">
        <span style={{ color: min.color, fontFamily: 'monospace', fontWeight: 700 }}>{zone.code}</span>
        <span style={{ color: T.sub, marginLeft: 8, fontSize: 10 }}>{zone.nom}</span>
      </Row>

      <Row label="Type minerai">
        <span style={{ color: min.color }}>{min.label}</span>
        <span style={{ color: T.faint, fontSize: 10, marginLeft: 12 }}>file max {zone.capacite_queue} HU</span>
      </Row>

      <Row label="Déchargement">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {zone.dumps.length === 0 ? (
            <span style={{ color: T.faint, fontStyle: 'italic' }}>aucun dump configuré</span>
          ) : zone.dumps.map(d => {
            const dt = DUMP_TYPE[d.type] ?? { label: d.type, color: T.sub };
            return (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ color: dt.color }}>▸</span>
                <span style={{ color: T.text, fontFamily: 'monospace', fontWeight: 600, width: 46, flexShrink: 0 }}>{d.code}</span>
                <span style={{ color: T.sub, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.nom}</span>
                <span style={{ color: T.faint, fontSize: 10, whiteSpace: 'nowrap' }}>{d.distance_km}km · {d.duree_min}min</span>
              </div>
            );
          })}
        </div>
      </Row>

      {/* ── Statuts HU ── */}
      <div style={{ padding: '6px 12px', borderBottom: `1px solid ${T.border}`, display: 'flex', gap: 14, fontSize: 11 }}>
        <span style={{ color: '#22c55e' }}>{zone.nb_dispos} <span style={{ color: T.faint, fontSize: 10 }}>dispo</span></span>
        <span style={{ color: '#f59e0b' }}>{zone.nb_file} <span style={{ color: T.faint, fontSize: 10 }}>file</span></span>
        <span style={{ color: '#3b82f6' }}>{zone.nb_en_route} <span style={{ color: T.faint, fontSize: 10 }}>route</span></span>
        <span style={{ color: T.sub, marginLeft: 'auto', fontSize: 10 }}>{Math.round(Number(zone.tonnes_jour))} t/j</span>
      </div>

      {/* ── Dispatch ── */}
      <div style={{ padding: '8px 12px' }}>
        <button
          onClick={onDispatch}
          disabled={zone.nb_dispos === 0}
          style={{
            width: '100%', padding: '6px', borderRadius: 5, fontSize: 11,
            cursor: zone.nb_dispos > 0 ? 'pointer' : 'not-allowed',
            border: `1px solid ${zone.nb_dispos > 0 ? min.color : T.border}`,
            background: 'none',
            color: zone.nb_dispos > 0 ? min.color : T.faint,
          }}
        >
          {zone.nb_dispos > 0 ? `dispatch — ${zone.code}` : 'aucun HU disponible'}
        </button>
      </div>
    </div>
  );
}
