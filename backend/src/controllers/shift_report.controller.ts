/**
 * shift_report.controller.ts
 * Endpoints pour la génération et la consultation des rapports de poste.
 */

import { Request, Response } from 'express';
import { shiftReportGenerator } from '../services/reporting/ShiftReportGenerator';
import { query } from '../config/database';

type AuthRequest = Request & { user?: { siteId: string } };

/**
 * GET /api/v1/shift-reports
 * Liste les derniers rapports de poste pour un site.
 * Triés du plus récent au plus ancien.
 *
 * Query params :
 *   siteId - UUID de la mine (optionnel si dans le token)
 *   limit  - Nombre de rapports (défaut : 10, max : 50)
 */
export async function listReports(req: AuthRequest, res: Response): Promise<void> {
  try {
    const siteId = (req.query.siteId as string) || req.user?.siteId;
    const limit  = Math.min(50, parseInt(req.query.limit as string || '10', 10));

    if (!siteId) {
      res.status(400).json({ error: 'siteId requis' });
      return;
    }

    const data = await shiftReportGenerator.listReports(siteId, limit);
    res.json(data);
  } catch (err) {
    console.error('listReports error:', err);
    res.status(500).json({ error: 'Erreur interne serveur' });
  }
}

/**
 * GET /api/v1/shift-reports/:shiftId
 * Récupère un rapport existant pour un poste donné.
 * Retourne 404 si aucun rapport n'a encore été généré pour ce poste.
 *
 * Params :
 *   shiftId - UUID du poste
 */
export async function getReport(req: Request, res: Response): Promise<void> {
  try {
    const { shiftId } = req.params;
    if (!shiftId) {
      res.status(400).json({ error: 'shiftId requis dans l\'URL' });
      return;
    }

    const data = await shiftReportGenerator.getReport(shiftId);
    if (!data) {
      res.status(404).json({ error: `Aucun rapport trouvé pour le poste ${shiftId}` });
      return;
    }

    res.json(data);
  } catch (err) {
    console.error('getReport error:', err);
    res.status(500).json({ error: 'Erreur interne serveur' });
  }
}

/**
 * POST /api/v1/shift-reports/generate
 * Génère (ou régénère) le rapport complet d'un poste.
 * Peut être appelé manuellement par le dispatcher ou en fin de poste.
 *
 * Si un rapport existe déjà pour ce poste, il est mis à jour.
 *
 * Body requis :
 *   shiftId - UUID du poste à rapporter
 *
 * Body optionnel :
 *   siteId - UUID de la mine (sinon pris du token)
 */
export async function generateReport(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { siteId } = req.body as { shiftId?: string; siteId?: string };
    let { shiftId } = req.body as { shiftId?: string };
    const resolvedSiteId = siteId || req.user?.siteId;

    if (!resolvedSiteId) {
      res.status(400).json({ error: 'siteId requis' });
      return;
    }

    // Auto-détecte le poste actif si shiftId non fourni
    if (!shiftId) {
      const r = await query(
        `SELECT shift_id FROM core.shift WHERE site_id = $1 AND status = 'ACTIVE' LIMIT 1`,
        [resolvedSiteId]
      );
      shiftId = r.rows[0]?.shift_id;
      if (!shiftId) {
        res.status(404).json({ error: 'Aucun poste actif trouvé pour ce site' });
        return;
      }
    }

    const report = await shiftReportGenerator.generateReport(resolvedSiteId, shiftId);
    res.status(201).json(report);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('generateReport error:', msg);
    res.status(500).json({ error: msg });
  }
}
