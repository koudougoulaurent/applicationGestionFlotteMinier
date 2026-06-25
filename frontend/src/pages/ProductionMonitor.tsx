/**
 * ProductionMonitor.tsx — Suivi production temps-réel vs objectif de poste
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store';
import { productionApi } from '../lib/api';
import { IconProduction2, IconRefresh, IconAlert, IconTruck } from '../components/ui/Icons';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ProductionKPI {
  currentTonnes:   number;
  targetTonnes:    number;
  achievementPct:  number;
  remainingTonnes: number;
  projectedTonnes: number;
  totalCycles:     number;
  activeShift:     { shiftId: string; label: string; startTime: string; endTime: string } | null;
  elapsedHours:    number;
  remainingHours:  number;
  ratePerHour:     number;
}

interface HourlyData  { hour: string; tonnes: number; cycles: number }
interface TruckRank   { rank: number; fleetNumber: string; tonnes: number; cycles: number; efficiencyPct: number }
interface LoaderStats { loaderNumber: string; tonnes: number; trucks: number; productivity: number }

// ── Composant principal ────────────────────────────────────────────────────────

export default function ProductionMonitor() {
  const { user } = useAuthStore();
  const siteId = user?.siteId || '';

  const [kpi,         setKpi]         = useState<ProductionKPI | null>(null);
  const [hourly,      setHourly]      = useState<HourlyData[]>([]);
  const [trucks,      setTrucks]      = useState<TruckRank[]>([]);
  const [loaders,     setLoaders]     = useState<LoaderStats[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const params: Record<string, string> = siteId ? { siteId } : {};

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [kpiRes, hourlyRes, trucksRes, loadersRes] = await Promise.all([
        productionApi.kpi(params),
        productionApi.hourly(params),
        productionApi.trucks(params),
        productionApi.loaders(params),
      ]);
      setKpi(kpiRes.data as ProductionKPI);
      setHourly((hourlyRes.data as HourlyData[]) || []);
      setTrucks((trucksRes.data as TruckRank[]) || []);
      setLoaders((loadersRes.data as LoaderStats[]) || []);
      setLastRefresh(new Date());
    } catch {
      setError('Erreur de chargement des données de production');
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  const pct = kpi?.achievementPct ?? 0;
  const gaugeColor = pct >= 90 ? 'bg-emerald-500' : pct >= 75 ? 'bg-amber-500' : 'bg-red-500';
  const maxTonnes = Math.max(...hourly.map(h => h.tonnes), 1);

  return (
    <div className="flex flex-col gap-4 p-4">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <IconProduction2 size={20} className="text-amber-400" />
            Production Live
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Poste actif · Actualisation auto toutes les 30s
            {lastRefresh && <span className="ml-2 opacity-60">· {lastRefresh.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}
          </p>
        </div>
        <button
          onClick={load}
          className="p-2 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
          title="Rafraîchir"
        >
          <IconRefresh size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Erreur */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-950/50 border border-red-700/40 rounded text-xs text-red-400">
          <IconAlert size={13} />
          {error}
        </div>
      )}

      {/* KPI Cards */}
      {loading && !kpi ? (
        <KPISkeleton />
      ) : kpi ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Tonnes actuelles"   value={kpi.currentTonnes.toLocaleString('fr-FR')} unit="t"   color="text-amber-400" />
            <KpiCard label="Objectif poste"      value={kpi.targetTonnes.toLocaleString('fr-FR')}  unit="t"   color="text-slate-300" />
            <KpiCard label="Avancement"          value={`${pct.toFixed(1)}`}                       unit="%"   color={pct >= 90 ? 'text-emerald-400' : pct >= 75 ? 'text-amber-400' : 'text-red-400'} />
            <KpiCard label="Projection fin poste" value={kpi.projectedTonnes.toLocaleString('fr-FR')} unit="t" color="text-blue-400" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Cycles totaux"      value={kpi.totalCycles.toString()}            unit=""    color="text-purple-400" />
            <KpiCard label="Cadence actuelle"   value={kpi.ratePerHour.toFixed(1)}            unit="t/h" color="text-cyan-400" />
            <KpiCard label="Heures écoulées"    value={kpi.elapsedHours.toFixed(1)}           unit="h"   color="text-slate-300" />
            <KpiCard label="Heures restantes"   value={kpi.remainingHours.toFixed(1)}         unit="h"   color="text-slate-300" />
          </div>

          {/* Barre de progression */}
          <div className="bg-[#0f1e30] border border-[#1a2740] rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-400 font-medium">Progression vers l'objectif</span>
              <span className={`text-sm font-bold ${pct >= 90 ? 'text-emerald-400' : pct >= 75 ? 'text-amber-400' : 'text-red-400'}`}>
                {pct.toFixed(1)}%
              </span>
            </div>
            <div className="h-6 bg-[#0a1628] rounded-lg overflow-hidden relative">
              <div
                className={`h-full rounded-lg transition-all duration-700 ${gaugeColor}`}
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
              {pct >= 90 && (
                <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">
                  Objectif atteint !
                </span>
              )}
            </div>
            <div className="flex justify-between text-[10px] text-slate-500 mt-1">
              <span>0 t</span>
              <span>{kpi.remainingTonnes.toLocaleString('fr-FR')} t restantes</span>
              <span>{kpi.targetTonnes.toLocaleString('fr-FR')} t</span>
            </div>
            {kpi.activeShift && (
              <div className="mt-2 text-xs text-slate-500">
                Poste : <span className="text-slate-300">{kpi.activeShift.label}</span>
                <span className="mx-2">·</span>
                {kpi.activeShift.startTime} → {kpi.activeShift.endTime}
              </div>
            )}
          </div>
        </>
      ) : null}

      {/* Graphique horaire — barres CSS */}
      <div className="bg-[#0f1e30] border border-[#1a2740] rounded-xl p-4">
        <h2 className="text-sm font-semibold text-slate-300 mb-3">Production horaire (12 dernières heures)</h2>
        {hourly.length === 0 ? (
          <EmptyState message="Aucune donnée horaire disponible" />
        ) : (
          <div className="flex items-end gap-1 h-32 overflow-x-auto">
            {hourly.map((h, i) => {
              const barH = maxTonnes > 0 ? Math.round((h.tonnes / maxTonnes) * 100) : 0;
              return (
                <div key={i} className="flex flex-col items-center gap-1 flex-1 min-w-[28px]">
                  <div className="relative w-full flex justify-center group" style={{ height: '100px' }}>
                    <div
                      className="absolute bottom-0 w-full bg-amber-500/70 hover:bg-amber-400 rounded-t transition-colors"
                      style={{ height: `${barH}%` }}
                      title={`${h.hour} : ${h.tonnes.toFixed(0)} t · ${h.cycles} cycles`}
                    />
                    <span className="absolute -top-4 text-[9px] text-slate-500 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                      {h.tonnes.toFixed(0)} t
                    </span>
                  </div>
                  <span className="text-[9px] text-slate-600 truncate w-full text-center">{h.hour}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Classement camions */}
      <div className="bg-[#0f1e30] border border-[#1a2740] rounded-xl p-4">
        <h2 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
          <IconTruck size={14} className="text-amber-400" />
          Classement camions du poste
        </h2>
        {trucks.length === 0 ? (
          <EmptyState message="Aucun camion actif" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#0a1628] text-slate-400 text-xs uppercase tracking-wider">
                  <th className="px-3 py-2 text-left">Rang</th>
                  <th className="px-3 py-2 text-left">Camion</th>
                  <th className="px-3 py-2 text-right">Cycles</th>
                  <th className="px-3 py-2 text-right">Tonnes</th>
                  <th className="px-3 py-2 text-right">Efficacité</th>
                </tr>
              </thead>
              <tbody>
                {trucks.map(t => (
                  <tr key={t.rank} className="border-b border-[#1a2740] hover:bg-[#0f1e30]/50">
                    <td className="px-3 py-2">
                      <span className={`text-xs font-bold ${t.rank === 1 ? 'text-amber-400' : t.rank === 2 ? 'text-slate-300' : t.rank === 3 ? 'text-orange-400' : 'text-slate-500'}`}>
                        #{t.rank}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-white">{t.fleetNumber}</td>
                    <td className="px-3 py-2 text-right text-slate-300">{t.cycles}</td>
                    <td className="px-3 py-2 text-right text-amber-400 font-medium">{t.tonnes.toLocaleString('fr-FR')} t</td>
                    <td className="px-3 py-2 text-right">
                      <span className={`text-xs font-medium ${t.efficiencyPct >= 90 ? 'text-emerald-400' : t.efficiencyPct >= 75 ? 'text-amber-400' : 'text-red-400'}`}>
                        {t.efficiencyPct.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Tableau par pelle */}
      <div className="bg-[#0f1e30] border border-[#1a2740] rounded-xl p-4">
        <h2 className="text-sm font-semibold text-slate-300 mb-3">Productivité par pelle</h2>
        {loaders.length === 0 ? (
          <EmptyState message="Aucune pelle active" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#0a1628] text-slate-400 text-xs uppercase tracking-wider">
                  <th className="px-3 py-2 text-left">Pelle</th>
                  <th className="px-3 py-2 text-right">Tonnes</th>
                  <th className="px-3 py-2 text-right">Nb camions</th>
                  <th className="px-3 py-2 text-right">Productivité</th>
                </tr>
              </thead>
              <tbody>
                {loaders.map(l => (
                  <tr key={l.loaderNumber} className="border-b border-[#1a2740] hover:bg-[#0f1e30]/50">
                    <td className="px-3 py-2 font-mono text-white">{l.loaderNumber}</td>
                    <td className="px-3 py-2 text-right text-amber-400">{l.tonnes.toLocaleString('fr-FR')} t</td>
                    <td className="px-3 py-2 text-right text-slate-300">{l.trucks}</td>
                    <td className="px-3 py-2 text-right text-blue-400">{l.productivity.toFixed(1)} t/h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Composants utilitaires ─────────────────────────────────────────────────────

function KpiCard({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <div className="bg-[#0f1e30] border border-[#1a2740] rounded-xl p-4">
      <div className={`text-2xl font-bold ${color}`}>
        {value}<span className="text-sm font-normal ml-1 text-slate-500">{unit}</span>
      </div>
      <div className="text-xs text-slate-400 mt-1">{label}</div>
    </div>
  );
}

function KPISkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="bg-[#0f1e30] border border-[#1a2740] rounded-xl p-4 animate-pulse">
          <div className="h-8 bg-slate-800 rounded mb-2" />
          <div className="h-3 bg-slate-800 rounded w-2/3" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <IconAlert size={24} className="text-slate-700" />
      <p className="text-sm text-slate-500">{message}</p>
    </div>
  );
}
