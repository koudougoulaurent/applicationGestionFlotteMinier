import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { telemetryApi } from '../lib/api';
import { TelemetryReading, WeatherReading } from '../types';
import { format, parseISO } from 'date-fns';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';

// ── Gauge Component ─────────────────────────────────────────────
interface GaugeProps { value: number; min: number; max: number; label: string; unit: string; warning?: number; critical?: number; }
function Gauge({ value, min, max, label, unit, warning, critical }: GaugeProps) {
  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
  const isCritical = critical !== undefined && value >= critical;
  const isWarning = warning !== undefined && value >= warning;
  const color = isCritical ? '#ef4444' : isWarning ? '#f59e0b' : '#22c55e';

  // Arc calculation
  const radius = 40;
  const cx = 60;
  const cy = 55;
  const startAngle = -210;
  const sweepAngle = 240;
  const angle = startAngle + (pct / 100) * sweepAngle;
  const rad = (a: number) => (a * Math.PI) / 180;
  const arcPath = (r: number, from: number, to: number) => {
    const large = Math.abs(to - from) > 180 ? 1 : 0;
    const x1 = cx + r * Math.cos(rad(from)); const y1 = cy + r * Math.sin(rad(from));
    const x2 = cx + r * Math.cos(rad(to));   const y2 = cy + r * Math.sin(rad(to));
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  };

  const needleX = cx + 32 * Math.cos(rad(angle));
  const needleY = cy + 32 * Math.sin(rad(angle));

  return (
    <div className="flex flex-col items-center">
      <svg width="120" height="80" viewBox="0 0 120 80">
        {/* Track */}
        <path d={arcPath(radius, startAngle, startAngle + sweepAngle)} fill="none" stroke="#1e2d45" strokeWidth="8" strokeLinecap="round" />
        {/* Fill */}
        <path d={arcPath(radius, startAngle, startAngle + (pct / 100) * sweepAngle)} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" />
        {/* Needle */}
        <line x1={cx} y1={cy} x2={needleX} y2={needleY} stroke={color} strokeWidth="2" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="4" fill={color} />
        {/* Value */}
        <text x={cx} y={cy + 16} textAnchor="middle" fill="white" fontSize="12" fontWeight="bold" fontFamily="monospace">
          {typeof value === 'number' ? value.toFixed(0) : '—'}
        </text>
        <text x={cx} y={cy + 26} textAnchor="middle" fill="#64748b" fontSize="8">{unit}</text>
      </svg>
      <div className="text-xs text-mine-muted mt-1 text-center">{label}</div>
    </div>
  );
}

// ── Equipment Card ─────────────────────────────────────────────
interface TelemetryCardProps { reading: TelemetryReading; onClick: () => void; }
function TelemetryCard({ reading, onClick }: TelemetryCardProps) {
  const statusColor: Record<string, string> = {
    OK: 'border-green-700 bg-green-900/10',
    WARNING: 'border-yellow-700 bg-yellow-900/10',
    CRITICAL: 'border-red-700 bg-red-900/10 animate-pulse',
  };
  const badgeCls: Record<string, string> = {
    OK: 'bg-green-900/40 text-green-300 border border-green-700',
    WARNING: 'bg-yellow-900/40 text-yellow-300 border border-yellow-700',
    CRITICAL: 'bg-red-900/40 text-red-300 border border-red-700',
  };

  const faultCodes = reading.fault_codes ? Object.keys(reading.fault_codes) : [];

  return (
    <button
      onClick={onClick}
      className={`card text-left border-l-4 hover:opacity-90 transition-opacity ${statusColor[reading.health_status] || ''}`}
    >
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="font-bold font-mono text-mine-accent">{reading.fleet_number}</div>
          <div className="text-xs text-mine-muted">{reading.category}</div>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded font-medium ${badgeCls[reading.health_status]}`}>
          {reading.health_status}
        </span>
      </div>

      {reading.event_time ? (
        <>
          <div className="grid grid-cols-2 gap-2 text-xs mb-3">
            {[
              { label: 'Temp. Moteur', value: reading.engine_temp_c, unit: '°C', warn: 95, crit: 105 },
              { label: 'Pression Huile', value: reading.oil_pressure, unit: 'bar', warn: 3, crit: 2 },
              { label: 'RPM Moteur', value: reading.engine_rpm, unit: 'tr/min', warn: 2200, crit: 2500 },
              { label: 'Carburant', value: reading.fuel_level_pct, unit: '%', warn: 20, crit: 10 },
            ].map(({ label, value, unit, crit }) => {
              const isCrit = crit !== undefined && value !== undefined &&
                (label === 'Pression Huile' ? value < crit : value > crit);
              return (
                <div key={label} className="bg-mine-bg rounded p-2">
                  <div className="text-mine-muted">{label}</div>
                  <div className={`font-mono font-bold ${isCrit ? 'text-red-400' : 'text-white'}`}>
                    {value !== null && value !== undefined ? `${Number(value).toFixed(0)} ${unit}` : '—'}
                  </div>
                </div>
              );
            })}
          </div>

          {faultCodes.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {faultCodes.slice(0, 3).map((fc) => (
                <span key={fc} className="bg-red-900/40 text-red-300 text-xs px-1.5 py-0.5 rounded border border-red-700">
                  {fc}
                </span>
              ))}
              {faultCodes.length > 3 && (
                <span className="text-xs text-mine-muted">+{faultCodes.length - 3}</span>
              )}
            </div>
          )}

          <div className="text-xs text-mine-muted mt-2">
            {format(parseISO(reading.event_time), 'HH:mm:ss')}
          </div>
        </>
      ) : (
        <div className="text-xs text-mine-muted py-2">Aucune donnée télémétrique</div>
      )}
    </button>
  );
}

// ── Equipment Detail Modal ─────────────────────────────────────
interface DetailModalProps { reading: TelemetryReading; onClose: () => void; }
function DetailModal({ reading, onClose }: DetailModalProps) {
  const [param, setParam] = useState<string>('engine_temp_c');
  const [hours, setHours] = useState<string>('4');

  const { data: history = [] } = useQuery<Array<{ event_time: string; value: number }>>({
    queryKey: ['telemetry-history', reading.equipment_id, param, hours],
    queryFn: async () => {
      const r = await telemetryApi.history(reading.equipment_id, { param, hours });
      return r.data;
    },
    refetchInterval: 30_000,
  });

  const PARAMS = [
    { key: 'engine_temp_c', label: 'Temp. Moteur (°C)', unit: '°C', warn: 95, crit: 105 },
    { key: 'oil_pressure', label: 'Pression Huile (bar)', unit: 'bar', warnLow: 3, critLow: 2 },
    { key: 'engine_rpm', label: 'RPM Moteur', unit: 'tr/min', warn: 2200, crit: 2500 },
    { key: 'fuel_level_pct', label: 'Niveau Carburant (%)', unit: '%', warnLow: 20, critLow: 10 },
    { key: 'coolant_temp_c', label: 'Temp. Liquide Refr. (°C)', unit: '°C', warn: 100, crit: 110 },
    { key: 'hydraulic_temp_c', label: 'Temp. Hydraulique (°C)', unit: '°C', warn: 85, crit: 95 },
    { key: 'brake_temp_c', label: 'Temp. Freins (°C)', unit: '°C', warn: 300, crit: 400 },
  ];

  const currentParam = PARAMS.find((p) => p.key === param) || PARAMS[0];
  const chartData = history.map((h) => ({
    time: format(parseISO(h.event_time), 'HH:mm'),
    value: Number(h.value),
  }));

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-mine-panel rounded-xl w-full max-w-3xl border border-mine-border shadow-2xl">
        <div className="flex justify-between items-center p-5 border-b border-mine-border">
          <div>
            <div className="text-lg font-bold font-mono text-mine-accent">{reading.fleet_number}</div>
            <div className="text-sm text-mine-muted">{reading.category} — Télémétrie en temps réel</div>
          </div>
          <button onClick={onClose} className="text-mine-muted hover:text-white">✕</button>
        </div>

        <div className="p-5 space-y-5">
          {/* Gauges */}
          <div className="flex justify-around flex-wrap gap-4 bg-mine-bg rounded-xl p-4">
            {[
              { value: reading.engine_temp_c, min: 0, max: 150, label: 'Temp. Moteur', unit: '°C', warning: 95, critical: 105 },
              { value: reading.engine_rpm, min: 0, max: 3000, label: 'RPM Moteur', unit: 'tr/min', warning: 2200, critical: 2500 },
              { value: reading.oil_pressure, min: 0, max: 10, label: 'Press. Huile', unit: 'bar', warning: 3, critical: 2 },
              { value: reading.fuel_level_pct, min: 0, max: 100, label: 'Carburant', unit: '%', warning: 20, critical: 10 },
              { value: reading.coolant_temp_c, min: 0, max: 150, label: 'Liquide Refr.', unit: '°C', warning: 100, critical: 110 },
            ].filter((g) => g.value !== null && g.value !== undefined).map((g) => (
              <Gauge key={g.label} {...g as Parameters<typeof Gauge>[0]} value={Number(g.value)} />
            ))}
          </div>

          {/* Historical chart */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold">Historique</div>
              <div className="flex gap-2">
                <select className="input text-xs" value={param} onChange={(e) => setParam(e.target.value)}>
                  {PARAMS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
                <select className="input text-xs" value={hours} onChange={(e) => setHours(e.target.value)}>
                  {['1', '4', '8', '12', '24'].map((h) => <option key={h} value={h}>{h}h</option>)}
                </select>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" />
                <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis stroke="#64748b" tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#111827', border: '1px solid #1e2d45', borderRadius: 8 }}
                  formatter={(v: unknown) => [`${Number(v).toFixed(1)} ${currentParam.unit}`, currentParam.label]}
                />
                {currentParam.warn && <ReferenceLine y={currentParam.warn} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'WARN', fill: '#f59e0b', fontSize: 10 }} />}
                {currentParam.crit && <ReferenceLine y={currentParam.crit} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'CRIT', fill: '#ef4444', fontSize: 10 }} />}
                <Line type="monotone" dataKey="value" stroke="#0ea5e9" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────
export default function Telemetry() {
  const [selected, setSelected] = useState<TelemetryReading | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'CRITICAL' | 'WARNING'>('ALL');

  const { data: fleet = [], isLoading } = useQuery<TelemetryReading[]>({
    queryKey: ['telemetry-fleet'],
    queryFn: async () => { const r = await telemetryApi.fleet(); return r.data; },
    refetchInterval: 15_000,
  });

  const { data: weatherData } = useQuery<{ latest: WeatherReading | null; history: WeatherReading[] }>({
    queryKey: ['weather'],
    queryFn: async () => { const r = await telemetryApi.weather(); return r.data; },
    refetchInterval: 300_000,
  });

  const weather = weatherData?.latest;

  const critCount  = fleet.filter((r) => r.health_status === 'CRITICAL').length;
  const warnCount  = fleet.filter((r) => r.health_status === 'WARNING').length;
  const noDataCount = fleet.filter((r) => !r.event_time).length;

  const shown = filter === 'ALL'      ? fleet
    : filter === 'CRITICAL' ? fleet.filter((r) => r.health_status === 'CRITICAL')
    : fleet.filter((r) => r.health_status === 'WARNING');

  return (
    <div className="space-y-5">
      {/* Summary + Weather */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Équipements', value: fleet.length, color: 'text-mine-accent' },
          { label: 'Critique', value: critCount, color: critCount > 0 ? 'text-red-400' : 'text-mine-muted' },
          { label: 'Avertissement', value: warnCount, color: warnCount > 0 ? 'text-yellow-400' : 'text-mine-muted' },
          { label: 'OK', value: fleet.length - critCount - warnCount - noDataCount, color: 'text-green-400' },
          { label: 'Sans données', value: noDataCount, color: 'text-mine-muted' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card">
            <div className="card-header">{label}</div>
            <div className={`text-2xl font-bold font-mono ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* Weather strip */}
      {weather && (
        <div className="bg-mine-panel border border-mine-border rounded-xl px-5 py-3 flex flex-wrap items-center gap-6">
          <div className="text-xs text-mine-muted font-semibold uppercase tracking-wide">Météo Mine</div>
          {[
            { label: '🌡', value: weather.temperature_c !== undefined ? `${weather.temperature_c}°C` : '—' },
            { label: '💧', value: weather.humidity_pct !== undefined ? `${weather.humidity_pct}%` : '—' },
            { label: '💨', value: weather.wind_speed_ms !== undefined ? `${(weather.wind_speed_ms * 3.6).toFixed(0)} km/h` : '—' },
            { label: '🌧', value: weather.rainfall_mm !== undefined ? `${weather.rainfall_mm} mm/h` : '—' },
            { label: '👁', value: weather.visibility_m !== undefined ? `${weather.visibility_m} m` : '—' },
            { label: '🟤', value: weather.dust_index !== undefined ? `Poussière ${weather.dust_index}/10` : '—' },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center gap-1.5 text-sm">
              <span>{label}</span>
              <span className="font-mono font-bold text-mine-accent">{value}</span>
            </div>
          ))}
          {weather.recorded_at && (
            <div className="ml-auto text-xs text-mine-muted">
              {format(parseISO(weather.recorded_at), 'HH:mm')}
            </div>
          )}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2">
        {([['ALL', 'Tous'], ['CRITICAL', `Critique (${critCount})`], ['WARNING', `Avertissement (${warnCount})`]] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === key
                ? key === 'CRITICAL' ? 'bg-red-700 text-white'
                : key === 'WARNING' ? 'bg-yellow-700 text-black'
                : 'bg-mine-accent text-black'
                : 'text-mine-muted hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
        <div className="ml-auto text-xs text-mine-muted self-center flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          Mise à jour auto 15s
        </div>
      </div>

      {/* Fleet grid */}
      {isLoading ? (
        <div className="text-center py-12 text-mine-muted">Chargement de la télémétrie...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {shown.map((r) => (
            <TelemetryCard key={r.equipment_id} reading={r} onClick={() => setSelected(r)} />
          ))}
        </div>
      )}

      {selected && <DetailModal reading={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
