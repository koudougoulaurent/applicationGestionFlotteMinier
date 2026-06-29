/**
 * AIPredictions.tsx — Analyse & Optimisation de flotte
 * =====================================================
 * Tableau de bord unifié : optimisation de routes, dispatch et maintenance.
 */

import { useState, useEffect, useCallback } from 'react';
import apiDefault, { aiApi } from '../lib/api';
import { useAuthStore } from '../store';
import {
  IconWrench, IconDispatch, IconRoads, IconRefresh,
  IconAlert, IconCheck, IconActivity, IconChevronDown, IconTruck,
} from '../components/ui/Icons';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AIDashboard {
  urgentMaintenances: UrgentEquipment[];
  lastDispatchRec:    DispatchRec | null;
  routeGraph:         GraphStats;
  simulationStatus:   { status: string };
}

interface UrgentEquipment {
  equipment_id:     string;
  fleet_number:     string;
  category:         string;
  health_score:     number;
  rul_hours:        number;
  recommended_action: string;
  component:        string;
  probability_24h:  number;
}

interface DispatchRec {
  rec_id:           string;
  generated_at:     string;
  confidence_score: number;
  improvement_pct:  number;
  applied:          boolean;
  truck_count:      number;
}

interface GraphStats {
  nodes:     number;
  edges:     number;
  siteId:    string;
  lastBuild: number;
}

interface RouteResult {
  found:         boolean;
  path:          string[];
  totalCost:     number;
  distanceKm:    number;
  travelMin:     number;
  roadSegments:  RouteSegment[];
}

interface RouteSegment {
  roadId:      string;
  fromName:    string;
  toName:      string;
  distanceM:   number;
  condition:   string;
  gradientPct: number;
}

interface Location {
  location_id: string;
  name:        string;
  location_type: string;
}

interface DispatchResult {
  assignments:    DispatchAssignment[];
  costMatrix:     number[][];
  totalCost:      number;
  improvementPct: number;
  confidence:     number;
  recId:          string;
}

interface DispatchAssignment {
  truckId:          string;
  truckNumber:      string;
  loaderId:         string;
  loaderNumber:     string;
  sourceLocationId: string;
  sourceLocationName: string;
  destLocationId:   string;
  destLocationName: string;
  estimatedWaitMin: number;
  costScore:        number;
}

interface MaintenancePrediction {
  equipmentId:     string;
  fleetNumber:     string;
  category:        string;
  healthScore:     number;
  rulHours:        number;
  probability24h:  number;
  probability72h:  number;
  probability7d:   number;
  recommendedAction: string;
  recommendedByDate: string | null;
  componentScores: Record<string, number>;
  topRisk:         string;
}

interface MaintenanceResult {
  count:       number;
  predictions: MaintenancePrediction[];
}

// ── Composant principal ────────────────────────────────────────────────────────

export default function AIPredictions() {
  const { user } = useAuthStore();

  // Tableau de bord global
  const [dashboard,  setDashboard]  = useState<AIDashboard | null>(null);
  const [dashLoading, setDashLoading] = useState(true);

  // Onglet actif : 'overview' | 'routes' | 'dispatch' | 'maintenance'
  const [tab, setTab] = useState<'overview' | 'routes' | 'dispatch' | 'maintenance'>('overview');

  // Module 2 — Routes
  const [locations,    setLocations]    = useState<Location[]>([]);
  const [originId,     setOriginId]     = useState('');
  const [destId,       setDestId]       = useState('');
  const [loaded,       setLoaded]       = useState(false);
  const [routeResult,  setRouteResult]  = useState<{ optimal: RouteResult; alternatives: RouteResult[] } | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);

  // Module 3 — Dispatch
  const [dispatchResult,  setDispatchResult]  = useState<DispatchResult | null>(null);
  const [dispatchLoading, setDispatchLoading] = useState(false);
  const [applyLoading,    setApplyLoading]    = useState(false);
  const [applyMsg,        setApplyMsg]        = useState('');

  // Module 4 — Maintenance
  const [maintenance,  setMaintenance]  = useState<MaintenanceResult | null>(null);
  const [maintLoading, setMaintLoading] = useState(false);

  const siteId = user?.siteId || '';

  useEffect(() => {
    loadDashboard();
    loadLocations();
  }, []);

  // ── Appels API ─────────────────────────────────────────────

  const loadDashboard = useCallback(async () => {
    setDashLoading(true);
    try {
      const { data } = await aiApi.dashboard(siteId);
      setDashboard(data as AIDashboard);
    } catch { /* silencieux */ }
    finally { setDashLoading(false); }
  }, [siteId]);

  const loadLocations = async () => {
    try {
      // Essaye d'abord les nœuds du graphe routier (seuls endpoints valides)
      const { data: stats } = await apiDefault.get<{
        nodeList?: Array<{ locationId: string; name: string }>;
      }>(`/ai/route-graph/stats?siteId=${siteId}`);

      if (stats?.nodeList?.length) {
        setLocations(
          stats.nodeList.map(n => ({ location_id: n.locationId, name: n.name } as unknown as Location))
        );
        return;
      }
      // Fallback : toutes les locations
      const { data } = await apiDefault.get<Location[]>('/locations');
      setLocations(data);
    } catch {
      const { data } = await apiDefault.get<Location[]>('/locations').catch(() => ({ data: [] }));
      setLocations(data);
    }
  };

  const handleRouteOptimize = async () => {
    if (!originId || !destId) return;
    setRouteLoading(true); setRouteResult(null);
    try {
      const { data } = await aiApi.routeOptimize({ originId, destId, loaded, siteId });
      setRouteResult(data as { optimal: RouteResult; alternatives: RouteResult[] });
    } catch { /* silencieux */ }
    finally { setRouteLoading(false); }
  };

  const handleDispatchOptimize = async () => {
    setDispatchLoading(true); setDispatchResult(null); setApplyMsg('');
    try {
      const { data } = await aiApi.dispatchOptimize(siteId);
      setDispatchResult(data as DispatchResult);
    } catch { /* silencieux */ }
    finally { setDispatchLoading(false); }
  };

  const handleApplyDispatch = async () => {
    if (!dispatchResult) return;
    setApplyLoading(true); setApplyMsg('');
    try {
      const { data } = await aiApi.dispatchApply({
        recId:       dispatchResult.recId,
        siteId,
        assignments: dispatchResult.assignments,
      });
      setApplyMsg((data as { message: string }).message);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setApplyMsg(msg || (e as Error).message || 'Erreur');
    } finally {
      setApplyLoading(false);
    }
  };

  const handlePredictMaintenance = async () => {
    setMaintLoading(true); setMaintenance(null);
    try {
      const { data } = await aiApi.predictSite(siteId);
      setMaintenance(data as MaintenanceResult);
    } catch { /* silencieux */ }
    finally { setMaintLoading(false); }
  };

  // ── Rendu ──────────────────────────────────────────────────

  const tabs = [
    { key: 'overview',    label: "Vue d'ensemble", icon: IconActivity },
    { key: 'routes',      label: 'Optimisation routes', icon: IconRoads },
    { key: 'dispatch',    label: 'Dispatch', icon: IconDispatch },
    { key: 'maintenance', label: 'Maintenance prédictive', icon: IconWrench },
  ] as const;

  return (
    <div className="flex flex-col gap-4 p-4">

      {/* ── En-tête ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <IconActivity size={18} className="text-purple-400" />
            Analyse & Optimisation
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Optimisation de routes · Dispatch · Maintenance prédictive
          </p>
        </div>
        <button onClick={loadDashboard}
          className="p-2 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors">
          <IconRefresh size={16} />
        </button>
      </div>

      {/* ── Onglets ── */}
      <div className="flex gap-1 border-b border-[#1a2740]">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key as typeof tab)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
              tab === key
                ? 'border-purple-500 text-purple-400'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {/* ── Contenu par onglet ── */}
      {tab === 'overview' && (
        <OverviewTab dashboard={dashboard} loading={dashLoading} />
      )}
      {tab === 'routes' && (
        <RoutesTab
          locations={locations}
          originId={originId} setOriginId={setOriginId}
          destId={destId}   setDestId={setDestId}
          loaded={loaded}   setLoaded={setLoaded}
          result={routeResult} loading={routeLoading}
          onOptimize={handleRouteOptimize}
        />
      )}
      {tab === 'dispatch' && (
        <DispatchTab
          result={dispatchResult} loading={dispatchLoading}
          applyLoading={applyLoading} applyMsg={applyMsg}
          onOptimize={handleDispatchOptimize}
          onApply={handleApplyDispatch}
        />
      )}
      {tab === 'maintenance' && (
        <MaintenanceTab
          result={maintenance} loading={maintLoading}
          onPredict={handlePredictMaintenance}
        />
      )}
    </div>
  );
}

// ── Onglet Vue d'ensemble ─────────────────────────────────────────────────────

function OverviewTab({ dashboard, loading }: { dashboard: AIDashboard | null; loading: boolean }) {
  if (loading) return <LoadingSpinner label="Chargement du tableau de bord…" />;
  if (!dashboard) return <EmptyState message="Impossible de charger le tableau de bord" />;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

      {/* Carte — Graphe routier */}
      <div className="bg-[#0d1520] border border-[#1a2740] rounded p-4">
        <div className="flex items-center gap-2 mb-3">
          <IconRoads size={14} className="text-blue-400" />
          <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Graphe Routier</span>
        </div>
        {dashboard.routeGraph.nodes > 0 ? (
          <>
            <div className="text-2xl font-bold text-white">{dashboard.routeGraph.nodes}</div>
            <div className="text-xs text-slate-400">nœuds · {dashboard.routeGraph.edges} arêtes</div>
            <div className="mt-2 text-[10px] text-slate-500">
              Construit {dashboard.routeGraph.lastBuild
                ? new Date(dashboard.routeGraph.lastBuild).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
                : '—'}
            </div>
          </>
        ) : (
          <div className="text-xs text-slate-500">Graphe non initialisé</div>
        )}
      </div>

      {/* Carte — Dernier dispatch IA */}
      <div className="bg-[#0d1520] border border-[#1a2740] rounded p-4">
        <div className="flex items-center gap-2 mb-3">
          <IconDispatch size={14} className="text-emerald-400" />
          <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Dernier Dispatch</span>
        </div>
        {dashboard.lastDispatchRec ? (
          <>
            <div className="flex items-center gap-2">
              <div className="text-2xl font-bold text-white">{dashboard.lastDispatchRec.truck_count}</div>
              <div className="text-xs text-slate-400">camions optimisés</div>
            </div>
            <div className="text-xs text-slate-400 mt-1">
              Confiance : <span className="text-white">{(dashboard.lastDispatchRec.confidence_score * 100).toFixed(0)}%</span>
              {' · '}gain : <span className="text-emerald-400">−{dashboard.lastDispatchRec.improvement_pct.toFixed(1)}%</span>
            </div>
            <div className="mt-1 flex items-center gap-1">
              {dashboard.lastDispatchRec.applied
                ? <><IconCheck size={11} className="text-emerald-400" /><span className="text-[10px] text-emerald-400">Appliqué</span></>
                : <span className="text-[10px] text-yellow-400">En attente d'application</span>}
            </div>
          </>
        ) : (
          <div className="text-xs text-slate-500">Aucune recommandation générée</div>
        )}
      </div>

      {/* Carte — Alertes maintenance */}
      <div className="bg-[#0d1520] border border-[#1a2740] rounded p-4">
        <div className="flex items-center gap-2 mb-3">
          <IconWrench size={14} className="text-orange-400" />
          <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Alertes Maintenance</span>
        </div>
        {dashboard.urgentMaintenances.length > 0 ? (
          <>
            <div className="text-2xl font-bold text-red-400">{dashboard.urgentMaintenances.length}</div>
            <div className="text-xs text-slate-400">équipement{dashboard.urgentMaintenances.length > 1 ? 's' : ''} en alerte</div>
            <div className="mt-2 space-y-1">
              {dashboard.urgentMaintenances.slice(0, 3).map(e => (
                <div key={e.equipment_id} className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-300 font-mono">{e.fleet_number}</span>
                  <ActionBadge action={e.recommended_action} />
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="text-xs text-emerald-400 flex items-center gap-1">
            <IconCheck size={12} />Tous les équipements sont en bonne santé
          </div>
        )}
      </div>

      {/* Explication des modules */}
      <div className="md:col-span-3 bg-[#0d1520] border border-[#1a2740] rounded p-4">
        <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
          <IconActivity size={14} className="text-purple-400" />Fonctionnement des modules
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-400">
          <div>
            <div className="text-blue-400 font-semibold mb-1">Optimisation de route</div>
            <p>Calcule le chemin de coût minimal entre deux points du site.
               Chaque segment est pondéré par la distance, la pente, l'état de la piste
               et le niveau de congestion actuel.</p>
          </div>
          <div>
            <div className="text-emerald-400 font-semibold mb-1">Dispatch optimisé</div>
            <p>Affecte chaque camion disponible à la pelle qui minimise le temps d'attente global.
               La matrice de coût intègre la distance, la file d'attente, la santé de l'engin
               et son niveau de carburant.</p>
          </div>
          <div>
            <div className="text-orange-400 font-semibold mb-1">Maintenance prédictive</div>
            <p>Analyse 24h de télémétrie pour calculer un score de santé 0–100 par équipement,
               estimer la durée de vie utile restante et la probabilité de panne à 24h, 72h et 7 jours.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Onglet Optimisation de routes ────────────────────────────────────────────

function RoutesTab({
  locations, originId, setOriginId, destId, setDestId,
  loaded, setLoaded, result, loading, onOptimize,
}: {
  locations:    Location[];
  originId:     string; setOriginId: (v: string) => void;
  destId:       string; setDestId:   (v: string) => void;
  loaded:       boolean; setLoaded:  (v: boolean) => void;
  result:       { optimal: RouteResult; alternatives: RouteResult[] } | null;
  loading:      boolean;
  onOptimize:   () => void;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

      {/* Formulaire */}
      <div className="bg-[#0d1520] border border-[#1a2740] rounded p-4">
        <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
          <IconRoads size={14} className="text-blue-400" />
          Calculer une route optimale
        </h3>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Point de départ</label>
            <div className="relative">
              <select value={originId} onChange={e => setOriginId(e.target.value)}
                className="w-full bg-[#1a2740] border border-[#2a3750] rounded px-2 py-1.5 text-xs text-slate-300 appearance-none">
                <option value="">— Sélectionner —</option>
                {locations.map(l => (
                  <option key={l.location_id} value={l.location_id}>{l.name} ({l.location_type})</option>
                ))}
              </select>
              <IconChevronDown size={12} className="absolute right-2 top-2 text-slate-500 pointer-events-none" />
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Destination</label>
            <div className="relative">
              <select value={destId} onChange={e => setDestId(e.target.value)}
                className="w-full bg-[#1a2740] border border-[#2a3750] rounded px-2 py-1.5 text-xs text-slate-300 appearance-none">
                <option value="">— Sélectionner —</option>
                {locations.map(l => (
                  <option key={l.location_id} value={l.location_id}>{l.name} ({l.location_type})</option>
                ))}
              </select>
              <IconChevronDown size={12} className="absolute right-2 top-2 text-slate-500 pointer-events-none" />
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={loaded} onChange={e => setLoaded(e.target.checked)}
              className="w-3.5 h-3.5" />
            <span className="text-xs text-slate-400">Camion chargé (pente plus pénalisante)</span>
          </label>

          <button
            onClick={onOptimize}
            disabled={loading || !originId || !destId}
            className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-sm font-semibold text-white transition-colors"
          >
            {loading ? 'Calcul en cours…' : 'Calculer la route'}
          </button>
        </div>

        <div className="mt-4 p-3 bg-blue-950/20 border border-blue-700/20 rounded text-xs text-slate-500">
          Le moteur calcule le chemin de coût minimal en tenant compte de la pente
          (+15% par degré pour camion chargé), de l'état de la piste et de la congestion en temps réel.
        </div>
      </div>

      {/* Résultat */}
      <div className="bg-[#0d1520] border border-[#1a2740] rounded p-4">
        <h3 className="text-sm font-semibold text-slate-300 mb-3">Résultat</h3>
        {!result && !loading && (
          <EmptyState message="Lancez le calcul pour voir la route optimale" />
        )}
        {loading && <LoadingSpinner label="Calcul en cours…" />}
        {result && (
          <div className="space-y-4">
            {/* Route principale */}
            <RouteCard route={result.optimal} label="Route optimale" highlight />
            {/* Routes alternatives */}
            {result.alternatives.map((r, i) => (
              <RouteCard key={i} route={r} label={`Alternative ${i + 1}`} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RouteCard({ route, label, highlight }: { route: RouteResult; label: string; highlight?: boolean }) {
  const conditionColor = (c: string) =>
    c === 'GOOD' ? 'text-emerald-400' : c === 'FAIR' ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className={`border rounded p-3 ${highlight ? 'border-blue-600/50 bg-blue-950/20' : 'border-[#1a2740]'}`}>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-xs font-semibold ${highlight ? 'text-blue-300' : 'text-slate-400'}`}>{label}</span>
        {!route.found && <span className="text-xs text-red-400">Aucun chemin trouvé</span>}
        {route.found && (
          <span className="text-xs text-slate-300">{route.travelMin.toFixed(1)} min · {route.distanceKm.toFixed(2)} km</span>
        )}
      </div>
      {route.found && (
        <>
          <div className="flex flex-wrap gap-1 mb-2">
            {route.path.map((node, i) => (
              <span key={i} className="flex items-center gap-1">
                <span className="text-[11px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-300">{node}</span>
                {i < route.path.length - 1 && <span className="text-slate-600">→</span>}
              </span>
            ))}
          </div>
          <div className="space-y-1">
            {route.roadSegments.map((seg, i) => (
              <div key={i} className="flex items-center justify-between text-[10px] text-slate-500">
                <span>{seg.fromName} → {seg.toName}</span>
                <span className={conditionColor(seg.condition)}>{seg.condition}</span>
                <span>{(seg.distanceM / 1000).toFixed(2)} km</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Onglet Dispatch intelligent ───────────────────────────────────────────────

function DispatchTab({ result, loading, applyLoading, applyMsg, onOptimize, onApply }: {
  result:       DispatchResult | null;
  loading:      boolean;
  applyLoading: boolean;
  applyMsg:     string;
  onOptimize:   () => void;
  onApply:      () => void;
}) {
  return (
    <div className="flex flex-col gap-4">

      {/* Contrôles */}
      <div className="flex items-center gap-3">
        <button
          onClick={onOptimize}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded text-sm font-semibold text-white transition-colors"
        >
          <IconDispatch size={14} />
          {loading ? 'Optimisation en cours…' : 'Optimiser le dispatch'}
        </button>
        {result && !applyMsg && (
          <button
            onClick={onApply}
            disabled={applyLoading}
            className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 rounded text-sm font-semibold text-white transition-colors"
          >
            <IconCheck size={14} />
            {applyLoading ? 'Application…' : 'Appliquer les affectations'}
          </button>
        )}
        {applyMsg && (
          <span className="text-sm text-emerald-400 flex items-center gap-1">
            <IconCheck size={14} />{applyMsg}
          </span>
        )}
      </div>

      {loading && <LoadingSpinner label="Optimisation des affectations…" />}

      {!result && !loading && (
        <div className="bg-[#0d1520] border border-[#1a2740] rounded p-8">
          <EmptyState message="Cliquez sur 'Optimiser le dispatch' pour calculer les affectations optimales" />
          <div className="mt-4 p-3 bg-emerald-950/20 border border-emerald-700/20 rounded text-xs text-slate-500">
            Le moteur d'affectation garantit le minimum de coût total pour l'ensemble de la flotte
            en combinant distance, file d'attente, santé de l'engin et niveau de carburant.
          </div>
        </div>
      )}

      {result && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Statistiques globales */}
          <div className="bg-[#0d1520] border border-[#1a2740] rounded p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Résultats de l'optimisation</h3>
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="bg-[#1a2740] rounded p-2 text-center">
                <div className="text-lg font-bold text-white">{result.assignments.length}</div>
                <div className="text-[10px] text-slate-500">Affectations</div>
              </div>
              <div className="bg-[#1a2740] rounded p-2 text-center">
                <div className="text-lg font-bold text-emerald-400">−{result.improvementPct.toFixed(1)}%</div>
                <div className="text-[10px] text-slate-500">Amélioration</div>
              </div>
              <div className="bg-[#1a2740] rounded p-2 text-center">
                <div className="text-lg font-bold text-blue-400">{(result.confidence * 100).toFixed(0)}%</div>
                <div className="text-[10px] text-slate-500">Confiance</div>
              </div>
            </div>
            <div className="text-xs text-slate-400">
              Coût total optimisé : <span className="text-white font-mono">{result.totalCost.toFixed(2)}</span>
            </div>
          </div>

          {/* Affectations détaillées */}
          <div className="bg-[#0d1520] border border-[#1a2740] rounded p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Affectations détaillées</h3>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {result.assignments.map((a, i) => (
                <div key={i} className="flex items-center gap-3 p-2 bg-[#1a2740] rounded text-[11px]">
                  <div className="flex items-center gap-1 min-w-0">
                    <IconTruck size={11} className="text-amber-400 flex-shrink-0" />
                    <span className="font-mono font-semibold text-white">{a.truckNumber}</span>
                  </div>
                  <span className="text-slate-600">→</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-slate-300">{a.loaderNumber}</span>
                    <span className="text-slate-500"> @ {a.sourceLocationName}</span>
                  </div>
                  <span className="text-slate-400 flex-shrink-0">{a.estimatedWaitMin.toFixed(1)} min</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Onglet Maintenance prédictive ─────────────────────────────────────────────

function MaintenanceTab({ result, loading, onPredict }: {
  result:     MaintenanceResult | null;
  loading:    boolean;
  onPredict:  () => void;
}) {
  const sortedPredictions = result?.predictions.sort((a, b) => a.healthScore - b.healthScore) ?? [];

  return (
    <div className="flex flex-col gap-4">

      <div className="flex items-center gap-3">
        <button
          onClick={onPredict}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 rounded text-sm font-semibold text-white transition-colors"
        >
          <IconActivity size={14} />
          {loading ? 'Analyse ML en cours…' : 'Analyser la flotte'}
        </button>
        {result && (
          <span className="text-xs text-slate-400">
            {result.count} équipement{result.count > 1 ? 's' : ''} analysé{result.count > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {loading && <LoadingSpinner label="Scoring ML — analyse de 24h de télémétrie par équipement…" />}

      {!result && !loading && (
        <div className="bg-[#0d1520] border border-[#1a2740] rounded p-8">
          <EmptyState message="Cliquez sur 'Analyser la flotte' pour obtenir les prédictions de maintenance" />
          <div className="mt-4 p-3 bg-orange-950/30 border border-orange-700/30 rounded text-xs text-slate-400">
            <strong className="text-orange-400">Modèle ML :</strong>{' '}
            Score de santé = moteur×40% + hydraulique×25% + freins×15% + carburant×10% + électrique×10%.
            La probabilité de panne suit une fonction logistique calibrée sur l'historique terrain.
          </div>
        </div>
      )}

      {result && sortedPredictions.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {sortedPredictions.map(p => (
            <EquipmentHealthCard key={p.equipmentId} prediction={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function EquipmentHealthCard({ prediction: p }: { prediction: MaintenancePrediction }) {
  const actionColors: Record<string, string> = {
    MONITOR:           'border-emerald-700/50 bg-emerald-950/20',
    INSPECT_SOON:      'border-yellow-700/50 bg-yellow-950/20',
    PLAN_MAINTENANCE:  'border-orange-700/50 bg-orange-950/20',
    URGENT:            'border-red-700/50 bg-red-950/20',
    IMMEDIATE:         'border-red-600/80 bg-red-900/30',
  };

  const healthColor = p.healthScore >= 80 ? 'text-emerald-400'
                    : p.healthScore >= 60 ? 'text-yellow-400'
                    : p.healthScore >= 40 ? 'text-orange-400'
                    : 'text-red-400';

  const components = Object.entries(p.componentScores || {})
    .sort(([, a], [, b]) => a - b)
    .slice(0, 4);

  return (
    <div className={`border rounded p-3 ${actionColors[p.recommendedAction] || 'border-[#1a2740]'}`}>
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="text-sm font-bold text-white font-mono">{p.fleetNumber}</div>
          <div className="text-[10px] text-slate-500">{p.category}</div>
        </div>
        <div className={`text-xl font-bold ${healthColor}`}>{p.healthScore}</div>
      </div>

      {/* Barre de santé */}
      <div className="h-1.5 bg-slate-800 rounded-full mb-2 overflow-hidden">
        <div
          className={`h-full rounded-full ${
            p.healthScore >= 80 ? 'bg-emerald-500' :
            p.healthScore >= 60 ? 'bg-yellow-500' :
            p.healthScore >= 40 ? 'bg-orange-500' : 'bg-red-500'
          }`}
          style={{ width: `${p.healthScore}%` }}
        />
      </div>

      {/* Métriques clés */}
      <div className="grid grid-cols-3 gap-1 mb-2 text-[10px]">
        <div className="text-center">
          <div className="text-slate-300">{p.rulHours.toFixed(0)}h</div>
          <div className="text-slate-600">RUL</div>
        </div>
        <div className="text-center">
          <div className={p.probability24h > 0.3 ? 'text-red-400' : 'text-slate-300'}>
            {(p.probability24h * 100).toFixed(0)}%
          </div>
          <div className="text-slate-600">P(24h)</div>
        </div>
        <div className="text-center">
          <div className="text-slate-300">{(p.probability7d * 100).toFixed(0)}%</div>
          <div className="text-slate-600">P(7j)</div>
        </div>
      </div>

      {/* Composants (mini-barres) */}
      <div className="space-y-1">
        {components.map(([name, score]) => (
          <div key={name} className="flex items-center gap-1.5">
            <span className="text-[9px] text-slate-500 w-20 truncate capitalize">{name.toLowerCase()}</span>
            <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${score >= 80 ? 'bg-emerald-500' : score >= 60 ? 'bg-yellow-500' : 'bg-red-500'}`}
                style={{ width: `${score}%` }}
              />
            </div>
            <span className="text-[9px] text-slate-500 w-6 text-right">{score.toFixed(0)}</span>
          </div>
        ))}
      </div>

      {/* Action recommandée */}
      <div className="mt-2 flex items-center justify-between">
        <ActionBadge action={p.recommendedAction} />
        {p.recommendedByDate && (
          <span className="text-[9px] text-slate-500">
            avant {new Date(p.recommendedByDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Composants utilitaires ────────────────────────────────────────────────────

function ActionBadge({ action }: { action: string }) {
  const map: Record<string, string> = {
    MONITOR:          'text-emerald-400 bg-emerald-950/50',
    INSPECT_SOON:     'text-yellow-400 bg-yellow-950/50',
    PLAN_MAINTENANCE: 'text-orange-400 bg-orange-950/50',
    URGENT:           'text-red-400 bg-red-950/50',
    IMMEDIATE:        'text-red-300 bg-red-800/60 font-bold',
  };
  const labels: Record<string, string> = {
    MONITOR:          'Surveiller',
    INSPECT_SOON:     'Inspecter',
    PLAN_MAINTENANCE: 'Planifier',
    URGENT:           'URGENT',
    IMMEDIATE:        'IMMÉDIAT',
  };
  return (
    <span className={`px-1.5 py-0.5 rounded text-[9px] ${map[action] || 'text-slate-400'}`}>
      {labels[action] || action}
    </span>
  );
}

function LoadingSpinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-8 justify-center">
      <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
      <span className="text-sm text-slate-400">{label}</span>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <IconAlert size={24} className="text-slate-700" />
      <p className="text-sm text-slate-500">{message}</p>
    </div>
  );
}
