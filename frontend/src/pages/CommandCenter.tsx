/**
 * CommandCenter.tsx
 * Écran principal de contrôle de la flotte minière.
 * Toutes les informations critiques en UN SEUL écran.
 *
 * Mise à jour automatique toutes les 5 secondes.
 * Connexion Socket.io pour les événements temps réel.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import apiDefault from '../lib/api';
import { simulationApi } from '../lib/api';
import { useAuthStore } from '../store';

// ── Types ──────────────────────────────────────────────────────────────────────

interface TruckState {
  fleetNumber:      string;
  phase:            string;
  phaseProgress:    number;
  fuelLevel_pct:    number;
  healthScore:      number;
  payloadTonnes:    number;
  cyclesThisShift:  number;
  tonnesThisShift:  number;
  status:           string;
}

interface BNRReading {
  stationCode:    string;
  stationName:    string;
  stabilityIndex: number | null;
  vibrationMms:   number | null;
  status:         string;
}

interface Violation {
  severity:    string;
  fleetNumber: string;
  speedKmh:    number;
  limitKmh:    number;
  excessPct:   number;
  timeLabel:   string;
}

interface MaintenanceRisk {
  fleetNumber: string;
  healthScore: number;
  rulHours:    number;
  action:      string;
}

interface Overview {
  simulation: {
    status:          string;
    speedMultiplier: number;
    uptime_s:        number;
    totalCycles:     number;
    totalTonnes:     number;
    trucks:          TruckState[];
  };
  fleet: {
    total: number; operational: number; down: number;
    inMaintenance: number; trucks: number; loaders: number;
  };
  production: {
    sessionCycles:  number;
    sessionTonnes:  number;
    targetTonnes:   number;
    targetCycles:   number;
    achievementPct: number;
    ratePerHour:    number;
  };
  safety: {
    violations2h: number; criticalCount: number; activeDelays: number;
    bnrStatus: string; bnrReadings: BNRReading[];
    recentViolations: Violation[];
    activeDelayList:  Array<{ fleetNumber: string; catCode: string; catLabel: string; durationMin: number }>;
  };
  maintenance: {
    maPct: number; urgentCount: number; risks: MaintenanceRisk[];
  };
  lastUpdated: string;
}

// ── Helpers visuels ────────────────────────────────────────────────────────────

const PHASE_LABELS: Record<string, string> = {
  IDLE:              'En attente',
  MOVING_TO_SOURCE:  'Vers pelle',
  QUEUING_AT_SOURCE: 'File pelle',
  LOADING:           'Chargement',
  HAULING:           'Transport',
  QUEUING_AT_DEST:   'File dump',
  DUMPING:           'Déversement',
  RETURNING:         'Retour vide',
  REFUELING:         'Ravitaillement',
  DOWN:              'En panne',
};

const PHASE_COLOR: Record<string, string> = {
  IDLE:              'bg-slate-600',
  MOVING_TO_SOURCE:  'bg-blue-500',
  QUEUING_AT_SOURCE: 'bg-yellow-500',
  LOADING:           'bg-orange-500',
  HAULING:           'bg-emerald-500',
  QUEUING_AT_DEST:   'bg-yellow-400',
  DUMPING:           'bg-purple-500',
  RETURNING:         'bg-cyan-500',
  REFUELING:         'bg-pink-500',
  DOWN:              'bg-red-600',
};

const BNR_COLOR: Record<string, string> = {
  NORMAL:   'text-emerald-400',
  WARNING:  'text-yellow-400',
  CRITICAL: 'text-red-400',
  NO_DATA:  'text-slate-500',
};

const BNR_DOT: Record<string, string> = {
  NORMAL:   'bg-emerald-400',
  WARNING:  'bg-yellow-400',
  CRITICAL: 'bg-red-400 animate-pulse',
  NO_DATA:  'bg-slate-500',
};

function fuelColor(pct: number) {
  if (pct < 20) return 'text-red-400';
  if (pct < 40) return 'text-yellow-400';
  return 'text-emerald-400';
}

function healthColor(score: number) {
  if (score < 60) return 'text-red-400';
  if (score < 80) return 'text-yellow-400';
  return 'text-slate-400';
}

function uptimeLabel(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

// ── Composant KPI Card ─────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, color = 'text-amber-400', alert = false,
}: {
  label: string; value: string | number; sub?: string;
  color?: string; alert?: boolean;
}) {
  return (
    <div className={`bg-[#0f1e30] rounded-xl p-3 border ${alert ? 'border-red-700/60' : 'border-[#1a2740]'}`}>
      <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

// ── Composant principal ────────────────────────────────────────────────────────

export default function CommandCenter() {
  const { user }                  = useAuthStore();
  const siteId                    = user?.siteId || '';
  const [data,    setData]        = useState<Overview | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error,   setError]       = useState('');
  const [simOp,   setSimOp]       = useState('');   // feedback opération simulation
  const pollRef                   = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Chargement de l'overview ─────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const { data: d } = await apiDefault.get<Overview>(`/overview?siteId=${siteId}`);
      setData(d);
      setError('');
    } catch {
      setError('Impossible de charger les données');
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 5000);   // mise à jour automatique toutes les 5s
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  // ── Contrôles simulation ─────────────────────────────────────────────────────
  const simControl = async (action: 'start' | 'stop' | 'pause' | 'resume', speed?: number) => {
    setSimOp(action);
    try {
      if (action === 'start')  await simulationApi.start({ siteId, speedMultiplier: speed ?? 5 });
      if (action === 'stop')   await simulationApi.stop();
      if (action === 'pause')  await simulationApi.pause();
      if (action === 'resume') await simulationApi.resume();
      if (speed !== undefined) await simulationApi.setSpeed(speed);
      setTimeout(load, 500);
    } catch { /* erreur silencieuse */ }
    finally { setSimOp(''); }
  };

  // ── Rendu ─────────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
      Chargement du Command Center…
    </div>
  );

  if (error) return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <div className="text-red-400 text-sm">{error}</div>
      <p className="text-[11px] text-slate-500">Le backend redémarre peut-être (ts-node-dev). Réessayez dans quelques secondes.</p>
      <button onClick={load} className="px-4 py-2 text-xs bg-amber-600 hover:bg-amber-500 text-black font-bold rounded transition-colors">
        ↺ Réessayer
      </button>
    </div>
  );

  if (!data) return null;

  const { simulation: sim, fleet, production, safety, maintenance } = data;
  const isRunning = sim.status === 'RUNNING';
  const isPaused  = sim.status === 'PAUSED';

  return (
    <div className="p-4 space-y-4 max-w-[1400px]">

      {/* ── En-tête ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">Command Center</h1>
          <p className="text-[11px] text-slate-500">
            Nchanga Open-Pit Mining · Mise à jour : {new Date(data.lastUpdated).toLocaleTimeString()}
          </p>
        </div>
        {/* Indicateur de statut */}
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border ${
          isRunning ? 'bg-emerald-900/40 border-emerald-600/40 text-emerald-400' :
          isPaused  ? 'bg-yellow-900/40 border-yellow-600/40 text-yellow-400'    :
                      'bg-slate-800 border-slate-700 text-slate-400'
        }`}>
          <span className={`w-2 h-2 rounded-full ${isRunning ? 'bg-emerald-400 animate-pulse' : isPaused ? 'bg-yellow-400' : 'bg-slate-500'}`} />
          {sim.status === 'RUNNING' ? `SIMULATION ×${sim.speedMultiplier} — ${uptimeLabel(sim.uptime_s)}` :
           sim.status === 'PAUSED'  ? 'SIMULATION EN PAUSE' : 'SIMULATION ARRÊTÉE'}
        </div>
      </div>

      {/* ── Barre de contrôle simulation ────────────────────────────────────── */}
      <div className="bg-[#0f1e30] border border-[#1a2740] rounded-xl p-3 flex flex-wrap items-center gap-3">
        <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Simulation</span>

        {!isRunning && !isPaused && (
          <button
            onClick={() => simControl('start')}
            disabled={simOp !== ''}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg disabled:opacity-50 transition-colors"
          >
            ▶ Démarrer
          </button>
        )}
        {isRunning && (
          <button
            onClick={() => simControl('pause')}
            disabled={simOp !== ''}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-600 hover:bg-yellow-500 text-white text-xs font-semibold rounded-lg disabled:opacity-50 transition-colors"
          >
            ⏸ Pause
          </button>
        )}
        {isPaused && (
          <button
            onClick={() => simControl('resume')}
            disabled={simOp !== ''}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg disabled:opacity-50 transition-colors"
          >
            ▶ Reprendre
          </button>
        )}
        {(isRunning || isPaused) && (
          <button
            onClick={() => simControl('stop')}
            disabled={simOp !== ''}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-700/60 hover:bg-red-600/60 text-red-300 text-xs font-semibold rounded-lg disabled:opacity-50 transition-colors border border-red-700/40"
          >
            ⏹ Arrêter
          </button>
        )}

        {/* Sélecteur de vitesse */}
        <div className="flex items-center gap-1 ml-2">
          <span className="text-[10px] text-slate-500">Vitesse :</span>
          {[1, 2, 5, 10, 20].map(s => (
            <button
              key={s}
              onClick={() => (isRunning || isPaused) ? simControl('start', s) : simControl('start', s)}
              className={`px-2 py-0.5 rounded text-[11px] font-bold transition-colors ${
                sim.speedMultiplier === s && isRunning
                  ? 'bg-amber-500 text-black'
                  : 'bg-[#1a2740] text-slate-400 hover:text-white'
              }`}
            >
              ×{s}
            </button>
          ))}
        </div>

        {simOp && (
          <span className="text-[11px] text-amber-400 animate-pulse ml-2">{simOp}…</span>
        )}
      </div>

      {/* ── KPI Cards ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-5 gap-3">
        <KpiCard
          label="Camions actifs"
          value={`${sim.trucks.filter(t => t.phase !== 'DOWN').length} / ${fleet.trucks}`}
          sub={`${fleet.down} en panne · ${fleet.inMaintenance} maintenance`}
        />
        <KpiCard
          label="Cycles session"
          value={sim.totalCycles}
          sub={`Objectif : ${production.targetCycles} cycles`}
        />
        <KpiCard
          label="Tonnes session"
          value={`${sim.totalTonnes.toLocaleString()} t`}
          sub={`${production.ratePerHour} t/h · obj. ${production.targetTonnes.toLocaleString()} t`}
        />
        <KpiCard
          label="Sécurité (2h)"
          value={safety.violations2h}
          sub={`${safety.criticalCount} critiques · ${safety.activeDelays} délais actifs`}
          color={safety.criticalCount > 0 ? 'text-red-400' : safety.violations2h > 0 ? 'text-yellow-400' : 'text-emerald-400'}
          alert={safety.criticalCount > 0}
        />
        <KpiCard
          label="Disponibilité MA"
          value={`${maintenance.maPct}%`}
          sub={maintenance.urgentCount > 0 ? `${maintenance.urgentCount} urgents` : 'Flotte en bonne santé'}
          color={maintenance.maPct < 70 ? 'text-red-400' : maintenance.maPct < 85 ? 'text-yellow-400' : 'text-emerald-400'}
        />
      </div>

      {/* ── Grille flotte + panneau latéral ─────────────────────────────────── */}
      <div className="grid grid-cols-[1fr_300px] gap-4">

        {/* Flotte temps réel */}
        <div className="bg-[#0f1e30] border border-[#1a2740] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#1a2740] flex items-center justify-between">
            <span className="text-sm font-semibold text-white">Flotte temps réel</span>
            <span className="text-[10px] text-slate-500">{sim.trucks.length} camions chargés</span>
          </div>

          {sim.trucks.length === 0 ? (
            <div className="p-6 text-center text-slate-500 text-sm">
              Aucun camion en simulation — Démarrez la simulation ci-dessus
            </div>
          ) : (
            <div className="divide-y divide-[#1a2740]">
              {sim.trucks.map(truck => {
                const phase = truck.phase || 'IDLE';
                const prog  = Math.min(100, Math.max(0, truck.phaseProgress));
                return (
                  <div key={truck.fleetNumber} className="px-4 py-2.5 flex items-center gap-3 hover:bg-[#0a1628]/50">
                    {/* Nom camion */}
                    <div className="w-14 text-xs font-mono font-bold text-white flex-shrink-0">
                      {truck.fleetNumber}
                    </div>

                    {/* Phase label */}
                    <div className="w-28 flex-shrink-0">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded text-white ${PHASE_COLOR[phase] ?? 'bg-slate-600'}`}>
                        {PHASE_LABELS[phase] ?? phase}
                      </span>
                    </div>

                    {/* Barre de progression */}
                    <div className="flex-1 min-w-0">
                      <div className="h-2 bg-[#1a2740] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${PHASE_COLOR[phase] ?? 'bg-slate-600'}`}
                          style={{ width: `${prog}%` }}
                        />
                      </div>
                      <div className="text-[9px] text-slate-600 mt-0.5">{prog.toFixed(0)}%</div>
                    </div>

                    {/* Carburant */}
                    <div className={`w-10 text-right text-xs font-mono flex-shrink-0 ${fuelColor(truck.fuelLevel_pct)}`}>
                      {truck.fuelLevel_pct.toFixed(0)}%
                    </div>
                    <div className="text-[9px] text-slate-600 flex-shrink-0">⛽</div>

                    {/* Santé */}
                    <div className={`w-10 text-right text-xs font-mono flex-shrink-0 ${healthColor(truck.healthScore)}`}>
                      {truck.healthScore}
                    </div>
                    <div className="text-[9px] text-slate-600 flex-shrink-0">❤</div>

                    {/* Tonnes du cycle courant */}
                    {truck.tonnesThisShift > 0 && (
                      <div className="text-[10px] text-slate-500 w-16 text-right flex-shrink-0">
                        {truck.tonnesThisShift.toLocaleString()} t
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Panneau latéral : BNR + Maintenance + Sécurité */}
        <div className="space-y-3">

          {/* Capteurs BNR */}
          <div className="bg-[#0f1e30] border border-[#1a2740] rounded-xl overflow-hidden">
            <div className="px-3 py-2.5 border-b border-[#1a2740] flex items-center justify-between">
              <span className="text-xs font-semibold text-white">Capteurs BNR</span>
              <span className={`text-[9px] font-bold uppercase ${BNR_COLOR[safety.bnrStatus]}`}>
                {safety.bnrStatus}
              </span>
            </div>
            <div className="p-2 space-y-1.5">
              {safety.bnrReadings.length === 0 ? (
                <p className="text-[11px] text-slate-500 p-1 text-center">
                  Aucune lecture — générateur BNR
                </p>
              ) : (
                safety.bnrReadings.map(r => (
                  <div key={r.stationCode} className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${BNR_DOT[r.status]}`} />
                    <span className="text-[10px] font-mono text-slate-400 w-16 flex-shrink-0">{r.stationCode}</span>
                    <div className="flex-1 h-1 bg-[#1a2740] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          r.status === 'CRITICAL' ? 'bg-red-500' :
                          r.status === 'WARNING'  ? 'bg-yellow-500' : 'bg-emerald-500'
                        }`}
                        style={{ width: `${r.stabilityIndex ?? 0}%` }}
                      />
                    </div>
                    <span className={`text-[10px] font-semibold w-8 text-right ${BNR_COLOR[r.status]}`}>
                      {r.stabilityIndex?.toFixed(0) ?? '—'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Top risques maintenance */}
          <div className="bg-[#0f1e30] border border-[#1a2740] rounded-xl overflow-hidden">
            <div className="px-3 py-2.5 border-b border-[#1a2740]">
              <span className="text-xs font-semibold text-white">Maintenance — risques</span>
            </div>
            <div className="p-2 space-y-1.5">
              {maintenance.risks.slice(0, 4).map(r => (
                <div key={r.fleetNumber} className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold w-12 flex-shrink-0 ${
                    r.action === 'URGENT' ? 'text-red-400' : 'text-slate-400'
                  }`}>{r.fleetNumber}</span>
                  <div className="flex-1 h-1 bg-[#1a2740] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        r.healthScore < 60 ? 'bg-red-500' :
                        r.healthScore < 80 ? 'bg-yellow-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${r.healthScore}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-slate-500 w-14 text-right flex-shrink-0">
                    RUL {r.rulHours < 1000 ? `${r.rulHours}h` : '∞'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Délais actifs */}
          {safety.activeDelayList.length > 0 && (
            <div className="bg-[#0f1e30] border border-yellow-800/40 rounded-xl overflow-hidden">
              <div className="px-3 py-2.5 border-b border-yellow-800/40">
                <span className="text-xs font-semibold text-yellow-400">
                  ⏱ Délais actifs ({safety.activeDelayList.length})
                </span>
              </div>
              <div className="p-2 space-y-1">
                {safety.activeDelayList.map((d, i) => (
                  <div key={i} className="text-[10px] text-slate-400">
                    <span className="font-bold text-white">{d.fleetNumber}</span>
                    {' — '}{d.catLabel}
                    <span className="text-slate-500"> ({d.durationMin} min)</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Événements récents (violations) ─────────────────────────────────── */}
      {safety.recentViolations.length > 0 && (
        <div className="bg-[#0f1e30] border border-[#1a2740] rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#1a2740]">
            <span className="text-xs font-semibold text-white">Alertes vitesse récentes (2h)</span>
          </div>
          <div className="divide-y divide-[#1a2740]">
            {safety.recentViolations.map((v, i) => (
              <div key={i} className="px-4 py-2 flex items-center gap-3 text-[11px]">
                <span className={`px-1.5 py-0.5 rounded font-bold text-[9px] ${
                  v.severity === 'CRITICAL'
                    ? 'bg-red-900/60 text-red-400 border border-red-700/40'
                    : 'bg-yellow-900/40 text-yellow-400 border border-yellow-700/30'
                }`}>{v.severity}</span>
                <span className="font-bold text-white">{v.fleetNumber}</span>
                <span className="text-slate-400">
                  {v.speedKmh.toFixed(1)} km/h
                  <span className="text-slate-600"> › limite </span>
                  {v.limitKmh.toFixed(0)} km/h
                </span>
                <span className="text-red-400 font-semibold">+{v.excessPct.toFixed(0)}%</span>
                <span className="text-slate-600 ml-auto">{v.timeLabel}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Légende phases ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 text-[9px] text-slate-600">
        {Object.entries(PHASE_LABELS).map(([key, label]) => (
          <span key={key} className="flex items-center gap-1">
            <span className={`w-2 h-2 rounded-sm ${PHASE_COLOR[key]}`} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
