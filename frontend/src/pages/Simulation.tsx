/**
 * Simulation.tsx — Module 5 : Console de Simulation FMS Mining
 * ============================================================
 * Panneau de contrôle principal pour la simulation de flotte.
 * Permet de :
 *   - Démarrer / Arrêter / Mettre en pause la simulation
 *   - Ajuster la vitesse (1x à 20x)
 *   - Visualiser l'état temps réel de chaque camion simulé
 *   - Suivre le journal des événements en direct
 *   - Monitorer les capteurs BNR géophysiques
 * ============================================================
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import apiDefault, { simulationApi } from '../lib/api';
import { useRealtimeStore } from '../store';
import Mine3DView, { TruckData } from '../components/mining/Mine3DView';
import {
  IconRefresh, IconActivity,
  IconAlert, IconTruck, IconClock, IconGps, IconChevronDown,
} from '../components/ui/Icons';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TruckSimState {
  equipmentId:     string;
  fleetNumber:     string;
  phase:           string;
  status:          string;
  lat:             number;
  lon:             number;
  heading:         number;
  speed_kmh:       number;
  phaseProgress:   number;   // 0-100
  phaseDuration_s: number;
  fuelLevel_pct:   number;
  healthScore:     number;
  payloadTonnes:   number;
  cyclesThisShift: number;
  tonnesThisShift: number;
  loaderId?:       string;
  destId?:         string;
}

interface SimStatus {
  status:          'STOPPED' | 'RUNNING' | 'PAUSED';
  siteId:          string;
  speedMultiplier: number;
  uptime_s:        number;
  totalCycles:     number;
  totalTonnes:     number;
  truckCount:      number;
  loaderCount:     number;
  trucks:          TruckSimState[];
}

interface SimEvent {
  log_id:      number;
  recorded_at: string;
  event_type:  string;
  fleet_number?: string;
  payload?:    { from?: string; to?: string; duration_s?: number };
}

interface BNRStation {
  stationId:        string;
  stationName:      string;
  stationCode:      string;
  stabilityIndex:   number;
  vibration_mms:    number;
  seismicActivity:  number;
  moisture_pct:     number;
  status:           'NORMAL' | 'WARNING' | 'CRITICAL' | 'ALERT';
}

interface BNRSummary {
  totalStations: number;
  normalCount:   number;
  warningCount:  number;
  criticalCount: number;
  alertCount:    number;
  overallStatus: string;
  readings:      BNRStation[];
}

// ── Constantes ────────────────────────────────────────────────────────────────

const SPEED_OPTIONS = [0.5, 1, 2, 5, 10, 20] as const;

const PHASE_LABELS: Record<string, string> = {
  IDLE:               'En attente',
  MOVING_TO_SOURCE:   '→ Pelle',
  QUEUING_AT_SOURCE:  'File pelle',
  LOADING:            'Chargement',
  HAULING:            'Transport ↗',
  QUEUING_AT_DEST:    'File dump',
  DUMPING:            'Déversement',
  RETURNING:          'Retour ↙',
  REFUELING:          'Carburant',
  DOWN:               'En panne',
};

const PHASE_COLORS: Record<string, string> = {
  IDLE:               'text-slate-400',
  MOVING_TO_SOURCE:   'text-blue-400',
  QUEUING_AT_SOURCE:  'text-yellow-400',
  LOADING:            'text-amber-400',
  HAULING:            'text-emerald-400',
  QUEUING_AT_DEST:    'text-yellow-400',
  DUMPING:            'text-orange-400',
  RETURNING:          'text-cyan-400',
  REFUELING:          'text-purple-400',
  DOWN:               'text-red-400',
};

const PHASE_BAR_COLORS: Record<string, string> = {
  IDLE:               'bg-slate-600',
  MOVING_TO_SOURCE:   'bg-blue-500',
  QUEUING_AT_SOURCE:  'bg-yellow-500',
  LOADING:            'bg-amber-500',
  HAULING:            'bg-emerald-500',
  QUEUING_AT_DEST:    'bg-yellow-500',
  DUMPING:            'bg-orange-500',
  RETURNING:          'bg-cyan-500',
  REFUELING:          'bg-purple-500',
  DOWN:               'bg-red-600',
};

// ── Composant principal ────────────────────────────────────────────────────────

export default function Simulation() {
  useRealtimeStore();

  // État simulation
  const [simStatus,  setSimStatus]  = useState<SimStatus | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [speed,      setSpeed]      = useState<number>(1);
  const [siteId,     setSiteId]     = useState<string>('');

  // Capteurs BNR
  const [bnrData,        setBnrData]       = useState<BNRSummary | null>(null);
  const [bnrProfile,     setBnrProfile]    = useState<string>('STABLE');
  const [bnrLoading,     setBnrLoading]    = useState(false);

  // Journal d'événements
  const [events,     setEvents]    = useState<SimEvent[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const eventListRef = useRef<HTMLDivElement>(null);

  // Sélection 3D
  const [sel3D, setSel3D] = useState<string | null>(null);

  // Polling de l'état simulation (toutes les 2 secondes quand active)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Chargement de l'état initial ──────────────────────────
  useEffect(() => {
    loadStatus();
    loadBNR();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // Démarre le polling quand la simulation tourne
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (simStatus?.status === 'RUNNING') {
      pollRef.current = setInterval(() => {
        loadStatus();
        loadEvents();
      }, 2000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [simStatus?.status]);

  // Auto-scroll du journal
  useEffect(() => {
    if (autoScroll && eventListRef.current) {
      eventListRef.current.scrollTop = 0;
    }
  }, [events, autoScroll]);

  // ── Appels API ─────────────────────────────────────────────

  const loadStatus = useCallback(async () => {
    try {
      const { data } = await simulationApi.status();
      setSimStatus(data as SimStatus);
      if ((data as SimStatus).siteId) setSiteId((data as SimStatus).siteId);
    } catch { /* silencieux — la simulation peut ne pas être démarrée */ }
  }, []);

  const loadEvents = useCallback(async () => {
    try {
      const { data } = await simulationApi.events({ limit: '50' });
      setEvents(data as SimEvent[]);
    } catch { /* silencieux */ }
  }, []);

  const loadBNR = useCallback(async () => {
    try {
      const { data } = await simulationApi.bnrSummary();
      setBnrData(data as BNRSummary);
    } catch { /* silencieux */ }
  }, []);

  const handleStart = async () => {
    setLoading(true); setError(null);
    try {
      const targetSiteId = siteId || await getDefaultSiteId();
      const { data } = await simulationApi.start({ siteId: targetSiteId, speedMultiplier: speed });
      setSimStatus(data as SimStatus);
      setSiteId(targetSiteId);
      loadEvents();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || (e as Error).message || 'Erreur au démarrage');
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      await simulationApi.stop();
      setSimStatus(prev => prev ? { ...prev, status: 'STOPPED', trucks: [] } : null);
      setEvents([]);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handlePause = async () => {
    await simulationApi.pause();
    setSimStatus(prev => prev ? { ...prev, status: 'PAUSED' } : null);
  };

  const handleResume = async () => {
    await simulationApi.resume();
    setSimStatus(prev => prev ? { ...prev, status: 'RUNNING' } : null);
  };

  const handleSpeedChange = async (newSpeed: number) => {
    setSpeed(newSpeed);
    if (simStatus?.status === 'RUNNING') {
      await simulationApi.setSpeed(newSpeed).catch(() => {});
    }
  };

  const handleGenerateBNR = async () => {
    setBnrLoading(true);
    try {
      await simulationApi.generateBNR({ profile: bnrProfile });
      await loadBNR();
    } finally {
      setBnrLoading(false);
    }
  };

  // ── Rendu ──────────────────────────────────────────────────

  const isRunning = simStatus?.status === 'RUNNING';
  const isPaused  = simStatus?.status === 'PAUSED';
  const isStopped = !simStatus || simStatus.status === 'STOPPED';

  const uptime = simStatus?.uptime_s
    ? formatUptime(simStatus.uptime_s)
    : '—';

  return (
    <div className="flex flex-col gap-4 p-4 max-w-full">

      {/* ── En-tête ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">Simulation de Flotte</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Module 5 — Test réaliste avant déploiement terrain
          </p>
        </div>
        <button
          onClick={() => { loadStatus(); loadBNR(); }}
          className="p-2 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
          title="Actualiser"
        >
          <IconRefresh size={16} />
        </button>
      </div>

      {/* ── Message d'erreur ── */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-950/60 border border-red-700/40 rounded text-sm text-red-400">
          <IconAlert size={14} className="flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* ── Panneau de contrôle (colonne gauche) ── */}
        <div className="flex flex-col gap-3">

          {/* Statut et contrôles */}
          <div className="bg-[#0d1520] border border-[#1a2740] rounded p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Contrôles</span>
              <StatusBadge status={simStatus?.status || 'STOPPED'} />
            </div>

            {/* Boutons Start / Stop / Pause */}
            <div className="flex gap-2 mb-4">
              {isStopped && (
                <button
                  onClick={handleStart}
                  disabled={loading}
                  className="flex-1 flex items-center justify-center gap-2 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded text-sm font-semibold text-white transition-colors"
                >
                  <IconPlay size={14} />
                  {loading ? 'Démarrage…' : 'Démarrer'}
                </button>
              )}
              {isRunning && (
                <>
                  <button
                    onClick={handlePause}
                    className="flex-1 flex items-center justify-center gap-2 py-2 bg-yellow-600 hover:bg-yellow-500 rounded text-sm font-semibold text-white transition-colors"
                  >
                    <IconPause size={14} />
                    Pause
                  </button>
                  <button
                    onClick={handleStop}
                    disabled={loading}
                    className="flex-1 flex items-center justify-center gap-2 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-50 rounded text-sm font-semibold text-white transition-colors"
                  >
                    <IconStop size={14} />
                    Arrêter
                  </button>
                </>
              )}
              {isPaused && (
                <>
                  <button
                    onClick={handleResume}
                    className="flex-1 flex items-center justify-center gap-2 py-2 bg-emerald-600 hover:bg-emerald-500 rounded text-sm font-semibold text-white transition-colors"
                  >
                    <IconPlay size={14} />
                    Reprendre
                  </button>
                  <button
                    onClick={handleStop}
                    disabled={loading}
                    className="flex-1 flex items-center justify-center gap-2 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-50 rounded text-sm font-semibold text-white transition-colors"
                  >
                    <IconStop size={14} />
                    Arrêter
                  </button>
                </>
              )}
            </div>

            {/* Multiplicateur de vitesse */}
            <div className="mb-4">
              <div className="text-xs text-slate-400 mb-2">Vitesse de simulation</div>
              <div className="flex gap-1">
                {SPEED_OPTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => handleSpeedChange(s)}
                    className={`flex-1 py-1.5 rounded text-xs font-mono font-semibold transition-colors ${
                      speed === s
                        ? 'bg-amber-500 text-black'
                        : 'bg-[#1a2740] text-slate-400 hover:text-white'
                    }`}
                  >
                    {s}×
                  </button>
                ))}
              </div>
              <div className="text-[10px] text-slate-500 mt-1">
                {speed > 1
                  ? `1 minute réelle = ${speed} minutes simulées`
                  : 'Temps réel (1:1)'}
              </div>
            </div>

            {/* Métriques globales */}
            <div className="grid grid-cols-2 gap-2">
              <MetricBox label="Durée" value={uptime} icon={<IconClock size={12} />} />
              <MetricBox label="Cycles" value={simStatus?.totalCycles?.toString() ?? '0'} />
              <MetricBox
                label="Tonnes"
                value={simStatus?.totalTonnes ? `${simStatus.totalTonnes.toLocaleString()} t` : '0 t'}
              />
              <MetricBox
                label="Camions actifs"
                value={`${simStatus?.truckCount ?? 0}`}
                icon={<IconTruck size={12} />}
              />
            </div>
          </div>

          {/* ── Capteurs BNR ── */}
          <div className="bg-[#0d1520] border border-[#1a2740] rounded p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Capteurs BNR (géophysique)
              </span>
              {bnrData && <BNRStatusBadge status={bnrData.overallStatus} />}
            </div>

            {bnrData && (
              <div className="grid grid-cols-4 gap-1 mb-3 text-center">
                <div className="bg-emerald-950/40 border border-emerald-700/30 rounded p-1.5">
                  <div className="text-sm font-bold text-emerald-400">{bnrData.normalCount}</div>
                  <div className="text-[9px] text-slate-500">Normal</div>
                </div>
                <div className="bg-yellow-950/40 border border-yellow-700/30 rounded p-1.5">
                  <div className="text-sm font-bold text-yellow-400">{bnrData.warningCount}</div>
                  <div className="text-[9px] text-slate-500">Alerte</div>
                </div>
                <div className="bg-orange-950/40 border border-orange-700/30 rounded p-1.5">
                  <div className="text-sm font-bold text-orange-400">{bnrData.criticalCount}</div>
                  <div className="text-[9px] text-slate-500">Critique</div>
                </div>
                <div className="bg-red-950/40 border border-red-700/30 rounded p-1.5">
                  <div className="text-sm font-bold text-red-400">{bnrData.alertCount}</div>
                  <div className="text-[9px] text-slate-500">Urgence</div>
                </div>
              </div>
            )}

            {/* Génération de profil BNR */}
            <div className="flex gap-2 items-center">
              <div className="relative flex-1">
                <select
                  value={bnrProfile}
                  onChange={e => setBnrProfile(e.target.value)}
                  className="w-full bg-[#1a2740] border border-[#2a3750] rounded px-2 py-1.5 text-xs text-slate-300 appearance-none"
                >
                  <option value="STABLE">Terrain stable</option>
                  <option value="HUMID">Sol humide (pluies)</option>
                  <option value="PRE_BLAST">Avant tir de mines</option>
                  <option value="POST_BLAST">Après tir (vibrations)</option>
                  <option value="CRITICAL">Instabilité critique</option>
                </select>
                <IconChevronDown size={12} className="absolute right-2 top-2 text-slate-500 pointer-events-none" />
              </div>
              <button
                onClick={handleGenerateBNR}
                disabled={bnrLoading}
                className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 rounded text-xs text-white transition-colors whitespace-nowrap"
              >
                {bnrLoading ? '…' : 'Générer'}
              </button>
            </div>

            {/* Liste des stations */}
            {bnrData?.readings.map(s => (
              <div key={s.stationId} className="mt-2 border-t border-[#1a2740] pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-300 font-medium">{s.stationCode}</span>
                  <BNRStatusBadge status={s.status} />
                </div>
                <div className="flex gap-3 mt-1 text-[10px] text-slate-500">
                  <span>Stabilité <span className={s.stabilityIndex < 40 ? 'text-red-400' : 'text-slate-300'}>{s.stabilityIndex.toFixed(0)}/100</span></span>
                  <span>Vibr. <span className={s.vibration_mms > 5 ? 'text-red-400' : 'text-slate-300'}>{s.vibration_mms.toFixed(2)} mm/s</span></span>
                  <span>Séisme <span className="text-slate-300">{s.seismicActivity.toFixed(2)}</span></span>
                </div>
              </div>
            ))}
          </div>

          {/* ── Journal d'événements ── */}
          <div className="bg-[#0d1520] border border-[#1a2740] rounded p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                <IconActivity size={12} />
                Journal d'événements
              </span>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={e => setAutoScroll(e.target.checked)}
                  className="w-3 h-3"
                />
                <span className="text-[10px] text-slate-500">Auto</span>
              </label>
            </div>
            <div
              ref={eventListRef}
              className="max-h-52 overflow-y-auto space-y-0.5 font-mono"
            >
              {events.length === 0 ? (
                <div className="text-[11px] text-slate-600 py-2 text-center">
                  {isRunning ? "En attente d'événements…" : 'Démarrez la simulation'}
                </div>
              ) : (
                events.map(e => (
                  <EventRow key={e.log_id} event={e} />
                ))
              )}
            </div>
          </div>
        </div>

        {/* ── Vue 3D + liste compacte (colonnes 2-3) ── */}
        <div className="lg:col-span-2 flex flex-col gap-2">

          {/* Header 3D */}
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <IconGps size={12} />
              Carte mine 3D — {simStatus?.trucks.length ?? 0} engins
            </span>
            {isRunning && (
              <span className="flex items-center gap-1.5 text-[10px] text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                En direct
              </span>
            )}
          </div>

          {/* Vue 3D principale */}
          <div className="rounded-xl overflow-hidden border border-[#1a2740]" style={{ height: 420 }}>
            <Mine3DView
              trucks={(simStatus?.trucks ?? []) as unknown as TruckData[]}
              selectedTruck={sel3D}
              onSelectTruck={fn => setSel3D(prev => prev === fn ? null : fn)}
              height={420}
              siteId={siteId}
            />
          </div>

          {/* Chips compactes des camions (cliquables → sélectionne dans la 3D) */}
          {(simStatus?.trucks.length ?? 0) > 0 ? (
            <div className="grid grid-cols-3 xl:grid-cols-5 gap-1.5">
              {simStatus!.trucks.map(t => (
                <button
                  key={t.equipmentId}
                  onClick={() => setSel3D(prev => prev === t.fleetNumber ? null : t.fleetNumber)}
                  className={`text-left p-2 rounded-lg border transition-colors ${
                    sel3D === t.fleetNumber
                      ? 'border-amber-500 bg-amber-500/10'
                      : t.phase === 'DOWN'
                      ? 'border-red-700/40 bg-red-950/20'
                      : 'border-[#1a2740] bg-[#0a1018] hover:bg-[#1a2740]'
                  }`}
                >
                  <div className="flex items-center gap-1 mb-1">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      t.phase === 'DOWN' ? 'bg-red-500' :
                      t.phase === 'IDLE' ? 'bg-slate-500' : 'bg-emerald-400'
                    }`} />
                    <span className={`text-[11px] font-bold font-mono truncate ${sel3D === t.fleetNumber ? 'text-amber-400' : 'text-white'}`}>
                      {t.fleetNumber}
                    </span>
                  </div>
                  <div className="h-1 bg-slate-800 rounded-full overflow-hidden mb-1">
                    <div
                      className={`h-full rounded-full ${PHASE_BAR_COLORS[t.phase] ?? 'bg-slate-600'}`}
                      style={{ width: `${t.phaseProgress}%` }}
                    />
                  </div>
                  <div className={`text-[9px] truncate ${PHASE_COLORS[t.phase] ?? 'text-slate-400'}`}>
                    {PHASE_LABELS[t.phase] ?? t.phase}
                  </div>
                  <div className="text-[8px] text-slate-600 mt-0.5">
                    ⛽{t.fuelLevel_pct}% · {t.speed_kmh}km/h
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-6 border border-[#1a2740] rounded-xl bg-[#0a1018] text-center">
              <IconTruck size={28} className="text-slate-700 mb-2" />
              <p className="text-sm text-slate-500">Aucun camion simulé</p>
              <p className="text-xs text-slate-600 mt-1">Cliquez sur "Démarrer" pour lancer</p>
            </div>
          )}

          {/* Info pédagogique */}
          {isStopped && (
            <div className="bg-blue-950/30 border border-blue-700/30 rounded-xl p-4">
              <h3 className="text-xs font-semibold text-blue-300 mb-2">Comment fonctionne la simulation ?</h3>
              <div className="text-[10px] text-slate-400 space-y-1">
                <p><span className="text-blue-400">Machine à états :</span> Chaque camion suit le cycle minier — pelle → transport → déversoir → retour.</p>
                <p><span className="text-blue-400">GPS & télémétrie :</span> Toutes les données sont enregistrées en DB comme avec du vrai matériel.</p>
                <p><span className="text-blue-400">Multiplicateur :</span> À 10×, un poste de 8h se simule en 48 minutes — idéal pour tester les KPIs.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sous-composants ───────────────────────────────────────────────────────────

/** Ligne du journal d'événements */
function EventRow({ event }: { event: SimEvent }) {
  const time = new Date(event.recorded_at).toLocaleTimeString('fr-FR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });

  const typeColors: Record<string, string> = {
    PHASE_CHANGE:     'text-blue-400',
    CYCLE_COMPLETE:   'text-emerald-400',
    BREAKDOWN:        'text-red-400',
    FUEL_LOW:         'text-orange-400',
    DOWN_REPAIRED:    'text-cyan-400',
    REFUELING:        'text-purple-400',
  };

  const color = typeColors[event.event_type] || 'text-slate-400';

  const label = event.event_type === 'PHASE_CHANGE' && event.payload
    ? `${event.fleet_number} → ${PHASE_LABELS[event.payload.to || ''] || event.payload.to}`
    : event.fleet_number
      ? `${event.fleet_number} — ${event.event_type}`
      : event.event_type;

  return (
    <div className="flex gap-2 text-[10px] py-0.5">
      <span className="text-slate-600 flex-shrink-0">{time}</span>
      <span className={color}>{label}</span>
    </div>
  );
}

/** Badge de statut simulation */
function StatusBadge({ status }: { status: string }) {
  const map = {
    RUNNING: 'bg-emerald-600/20 text-emerald-400 border-emerald-700/40',
    PAUSED:  'bg-yellow-600/20 text-yellow-400 border-yellow-700/40',
    STOPPED: 'bg-slate-700/20 text-slate-400 border-slate-700/40',
  };
  const labels = { RUNNING: 'En cours', PAUSED: 'En pause', STOPPED: 'Arrêtée' };

  return (
    <span className={`px-2 py-0.5 rounded border text-[10px] font-medium ${map[status as keyof typeof map] || map.STOPPED}`}>
      {labels[status as keyof typeof labels] || status}
    </span>
  );
}

/** Badge statut capteur BNR */
function BNRStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    NORMAL:   'text-emerald-400',
    WARNING:  'text-yellow-400',
    CRITICAL: 'text-orange-400',
    ALERT:    'text-red-400',
  };
  const dots: Record<string, string> = {
    NORMAL: 'bg-emerald-400', WARNING: 'bg-yellow-400',
    CRITICAL: 'bg-orange-400', ALERT: 'bg-red-400 animate-pulse',
  };
  return (
    <span className={`flex items-center gap-1 text-[10px] font-medium ${colors[status] || 'text-slate-400'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dots[status] || 'bg-slate-500'}`} />
      {status}
    </span>
  );
}

/** Boîte de métrique */
function MetricBox({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="bg-[#1a2740] rounded p-2 text-center">
      <div className="flex items-center justify-center gap-1 text-[11px] font-semibold text-white">
        {icon}
        {value}
      </div>
      <div className="text-[10px] text-slate-500">{label}</div>
    </div>
  );
}

// ── Icônes supplémentaires ────────────────────────────────────────────────────

function IconPlay({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function IconPause({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
    </svg>
  );
}

function IconStop({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <rect x="3" y="3" width="18" height="18" rx="2" />
    </svg>
  );
}

// ── Utilitaires ────────────────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}

async function getDefaultSiteId(): Promise<string> {
  try {
    const { data } = await apiDefault.get<Array<{ site_id: string }>>('/locations', { params: { type: 'SITE' } });
    return data[0]?.site_id || '';
  } catch {
    return '';
  }
}
