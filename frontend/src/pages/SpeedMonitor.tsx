/**
 * SpeedMonitor.tsx — Surveillance des vitesses et violations
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store';
import { speedApi } from '../lib/api';
import { IconSpeed, IconRefresh, IconAlert } from '../components/ui/Icons';

// ── Types ──────────────────────────────────────────────────────────────────────

interface SpeedViolation {
  violId:      string;
  fleetNumber: string;
  roadName:    string;
  detectedAt:  string;
  speedKmh:    number;
  limitKmh:    number;
  excessPct:   number;
  severity:    'WARNING' | 'CRITICAL';
}

interface SpeedSummary {
  totalViolations: number;
  criticalCount:   number;
  byTruck: Array<{ fleetNumber: string; count: number; maxSpeed: number }>;
  byRoad:  Array<{ roadName: string; count: number; avgExcess: number }>;
}

interface RoadLimit {
  roadId:    string;
  name:      string;
  roadClass: string;
  limitKmh:  number;
}

// ── Composant principal ────────────────────────────────────────────────────────

export default function SpeedMonitor() {
  const { user } = useAuthStore();
  const siteId = user?.siteId || '';
  const params: Record<string, string> = siteId ? { siteId } : {};

  const [violations, setViolations] = useState<SpeedViolation[]>([]);
  const [summary,    setSummary]    = useState<SpeedSummary | null>(null);
  const [limits,     setLimits]     = useState<RoadLimit[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [violRes, sumRes, limRes] = await Promise.all([
        speedApi.violations({ ...params, hours: '24' }),
        speedApi.summary(params),
        speedApi.limits(params),
      ]);
      setViolations((violRes.data as SpeedViolation[]) || []);
      setSummary(sumRes.data as SpeedSummary);
      setLimits((limRes.data as RoadLimit[]) || []);
    } catch {
      setError('Erreur de chargement des données de vitesse');
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => { load(); }, [load]);

  // Camion le plus fautif
  const topOffender = summary?.byTruck.sort((a, b) => b.count - a.count)[0];
  // Tronçon le plus dangereux
  const topRoad = summary?.byRoad.sort((a, b) => b.count - a.count)[0];

  return (
    <div className="flex flex-col gap-4 p-4">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <IconSpeed size={20} className="text-amber-400" />
            Contrôle Vitesse
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">Violations de vitesse — 24 dernières heures</p>
        </div>
        <button onClick={load} className="p-2 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors">
          <IconRefresh size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-950/50 border border-red-700/40 rounded text-xs text-red-400">
          <IconAlert size={13} />{error}
        </div>
      )}

      {/* Compteurs */}
      {loading && !summary ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-[#0f1e30] border border-[#1a2740] rounded-xl p-4 animate-pulse">
              <div className="h-8 bg-slate-800 rounded mb-2" />
              <div className="h-3 bg-slate-800 rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : summary ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-[#0f1e30] border border-[#1a2740] rounded-xl p-4">
            <div className="text-2xl font-bold text-amber-400">{summary.totalViolations}</div>
            <div className="text-xs text-slate-400 mt-1">Total violations</div>
          </div>
          <div className="bg-[#0f1e30] border border-red-700/30 rounded-xl p-4">
            <div className="text-2xl font-bold text-red-400">{summary.criticalCount}</div>
            <div className="text-xs text-slate-400 mt-1">Violations critiques</div>
          </div>
          <div className="bg-[#0f1e30] border border-[#1a2740] rounded-xl p-4">
            <div className="text-lg font-bold text-white font-mono truncate">{topOffender?.fleetNumber ?? '—'}</div>
            <div className="text-xs text-slate-400 mt-1">
              Camion le plus fautif
              {topOffender && <span className="ml-1 text-red-400">({topOffender.count} viol.)</span>}
            </div>
          </div>
          <div className="bg-[#0f1e30] border border-[#1a2740] rounded-xl p-4">
            <div className="text-sm font-bold text-white truncate">{topRoad?.roadName ?? '—'}</div>
            <div className="text-xs text-slate-400 mt-1">
              Tronçon le plus dangereux
              {topRoad && <span className="ml-1 text-amber-400">({topRoad.count} viol.)</span>}
            </div>
          </div>
        </div>
      ) : null}

      {/* Tableau violations récentes */}
      <div className="bg-[#0f1e30] border border-[#1a2740] rounded-xl p-4">
        <h2 className="text-sm font-semibold text-slate-300 mb-3">Violations récentes — 24h</h2>
        {violations.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <span className="text-2xl">✓</span>
            <p className="text-sm text-emerald-400">Aucune violation détectée</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#0a1628] text-slate-400 text-xs uppercase tracking-wider">
                  <th className="px-3 py-2 text-left">Heure</th>
                  <th className="px-3 py-2 text-left">Camion</th>
                  <th className="px-3 py-2 text-left">Route</th>
                  <th className="px-3 py-2 text-right">Vitesse</th>
                  <th className="px-3 py-2 text-right">Limite</th>
                  <th className="px-3 py-2 text-right">Dépassement</th>
                  <th className="px-3 py-2 text-center">Sévérité</th>
                </tr>
              </thead>
              <tbody>
                {violations.map(v => (
                  <tr key={v.violId} className="border-b border-[#1a2740] hover:bg-[#0f1e30]/50">
                    <td className="px-3 py-2 text-slate-400 text-xs">
                      {new Date(v.detectedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-3 py-2 font-mono text-white">{v.fleetNumber}</td>
                    <td className="px-3 py-2 text-slate-300 text-xs max-w-[120px] truncate">{v.roadName}</td>
                    <td className="px-3 py-2 text-right font-bold text-red-400">{v.speedKmh.toFixed(0)} km/h</td>
                    <td className="px-3 py-2 text-right text-slate-400">{v.limitKmh.toFixed(0)} km/h</td>
                    <td className="px-3 py-2 text-right text-orange-400">+{v.excessPct.toFixed(0)}%</td>
                    <td className="px-3 py-2 text-center">
                      <SeverityBadge severity={v.severity} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Classement par camion */}
        {summary && summary.byTruck.length > 0 && (
          <div className="bg-[#0f1e30] border border-[#1a2740] rounded-xl p-4">
            <h2 className="text-sm font-semibold text-slate-300 mb-3">Violations par camion</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#0a1628] text-slate-400 text-xs uppercase tracking-wider">
                    <th className="px-3 py-2 text-left">Camion</th>
                    <th className="px-3 py-2 text-right">Violations</th>
                    <th className="px-3 py-2 text-right">Vitesse max</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byTruck.sort((a, b) => b.count - a.count).map(t => (
                    <tr key={t.fleetNumber} className="border-b border-[#1a2740] hover:bg-[#0f1e30]/50">
                      <td className="px-3 py-2 font-mono text-white">{t.fleetNumber}</td>
                      <td className="px-3 py-2 text-right text-red-400 font-bold">{t.count}</td>
                      <td className="px-3 py-2 text-right text-orange-400">{t.maxSpeed.toFixed(0)} km/h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Limites de vitesse par route */}
        {limits.length > 0 && (
          <div className="bg-[#0f1e30] border border-[#1a2740] rounded-xl p-4">
            <h2 className="text-sm font-semibold text-slate-300 mb-3">Limites de vitesse par route</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#0a1628] text-slate-400 text-xs uppercase tracking-wider">
                    <th className="px-3 py-2 text-left">Route</th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-right">Limite km/h</th>
                  </tr>
                </thead>
                <tbody>
                  {limits.map(r => (
                    <tr key={r.roadId} className="border-b border-[#1a2740] hover:bg-[#0f1e30]/50">
                      <td className="px-3 py-2 text-slate-300 text-xs">{r.name}</td>
                      <td className="px-3 py-2 text-slate-400 text-xs">{r.roadClass}</td>
                      <td className="px-3 py-2 text-right text-amber-400 font-bold">{r.limitKmh}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Composants utilitaires ─────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: 'WARNING' | 'CRITICAL' }) {
  return severity === 'CRITICAL' ? (
    <span className="px-2 py-0.5 text-[10px] font-bold bg-red-950/60 text-red-400 border border-red-700/50 rounded">
      CRITICAL
    </span>
  ) : (
    <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-950/60 text-amber-400 border border-amber-700/50 rounded">
      WARNING
    </span>
  );
}
