import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { kpiApi, cyclesApi, exportCsv } from '../lib/api';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell,
} from 'recharts';

export default function Reports() {
  const [tab, setTab] = useState<'availability' | 'cycles' | 'production'>('production');
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().slice(0, 10));

  const { data: availability = [] } = useQuery({
    queryKey: ['availability'],
    queryFn: async () => { const r = await kpiApi.availability({ from: `${dateFilter} 00:00`, to: `${dateFilter} 23:59` }); return r.data; },
    refetchInterval: 60_000,
  });

  const { data: cycleKpi = [] } = useQuery({
    queryKey: ['cycle-kpi'],
    queryFn: async () => { const r = await kpiApi.cycleTime(); return r.data; },
    refetchInterval: 60_000,
  });

  const { data: production = [] } = useQuery({
    queryKey: ['production'],
    queryFn: async () => { const r = await cyclesApi.productionSummary({ date: dateFilter }); return r.data; },
    refetchInterval: 60_000,
  });

  const COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#8b5cf6', '#ef4444', '#06b6d4'];

  const availData = (availability as Array<{
    fleet_number: string; category: string;
    utilization_pct: number; availability_pct: number;
    operating_s: number; down_s: number; idle_s: number;
  }>).map((a) => ({
    ...a,
    operating_h: Math.round((a.operating_s || 0) / 3600 * 10) / 10,
    down_h: Math.round((a.down_s || 0) / 3600 * 10) / 10,
    idle_h: Math.round((a.idle_s || 0) / 3600 * 10) / 10,
  }));

  const productionData = (production as Array<{
    source_name: string; dest_name: string; total_tonnes: number;
    total_cycles: number; avg_payload_t: number; avg_cycle_min: number;
  }>);

  const cycleData = (cycleKpi as Array<{
    fleet_number: string; cycles: number;
    avg_total_min: number; avg_queue_min: number; avg_load_min: number;
    avg_haul_min: number; avg_dump_min: number; avg_return_min: number;
    avg_payload_t: number; total_tonnes: number;
  }>);

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex items-center gap-4">
        <div className="flex gap-1 bg-mine-panel rounded-lg p-1">
          {([
            ['production', '📦 Production'],
            ['availability', '📊 Disponibilité'],
            ['cycles', '🔄 Cycles'],
          ] as const).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors
                ${tab === t ? 'bg-mine-accent text-black' : 'text-mine-muted hover:text-mine-text'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div>
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="bg-mine-bg border border-mine-border rounded-lg px-3 py-1.5 text-sm text-mine-text"
          />
        </div>
        <button
          onClick={() => {
            if (tab === 'availability') exportCsv(availData as unknown as Record<string, unknown>[], `disponibilite_${dateFilter}.csv`);
            else if (tab === 'cycles') exportCsv(cycleData as unknown as Record<string, unknown>[], `cycles_${dateFilter}.csv`);
            else exportCsv(productionData as unknown as Record<string, unknown>[], `production_${dateFilter}.csv`);
          }}
          className="btn-secondary text-sm ml-auto"
        >
          ↓ Exporter CSV
        </button>
      </div>

      {/* Production Tab */}
      {tab === 'production' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="card text-center">
              <div className="text-2xl font-bold font-mono text-mine-accent">
                {productionData.reduce((s, p) => s + parseFloat(String(p.total_tonnes || 0)), 0).toLocaleString('fr', { maximumFractionDigits: 0 })}
              </div>
              <div className="text-xs text-mine-muted mt-1">Tonnes Totales</div>
            </div>
            <div className="card text-center">
              <div className="text-2xl font-bold font-mono text-blue-400">
                {productionData.reduce((s, p) => s + parseInt(String(p.total_cycles || 0)), 0)}
              </div>
              <div className="text-xs text-mine-muted mt-1">Cycles Totaux</div>
            </div>
            <div className="card text-center">
              <div className="text-2xl font-bold font-mono text-green-400">
                {productionData.length > 0 ?
                  Math.round(productionData.reduce((s, p) => s + parseFloat(String(p.avg_payload_t || 0)), 0) / productionData.length)
                  : '—'} t
              </div>
              <div className="text-xs text-mine-muted mt-1">Payload Moyen</div>
            </div>
          </div>

          {productionData.length > 0 ? (
            <div className="card">
              <div className="card-header">Production par Flux (Source → Destination)</div>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={productionData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" />
                  <XAxis
                    dataKey="source_name"
                    stroke="#64748b"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v, i) => `${v} → ${productionData[i]?.dest_name || ''}`}
                  />
                  <YAxis stroke="#64748b" tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#111827', border: '1px solid #1e2d45', borderRadius: 8 }}
                    formatter={(v: unknown, name: string): [string, string] => {
                      if (name === 'total_tonnes') return [`${Number(v).toLocaleString('fr')} t`, 'Tonnes'];
                      if (name === 'total_cycles') return [`${String(v)} cycles`, 'Cycles'];
                      return [String(v), name];
                    }}
                  />
                  <Bar dataKey="total_tonnes" fill="#f59e0b" radius={[4, 4, 0, 0]} name="total_tonnes">
                    {productionData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="card text-center py-12 text-mine-muted">
              Aucune donnée de production pour cette date
            </div>
          )}
        </div>
      )}

      {/* Availability Tab */}
      {tab === 'availability' && (
        <div className="space-y-4">
          <div className="card">
            <div className="card-header">Utilisation et Disponibilité par Équipement</div>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={availData} margin={{ bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" />
                <XAxis dataKey="fleet_number" stroke="#64748b" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" />
                <YAxis stroke="#64748b" tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#111827', border: '1px solid #1e2d45', borderRadius: 8 }}
                />
                <Bar dataKey="utilization_pct" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Utilisation %" />
                <Bar dataKey="availability_pct" fill="#10b981" radius={[4, 4, 0, 0]} name="Disponibilité %" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="card">
            <div className="card-header">Détail des Heures</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-mine-border">
                    {['Équipement', 'Catégorie', 'En opération', 'Inactif', 'En panne', 'Utilisation', 'Disponibilité'].map((h) => (
                      <th key={h} className="text-left py-2.5 px-3 text-xs text-mine-muted font-medium uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {availData.map((a, i) => (
                    <tr key={i} className="table-row">
                      <td className="py-2.5 px-3 font-mono font-bold text-mine-accent text-sm">{a.fleet_number}</td>
                      <td className="py-2.5 px-3 text-xs text-mine-muted">{a.category}</td>
                      <td className="py-2.5 px-3 text-xs font-mono text-blue-400">{a.operating_h}h</td>
                      <td className="py-2.5 px-3 text-xs font-mono text-yellow-400">{a.idle_h}h</td>
                      <td className="py-2.5 px-3 text-xs font-mono text-red-400">{a.down_h}h</td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-mine-border rounded-full">
                            <div className="h-full bg-blue-500 rounded-full" style={{ width: `${a.utilization_pct || 0}%` }} />
                          </div>
                          <span className="text-xs font-mono w-10">{a.utilization_pct || 0}%</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`text-xs font-mono font-bold ${
                          (a.availability_pct || 0) >= 85 ? 'text-green-400' :
                          (a.availability_pct || 0) >= 70 ? 'text-yellow-400' : 'text-red-400'
                        }`}>
                          {a.availability_pct || 0}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Cycle Times Tab */}
      {tab === 'cycles' && (
        <div className="space-y-4">
          <div className="card">
            <div className="card-header">Analyse des Temps de Cycle par Camion</div>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={cycleData} margin={{ bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" />
                <XAxis dataKey="fleet_number" stroke="#64748b" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" />
                <YAxis stroke="#64748b" tick={{ fontSize: 11 }} unit="min" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#111827', border: '1px solid #1e2d45', borderRadius: 8 }}
                />
                <Bar dataKey="avg_queue_min"  stackId="a" fill="#64748b" name="File attente" />
                <Bar dataKey="avg_load_min"   stackId="a" fill="#8b5cf6" name="Chargement" />
                <Bar dataKey="avg_haul_min"   stackId="a" fill="#3b82f6" name="Transport" />
                <Bar dataKey="avg_dump_min"   stackId="a" fill="#10b981" name="Déchargement" />
                <Bar dataKey="avg_return_min" stackId="a" fill="#f59e0b" name="Retour" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Cycle detail table */}
          <div className="card">
            <div className="card-header">Détail des Cycles</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-mine-border">
                    {['Camion', 'Cycles', 'File', 'Charge', 'Transport', 'Dump', 'Retour', 'Total', 'Payload Moy', 'Total Tonnes'].map((h) => (
                      <th key={h} className="text-left py-2 px-2 text-mine-muted font-medium uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cycleData.map((c, i) => (
                    <tr key={i} className="table-row">
                      <td className="py-2 px-2 font-mono font-bold text-mine-accent">{c.fleet_number}</td>
                      <td className="py-2 px-2 font-mono text-center">{c.cycles}</td>
                      <td className="py-2 px-2 font-mono text-mine-muted">{c.avg_queue_min}m</td>
                      <td className="py-2 px-2 font-mono text-purple-400">{c.avg_load_min}m</td>
                      <td className="py-2 px-2 font-mono text-blue-400">{c.avg_haul_min}m</td>
                      <td className="py-2 px-2 font-mono text-green-400">{c.avg_dump_min}m</td>
                      <td className="py-2 px-2 font-mono text-mine-accent">{c.avg_return_min}m</td>
                      <td className="py-2 px-2 font-mono font-bold">{c.avg_total_min}m</td>
                      <td className="py-2 px-2 font-mono text-mine-accent">{c.avg_payload_t}t</td>
                      <td className="py-2 px-2 font-mono font-bold">{c.total_tonnes?.toLocaleString('fr')}t</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
