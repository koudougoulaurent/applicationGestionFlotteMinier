import { useState } from 'react';
import { T } from '../../constants';
import type { Zone, Dump, Engin } from '../../types';
import ZonesConfig  from './ZonesConfig';
import DumpsConfig  from './DumpsConfig';
import EnginsConfig from './EnginsConfig';
import PellesConfig from './PellesConfig';

type Tab = 'zones' | 'dumps' | 'engins' | 'pelles';

interface Props {
  zones:  Zone[];
  dumps:  Dump[];
  engins: Engin[];
  onRefresh: () => void;
}

export default function ConfigView({ zones, dumps, engins, onRefresh }: Props) {
  const [tab, setTab] = useState<Tab>('zones');

  const tabs: { key: Tab; label: string }[] = [
    { key: 'zones',  label: `Zones (${zones.length})`  },
    { key: 'dumps',  label: `Dumps (${dumps.length})`  },
    { key: 'engins', label: `Engins HU (${engins.length})` },
    { key: 'pelles', label: 'Pelles LU' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, borderBottom: `1px solid ${T.border}`, paddingBottom: 12 }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              padding: '6px 14px', border: '1px solid', borderRadius: 5,
              fontSize: 11, cursor: 'pointer', background: 'none',
              borderColor: tab === t.key ? T.amber : T.border,
              color:       tab === t.key ? T.amber : T.sub,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'zones'  && <ZonesConfig  zones={zones}  dumps={dumps}  onRefresh={onRefresh} />}
      {tab === 'dumps'  && <DumpsConfig  dumps={dumps}              onRefresh={onRefresh} />}
      {tab === 'engins' && <EnginsConfig zones={zones} engins={engins} onRefresh={onRefresh} />}
      {tab === 'pelles' && <PellesConfig zones={zones}              onRefresh={onRefresh} />}
    </div>
  );
}
