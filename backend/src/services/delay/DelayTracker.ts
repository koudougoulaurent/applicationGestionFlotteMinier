/**
 * DelayTracker.ts
 * Gère les codes de délai — temps non productifs de chaque équipement.
 * Détecte automatiquement les arrêts > 5 min et ouvre un événement.
 *
 * Calcule les indicateurs de disponibilité (standard minier) :
 *   MA (Mechanical Availability)  = (Total - Panne méca) / Total × 100
 *   PA (Physical Availability)    = (Total - Toute maint) / Total × 100
 *   UA (Utilisation Availability) = Heures productives / (Total - Maint) × 100
 */

import { query } from '../../config/database';

// ── Types ────────────────────────────────────────────────────────────────────

/** Résumé des délais par catégorie + indicateurs MA/PA/UA */
export interface DelaySummary {
  by_category: DelayCategoryTotal[];
  /** Disponibilité Mécanique en % */
  ma_pct: number;
  /** Disponibilité Physique en % */
  pa_pct: number;
  /** Taux d'utilisation en % */
  ua_pct: number;
  /** Total minutes de délai sur le poste */
  total_delay_min: number;
  /** Durée totale du poste en minutes */
  shift_duration_min: number;
}

export interface DelayCategoryTotal {
  code: string;
  label: string;
  type: string;
  planned: boolean;
  affects_ma: boolean;
  count: number;
  total_min: number;
}

export interface DelayEvent {
  event_id: string;
  equipment_id: string;
  fleet_number: string;
  cat_code: string;
  cat_label: string;
  cat_type: string;
  started_at: string;
  ended_at: string | null;
  duration_min: number | null;
  notes: string | null;
  auto_detected: boolean;
}

export interface DelayCategory {
  cat_id: string;
  code: string;
  label: string;
  type: string;
  planned: boolean;
  affects_ma: boolean;
}

// ── Classe principale ─────────────────────────────────────────────────────────

export class DelayTracker {

  /**
   * Ouvre un nouvel événement de délai pour un équipement.
   * L'événement reste "ouvert" (ended_at NULL) jusqu'à appel de closeDelay().
   *
   * @param siteId        - Mine concernée
   * @param equipmentId   - Équipement en arrêt
   * @param catCode       - Code délai (ex: 'WAIT-SHO', 'MAINT-CM')
   * @param notes         - Commentaire optionnel de l'opérateur
   * @param autoDetected  - TRUE si détecté automatiquement par le système
   */
  async openDelay(
    siteId: string,
    equipmentId: string,
    catCode: string,
    notes?: string,
    autoDetected = false
  ): Promise<string> {
    // Résoudre le poste actif
    const shiftResult = await query(
      `SELECT shift_id FROM core.shift
       WHERE site_id = $1 AND status = 'ACTIVE'
       ORDER BY start_time DESC LIMIT 1`,
      [siteId]
    );
    const shiftId = shiftResult.rows[0]?.shift_id ?? null;

    // Trouver le cat_id depuis le code
    const catResult = await query(
      `SELECT cat_id FROM operations.delay_category WHERE code = $1`,
      [catCode]
    );

    if (catResult.rows.length === 0) {
      throw new Error(`Code de délai inconnu : ${catCode}`);
    }

    const catId = catResult.rows[0].cat_id;

    // Insérer l'événement ouvert
    const result = await query(
      `INSERT INTO operations.delay_event
         (site_id, shift_id, equipment_id, cat_id, started_at, notes, auto_detected)
       VALUES ($1, $2, $3, $4, NOW(), $5, $6)
       RETURNING event_id`,
      [siteId, shiftId, equipmentId, catId, notes ?? null, autoDetected]
    );

    return result.rows[0].event_id as string;
  }

  /**
   * Ferme un événement de délai en enregistrant l'heure de fin.
   * Calcule automatiquement la durée dans la vue (ended_at - started_at).
   *
   * @param eventId - UUID de l'événement à fermer
   */
  async closeDelay(eventId: string): Promise<void> {
    await query(
      `UPDATE operations.delay_event
       SET ended_at = NOW()
       WHERE event_id = $1 AND ended_at IS NULL`,
      [eventId]
    );
  }

  /**
   * Liste les délais actuellement ouverts (ended_at NULL) pour un site.
   * Le dispatcher peut les voir en temps réel et les fermer manuellement.
   */
  async getOpenDelays(siteId: string): Promise<DelayEvent[]> {
    const result = await query(
      `SELECT
         de.event_id,
         de.equipment_id,
         e.fleet_number,
         dc.code AS cat_code,
         dc.label AS cat_label,
         dc.type AS cat_type,
         TO_CHAR(de.started_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS started_at,
         NULL AS ended_at,
         -- Durée depuis l'ouverture jusqu'à maintenant (minutes)
         ROUND(EXTRACT(EPOCH FROM (NOW() - de.started_at)) / 60.0, 1)::NUMERIC AS duration_min,
         de.notes,
         de.auto_detected
       FROM operations.delay_event de
       JOIN core.equipment e ON de.equipment_id = e.equipment_id
       JOIN operations.delay_category dc ON de.cat_id = dc.cat_id
       WHERE de.site_id = $1
         AND de.ended_at IS NULL
       ORDER BY de.started_at DESC`,
      [siteId]
    );

    return this._mapRows(result.rows);
  }

  /**
   * Retourne tous les délais du poste (ouverts et fermés) avec leur durée.
   * Utilisé pour le tableau récapitulatif en fin de poste.
   */
  async getShiftDelays(siteId: string, shiftId?: string): Promise<DelayEvent[]> {
    const resolvedShiftId = await this._resolveShiftId(siteId, shiftId);

    const result = await query(
      `SELECT
         de.event_id,
         de.equipment_id,
         e.fleet_number,
         dc.code AS cat_code,
         dc.label AS cat_label,
         dc.type AS cat_type,
         TO_CHAR(de.started_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS started_at,
         TO_CHAR(de.ended_at,   'YYYY-MM-DD"T"HH24:MI:SS') AS ended_at,
         ROUND(
           EXTRACT(EPOCH FROM (COALESCE(de.ended_at, NOW()) - de.started_at)) / 60.0,
           1
         )::NUMERIC AS duration_min,
         de.notes,
         de.auto_detected
       FROM operations.delay_event de
       JOIN core.equipment e ON de.equipment_id = e.equipment_id
       JOIN operations.delay_category dc ON de.cat_id = dc.cat_id
       WHERE de.site_id = $1
         AND de.shift_id = $2
       ORDER BY de.started_at DESC`,
      [siteId, resolvedShiftId]
    );

    return this._mapRows(result.rows);
  }

  /**
   * Calcule le résumé des délais et les indicateurs MA/PA/UA du poste.
   *
   * Formules standard industrie minière :
   *   Shift total minutes = durée_poste × nb_équipements_actifs
   *   MA  = (Total - min_panne_méca) / Total × 100
   *   PA  = (Total - min_maintenance) / Total × 100
   *   UA  = (Total - toutes_maint - délais_opé) / (Total - maintenance) × 100
   */
  async getDelaySummary(siteId: string, shiftId?: string): Promise<DelaySummary> {
    const resolvedShiftId = await this._resolveShiftId(siteId, shiftId);

    // Récupère la durée du poste (en minutes)
    const shiftResult = await query(
      `SELECT sd.duration_hours * 60 AS shift_min
       FROM core.shift s
       JOIN core.shift_definition sd ON s.shift_def_id = sd.shift_def_id
       WHERE s.shift_id = $1`,
      [resolvedShiftId]
    );
    const shiftMin = parseFloat(shiftResult.rows[0]?.shift_min ?? 720);

    // Aggrège les délais par catégorie
    const result = await query(
      `SELECT
         dc.code,
         dc.label,
         dc.type,
         dc.planned,
         dc.affects_ma,
         COUNT(de.event_id)::INTEGER AS count,
         ROUND(
           SUM(EXTRACT(EPOCH FROM (COALESCE(de.ended_at, NOW()) - de.started_at))) / 60.0,
           1
         )::NUMERIC AS total_min
       FROM operations.delay_event de
       JOIN operations.delay_category dc ON de.cat_id = dc.cat_id
       WHERE de.site_id = $1 AND de.shift_id = $2
       GROUP BY dc.code, dc.label, dc.type, dc.planned, dc.affects_ma
       ORDER BY total_min DESC`,
      [siteId, resolvedShiftId]
    );

    const cats: DelayCategoryTotal[] = result.rows.map(r => ({
      code:       r.code,
      label:      r.label,
      type:       r.type,
      planned:    r.planned,
      affects_ma: r.affects_ma,
      count:      r.count,
      total_min:  parseFloat(r.total_min) || 0,
    }));

    // Calcul des indicateurs
    const totalDelayMin = cats.reduce((sum, c) => sum + c.total_min, 0);
    const maintMin = cats
      .filter(c => c.type === 'MAINTENANCE')
      .reduce((sum, c) => sum + c.total_min, 0);
    const mechanicalBreakMin = cats
      .filter(c => c.code === 'MAINT-CM' || c.code === 'MAINT-TY')
      .reduce((sum, c) => sum + c.total_min, 0);
    const operDelayMin = cats
      .filter(c => c.type === 'OPERATIONAL' || c.type === 'STANDBY')
      .reduce((sum, c) => sum + c.total_min, 0);

    const maPct = shiftMin > 0
      ? Math.round((shiftMin - mechanicalBreakMin) / shiftMin * 1000) / 10
      : 100;
    const paPct = shiftMin > 0
      ? Math.round((shiftMin - maintMin) / shiftMin * 1000) / 10
      : 100;
    const availableMin = shiftMin - maintMin;
    const uaPct = availableMin > 0
      ? Math.round((availableMin - operDelayMin) / availableMin * 1000) / 10
      : 100;

    return {
      by_category:        cats,
      ma_pct:             maPct,
      pa_pct:             paPct,
      ua_pct:             uaPct,
      total_delay_min:    Math.round(totalDelayMin * 10) / 10,
      shift_duration_min: shiftMin,
    };
  }

  /**
   * Détecte automatiquement les camions IDLE depuis plus de 5 minutes
   * sans délai ouvert, et ouvre un événement WAIT-SHO pour eux.
   *
   * Logique :
   *   1. Trouver les équipements avec status = 'IDLE' ou 'AVAILABLE'
   *      dont la dernière position GPS date de > 5 min
   *   2. Vérifier qu'il n'y a pas déjà un delay ouvert pour eux
   *   3. Ouvrir un WAIT-SHO automatique
   */
  async autoDetectIdleTrucks(siteId: string): Promise<number> {
    // Chercher les camions immobiles sans délai ouvert
    const idleResult = await query(
      `SELECT e.equipment_id
       FROM core.equipment e
       WHERE e.site_id = $1
         AND e.status IN ('IDLE', 'AVAILABLE', 'QUEUING')
         AND e.active = TRUE
         -- Pas déjà un délai ouvert pour cet équipement
         AND NOT EXISTS (
           SELECT 1 FROM operations.delay_event de
           WHERE de.equipment_id = e.equipment_id
             AND de.ended_at IS NULL
         )
         -- L'équipement est immobile depuis > 5 minutes (dernière mise à jour status)
         AND e.updated_at <= NOW() - INTERVAL '5 minutes'`,
      [siteId]
    );

    let opened = 0;
    for (const row of idleResult.rows) {
      try {
        await this.openDelay(siteId, row.equipment_id, 'WAIT-SHO',
          'Auto-détecté : immobile depuis > 5 min', true);
        opened++;
      } catch {
        // Ignorer les erreurs individuelles (ex: catégorie non trouvée)
      }
    }

    return opened;
  }

  /**
   * Liste toutes les catégories de délai disponibles.
   * Utile pour remplir les listes déroulantes dans l'interface.
   */
  async getCategories(): Promise<DelayCategory[]> {
    const result = await query(
      `SELECT cat_id, code, label, type, planned, affects_ma
       FROM operations.delay_category
       ORDER BY type, code`
    );
    return result.rows;
  }

  // ── Helpers privés ──────────────────────────────────────────────────────────

  private async _resolveShiftId(siteId: string, shiftId?: string): Promise<string> {
    if (shiftId) return shiftId;
    const r = await query(
      `SELECT shift_id FROM core.shift
       WHERE site_id = $1 AND status = 'ACTIVE'
       ORDER BY start_time DESC LIMIT 1`,
      [siteId]
    );
    return r.rows[0]?.shift_id ?? '';
  }

  private _mapRows(rows: Record<string, unknown>[]): DelayEvent[] {
    return rows.map(r => ({
      event_id:      r.event_id as string,
      equipment_id:  r.equipment_id as string,
      fleet_number:  r.fleet_number as string,
      cat_code:      r.cat_code as string,
      cat_label:     r.cat_label as string,
      cat_type:      r.cat_type as string,
      started_at:    r.started_at as string,
      ended_at:      (r.ended_at as string) ?? null,
      duration_min:  r.duration_min !== null ? parseFloat(r.duration_min as string) : null,
      notes:         (r.notes as string) ?? null,
      auto_detected: r.auto_detected as boolean,
    }));
  }
}

// Singleton exporté
export const delayTracker = new DelayTracker();
