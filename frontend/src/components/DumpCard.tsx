import { T, DUMP_TYPE } from '../constants';
import type { Dump } from '../types';

export default function DumpCard({ dump }: { dump: Dump }) {
  const dt = DUMP_TYPE[dump.type] ?? { label: dump.type, color: T.sub };

  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '10px 12px', borderBottom: `1px solid ${T.border}` }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 3 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: dt.color, fontFamily: 'monospace' }}>{dump.code}</span>
          <span style={{ fontSize: 10, color: dt.color }}>{dt.label}</span>
        </div>
        <div style={{ fontSize: 11, color: T.sub }}>{dump.nom}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
        <Stat label="présents" value={dump.camions_presents} color={dump.camions_presents > 0 ? '#f97316' : T.faint} />
        <Stat label="tonnes/j"  value={`${Math.round(Number(dump.tonnes_recues_jour))} t`} color={T.text} border />
        <Stat label="voyages"   value={dump.voyages_jour} color={T.text} border />
      </div>
    </div>
  );
}

function Stat({ label, value, color, border }: {
  label: string; value: string | number; color: string; border?: boolean;
}) {
  return (
    <div style={{ padding: '8px 10px', textAlign: 'center', borderLeft: border ? `1px solid ${T.border}` : 'none' }}>
      <div style={{ fontWeight: 700, color, fontSize: 14 }}>{value}</div>
      <div style={{ fontSize: 9, color: T.faint }}>{label}</div>
    </div>
  );
}
