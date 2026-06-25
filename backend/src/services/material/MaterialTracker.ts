/**
 * MaterialTracker.ts
 * Gère le suivi de la matière (minerai, stérile, low-grade).
 * Classe chaque chargement et vérifie la cohérence de destination.
 *
 * Types de matière :
 *   OXIDE      → Minerai oxydé → Crusher (haute priorité)
 *   SULPHIDE   → Minerai sulfuré → Crusher (haute priorité)
 *   LOW_GRADE  → Minerai basse teneur → Stockpile
 *   WASTE      → Stérile → Dump
 *   TOPSOIL    → Décapage → Zone décharge (dump)
 */

import { query } from '../../config/database';

// ── Types ────────────────────────────────────────────────────────────────────

/** Données requises pour enregistrer un chargement */
export interface MaterialLoadInput {
  siteId: string;
  shiftId?: string;
  truckId: string;
  loaderId?: string;
  sourceId?: string;
  destinationId?: string;
  materialType: string;
  gradeCuPct?: number;
  payloadTonnes?: number;
  notes?: string;
}

/** Résultat d'un enregistrement de chargement */
export interface MaterialLoadResult {
  load_id: string;
  correct_dest: boolean;
  /** Message d'avertissement si mauvaise destination */
  warning?: string;
}

/** Tonnes et grade par type de matière */
export interface MaterialBreakdown {
  material_type: string;
  tonnes: number;
  loads_count: number;
  avg_grade_cu: number | null;
  pct_of_total: number;
}

/** Chargement envoyé à mauvaise destination */
export interface MisdirectedLoad {
  load_id: string;
  loaded_at: string;
  fleet_number: string;
  material_type: string;
  payload_tonnes: number;
  source_name: string;
  destination_name: string;
  notes: string | null;
}

/** Flux de matière source → destination (pour diagramme Sankey) */
export interface MaterialFlowNode {
  source: string;
  destination: string;
  material_type: string;
  tonnes: number;
  loads_count: number;
}

/** Évolution du grade Cu% heure par heure */
export interface GradeTrendPoint {
  hour: string;
  avg_grade_cu: number;
  loads_count: number;
  tonnes: number;
}

// ── Règles de destination correcte ───────────────────────────────────────────
// location_type attendu par type de matière
const CORRECT_DEST_TYPES: Record<string, string[]> = {
  OXIDE:    ['CRUSHER'],
  SULPHIDE: ['CRUSHER'],
  WASTE:    ['DUMP'],
  TOPSOIL:  ['DUMP'],
  // LOW_GRADE : accepté partout (stockpile, crusher selon grade)
  LOW_GRADE: ['CRUSHER', 'STOCKPILE', 'DUMP'],
  UNKNOWN:   ['CRUSHER', 'STOCKPILE', 'DUMP', 'PIT'],
};

// ── Classe principale ─────────────────────────────────────────────────────────

export class MaterialTracker {

  /**
   * Enregistre un nouveau chargement dans operations.material_load.
   * Vérifie automatiquement si la destination est correcte selon le type de matière.
   *
   * Exemple : un camion chargé d'OXIDE doit aller au CRUSHER, pas au DUMP.
   */
  async recordLoad(data: MaterialLoadInput): Promise<MaterialLoadResult> {
    // Vérifier si la destination est correcte
    let correctDest = true;
    let warning: string | undefined;

    if (data.destinationId && data.materialType) {
      // Cherche le type de la destination dans core.location
      const destResult = await query(
        `SELECT location_type FROM core.location WHERE location_id = $1`,
        [data.destinationId]
      );

      if (destResult.rows.length > 0) {
        const destType: string = destResult.rows[0].location_type;
        const allowedTypes = CORRECT_DEST_TYPES[data.materialType] ?? [];

        if (!allowedTypes.includes(destType)) {
          correctDest = false;
          warning = `${data.materialType} envoyé à ${destType} — destination incorrecte !`;
        }
      }
    }

    // Résoudre le poste actif si pas fourni
    let shiftId = data.shiftId;
    if (!shiftId) {
      const sr = await query(
        `SELECT shift_id FROM core.shift
         WHERE site_id = $1 AND status = 'ACTIVE'
         ORDER BY start_time DESC LIMIT 1`,
        [data.siteId]
      );
      shiftId = sr.rows[0]?.shift_id;
    }

    // Insertion dans la base
    const result = await query(
      `INSERT INTO operations.material_load
         (site_id, shift_id, truck_id, loader_id, source_id, destination_id,
          material_type, grade_cu_pct, payload_tonnes, correct_dest, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING load_id, correct_dest`,
      [
        data.siteId,
        shiftId ?? null,
        data.truckId,
        data.loaderId ?? null,
        data.sourceId ?? null,
        data.destinationId ?? null,
        data.materialType,
        data.gradeCuPct ?? null,
        data.payloadTonnes ?? null,
        correctDest,
        data.notes ?? null,
      ]
    );

    return {
      load_id:      result.rows[0].load_id,
      correct_dest: result.rows[0].correct_dest,
      warning,
    };
  }

  /**
   * Répartition des tonnes par type de matière sur un poste.
   * Calcule également le grade moyen Cu% pour les minerais.
   *
   * Résultat typique :
   *   OXIDE    → 2400t, grade 1.45%
   *   WASTE    → 3200t, grade null
   *   SULPHIDE → 800t,  grade 2.10%
   */
  async getMaterialBreakdown(siteId: string, shiftId?: string): Promise<MaterialBreakdown[]> {
    const resolvedShiftId = await this._resolveShiftId(siteId, shiftId);

    const result = await query(
      `WITH totals AS (
         SELECT SUM(payload_tonnes) AS grand_total
         FROM operations.material_load
         WHERE site_id = $1 AND shift_id = $2
       )
       SELECT
         ml.material_type,
         ROUND(SUM(ml.payload_tonnes), 0)::NUMERIC AS tonnes,
         COUNT(ml.load_id)::INTEGER AS loads_count,
         ROUND(AVG(ml.grade_cu_pct) FILTER (WHERE ml.grade_cu_pct IS NOT NULL), 3)::NUMERIC AS avg_grade_cu,
         ROUND(SUM(ml.payload_tonnes) / NULLIF(t.grand_total, 0) * 100.0, 1)::NUMERIC AS pct_of_total
       FROM operations.material_load ml
       CROSS JOIN totals t
       WHERE ml.site_id = $1 AND ml.shift_id = $2
       GROUP BY ml.material_type, t.grand_total
       ORDER BY tonnes DESC`,
      [siteId, resolvedShiftId]
    );

    return result.rows.map(r => ({
      material_type: r.material_type,
      tonnes:        parseFloat(r.tonnes) || 0,
      loads_count:   r.loads_count,
      avg_grade_cu:  r.avg_grade_cu !== null ? parseFloat(r.avg_grade_cu) : null,
      pct_of_total:  parseFloat(r.pct_of_total) || 0,
    }));
  }

  /**
   * Liste les chargements envoyés à la mauvaise destination (correct_dest = FALSE).
   * Filtre par les N dernières heures (par défaut : 8h = durée d'un demi-poste).
   *
   * Cas typique : camion chargé d'OXIDE envoyé au DUMP au lieu du CRUSHER.
   */
  async getMisdirectedLoads(siteId: string, hours = 8): Promise<MisdirectedLoad[]> {
    const result = await query(
      `SELECT
         ml.load_id,
         TO_CHAR(ml.loaded_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS loaded_at,
         e.fleet_number,
         ml.material_type,
         ml.payload_tonnes::NUMERIC,
         ls.name AS source_name,
         ld.name AS destination_name,
         ml.notes
       FROM operations.material_load ml
       JOIN core.equipment e ON ml.truck_id = e.equipment_id
       LEFT JOIN core.location ls ON ml.source_id = ls.location_id
       LEFT JOIN core.location ld ON ml.destination_id = ld.location_id
       WHERE ml.site_id = $1
         AND ml.correct_dest = FALSE
         AND ml.loaded_at >= NOW() - ($2 || ' hours')::INTERVAL
       ORDER BY ml.loaded_at DESC`,
      [siteId, hours]
    );

    return result.rows.map(r => ({
      load_id:        r.load_id,
      loaded_at:      r.loaded_at,
      fleet_number:   r.fleet_number,
      material_type:  r.material_type,
      payload_tonnes: parseFloat(r.payload_tonnes) || 0,
      source_name:    r.source_name ?? 'Inconnu',
      destination_name: r.destination_name ?? 'Inconnu',
      notes:          r.notes,
    }));
  }

  /**
   * Flux de matière source → destination pour un poste.
   * Données utiles pour un diagramme Sankey (visualisation des flux).
   *
   * Exemple : PIT-1 → CRUSH-1 : 2400t OXIDE
   *           PIT-2 → DUMP-1  : 3200t WASTE
   */
  async getMaterialFlow(siteId: string, shiftId?: string): Promise<MaterialFlowNode[]> {
    const resolvedShiftId = await this._resolveShiftId(siteId, shiftId);

    const result = await query(
      `SELECT
         COALESCE(ls.name, 'Source inconnue') AS source,
         COALESCE(ld.name, 'Dest inconnue')   AS destination,
         ml.material_type,
         ROUND(SUM(ml.payload_tonnes), 0)::NUMERIC AS tonnes,
         COUNT(ml.load_id)::INTEGER AS loads_count
       FROM operations.material_load ml
       LEFT JOIN core.location ls ON ml.source_id = ls.location_id
       LEFT JOIN core.location ld ON ml.destination_id = ld.location_id
       WHERE ml.site_id = $1 AND ml.shift_id = $2
       GROUP BY ls.name, ld.name, ml.material_type
       ORDER BY tonnes DESC`,
      [siteId, resolvedShiftId]
    );

    return result.rows.map(r => ({
      source:       r.source,
      destination:  r.destination,
      material_type: r.material_type,
      tonnes:       parseFloat(r.tonnes) || 0,
      loads_count:  r.loads_count,
    }));
  }

  /**
   * Évolution du grade Cu% sur les dernières heures.
   * Utile pour détecter les variations de qualité du minerai extrait.
   *
   * Ne concerne que les types OXIDE et SULPHIDE (seuls ayant un grade Cu%).
   */
  async getGradeTrend(siteId: string, hours = 12): Promise<GradeTrendPoint[]> {
    const result = await query(
      `SELECT
         TO_CHAR(DATE_TRUNC('hour', ml.loaded_at), 'YYYY-MM-DD"T"HH24:MI:SS') AS hour,
         ROUND(AVG(ml.grade_cu_pct), 3)::NUMERIC AS avg_grade_cu,
         COUNT(ml.load_id)::INTEGER AS loads_count,
         ROUND(SUM(ml.payload_tonnes), 0)::NUMERIC AS tonnes
       FROM operations.material_load ml
       WHERE ml.site_id = $1
         AND ml.grade_cu_pct IS NOT NULL
         AND ml.material_type IN ('OXIDE', 'SULPHIDE')
         AND ml.loaded_at >= NOW() - ($2 || ' hours')::INTERVAL
       GROUP BY DATE_TRUNC('hour', ml.loaded_at)
       ORDER BY hour ASC`,
      [siteId, hours]
    );

    return result.rows.map(r => ({
      hour:         r.hour,
      avg_grade_cu: parseFloat(r.avg_grade_cu) || 0,
      loads_count:  r.loads_count,
      tonnes:       parseFloat(r.tonnes) || 0,
    }));
  }

  // ── Helper privé ────────────────────────────────────────────────────────────

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
}

// Singleton : une seule instance partagée dans toute l'application
export const materialTracker = new MaterialTracker();
