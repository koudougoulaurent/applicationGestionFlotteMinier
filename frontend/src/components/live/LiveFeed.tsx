import { useLiveStore } from '../../store';

function timeAgo(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60)  return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

interface EventRowProps {
  color: string;
  badge: string;
  line1: string;
  line2?: string;
  ts: number;
}
function EventRow({ color, badge, line1, line2, ts }: EventRowProps) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-[#1a2740]/50 last:border-0">
      <div
        className="text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5"
        style={{ backgroundColor: color + '20', color, border: `1px solid ${color}40` }}
      >
        {badge}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] text-slate-200 truncate">{line1}</div>
        {line2 && <div className="text-[10px] text-slate-500">{line2}</div>}
      </div>
      <div className="text-[10px] text-slate-600 font-mono flex-shrink-0">{timeAgo(ts)}</div>
    </div>
  );
}

export default function LiveFeed({ maxItems = 12 }: { maxItems?: number }) {
  const cycles   = useLiveStore((s) => s.recentCycles);
  const fuels    = useLiveStore((s) => s.recentFuelEvents);
  const downs    = useLiveStore((s) => s.downEvents);
  const dispatch = useLiveStore((s) => s.dispatchEvents);

  type FeedItem = { ts: number; el: React.ReactNode; key: string };
  const items: FeedItem[] = [];

  cycles.forEach((c) => items.push({
    ts:  c.receivedAt,
    key: `cy-${c.cycle_id}`,
    el: (
      <EventRow
        color="#3b82f6"
        badge="CYCLE"
        line1={`${c.fleet_number} — ${c.payload_tonnes.toFixed(0)} t → ${c.dest_name}`}
        line2={`${c.source_name} · ${c.material_name || 'Minerai'} · ${Math.round((c.duration_s || 0) / 60)} min`}
        ts={c.receivedAt}
      />
    ),
  }));

  fuels.forEach((f) => items.push({
    ts:  f.receivedAt,
    key: `fu-${f.transaction_id}`,
    el: (
      <EventRow
        color="#f59e0b"
        badge="FUEL"
        line1={`${f.fleet_number} — ${f.quantity_liters.toLocaleString('fr', { maximumFractionDigits: 0 })} L`}
        line2={f.total_cost ? `$${Number(f.total_cost).toFixed(2)}` : undefined}
        ts={f.receivedAt}
      />
    ),
  }));

  downs.forEach((d) => items.push({
    ts:  d.receivedAt,
    key: `dn-${d.equipment_id}-${d.receivedAt}`,
    el: (
      <EventRow
        color={d.new_status === 'DOWN' ? '#ef4444' : '#f97316'}
        badge={d.new_status}
        line1={`${d.fleet_number} — ${d.previous_status} → ${d.new_status}`}
        line2={d.reason || undefined}
        ts={d.receivedAt}
      />
    ),
  }));

  dispatch.forEach((da) => items.push({
    ts:  da.receivedAt,
    key: `da-${da.assignment_id}`,
    el: (
      <EventRow
        color="#22c55e"
        badge="DISPATCH"
        line1={`${da.fleet_number} → ${da.dest_name}`}
        line2={`${da.source_name}${da.material_name ? ' · ' + da.material_name : ''}`}
        ts={da.receivedAt}
      />
    ),
  }));

  const sorted = items.sort((a, b) => b.ts - a.ts).slice(0, maxItems);

  if (sorted.length === 0) {
    return (
      <div className="text-center py-8 text-slate-600 text-[12px]">
        En attente d'événements temps réel...
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {sorted.map((item) => (
        <div key={item.key}>{item.el}</div>
      ))}
    </div>
  );
}
