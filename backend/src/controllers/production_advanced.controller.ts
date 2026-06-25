/**
 * production_advanced.controller.ts
 * Endpoints de production en temps réel (KPI, horaire, pelles, classement camions).
 * Ces routes complètent le controller production.controller.ts existant.
 */

import { Request, Response } from 'express';
import { productionTracker } from '../services/production/ProductionTracker';

// Typage utilitaire pour accéder au siteId depuis le token JWT
type AuthRequest = Request & { user?: { siteId: string } };

/**
 * GET /api/v1/production/kpi
 * Retourne le KPI principal du poste actif :
 *   - Tonnes actuelles vs objectif
 *   - Taux d'avancement (%)
 *   - Projection fin de poste
 *   - Productivité par camion
 *
 * Query params :
 *   siteId  - (optionnel) UUID de la mine, sinon pris du token
 *   shiftId - (optionnel) UUID du poste, sinon poste ACTIVE
 */
export async function getShiftProductionKPI(req: AuthRequest, res: Response): Promise<void> {
  try {
    const siteId  = (req.query.siteId as string) || req.user?.siteId;
    const shiftId = req.query.shiftId as string | undefined;

    if (!siteId) {
      res.status(400).json({ error: 'siteId requis' });
      return;
    }

    const raw = await productionTracker.getShiftProductionKPI(siteId, shiftId);
    // Normalise snake_case → camelCase pour le frontend
    res.json({
      shiftId:             raw.shift_id,
      shiftName:           raw.shift_name,
      shiftDate:           raw.shift_date,
      currentTonnes:       raw.actual_tonnes,
      targetTonnes:        raw.target_tonnes,
      achievementPct:      raw.achievement_pct,
      totalCycles:         raw.total_cycles,
      targetCycles:        raw.target_cycles,
      elapsedHours:        raw.elapsed_hours,
      projectedTonnes:     raw.projected_tonnes,
      ratePerHour:         raw.tonnes_per_hour,
      productivityPerTruck: raw.productivity_per_truck,
      activeTrucks:        raw.active_trucks,
      remainingTonnes:     Math.max(0, (raw.target_tonnes ?? 0) - (raw.actual_tonnes ?? 0)),
      remainingHours:      0,  // calculé côté frontend si besoin
    });
  } catch (err) {
    console.error('getShiftProductionKPI error:', err);
    res.status(500).json({ error: 'Erreur interne serveur' });
  }
}

/**
 * GET /api/v1/production/hourly
 * Retourne la production heure par heure (tonnes et cycles).
 * Utile pour le graphique d'évolution dans le dashboard.
 *
 * Query params : siteId, shiftId (optionnels)
 */
export async function getHourlyBreakdown(req: AuthRequest, res: Response): Promise<void> {
  try {
    const siteId  = (req.query.siteId as string) || req.user?.siteId;
    const shiftId = req.query.shiftId as string | undefined;

    if (!siteId) {
      res.status(400).json({ error: 'siteId requis' });
      return;
    }

    const data = await productionTracker.getHourlyBreakdown(siteId, shiftId);
    res.json(data);
  } catch (err) {
    console.error('getHourlyBreakdown error:', err);
    res.status(500).json({ error: 'Erreur interne serveur' });
  }
}

/**
 * GET /api/v1/production/loaders
 * Tonnes chargées par pelle (EX-201, EX-202...) sur le poste.
 * Permet de comparer les performances des pelles.
 *
 * Query params : siteId, shiftId (optionnels)
 */
export async function getLoaderBreakdown(req: AuthRequest, res: Response): Promise<void> {
  try {
    const siteId  = (req.query.siteId as string) || req.user?.siteId;
    const shiftId = req.query.shiftId as string | undefined;

    if (!siteId) {
      res.status(400).json({ error: 'siteId requis' });
      return;
    }

    const data = await productionTracker.getLoaderBreakdown(siteId, shiftId);
    res.json(data);
  } catch (err) {
    console.error('getLoaderBreakdown error:', err);
    res.status(500).json({ error: 'Erreur interne serveur' });
  }
}

/**
 * GET /api/v1/production/trucks
 * Classement des camions du meilleur au moins bon par tonnes transportées.
 * Le TOP 3 est mis en avant dans le rapport de poste.
 *
 * Query params : siteId, shiftId (optionnels)
 */
export async function getTruckRanking(req: AuthRequest, res: Response): Promise<void> {
  try {
    const siteId  = (req.query.siteId as string) || req.user?.siteId;
    const shiftId = req.query.shiftId as string | undefined;

    if (!siteId) {
      res.status(400).json({ error: 'siteId requis' });
      return;
    }

    const data = await productionTracker.getTruckRanking(siteId, shiftId);
    res.json(data);
  } catch (err) {
    console.error('getTruckRanking error:', err);
    res.status(500).json({ error: 'Erreur interne serveur' });
  }
}
