/**
 * delay.controller.ts
 * Endpoints pour la gestion des codes de délai (temps non productifs).
 * Permet d'ouvrir/fermer des événements et de calculer MA/PA/UA.
 */

import { Request, Response } from 'express';
import { delayTracker } from '../services/delay/DelayTracker';

type AuthRequest = Request & { user?: { siteId: string } };

/**
 * GET /api/v1/delays/active
 * Liste les délais actuellement ouverts (ended_at NULL).
 * Affiché en temps réel dans le panneau de contrôle du dispatcher.
 *
 * Query params : siteId (optionnel si dans le token)
 */
export async function getOpenDelays(req: AuthRequest, res: Response): Promise<void> {
  try {
    const siteId = (req.query.siteId as string) || req.user?.siteId;
    if (!siteId) {
      res.status(400).json({ error: 'siteId requis' });
      return;
    }

    const data = await delayTracker.getOpenDelays(siteId);
    res.json(data);
  } catch (err) {
    console.error('getOpenDelays error:', err);
    res.status(500).json({ error: 'Erreur interne serveur' });
  }
}

/**
 * GET /api/v1/delays/shift
 * Tous les délais du poste actif (ouverts + fermés) avec durée.
 * Vue complète pour le rapport de poste.
 *
 * Query params : siteId, shiftId (optionnels)
 */
export async function getShiftDelays(req: AuthRequest, res: Response): Promise<void> {
  try {
    const siteId  = (req.query.siteId as string) || req.user?.siteId;
    const shiftId = req.query.shiftId as string | undefined;

    if (!siteId) {
      res.status(400).json({ error: 'siteId requis' });
      return;
    }

    const data = await delayTracker.getShiftDelays(siteId, shiftId);
    res.json(data);
  } catch (err) {
    console.error('getShiftDelays error:', err);
    res.status(500).json({ error: 'Erreur interne serveur' });
  }
}

/**
 * GET /api/v1/delays/summary
 * Résumé des délais avec indicateurs MA%, PA%, UA%.
 * Données clés pour évaluer la performance de la flotte.
 *
 * Query params : siteId, shiftId (optionnels)
 */
export async function getDelaySummary(req: AuthRequest, res: Response): Promise<void> {
  try {
    const siteId  = (req.query.siteId as string) || req.user?.siteId;
    const shiftId = req.query.shiftId as string | undefined;

    if (!siteId) {
      res.status(400).json({ error: 'siteId requis' });
      return;
    }

    const data = await delayTracker.getDelaySummary(siteId, shiftId);
    res.json(data);
  } catch (err) {
    console.error('getDelaySummary error:', err);
    res.status(500).json({ error: 'Erreur interne serveur' });
  }
}

/**
 * POST /api/v1/delays/open
 * Ouvre un nouvel événement de délai pour un équipement.
 *
 * Body requis :
 *   siteId      - UUID de la mine
 *   equipmentId - UUID de l'équipement
 *   catCode     - Code délai (ex: 'WAIT-SHO', 'MAINT-CM')
 *
 * Body optionnel :
 *   notes         - Commentaire de l'opérateur
 *   autoDetected  - TRUE si détecté automatiquement (défaut : FALSE)
 */
export async function openDelay(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { siteId, equipmentId, catCode, notes, autoDetected } = req.body as {
      siteId?: string;
      equipmentId?: string;
      catCode?: string;
      notes?: string;
      autoDetected?: boolean;
    };

    const resolvedSiteId = siteId || req.user?.siteId;

    if (!resolvedSiteId || !equipmentId || !catCode) {
      res.status(400).json({ error: 'siteId, equipmentId et catCode sont requis' });
      return;
    }

    const eventId = await delayTracker.openDelay(
      resolvedSiteId, equipmentId, catCode, notes, autoDetected ?? false
    );

    res.status(201).json({ event_id: eventId, status: 'opened' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur interne serveur';
    console.error('openDelay error:', err);
    res.status(400).json({ error: message });
  }
}

/**
 * POST /api/v1/delays/close/:eventId
 * Ferme un événement de délai (enregistre ended_at = NOW()).
 *
 * Params :
 *   eventId - UUID de l'événement de délai à fermer
 */
export async function closeDelay(req: Request, res: Response): Promise<void> {
  try {
    const { eventId } = req.params;
    if (!eventId) {
      res.status(400).json({ error: 'eventId requis dans l\'URL' });
      return;
    }

    await delayTracker.closeDelay(eventId);
    res.json({ event_id: eventId, status: 'closed' });
  } catch (err) {
    console.error('closeDelay error:', err);
    res.status(500).json({ error: 'Erreur interne serveur' });
  }
}

/**
 * GET /api/v1/delays/categories
 * Liste toutes les catégories de délai disponibles.
 * Utilisé pour les listes déroulantes dans l'interface.
 */
export async function getDelayCategories(_req: Request, res: Response): Promise<void> {
  try {
    const data = await delayTracker.getCategories();
    res.json(data);
  } catch (err) {
    console.error('getDelayCategories error:', err);
    res.status(500).json({ error: 'Erreur interne serveur' });
  }
}

/**
 * POST /api/v1/delays/auto-detect
 * Détecte automatiquement les camions immobiles depuis > 5 min.
 * Ouvre un délai WAIT-SHO pour chacun d'eux.
 *
 * Body requis : siteId (ou depuis le token JWT)
 */
export async function autoDetectIdleTrucks(req: AuthRequest, res: Response): Promise<void> {
  try {
    const siteId = (req.body?.siteId as string) || req.user?.siteId;
    if (!siteId) {
      res.status(400).json({ error: 'siteId requis' });
      return;
    }

    const opened = await delayTracker.autoDetectIdleTrucks(siteId);
    res.json({ detected: opened, message: `${opened} délai(s) WAIT-SHO ouverts automatiquement` });
  } catch (err) {
    console.error('autoDetectIdleTrucks error:', err);
    res.status(500).json({ error: 'Erreur interne serveur' });
  }
}
