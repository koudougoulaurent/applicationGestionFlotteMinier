/**
 * simulation.controller.ts
 * Contrôleur pour l'API de contrôle du moteur de simulation.
 * Expose les endpoints pour démarrer, arrêter et monitorer la simulation.
 */

import { Request, Response } from 'express';
import { simulationEngine } from '../services/simulation/SimulationEngine';
import { bnrSensor } from '../services/sensors/BNRSensor';
import { query } from '../config/database';
import { liveTelemetry } from '../services/telemetry/LiveTelemetryService';

type AuthRequest = Request & { user?: { userId: string; siteId: string; role: string } };

// ── Contrôle de la simulation ─────────────────────────────────────────────────

/**
 * POST /api/v1/simulation/start
 * Démarre la simulation pour le site de l'utilisateur connecté.
 * Body : { speedMultiplier?: number, siteId?: string }
 */
export async function startSimulation(req: AuthRequest, res: Response): Promise<void> {
  const siteId          = req.body.siteId || req.user?.siteId;
  const speedMultiplier = parseFloat(req.body.speedMultiplier) || 1.0;

  if (!siteId) {
    res.status(400).json({ error: 'siteId requis' });
    return;
  }

  // Injecte Socket.io dans le moteur (nécessaire pour les broadcasts)
  const io = req.app.get('io');
  simulationEngine.init(io);

  await simulationEngine.start(siteId, speedMultiplier);

  res.json({
    message:         'Simulation démarrée',
    ...simulationEngine.getStatus(),
  });
}

/**
 * POST /api/v1/simulation/stop
 * Arrête la simulation et remet tous les camions en AVAILABLE.
 */
export async function stopSimulation(_req: Request, res: Response): Promise<void> {
  await simulationEngine.stop();
  res.json({ message: 'Simulation arrêtée', status: 'STOPPED' });
}

/**
 * POST /api/v1/simulation/pause
 * Suspend la simulation (l'état des camions est conservé).
 */
export async function pauseSimulation(_req: Request, res: Response): Promise<void> {
  simulationEngine.pause();
  res.json({ message: 'Simulation en pause', ...simulationEngine.getStatus() });
}

/**
 * POST /api/v1/simulation/resume
 * Reprend la simulation après une pause.
 */
export async function resumeSimulation(_req: Request, res: Response): Promise<void> {
  simulationEngine.resume();
  res.json({ message: 'Simulation reprise', ...simulationEngine.getStatus() });
}

/**
 * PATCH /api/v1/simulation/speed
 * Change le multiplicateur de vitesse en cours de simulation.
 * Body : { multiplier: number }  (0.5 – 20)
 */
export async function setSimSpeed(req: Request, res: Response): Promise<void> {
  const multiplier = parseFloat(req.body.multiplier);
  if (isNaN(multiplier) || multiplier < 0.5 || multiplier > 20) {
    res.status(400).json({ error: 'multiplier doit être entre 0.5 et 20' });
    return;
  }
  simulationEngine.setSpeed(multiplier);
  res.json({ speedMultiplier: multiplier });
}

/**
 * GET /api/v1/simulation/status
 * Retourne l'état courant de la simulation (statut + tous les camions).
 *
 * Mode hybride : les engins réels (liveTelemetry) prennent le dessus
 * sur leur jumeau simulé. Les engins sans signal réel restent simulés.
 * Chaque engin porte un flag isReal:true/false.
 */
export async function getSimStatus(_req: Request, res: Response): Promise<void> {
  const simStatus = simulationEngine.getStatus();
  const liveSet   = liveTelemetry.getLiveFleetNumbers();

  if (liveSet.size === 0) {
    // Aucun engin réel → réponse simulation pure, marquer isReal: false
    res.json({
      ...simStatus,
      trucks: simStatus.trucks.map(t => ({ ...t, isReal: false })),
      liveCount: 0,
    });
    return;
  }

  // Merger : remplacer les camions simulés par leurs jumeaux réels
  const mergedTrucks = simStatus.trucks.map(t => {
    if (!liveSet.has(t.fleetNumber)) return { ...t, isReal: false };
    const live = liveTelemetry.serialize(t.fleetNumber);
    return live ?? { ...t, isReal: false };
  });

  // Ajouter les engins réels qui ne sont pas dans la simulation (nouveaux engins)
  liveSet.forEach(fn => {
    const alreadyIn = mergedTrucks.some(t => t.fleetNumber === fn);
    if (!alreadyIn) {
      const live = liveTelemetry.serialize(fn);
      if (live) mergedTrucks.push(live);
    }
  });

  res.json({
    ...simStatus,
    trucks:    mergedTrucks,
    liveCount: liveSet.size,
  });
}

// ── Scénarios ─────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/simulation/scenarios
 * Liste les scénarios de simulation disponibles.
 */
export async function listScenarios(req: AuthRequest, res: Response): Promise<void> {
  const siteId = req.query.siteId || req.user?.siteId;
  const result = await query(
    `SELECT s.*, ms.name AS site_name
     FROM simulation.scenario s
     LEFT JOIN core.mine_site ms ON s.site_id = ms.site_id
     WHERE s.site_id = $1 OR s.site_id IS NULL
     ORDER BY s.created_at DESC`,
    [siteId]
  );
  res.json(result.rows);
}

// ── Journal de simulation ─────────────────────────────────────────────────────

/**
 * GET /api/v1/simulation/events
 * Retourne les derniers événements du journal de simulation.
 * Query params : limit (défaut 100), equipmentId, eventType
 */
export async function getSimEvents(req: AuthRequest, res: Response): Promise<void> {
  const siteId      = req.query.siteId || req.user?.siteId;
  const limit       = Math.min(parseInt(req.query.limit as string) || 100, 500);
  const equipmentId = req.query.equipmentId as string;
  const eventType   = req.query.eventType as string;

  const conditions: string[] = ['site_id = $1'];
  const params: unknown[]    = [siteId];
  let idx = 2;

  if (equipmentId) { conditions.push(`equipment_id = $${idx++}`); params.push(equipmentId); }
  if (eventType)   { conditions.push(`event_type = $${idx++}`);   params.push(eventType); }

  const result = await query(
    `SELECT log_id, recorded_at, event_type, fleet_number, payload
     FROM simulation.event_log
     WHERE ${conditions.join(' AND ')}
     ORDER BY recorded_at DESC
     LIMIT $${idx}`,
    [...params, limit]
  );
  res.json(result.rows);
}

// ── Capteurs BNR ──────────────────────────────────────────────────────────────

/**
 * GET /api/v1/simulation/sensors/bnr
 * Retourne le résumé des capteurs BNR du site.
 */
export async function getBNRSummary(req: AuthRequest, res: Response): Promise<void> {
  const siteId = (req.query.siteId || req.user?.siteId) as string;
  if (!siteId) { res.status(400).json({ error: 'siteId requis' }); return; }

  const summary = await bnrSensor.getLatestReadings(siteId);
  res.json(summary);
}

/**
 * POST /api/v1/simulation/sensors/bnr/generate
 * Génère une nouvelle lecture simulée pour les capteurs BNR.
 * Body : { siteId?, profile?: 'STABLE' | 'HUMID' | 'PRE_BLAST' | 'POST_BLAST' | 'CRITICAL' }
 */
export async function generateBNRReadings(req: AuthRequest, res: Response): Promise<void> {
  const siteId  = req.body.siteId || req.user?.siteId;
  const profile = req.body.profile || 'STABLE';

  const validProfiles = ['STABLE', 'HUMID', 'PRE_BLAST', 'POST_BLAST', 'CRITICAL'];
  if (!validProfiles.includes(profile)) {
    res.status(400).json({ error: `profile doit être : ${validProfiles.join(', ')}` });
    return;
  }

  const readings = await bnrSensor.generateReadings(siteId, profile);
  res.json({ generated: readings.length, readings });
}

/**
 * GET /api/v1/simulation/sensors/bnr/:stationId/history
 * Historique des lectures d'une station BNR (pour les graphes).
 * Query params : hours (défaut 24)
 */
export async function getBNRHistory(req: Request, res: Response): Promise<void> {
  const { stationId } = req.params;
  const hours = parseInt(req.query.hours as string) || 24;
  const history = await bnrSensor.getStationHistory(stationId, hours);
  res.json(history);
}
