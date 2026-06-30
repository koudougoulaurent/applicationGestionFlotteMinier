import { T } from '../constants';
import type { Stats } from '../types';

type View = 'terrain' | 'historique' | 'config';

interface Props {
  stats: Stats | null;
  view: View;
  onChangeView: (v: View) => void;
  onNewVoyage: () => void;
  onRefresh: () => void;
}

const NAV: { key: View; label: string }[] = [
  { key: 'terrain',    label: 'Terrain'       },
  { key: 'historique', label: 'Historique'    },
  { key: 'config',     label: 'Configuration' },
];

const KPI_DEFS = (s: Stats) => [
  { l: 'voyages/j', v: s.voyages_jour },
  { l: 'en route',  v: s.en_route,    c: '#3b82f6' },
  { l: 'au dump',   v: s.au_dump,     c: '#f97316' },
  { l: 'dispos',    v: s.dispos,      c: '#22c55e' },
  { l: 'tonnes/j',  v: `${Math.round(Number(s.tonnes_jour))} t` },
  { l: 'cycle moy', v: s.cycle_moyen_min > 0 ? `${Math.round(Number(s.cycle_moyen_min))} min` : '—' },
];

export default function Header({ stats, view, onChangeView, onNewVoyage, onRefresh }: Props) {
  return (
    <div style={{ borderBottom: `1px solid ${T.border}`, padding: '0 20px', display: 'flex', alignItems: 'center', gap: 16, height: 52, background: T.card, flexShrink: 0 }}>
      <span style={{ color: T.amber, fontWeight: 700, fontSize: 14, letterSpacing: 1, flexShrink: 0 }}>
        MINE TRACKER
      </span>
      <span style={{ color: T.border, userSelect: 'none' }}>|</span>

      {stats && (
        <div style={{ display: 'flex', gap: 16, fontSize: 12, flexWrap: 'wrap' }}>
          {KPI_DEFS(stats).map(s => (
            <span key={s.l} style={{ color: (s as { c?: string }).c ?? T.sub }}>
              {s.v}{' '}
              <span style={{ color: T.faint, fontSize: 10 }}>{s.l}</span>
            </span>
          ))}
        </div>
      )}

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={onNewVoyage}
          style={{ padding: '6px 14px', background: T.amber, color: '#000', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
        >
          + Nouveau voyage
        </button>

        {NAV.map(n => (
          <button
            key={n.key}
            onClick={() => onChangeView(n.key)}
            style={{
              padding: '5px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
              background: view === n.key ? T.border : 'none',
              color: view === n.key ? T.text : T.sub,
              border: `1px solid ${view === n.key ? '#3d4259' : 'transparent'}`,
            }}
          >
            {n.label}
          </button>
        ))}

        <button
          onClick={onRefresh}
          style={{ padding: '5px 9px', background: 'none', color: T.sub, border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 12, cursor: 'pointer' }}
          title="Actualiser"
        >
          ↻
        </button>
      </div>
    </div>
  );
}
