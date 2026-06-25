/**
 * material.controller.ts
 * Endpoints pour le suivi de la matière (minerai, stérile, low-grade).
 * Gère les chargements, la classification et la détection de mauvaises destinations.
 */

import { Request, Response } from 'express';
import { materialTracker, MaterialLoadInput } from '../services/material/MaterialTracker';

type AuthRequest = Request & { user?: { siteId: string } };

/**
 * GET /api/v1/material/breakdown
 * Répartition des tonnes par type de matière sur le poste actif.
 * Exemple : OXIDE 2400t (40%), WASTE 3200t (53%), LOW_GRADE 400t (7%)
 *
 * Query params : siteId, shiftId (optionnels)
 */
export async function getMaterialBreakdown(req: AuthRequest, res: Response): Promise<void> {
  try {
    const siteId  = (req.query.siteId as string) || req.user?.siteId;
    const shiftId = req.query.shiftId as string | undefined;

    if (!siteId) {
      res.status(400).json({ error: 'siteId requis' });
      return;
    }

    const rows = await materialTracker.getMaterialBreakdown(siteId, shiftId);
    // Normalise le tableau en objet structuré pour le frontend
    const byType = (Array.isArray(rows) ? rows : []).map((r) => ({
      type:     r.material_type,
      tonnes:   Number(r.tonnes ?? 0),
      pct:      Number(r.pct_of_total ?? 0),
      avgGrade: Number(r.avg_grade_cu ?? 0),
    }));
    const totalTonnes = byType.reduce((s, t) => s + t.tonnes, 0);
    const oreTonnes   = byType.filter(t => ['OXIDE','SULPHIDE'].includes(String(t.type))).reduce((s,t)=>s+t.tonnes,0);
    const wasteTonnes = byType.filter(t => t.type === 'WASTE').reduce((s,t)=>s+t.tonnes,0);
    const avgGradeCu  = byType.reduce((s,t) => s + t.avgGrade * t.tonnes, 0) / (totalTonnes || 1);
    res.json({ byType, totalTonnes, oreTonnes, wasteTonnes, avgGradeCu: +avgGradeCu.toFixed(3) });
  } catch (err) {
    console.error('getMaterialBreakdown error:', err);
    res.status(500).json({ error: 'Erreur interne serveur' });
  }
}

/**
 * GET /api/v1/material/flow
 * Flux source → destination (données pour diagramme Sankey).
 * Exemple : PIT-1 → CRUSH-1 : 2400t OXIDE
 *
 * Query params : siteId, shiftId (optionnels)
 */
export async function getMaterialFlow(req: AuthRequest, res: Response): Promise<void> {
  try {
    const siteId  = (req.query.siteId as string) || req.user?.siteId;
    const shiftId = req.query.shiftId as string | undefined;

    if (!siteId) {
      res.status(400).json({ error: 'siteId requis' });
      return;
    }

    const data = await materialTracker.getMaterialFlow(siteId, shiftId);
    res.json(data);
  } catch (err) {
    console.error('getMaterialFlow error:', err);
    res.status(500).json({ error: 'Erreur interne serveur' });
  }
}

/**
 * GET /api/v1/material/misdirected
 * Liste les chargements envoyés à mauvaise destination (correct_dest = FALSE).
 * Permet au dispatcher de détecter et corriger les erreurs d'orientation.
 *
 * Query params :
 *   siteId - UUID de la mine
 *   hours  - Fenêtre temporelle en heures (défaut : 8)
 */
export async function getMisdirectedLoads(req: AuthRequest, res: Response): Promise<void> {
  try {
    const siteId = (req.query.siteId as string) || req.user?.siteId;
    const hours  = parseInt(req.query.hours as string || '8', 10);

    if (!siteId) {
      res.status(400).json({ error: 'siteId requis' });
      return;
    }

    const data = await materialTracker.getMisdirectedLoads(siteId, hours);
    res.json(data);
  } catch (err) {
    console.error('getMisdirectedLoads error:', err);
    res.status(500).json({ error: 'Erreur interne serveur' });
  }
}

/**
 * POST /api/v1/material/record
 * Enregistre un nouveau chargement de matière.
 * Vérifie automatiquement si la destination est correcte.
 *
 * Body requis :
 *   siteId       - UUID de la mine
 *   truckId      - UUID du camion
 *   materialType - OXIDE | SULPHIDE | LOW_GRADE | WASTE | TOPSOIL
 *
 * Body optionnel :
 *   shiftId, loaderId, sourceId, destinationId,
 *   gradeCuPct, payloadTonnes, notes
 */
export async function recordLoad(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      siteId, shiftId, truckId, loaderId,
      sourceId, destinationId, materialType,
      gradeCuPct, payloadTonnes, notes,
    } = req.body as MaterialLoadInput;

    const resolvedSiteId = siteId || req.user?.siteId;

    if (!resolvedSiteId || !truckId || !materialType) {
      res.status(400).json({ error: 'siteId, truckId et materialType sont requis' });
      return;
    }

    const validTypes = ['OXIDE', 'SULPHIDE', 'LOW_GRADE', 'WASTE', 'TOPSOIL', 'UNKNOWN'];
    if (!validTypes.includes(materialType)) {
      res.status(400).json({ error: `materialType invalide. Valeurs : ${validTypes.join(', ')}` });
      return;
    }

    const result = await materialTracker.recordLoad({
      siteId: resolvedSiteId,
      shiftId, truckId, loaderId,
      sourceId, destinationId, materialType,
      gradeCuPct, payloadTonnes, notes,
    });

    const status = result.correct_dest ? 201 : 201; // toujours 201 mais avec warning
    res.status(status).json(result);
  } catch (err) {
    console.error('recordLoad error:', err);
    res.status(500).json({ error: 'Erreur interne serveur' });
  }
}

/**
 * GET /api/v1/material/grade-trend
 * Évolution du grade Cu% heure par heure sur les dernières heures.
 * Concerne uniquement les minerais (OXIDE, SULPHIDE).
 *
 * Query params :
 *   siteId - UUID de la mine
 *   hours  - Fenêtre temporelle (défaut : 12)
 */
export async function getGradeTrend(req: AuthRequest, res: Response): Promise<void> {
  try {
    const siteId = (req.query.siteId as string) || req.user?.siteId;
    const hours  = parseInt(req.query.hours as string || '12', 10);

    if (!siteId) {
      res.status(400).json({ error: 'siteId requis' });
      return;
    }

    const data = await materialTracker.getGradeTrend(siteId, hours);
    res.json(data);
  } catch (err) {
    console.error('getGradeTrend error:', err);
    res.status(500).json({ error: 'Erreur interne serveur' });
  }
}
