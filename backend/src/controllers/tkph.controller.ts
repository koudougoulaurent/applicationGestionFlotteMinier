/**
 * tkph.controller.ts
 * Endpoints pour le calcul et la surveillance du TKPH des pneus.
 * TKPH = Tonnes-Kilomètres Par Heure : indicateur de chaleur des pneus.
 */

import { Request, Response } from 'express';
import { tkphCalculator } from '../services/maintenance/TKPHCalculator';

type AuthRequest = Request & { user?: { siteId: string } };

/**
 * GET /api/v1/tyres/tkph
 * Statut TKPH actuel de toute la flotte du site.
 * Groupe les résultats par équipement avec le pneu le plus chargé mis en avant.
 *
 * Niveau d'alerte :
 *   OK       : TKPH réel < 75% du nominal
 *   WARNING  : TKPH réel entre 75% et 85% du nominal
 *   CRITICAL : TKPH réel > 85% du nominal → risque de surchauffe
 *
 * Query params : siteId (optionnel si dans le token)
 */
export async function getTKPHStatus(req: AuthRequest, res: Response): Promise<void> {
  try {
    const siteId = (req.query.siteId as string) || req.user?.siteId;

    if (!siteId) {
      res.status(400).json({ error: 'siteId requis' });
      return;
    }

    const data = await tkphCalculator.getTKPHStatus(siteId);
    res.json(data);
  } catch (err) {
    console.error('getTKPHStatus error:', err);
    res.status(500).json({ error: 'Erreur interne serveur' });
  }
}

/**
 * GET /api/v1/tyres/overloaded
 * Retourne uniquement les pneus dépassant 85% de leur TKPH nominal.
 * Liste d'intervention prioritaire pour la maintenance.
 *
 * Query params : siteId (optionnel si dans le token)
 */
export async function getOverloadedTyres(req: AuthRequest, res: Response): Promise<void> {
  try {
    const siteId = (req.query.siteId as string) || req.user?.siteId;

    if (!siteId) {
      res.status(400).json({ error: 'siteId requis' });
      return;
    }

    const data = await tkphCalculator.getOverloadedTyres(siteId);
    res.json({
      count: data.length,
      tyres: data,
    });
  } catch (err) {
    console.error('getOverloadedTyres error:', err);
    res.status(500).json({ error: 'Erreur interne serveur' });
  }
}

/**
 * POST /api/v1/tyres/calculate
 * Lance le calcul TKPH pour tous les camions actifs du site.
 * Met à jour maintenance.tyre_tkph avec les valeurs du jour.
 *
 * À appeler périodiquement (CRON toutes les heures) ou manuellement.
 *
 * Body requis : siteId (ou depuis le token JWT)
 */
export async function calculateForSite(req: AuthRequest, res: Response): Promise<void> {
  try {
    const siteId = (req.body?.siteId as string) || req.user?.siteId;

    if (!siteId) {
      res.status(400).json({ error: 'siteId requis' });
      return;
    }

    const processed = await tkphCalculator.calculateForSite(siteId);
    res.json({
      processed,
      message: `TKPH calculé pour ${processed} camion(s)`,
      calc_date: new Date().toISOString().slice(0, 10),
    });
  } catch (err) {
    console.error('calculateForSite error:', err);
    res.status(500).json({ error: 'Erreur interne serveur' });
  }
}
