/**
 * ai.controller.ts
 * Contrôleur pour les endpoints d'intelligence artificielle :
 *   - Optimisation des routes (Dijkstra)
 *   - Dispatch intelligent (algorithme hongrois)
 *   - Maintenance prédictive (scoring ML)
 */

import { Request, Response } from 'express';
import { routeOptimizer }          from '../services/ai/RouteOptimizer';
import { dispatchOptimizer }       from '../services/ai/DispatchOptimizer';
import { predictiveMaintenance }   from '../services/ai/PredictiveMaintenance';
import { query } from '../config/database';

type AuthRequest = Request & { user?: { userId: string; siteId: string } };

// ── Module 2 : Optimisation des routes ────────────────────────────────────────

/**
 * POST /api/v1/ai/route-optimize
 * Calcule la route optimale entre deux locations.
 * Body : { originId, destId, loaded?, weatherModifier?, siteId? }
 */
export async function optimizeRoute(req: AuthRequest, res: Response): Promise<void> {
  const { originId, destId, loaded, weatherModifier, siteId } = req.body;

  if (!originId || !destId) {
    res.status(400).json({ error: 'originId et destId sont requis' });
    return;
  }

  const site = siteId || req.user?.siteId;

  // Reconstruit le graphe si nécessaire (première fois ou site différent)
  const stats = routeOptimizer.getGraphStats();
  if (stats.nodes === 0 || stats.siteId !== site) {
    await routeOptimizer.buildGraph(site!);
  }

  const opts = {
    loaded:          !!loaded,
    weatherModifier: parseFloat(weatherModifier) || 1.0,
  };

  const route       = routeOptimizer.findOptimalRoute(originId, destId, opts);
  const alternatives = routeOptimizer.findAlternativeRoutes(originId, destId, opts);

  // Normalise la réponse du service → format attendu par le frontend
  const normalize = (r: ReturnType<typeof routeOptimizer.findOptimalRoute>) => ({
    found:        r.found,
    path:         (r.path as Array<{ name?: string } | string>)
                    .map(n => (typeof n === 'string' ? n : (n as { name?: string }).name ?? n)),
    distanceKm:   (r as unknown as { totalDistanceKm?: number }).totalDistanceKm
                    ?? (r as unknown as { distanceKm?: number }).distanceKm ?? 0,
    travelMin:    (r as unknown as { estimatedMinutes?: number }).estimatedMinutes
                    ?? (r as unknown as { travelMin?: number }).travelMin ?? 0,
    totalCost:    r.totalCost,
    roadSegments: buildSegments(r, routeOptimizer),
  });

  res.json({
    optimal:      normalize(route),
    alternatives: alternatives.slice(1).map(normalize),
    graphStats:   routeOptimizer.getGraphStats(),
  });
}

/** Construit les segments de route lisibles pour le frontend */
function buildSegments(r: ReturnType<typeof routeOptimizer.findOptimalRoute>, _ro: typeof routeOptimizer) {
  const pathArr = r.path as Array<{ locationId?: string; name?: string } | string>;
  const segs = [];
  for (let i = 0; i < pathArr.length - 1; i++) {
    const a = pathArr[i];
    const b = pathArr[i + 1];
    segs.push({
      fromName:   typeof a === 'string' ? a : (a as { name?: string }).name ?? '?',
      toName:     typeof b === 'string' ? b : (b as { name?: string }).name ?? '?',
      distanceM:  0,   // enrichi côté terrain quand les routes ont des distances
      condition:  'GOOD',
      gradientPct: 0,
    });
  }
  return segs;
}

/**
 * POST /api/v1/ai/route-graph/rebuild
 * Force le recalcul du graphe de routes (utile après modification des routes).
 */
export async function rebuildRouteGraph(req: AuthRequest, res: Response): Promise<void> {
  const siteId = req.body.siteId || req.user?.siteId;
  if (!siteId) { res.status(400).json({ error: 'siteId requis' }); return; }

  await routeOptimizer.buildGraph(siteId);
  res.json({ message: 'Graphe reconstruit', ...routeOptimizer.getGraphStats() });
}

/**
 * GET /api/v1/ai/route-graph/stats
 * Retourne les statistiques du graphe en mémoire.
 */
export async function getGraphStats(req: AuthRequest, res: Response): Promise<void> {
  const stats = routeOptimizer.getGraphStats();
  // Auto-construit le graphe si vide (premier appel après démarrage)
  if (stats.nodes === 0) {
    const siteId = (req.query.siteId as string) || req.user?.siteId;
    if (siteId) await routeOptimizer.buildGraph(siteId);
  }
  res.json(routeOptimizer.getGraphStats());
}

// ── Module 3 : Dispatch intelligent ──────────────────────────────────────────

/**
 * GET /api/v1/ai/dispatch-optimize
 * Calcule les affectations optimales camions→pelles pour le site.
 * Utilise l'algorithme hongrois (minimise le temps d'attente total).
 * Query params : siteId?
 */
export async function optimizeDispatch(req: AuthRequest, res: Response): Promise<void> {
  const siteId = (req.query.siteId || req.user?.siteId) as string;
  if (!siteId) { res.status(400).json({ error: 'siteId requis' }); return; }

  const result = await dispatchOptimizer.optimize(siteId);
  res.json(result);
}

/**
 * POST /api/v1/ai/dispatch-apply
 * Applique les affectations recommandées (crée les dispatch_assignment en DB).
 * Body : { recId, siteId?, assignments }
 */
export async function applyDispatchRecommendation(req: AuthRequest, res: Response): Promise<void> {
  const { recId, assignments } = req.body;
  const siteId  = req.body.siteId || req.user?.siteId;
  const userId  = req.user?.userId;

  if (!assignments || !Array.isArray(assignments)) {
    res.status(400).json({ error: 'assignments requis (tableau)' });
    return;
  }

  const created: string[] = [];
  const io = req.app.get('io');

  for (const a of assignments) {
    if (!a.truckId || !a.sourceLocationId || !a.destLocationId) continue;

    const r = await query(
      `INSERT INTO operations.dispatch_assignment
         (site_id, truck_id, loader_id, source_location_id, dest_location_id,
          material_id, priority, status, dispatcher_id)
       VALUES ($1, $2, $3, $4, $5, $6, 1, 'PENDING', $7)
       RETURNING assignment_id`,
      [siteId, a.truckId, a.loaderId || null, a.sourceLocationId,
       a.destLocationId, a.materialId || null, userId]
    );
    created.push(r.rows[0].assignment_id);

    // Met à jour le statut du camion
    await query(
      `UPDATE core.equipment SET status = 'OPERATING' WHERE equipment_id = $1`,
      [a.truckId]
    );

    // Notifie via Socket.io
    if (io && siteId) {
      io.to(`site:${siteId}`).emit('dispatch:assigned', {
        assignment_id: r.rows[0].assignment_id,
        truck_id:      a.truckId,
        truck_number:  a.truckNumber,
        loader_number: a.loaderNumber,
        source_name:   a.sourceLocationName,
        dest_name:     a.destLocationName,
        ai_recommended: true,
        timestamp:     new Date().toISOString(),
      });
    }
  }

  // Marque la recommandation comme appliquée
  if (recId) {
    await query(
      `UPDATE ai.dispatch_recommendation
       SET applied = TRUE, applied_at = NOW(), applied_by = $1
       WHERE rec_id = $2`,
      [userId, recId]
    ).catch(() => {});
  }

  res.json({ message: `${created.length} dispatch(s) créé(s)`, assignmentIds: created });
}

/**
 * GET /api/v1/ai/dispatch-history
 * Historique des recommandations de dispatch IA.
 */
export async function getDispatchHistory(req: AuthRequest, res: Response): Promise<void> {
  const siteId = (req.query.siteId || req.user?.siteId) as string;
  const limit  = Math.min(parseInt(req.query.limit as string) || 20, 100);

  const result = await query(
    `SELECT rec_id, generated_at, algorithm, confidence_score,
            improvement_pct, applied, applied_at,
            jsonb_array_length(assignments) AS truck_count
     FROM ai.dispatch_recommendation
     WHERE site_id = $1
     ORDER BY generated_at DESC
     LIMIT $2`,
    [siteId, limit]
  );
  res.json(result.rows);
}

// ── Module 4 : Maintenance prédictive ────────────────────────────────────────

/**
 * GET /api/v1/ai/maintenance-predict
 * Génère les prédictions de maintenance pour tous les équipements du site.
 * Query params : siteId?
 */
export async function predictMaintenance(req: AuthRequest, res: Response): Promise<void> {
  const siteId = (req.query.siteId || req.user?.siteId) as string;
  if (!siteId) { res.status(400).json({ error: 'siteId requis' }); return; }

  const raw = await predictiveMaintenance.analyzeSite(siteId);
  // Normalise les champs du service vers le format attendu par le frontend
  const predictions = raw.map(p => ({
    equipmentId:       p.equipmentId,
    fleetNumber:       p.fleetNumber,
    category:          p.category,
    healthScore:       p.scores?.overall ?? 100,
    rulHours:          p.rulHours,
    probability24h:    p.probability24h,
    probability72h:    p.probability72h,
    probability7d:     p.probability7d,
    recommendedAction: p.action ?? 'MONITOR',
    recommendedByDate: p.recommendedByDate ?? null,
    componentScores:   p.scores ?? {},
    topRisk:           p.signals?.[0] ?? '',
  }));
  res.json({ count: predictions.length, predictions });
}

/**
 * GET /api/v1/ai/maintenance-predict/:equipmentId
 * Prédiction détaillée pour un équipement spécifique.
 */
export async function predictMaintenanceForEquipment(req: Request, res: Response): Promise<void> {
  const { equipmentId } = req.params;

  const equipRes = await query(
    `SELECT e.fleet_number, et.category, e.current_hours
     FROM core.equipment e
     JOIN core.equipment_type et ON e.type_id = et.type_id
     WHERE e.equipment_id = $1`,
    [equipmentId]
  );

  if (!equipRes.rows[0]) {
    res.status(404).json({ error: 'Équipement non trouvé' });
    return;
  }

  const { fleet_number, category, current_hours } = equipRes.rows[0];

  const prediction = await predictiveMaintenance.analyzeEquipment(
    equipmentId,
    fleet_number,
    category,
    parseFloat(current_hours) || 0
  );

  res.json(prediction);
}

/**
 * GET /api/v1/ai/maintenance-history/:equipmentId
 * Historique des prédictions pour un équipement.
 */
export async function getMaintenancePredictionHistory(req: Request, res: Response): Promise<void> {
  const { equipmentId } = req.params;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

  const result = await query(
    `SELECT prediction_id, predicted_at, component, failure_mode,
            health_score, rul_hours,
            probability_24h, probability_72h, probability_7d,
            recommended_action, recommended_by_date, confirmed
     FROM ai.maintenance_prediction
     WHERE equipment_id = $1
     ORDER BY predicted_at DESC
     LIMIT $2`,
    [equipmentId, limit]
  );
  res.json(result.rows);
}

/**
 * GET /api/v1/ai/dashboard
 * Tableau de bord IA : récapitulatif des 3 modules pour le site.
 */
export async function getAIDashboard(req: AuthRequest, res: Response): Promise<void> {
  const siteId = (req.query.siteId || req.user?.siteId) as string;
  if (!siteId) { res.status(400).json({ error: 'siteId requis' }); return; }

  // Équipements urgents (score santé < 60 ou action urgente)
  const urgent = await query(
    `SELECT DISTINCT ON (mp.equipment_id)
       e.fleet_number, e.equipment_id, et.category,
       mp.health_score, mp.rul_hours, mp.recommended_action,
       mp.component, mp.probability_24h
     FROM ai.maintenance_prediction mp
     JOIN core.equipment e ON mp.equipment_id = e.equipment_id
     JOIN core.equipment_type et ON e.type_id = et.type_id
     WHERE e.site_id = $1
       AND mp.recommended_action IN ('URGENT', 'IMMEDIATE', 'PLAN_MAINTENANCE')
     ORDER BY mp.equipment_id, mp.predicted_at DESC
     LIMIT 10`,
    [siteId]
  );

  // Dernière recommandation dispatch
  const lastDispatch = await query(
    `SELECT rec_id, generated_at, confidence_score, improvement_pct, applied,
            jsonb_array_length(assignments) AS truck_count
     FROM ai.dispatch_recommendation
     WHERE site_id = $1
     ORDER BY generated_at DESC LIMIT 1`,
    [siteId]
  );

  // Statistiques du graphe routier
  const graphStats = routeOptimizer.getGraphStats();

  res.json({
    urgentMaintenances: urgent.rows,
    lastDispatchRec:    lastDispatch.rows[0] || null,
    routeGraph:         graphStats,
    simulationStatus:   simulationEngine_getStatus(),
  });
}

// Import conditionnel pour éviter la dépendance circulaire
import { simulationEngine } from '../services/simulation/SimulationEngine';
function simulationEngine_getStatus() {
  try { return simulationEngine.getStatus(); }
  catch { return { status: 'STOPPED' }; }
}
