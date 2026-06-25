/**
 * speed.controller.ts
 * Endpoints pour la surveillance des vitesses et la gestion des infractions.
 */

import { Request, Response } from 'express';
import { speedMonitor } from '../services/speed/SpeedMonitor';

type AuthRequest = Request & { user?: { siteId: string } };

/**
 * GET /api/v1/speed/violations
 * Liste les infractions de vitesse pour un site.
 * Filtrage optionnel par équipement et par fenêtre temporelle.
 *
 * Query params :
 *   siteId      - UUID de la mine (optionnel si dans le token)
 *   hours       - Nombre d'heures à couvrir (défaut : 8)
 *   equipmentId - Filtrer sur un camion spécifique (optionnel)
 */
export async function getViolations(req: AuthRequest, res: Response): Promise<void> {
  try {
    const siteId      = (req.query.siteId as string) || req.user?.siteId;
    const hours       = parseInt(req.query.hours as string || '8', 10);
    const equipmentId = req.query.equipmentId as string | undefined;

    if (!siteId) {
      res.status(400).json({ error: 'siteId requis' });
      return;
    }

    const rows = await speedMonitor.getViolations(siteId, hours, equipmentId);
    // Normalise snake_case → camelCase
    const violations = (Array.isArray(rows) ? rows : []).map((r) => ({
      violId:      r.viol_id,
      fleetNumber: r.fleet_number,
      roadName:    r.road_name,
      detectedAt:  r.detected_at,
      speedKmh:    Number(r.speed_kmh ?? 0),
      limitKmh:    Number(r.limit_kmh ?? 0),
      excessPct:   Number(r.excess_pct ?? 0),
      lat:         r.lat,
      lon:         r.lon,
      severity:    r.severity ?? 'WARNING',
    }));
    res.json(violations);
  } catch (err) {
    console.error('getViolations error:', err);
    res.status(500).json({ error: 'Erreur interne serveur' });
  }
}

/**
 * GET /api/v1/speed/summary
 * Résumé des infractions par camion et par tronçon de route.
 * Identifie les chauffeurs à risque et les zones dangereuses.
 *
 * Query params : siteId, shiftId (optionnels)
 */
export async function getViolationSummary(req: AuthRequest, res: Response): Promise<void> {
  try {
    const siteId  = (req.query.siteId as string) || req.user?.siteId;
    const shiftId = req.query.shiftId as string | undefined;

    if (!siteId) {
      res.status(400).json({ error: 'siteId requis' });
      return;
    }

    const data = await speedMonitor.getViolationSummary(siteId, shiftId);
    res.json(data);
  } catch (err) {
    console.error('getViolationSummary error:', err);
    res.status(500).json({ error: 'Erreur interne serveur' });
  }
}

/**
 * GET /api/v1/speed/limits
 * Retourne les limites de vitesse par tronçon de route.
 * Affiché sur la carte du dispatcher.
 *
 * Query params : siteId (optionnel si dans le token)
 */
export async function getRoadSpeedLimits(req: AuthRequest, res: Response): Promise<void> {
  try {
    const siteId = (req.query.siteId as string) || req.user?.siteId;

    if (!siteId) {
      res.status(400).json({ error: 'siteId requis' });
      return;
    }

    const data = await speedMonitor.getRoadSpeedLimits(siteId);
    res.json(data);
  } catch (err) {
    console.error('getRoadSpeedLimits error:', err);
    res.status(500).json({ error: 'Erreur interne serveur' });
  }
}

/**
 * POST /api/v1/speed/check
 * Vérifie si un équipement dépasse la limite sur un tronçon.
 * Enregistre automatiquement une infraction si dépassement.
 * Appelé par le système GPS à chaque mise à jour de position.
 *
 * Body requis :
 *   equipmentId - UUID du camion
 *   roadId      - UUID du tronçon de route
 *   speedKmh    - Vitesse mesurée par GPS
 *
 * Body optionnel :
 *   lat, lon - Coordonnées GPS
 */
export async function checkSpeed(req: Request, res: Response): Promise<void> {
  try {
    const { equipmentId, roadId, speedKmh, lat, lon } = req.body as {
      equipmentId?: string;
      roadId?: string;
      speedKmh?: number;
      lat?: number;
      lon?: number;
    };

    if (!equipmentId || !roadId || speedKmh === undefined) {
      res.status(400).json({ error: 'equipmentId, roadId et speedKmh sont requis' });
      return;
    }

    if (typeof speedKmh !== 'number' || speedKmh < 0) {
      res.status(400).json({ error: 'speedKmh doit être un nombre positif' });
      return;
    }

    const result = await speedMonitor.checkSpeed(equipmentId, roadId, speedKmh, lat, lon);
    res.json(result);
  } catch (err) {
    console.error('checkSpeed error:', err);
    res.status(500).json({ error: 'Erreur interne serveur' });
  }
}
