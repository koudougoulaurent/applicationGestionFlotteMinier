import { T, STATUT_ENGIN } from '../constants';
import type { Zone, Dump, Engin, Voyage } from '../types';
import ZoneCard   from '../components/ZoneCard';
import DumpCard   from '../components/DumpCard';
import VoyageCard from '../components/VoyageCard';
import TransitRoad from '../components/TransitRoad';

interface Props {
  zones:   Zone[];
  dumps:   Dump[];
  engins:  Engin[];
  actifs:  Voyage[];
  onRefresh: () => void;
  onDispatch: (zoneId?: number) => void;
}

export default function TerrainView({ zones, dumps, engins, actifs, onRefresh, onDispatch }: Props) {
  const routes = zones.flatMap(z => z.dumps.map(d => ({ zone: z, dump: d })));

  // Voyages filtrés par route, passés aux TransitRoad (évite les fetches multiples)
  const routeVoyages = (zoneId: number, dumpId: number) =>
    actifs.filter(v => v.zone_id === zoneId && v.dump_id === dumpId);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '290px 1fr 240px', gap: 14 }}>

      {/* ─── ZONES ─── */}
      <div>
        <Section title={`Zones de chargement (${zones.length})`} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {zones.map(z => (
            <ZoneCard key={z.id} zone={z} onDispatch={() => onDispatch(z.id)} />
          ))}
          {zones.length === 0 && (
            <Empty>Aucune zone — allez dans Configuration pour en créer une.</Empty>
          )}
        </div>
      </div>

      {/* ─── CENTRE : TRANSIT + ACTIFS ─── */}
      <div>
        {/* Transit */}
        <Section title="Transit" />
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
          <Legend />
          {routes.length === 0 ? (
            <Empty>Aucune route zone→dump configurée.</Empty>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
              {routes.map(({ zone: z, dump: d }) => (
                <TransitRoad
                  key={`${z.id}-${d.id}`}
                  zoneCode={z.code}
                  dumpCode={d.code}
                  voyages={routeVoyages(z.id, d.id)}
                  onRefresh={onRefresh}
                />
              ))}
            </div>
          )}
        </div>

        {/* Voyages actifs */}
        <Section title={`Voyages actifs (${actifs.length})`} />
        {actifs.length === 0 ? (
          <Empty>Aucun voyage en cours.</Empty>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {actifs.map(v => <VoyageCard key={v.id} voyage={v} onRefresh={onRefresh} />)}
          </div>
        )}
      </div>

      {/* ─── DUMPS + FLOTTE ─── */}
      <div>
        <Section title={`Points de décharge (${dumps.length})`} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {dumps.map(d => <DumpCard key={d.id} dump={d} />)}
          {dumps.length === 0 && <Empty>Aucun dump configuré.</Empty>}
        </div>

        <div style={{ marginTop: 16 }}>
          <Section title="Flotte HU" />
          <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: '10px 12px' }}>
            {Object.entries(STATUT_ENGIN).map(([k, { label, color }]) => {
              const count = engins.filter(e => e.statut === k).length;
              if (!count) return null;
              return (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11 }}>
                  <span style={{ color }}>● {label}</span>
                  <span style={{ color: T.text, fontWeight: 700 }}>{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title }: { title: string }) {
  return <div style={{ color: '#6b7280', fontSize: 11, marginBottom: 8, fontWeight: 600 }}>{title}</div>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ color: '#374151', fontSize: 11, padding: '12px 0', fontStyle: 'italic' }}>{children}</div>;
}
function Legend() {
  return (
    <div style={{ display: 'flex', gap: 14, fontSize: 10, color: '#6b7280', borderBottom: `1px solid ${T.border}`, paddingBottom: 8 }}>
      {[['#3b82f6','En route'],['#f97316','Au dump'],['#8b5cf6','Retour']].map(([c,l]) => (
        <span key={l}><span style={{ color: c as string }}>●</span> {l}</span>
      ))}
      <span style={{ marginLeft: 'auto', color: '#1e2236' }}>survol pour actions</span>
    </div>
  );
}
