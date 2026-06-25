import { useQuery } from '@tanstack/react-query';
import { fuelApi } from '../lib/api';
import { FuelTransaction } from '../types';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';

export default function Fuel() {
  const { data: transactions = [], isLoading } = useQuery<FuelTransaction[]>({
    queryKey: ['fuel-transactions'],
    queryFn: async () => { const r = await fuelApi.transactions({ limit: '50' }); return r.data; },
    refetchInterval: 30_000,
  });

  const { data: summary } = useQuery({
    queryKey: ['fuel-summary'],
    queryFn: async () => { const r = await fuelApi.summary(); return r.data; },
  });

  const { data: stations = [] } = useQuery({
    queryKey: ['fuel-stations'],
    queryFn: async () => { const r = await fuelApi.stations(); return r.data; },
  });

  const byCategory: Record<string, number> = {};
  const byCategoryData = (summary?.byCategory || []) as Array<{
    category: string; total_liters: number; total_cost: number; equipment_count: number;
  }>;
  const dailyTrend = (summary?.dailyTrend || []) as Array<{
    fuel_date: string; total_liters: number; transactions: number;
  }>;

  byCategoryData.forEach((r) => { byCategory[r.category] = r.total_liters; });

  const totalLiters = byCategoryData.reduce((s, r) => s + parseFloat(String(r.total_liters || 0)), 0);
  const totalCost = byCategoryData.reduce((s, r) => s + parseFloat(String(r.total_cost || 0)), 0);

  const trendData = dailyTrend.map((d) => ({
    ...d,
    date: format(parseISO(d.fuel_date), 'dd/MM', { locale: fr }),
  }));

  return (
    <div className="space-y-5">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card">
          <div className="card-header">Consommation (30j)</div>
          <div className="text-2xl font-bold font-mono text-mine-accent">
            {totalLiters.toLocaleString('fr', { maximumFractionDigits: 0 })}
          </div>
          <div className="text-xs text-mine-muted">litres</div>
        </div>
        <div className="card">
          <div className="card-header">Coût Total (30j)</div>
          <div className="text-2xl font-bold font-mono text-orange-400">
            ${totalCost.toLocaleString('fr', { maximumFractionDigits: 0 })}
          </div>
          <div className="text-xs text-mine-muted">USD</div>
        </div>
        <div className="card">
          <div className="card-header">Stations Actives</div>
          <div className="text-2xl font-bold font-mono text-blue-400">
            {(stations as Array<object>).length}
          </div>
          <div className="text-xs text-mine-muted">stations carburant</div>
        </div>
        <div className="card">
          <div className="card-header">Transactions (30j)</div>
          <div className="text-2xl font-bold font-mono text-green-400">
            {dailyTrend.reduce((s, d) => s + parseInt(String(d.transactions || 0)), 0)}
          </div>
          <div className="text-xs text-mine-muted">ravitaillements</div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* By category */}
        <div className="card">
          <div className="card-header">Consommation par Catégorie</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={byCategoryData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" />
              <XAxis dataKey="category" stroke="#64748b" tick={{ fontSize: 11 }} />
              <YAxis stroke="#64748b" tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#111827', border: '1px solid #1e2d45', borderRadius: 8 }}
                formatter={(v: unknown) => [`${Number(v).toLocaleString('fr')} L`, 'Litres']}
              />
              <Bar dataKey="total_liters" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Litres" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Daily trend */}
        <div className="card">
          <div className="card-header">Tendance Journalière (30 jours)</div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" />
              <XAxis dataKey="date" stroke="#64748b" tick={{ fontSize: 10 }} interval={4} />
              <YAxis stroke="#64748b" tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#111827', border: '1px solid #1e2d45', borderRadius: 8 }}
              />
              <Line type="monotone" dataKey="total_liters" stroke="#f59e0b" strokeWidth={2} dot={false} name="Litres" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Tank levels */}
      {(stations as Array<{
        station_id: string; name: string; location_name: string;
        tank_capacity_l: number; current_level_l: number; fill_pct: number;
      }>).length > 0 && (
        <div className="card">
          <div className="card-header">Niveaux des Stations</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(stations as Array<{
              station_id: string; name: string; location_name: string;
              tank_capacity_l: number; current_level_l: number; fill_pct: number;
            }>).map((st) => (
              <div key={st.station_id} className="bg-mine-bg rounded-lg p-4">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <div className="font-semibold text-sm">{st.name}</div>
                    <div className="text-xs text-mine-muted">{st.location_name}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold font-mono text-mine-accent">{st.fill_pct}%</div>
                    <div className="text-xs text-mine-muted">plein</div>
                  </div>
                </div>
                <div className="h-3 bg-mine-border rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      st.fill_pct > 50 ? 'bg-green-500' : st.fill_pct > 20 ? 'bg-yellow-500' : 'bg-red-500'
                    }`}
                    style={{ width: `${st.fill_pct}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-mine-muted mt-1.5">
                  <span>{st.current_level_l?.toLocaleString('fr')} L restants</span>
                  <span>Capacité: {st.tank_capacity_l?.toLocaleString('fr')} L</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Transactions Table */}
      <div className="card">
        <div className="card-header">Dernières Transactions</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-mine-border">
                {['Équipement', 'Station', 'Opérateur', 'Date/Heure', 'Litres', 'Coût/L', 'Total'].map((h) => (
                  <th key={h} className="text-left py-2.5 px-3 text-xs text-mine-muted font-medium uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="text-center py-6 text-mine-muted">Chargement...</td></tr>
              ) : transactions.map((t) => (
                <tr key={t.transaction_id} className="table-row">
                  <td className="py-2.5 px-3 font-mono font-bold text-mine-accent text-sm">{t.fleet_number}</td>
                  <td className="py-2.5 px-3 text-xs text-mine-muted">{t.station_name || '—'}</td>
                  <td className="py-2.5 px-3 text-xs">{t.operator_name || '—'}</td>
                  <td className="py-2.5 px-3 text-xs font-mono text-mine-muted">
                    {format(parseISO(t.transaction_time), 'dd/MM HH:mm')}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-mine-accent">
                    {t.quantity_liters?.toLocaleString('fr')} L
                  </td>
                  <td className="py-2.5 px-3 text-xs font-mono text-mine-muted">
                    {t.unit_cost ? `$${Number(t.unit_cost).toFixed(3)}` : '—'}
                  </td>
                  <td className="py-2.5 px-3 font-mono font-bold">
                    {t.total_cost ? `$${t.total_cost?.toLocaleString('fr')}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
