import { useState } from 'react';
import { api } from '../api';
import type { Voyage } from '../types';

interface Props {
  zoneCode: string;
  dumpCode: string;
  voyages: Voyage[];  // voyages actifs filtrés pour cette route, passés par le parent
  onRefresh: () => void;
}

const STATUT_COLOR: Record<string, string> = {
  EN_ROUTE: '#3b82f6',
  AU_DUMP:  '#f97316',
  EN_RETOUR:'#8b5cf6',
};

function Truck({ v, onAuDump, onRetour }: { v: Voyage; onAuDump: () => void; onRetour: () => void }) {
  const [hover, setHover] = useState(false);
  const pct   = Math.min((v.elapsed_min / v.duree_estime_min) * 100, 92);
  const color = STATUT_COLOR[v.statut] ?? '#6b7280';
  const atDump = v.statut === 'AU_DUMP';

  return (
    <div
      className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 transition-all duration-1000 ease-linear"
      style={{ left: atDump ? '95%' : `${pct}%`, zIndex: hover ? 20 : 5 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Camion */}
      <div
        style={{
          width: 26, height: 18, borderRadius: 3, display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: 11, border: `1px solid ${color}`,
          background: `${color}18`, cursor: 'pointer', position: 'relative',
        }}
      >
        🚛
        {/* Pulse */}
        {v.statut === 'EN_ROUTE' && (
          <div style={{
            position: 'absolute', inset: -3, borderRadius: 5,
            border: `1px solid ${color}`, opacity: 0.3,
            animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
          }} />
        )}
      </div>

      {/* Tooltip */}
      {hover && (
        <div style={{
          position: 'absolute', bottom: 26, left: '50%', transform: 'translateX(-50%)',
          background: '#1a1d26', border: '1px solid #252a38', borderRadius: 6,
          padding: '8px 10px', minWidth: 160, maxWidth: 220,
          fontSize: 11, color: '#d4d8e2', boxShadow: '0 4px 16px rgba(0,0,0,.4)',
          pointerEvents: 'none', zIndex: 50,
        }}>
          <div style={{ fontWeight: 700, fontFamily: 'monospace', marginBottom: 4 }}>{v.engin}</div>
          <div style={{ color: '#6b7280', marginBottom: 2 }}>{v.engin_modele}</div>
          {v.payload_t && <div style={{ color: '#6b7280' }}>{v.payload_t} t · {v.type_materiau ?? '—'}</div>}
          {v.operateur && <div style={{ color: '#6b7280' }}>👷 {v.operateur}</div>}
          <div style={{ color: '#6b7280', marginTop: 3 }}>{Math.round(v.elapsed_min)} min écoulées</div>
          {/* Actions dans tooltip - on réactive pointer events */}
          <div style={{ display: 'flex', gap: 4, marginTop: 6, pointerEvents: 'auto' }}>
            {v.statut === 'EN_ROUTE' && (
              <button onClick={e => { e.stopPropagation(); onAuDump(); }}
                style={{ padding: '2px 8px', fontSize: 9, border: '1px solid #f9731640', color: '#f97316', background: 'none', borderRadius: 3, cursor: 'pointer' }}>
                au dump
              </button>
            )}
            {['EN_ROUTE','AU_DUMP'].includes(v.statut) && (
              <button onClick={e => { e.stopPropagation(); onRetour(); }}
                style={{ padding: '2px 8px', fontSize: 9, border: '1px solid #22c55e40', color: '#22c55e', background: 'none', borderRadius: 3, cursor: 'pointer' }}>
                terminé ✓
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function TransitRoad({ zoneCode, dumpCode, voyages, onRefresh }: Props) {
  const handleAuDump = async (id: number) => { await api.auDump(id);  onRefresh(); };
  const handleRetour = async (id: number) => { await api.retour(id);  onRefresh(); };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 32 }}>
      {/* Label zone */}
      <div style={{ width: 40, textAlign: 'right', flexShrink: 0 }}>
        <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'monospace', color: '#6b7280' }}>{zoneCode}</span>
      </div>

      {/* Route */}
      <div style={{ flex: 1, position: 'relative', height: '100%', display: 'flex', alignItems: 'center' }}>
        {/* Ligne */}
        <div style={{ position: 'absolute', left: 0, right: 0, height: 1, background: '#252a38' }} />
        {/* Marqueurs km */}
        {[25, 50, 75].map(p => (
          <div key={p} style={{ position: 'absolute', left: `${p}%`, top: '50%', transform: 'translateY(-50%)', width: 1, height: 6, background: '#1e2236' }} />
        ))}
        {/* Camions */}
        {voyages.map(v => (
          <Truck key={v.id} v={v}
            onAuDump={() => handleAuDump(v.id)}
            onRetour={() => handleRetour(v.id)} />
        ))}
        {voyages.length === 0 && (
          <span style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', fontSize: 9, color: '#1e2236', whiteSpace: 'nowrap' }}>
            aucun transit
          </span>
        )}
      </div>

      {/* Label dump */}
      <div style={{ width: 40, flexShrink: 0 }}>
        <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'monospace', color: '#6b7280' }}>{dumpCode}</span>
      </div>
    </div>
  );
}
