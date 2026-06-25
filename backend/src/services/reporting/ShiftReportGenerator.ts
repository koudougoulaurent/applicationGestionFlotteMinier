/**
 * ShiftReportGenerator.ts
 * Génère automatiquement un rapport complet de fin de poste.
 * Agrège production, délais, matière, disponibilité, incidents.
 *
 * Déclenché :
 *   - Manuellement via API (dispatcher)
 *   - Automatiquement à la fin de chaque poste (CRON ou event shift:end)
 *
 * Le rapport est stocké dans reporting.shift_report (une ligne par poste).
 */

import { query } from '../../config/database';
import { delayTracker } from '../delay/DelayTracker';
import { productionTracker } from '../production/ProductionTracker';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ShiftReportData {
  report_id: string;
  site_id: string;
  shift_id: string;
  shift_name: string | null;
  shift_date: string | null;
  generated_at: string;
  total_tonnes: number;
  target_tonnes: number;
  achievement_pct: number;
  total_cycles: number;
  ma_pct: number;
  pa_pct: number;
  ua_pct: number;
  total_delay_min: number;
  ore_tonnes: number;
  waste_tonnes: number;
  avg_grade_cu: number | null;
  trucks_active: number;
  trucks_down: number;
  top_trucks: TopTruck[];
  incidents: Incident[];
}

export interface TopTruck {
  rank: number;
  fleet_number: string;
  tonnes: number;
  cycles: number;
}

export interface Incident {
  type: string;
  equipment_id?: string;
  fleet_number?: string;
  description: string;
  detected_at?: string;
}

/** Résumé pour la liste des rapports */
export interface ShiftReportSummary {
  report_id: string;
  shift_id: string;
  shift_name: string | null;
  shift_date: string | null;
  generated_at: string;
  total_tonnes: number;
  achievement_pct: number;
  ma_pct: number;
}

// ── Classe principale ─────────────────────────────────────────────────────────

export class ShiftReportGenerator {

  /**
   * Génère le rapport complet d'un poste et le sauvegarde en base.
   * Si un rapport existe déjà pour ce poste, il est mis à jour.
   *
   * Étapes :
   *   1. Calcul KPI production (ProductionTracker)
   *   2. Calcul disponibilités MA/PA/UA (DelayTracker)
   *   3. Répartition minerai/stérile
   *   4. TOP 3 camions
   *   5. Incidents (vitesse critique, mauvaise destination, pannes)
   *   6. Insertion dans reporting.shift_report
   */
  async generateReport(siteId: string, shiftId: string): Promise<ShiftReportData> {
    // ─ 1. KPI production ─────────────────────────────────────────────────────
    const kpi = await productionTracker.getShiftProductionKPI(siteId, shiftId);

    // ─ 2. Disponibilités MA/PA/UA ─────────────────────────────────────────────
    const delays = await delayTracker.getDelaySummary(siteId, shiftId);

    // ─ 3. Répartition minerai/stérile ────────────────────────────────────────
    const matResult = await query(
      `SELECT
         ROUND(SUM(hc.payload_tonnes) FILTER (WHERE m.category = 'ORE'), 0)   AS ore_tonnes,
         ROUND(SUM(hc.payload_tonnes) FILTER (WHERE m.category = 'WASTE' OR m.category = 'OVERBURDEN'), 0) AS waste_tonnes,
         ROUND(AVG(ml.grade_cu_pct) FILTER (WHERE ml.grade_cu_pct IS NOT NULL), 3) AS avg_grade_cu
       FROM operations.haul_cycle hc
       LEFT JOIN core.material m ON hc.material_id = m.material_id
       LEFT JOIN operations.material_load ml
         ON ml.shift_id = hc.shift_id AND ml.truck_id = hc.truck_id
       WHERE hc.site_id = $1 AND hc.shift_id = $2 AND hc.cycle_end IS NOT NULL`,
      [siteId, shiftId]
    );

    const matRow = matResult.rows[0] ?? {};
    const oreTonnes   = parseFloat(matRow.ore_tonnes) || 0;
    const wasteTonnes = parseFloat(matRow.waste_tonnes) || 0;
    const avgGradeCu  = matRow.avg_grade_cu !== null ? parseFloat(matRow.avg_grade_cu) : null;

    // ─ 4. TOP 3 camions ───────────────────────────────────────────────────────
    const ranking = await productionTracker.getTruckRanking(siteId, shiftId);
    const topTrucks: TopTruck[] = ranking.slice(0, 3).map(t => ({
      rank:         t.rank,
      fleet_number: t.fleet_number,
      tonnes:       t.tonnes,
      cycles:       t.cycles,
    }));

    // ─ 5. Flotte : camions actifs vs en panne ─────────────────────────────────
    const fleetResult = await query(
      `SELECT
         COUNT(DISTINCT hc.truck_id)::INTEGER AS trucks_active,
         COUNT(e.equipment_id) FILTER (WHERE e.status IN ('DOWN', 'MAINTENANCE'))::INTEGER AS trucks_down
       FROM core.equipment e
       LEFT JOIN operations.haul_cycle hc
         ON hc.truck_id = e.equipment_id AND hc.shift_id = $1 AND hc.cycle_end IS NOT NULL
       WHERE e.site_id = $2 AND e.active = TRUE`,
      [shiftId, siteId]
    );
    const trucksActive = fleetResult.rows[0]?.trucks_active ?? 0;
    const trucksDown   = fleetResult.rows[0]?.trucks_down ?? 0;

    // ─ 6. Incidents (vitesse critique, mauvaise destination, pannes long) ─────
    const incidents: Incident[] = [];

    // Infractions de vitesse CRITICAL
    const speedIncidents = await query(
      `SELECT sv.viol_id, sv.equipment_id, e.fleet_number,
              sv.speed_kmh, sv.limit_kmh, sv.excess_pct,
              TO_CHAR(sv.detected_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS detected_at
       FROM operations.speed_violation sv
       JOIN core.equipment e ON sv.equipment_id = e.equipment_id
       WHERE sv.site_id = $1
         AND sv.severity = 'CRITICAL'
         AND sv.detected_at >= (SELECT start_time FROM core.shift WHERE shift_id = $2)
       ORDER BY sv.excess_pct DESC
       LIMIT 5`,
      [siteId, shiftId]
    );

    for (const r of speedIncidents.rows) {
      incidents.push({
        type:         'SPEED_CRITICAL',
        equipment_id: r.equipment_id,
        fleet_number: r.fleet_number,
        description:  `Vitesse ${r.speed_kmh} km/h (limite ${r.limit_kmh}, +${r.excess_pct}%)`,
        detected_at:  r.detected_at,
      });
    }

    // Chargements mal dirigés
    const misdirected = await query(
      `SELECT ml.load_id, e.fleet_number, ml.material_type, ml.payload_tonnes,
              TO_CHAR(ml.loaded_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS loaded_at
       FROM operations.material_load ml
       JOIN core.equipment e ON ml.truck_id = e.equipment_id
       WHERE ml.site_id = $1 AND ml.shift_id = $2 AND ml.correct_dest = FALSE`,
      [siteId, shiftId]
    );

    for (const r of misdirected.rows) {
      incidents.push({
        type:         'MISDIRECTED_LOAD',
        equipment_id: undefined,
        fleet_number: r.fleet_number,
        description:  `${r.material_type} (${r.payload_tonnes}t) envoyé à mauvaise destination`,
        detected_at:  r.loaded_at,
      });
    }

    // Pannes longues (MAINT-CM > 2h)
    const breakdowns = await query(
      `SELECT de.event_id, e.fleet_number,
              ROUND(EXTRACT(EPOCH FROM (COALESCE(de.ended_at, NOW()) - de.started_at)) / 60.0, 0) AS dur_min,
              TO_CHAR(de.started_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS started_at
       FROM operations.delay_event de
       JOIN operations.delay_category dc ON de.cat_id = dc.cat_id
       JOIN core.equipment e ON de.equipment_id = e.equipment_id
       WHERE de.site_id = $1 AND de.shift_id = $2
         AND dc.code IN ('MAINT-CM', 'MAINT-TY')
         AND EXTRACT(EPOCH FROM (COALESCE(de.ended_at, NOW()) - de.started_at)) > 7200`,
      [siteId, shiftId]
    );

    for (const r of breakdowns.rows) {
      incidents.push({
        type:         'BREAKDOWN',
        fleet_number: r.fleet_number,
        description:  `Panne : ${r.dur_min} minutes d'arrêt`,
        detected_at:  r.started_at,
      });
    }

    // ─ 7. Insertion / mise à jour du rapport ──────────────────────────────────
    const result = await query(
      `INSERT INTO reporting.shift_report
         (site_id, shift_id, total_tonnes, target_tonnes, achievement_pct,
          total_cycles, ma_pct, pa_pct, ua_pct, total_delay_min,
          ore_tonnes, waste_tonnes, avg_grade_cu,
          trucks_active, trucks_down, top_trucks, incidents, detail_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (shift_id) DO UPDATE SET
         total_tonnes    = EXCLUDED.total_tonnes,
         target_tonnes   = EXCLUDED.target_tonnes,
         achievement_pct = EXCLUDED.achievement_pct,
         total_cycles    = EXCLUDED.total_cycles,
         ma_pct          = EXCLUDED.ma_pct,
         pa_pct          = EXCLUDED.pa_pct,
         ua_pct          = EXCLUDED.ua_pct,
         total_delay_min = EXCLUDED.total_delay_min,
         ore_tonnes      = EXCLUDED.ore_tonnes,
         waste_tonnes    = EXCLUDED.waste_tonnes,
         avg_grade_cu    = EXCLUDED.avg_grade_cu,
         trucks_active   = EXCLUDED.trucks_active,
         trucks_down     = EXCLUDED.trucks_down,
         top_trucks      = EXCLUDED.top_trucks,
         incidents       = EXCLUDED.incidents,
         detail_json     = EXCLUDED.detail_json,
         generated_at    = NOW()
       RETURNING report_id, TO_CHAR(generated_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS generated_at`,
      [
        siteId, shiftId,
        kpi.actual_tonnes, kpi.target_tonnes, kpi.achievement_pct,
        kpi.total_cycles,
        delays.ma_pct, delays.pa_pct, delays.ua_pct, delays.total_delay_min,
        oreTonnes, wasteTonnes, avgGradeCu,
        trucksActive, trucksDown,
        JSON.stringify(topTrucks),
        JSON.stringify(incidents),
        JSON.stringify({ kpi, delays: delays.by_category }),
      ]
    );

    const reportId   = result.rows[0].report_id as string;
    const generatedAt = result.rows[0].generated_at as string;

    return {
      report_id:       reportId,
      site_id:         siteId,
      shift_id:        shiftId,
      shift_name:      kpi.shift_name,
      shift_date:      kpi.shift_date,
      generated_at:    generatedAt,
      total_tonnes:    kpi.actual_tonnes,
      target_tonnes:   kpi.target_tonnes,
      achievement_pct: kpi.achievement_pct,
      total_cycles:    kpi.total_cycles,
      ma_pct:          delays.ma_pct,
      pa_pct:          delays.pa_pct,
      ua_pct:          delays.ua_pct,
      total_delay_min: delays.total_delay_min,
      ore_tonnes:      oreTonnes,
      waste_tonnes:    wasteTonnes,
      avg_grade_cu:    avgGradeCu,
      trucks_active:   trucksActive,
      trucks_down:     trucksDown,
      top_trucks:      topTrucks,
      incidents,
    };
  }

  /**
   * Récupère un rapport existant depuis reporting.shift_report.
   * Utilisé pour afficher un rapport déjà généré sans recalculer.
   */
  async getReport(shiftId: string): Promise<ShiftReportData | null> {
    const result = await query(
      `SELECT
         sr.report_id,
         sr.site_id,
         sr.shift_id,
         sd.shift_name,
         s.shift_date::TEXT AS shift_date,
         TO_CHAR(sr.generated_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS generated_at,
         sr.total_tonnes::NUMERIC,
         sr.target_tonnes::NUMERIC,
         sr.achievement_pct::NUMERIC,
         sr.total_cycles,
         sr.ma_pct::NUMERIC,
         sr.pa_pct::NUMERIC,
         sr.ua_pct::NUMERIC,
         sr.total_delay_min::NUMERIC,
         sr.ore_tonnes::NUMERIC,
         sr.waste_tonnes::NUMERIC,
         sr.avg_grade_cu::NUMERIC,
         sr.trucks_active,
         sr.trucks_down,
         sr.top_trucks,
         sr.incidents
       FROM reporting.shift_report sr
       JOIN core.shift s ON sr.shift_id = s.shift_id
       JOIN core.shift_definition sd ON s.shift_def_id = sd.shift_def_id
       WHERE sr.shift_id = $1`,
      [shiftId]
    );

    if (result.rows.length === 0) return null;
    return this._mapReport(result.rows[0]);
  }

  /**
   * Liste les derniers rapports de poste pour un site.
   * Trié par date décroissante (le plus récent en premier).
   *
   * @param siteId - Mine concernée
   * @param limit  - Nombre de rapports à retourner (défaut : 10)
   */
  async listReports(siteId: string, limit = 10): Promise<ShiftReportSummary[]> {
    const result = await query(
      `SELECT
         sr.report_id,
         sr.shift_id,
         sd.shift_name,
         s.shift_date::TEXT AS shift_date,
         TO_CHAR(sr.generated_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS generated_at,
         sr.total_tonnes::NUMERIC,
         sr.achievement_pct::NUMERIC,
         sr.ma_pct::NUMERIC
       FROM reporting.shift_report sr
       JOIN core.shift s ON sr.shift_id = s.shift_id
       JOIN core.shift_definition sd ON s.shift_def_id = sd.shift_def_id
       WHERE sr.site_id = $1
       ORDER BY sr.generated_at DESC
       LIMIT $2`,
      [siteId, limit]
    );

    return result.rows.map(r => ({
      report_id:       r.report_id,
      shift_id:        r.shift_id,
      shift_name:      r.shift_name,
      shift_date:      r.shift_date,
      generated_at:    r.generated_at,
      total_tonnes:    parseFloat(r.total_tonnes) || 0,
      achievement_pct: parseFloat(r.achievement_pct) || 0,
      ma_pct:          parseFloat(r.ma_pct) || 0,
    }));
  }

  // ── Helper privé ─────────────────────────────────────────────────────────────

  private _mapReport(r: Record<string, unknown>): ShiftReportData {
    return {
      report_id:       r.report_id as string,
      site_id:         r.site_id as string,
      shift_id:        r.shift_id as string,
      shift_name:      (r.shift_name as string) ?? null,
      shift_date:      (r.shift_date as string) ?? null,
      generated_at:    r.generated_at as string,
      total_tonnes:    parseFloat(r.total_tonnes as string) || 0,
      target_tonnes:   parseFloat(r.target_tonnes as string) || 0,
      achievement_pct: parseFloat(r.achievement_pct as string) || 0,
      total_cycles:    (r.total_cycles as number) ?? 0,
      ma_pct:          parseFloat(r.ma_pct as string) || 0,
      pa_pct:          parseFloat(r.pa_pct as string) || 0,
      ua_pct:          parseFloat(r.ua_pct as string) || 0,
      total_delay_min: parseFloat(r.total_delay_min as string) || 0,
      ore_tonnes:      parseFloat(r.ore_tonnes as string) || 0,
      waste_tonnes:    parseFloat(r.waste_tonnes as string) || 0,
      avg_grade_cu:    r.avg_grade_cu !== null ? parseFloat(r.avg_grade_cu as string) : null,
      trucks_active:   (r.trucks_active as number) ?? 0,
      trucks_down:     (r.trucks_down as number) ?? 0,
      top_trucks:      Array.isArray(r.top_trucks) ? r.top_trucks as TopTruck[] : [],
      incidents:       Array.isArray(r.incidents) ? r.incidents as Incident[] : [],
    };
  }
}

// Singleton exporté
export const shiftReportGenerator = new ShiftReportGenerator();
