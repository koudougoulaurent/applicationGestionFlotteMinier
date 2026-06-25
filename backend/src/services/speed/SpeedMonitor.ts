/**
 * SpeedMonitor.ts
 * Surveille les vitesses des camions sur chaque tronçon de route.
 * Compare la vitesse GPS en temps réel avec la limite de la route.
 *
 * Seuils de dépassement :
 *   WARNING  : vitesse > limite × 1.10  (dépassement de 10%)
 *   CRITICAL : vitesse > limite × 1.25  (dépassement de 25%)
 *
 * Ces données alimentent le système d'alarme et le reporting sécurité.
 */

import { query } from '../../config/database';

// ── Types ────────────────────────────────────────────────────────────────────

/** Résultat du contrôle de vitesse — null si pas de dépassement */
export interface SpeedCheckResult {
  /** TRUE si infraction détectée */
  violation: boolean;
  severity: 'WARNING' | 'CRITICAL' | null;
  speed_kmh: number;
  limit_kmh: number;
  excess_pct: number;
  /** UUID de l'infraction insérée (si violation) */
  viol_id?: string;
}

/** Infraction enregistrée */
export interface SpeedViolation {
  viol_id: string;
  equipment_id: string;
  fleet_number: string;
  road_name: string;
  detected_at: string;
  speed_kmh: number;
  limit_kmh: number;
  excess_pct: number;
  lat: number | null;
  lon: number | null;
  severity: string;
}

/** Résumé des infractions par camion et par route */
export interface ViolationSummary {
  by_truck: TruckViolationSummary[];
  by_road: RoadViolationSummary[];
  total_violations: number;
  critical_count: number;
}

export interface TruckViolationSummary {
  equipment_id: string;
  fleet_number: string;
  violations_count: number;
  critical_count: number;
  max_excess_pct: number;
}

export interface RoadViolationSummary {
  road_id: string;
  road_name: string;
  speed_limit_kmh: number;
  violations_count: number;
  avg_excess_pct: number;
}

/** Limite de vitesse par tronçon de route */
export interface RoadSpeedLimit {
  road_id: string;
  name: string;
  speed_limit_kmh: number;
  road_class: string;
  distance_km: number;
  start_location: string;
  end_location: string;
  active: boolean;
}

/** Données pour enregistrer une infraction */
export interface ViolationInput {
  siteId: string;
  equipmentId: string;
  roadId: string;
  speedKmh: number;
  limitKmh: number;
  lat?: number;
  lon?: number;
}

// ── Constantes des seuils ─────────────────────────────────────────────────────
const THRESHOLD_WARNING  = 1.10; // +10% de la limite
const THRESHOLD_CRITICAL = 1.25; // +25% de la limite

// ── Classe principale ─────────────────────────────────────────────────────────

export class SpeedMonitor {

  /**
   * Vérifie si un équipement dépasse la vitesse limite sur un tronçon.
   * Si dépassement détecté, insère automatiquement une infraction.
   *
   * Appelé à chaque mise à jour GPS (toutes les 30 secondes environ).
   *
   * @param equipmentId - UUID du camion
   * @param roadId      - UUID du tronçon de route
   * @param speedKmh    - Vitesse mesurée par GPS
   * @param lat         - Latitude GPS
   * @param lon         - Longitude GPS
   */
  async checkSpeed(
    equipmentId: string,
    roadId: string,
    speedKmh: number,
    lat?: number,
    lon?: number
  ): Promise<SpeedCheckResult> {
    // Récupérer la limite de vitesse du tronçon
    const roadResult = await query(
      `SELECT site_id, speed_limit_kmh
       FROM core.haul_road
       WHERE road_id = $1 AND active = TRUE`,
      [roadId]
    );

    if (roadResult.rows.length === 0) {
      return { violation: false, severity: null, speed_kmh: speedKmh, limit_kmh: 0, excess_pct: 0 };
    }

    const limitKmh: number = parseFloat(roadResult.rows[0].speed_limit_kmh) || 30;
    const siteId: string   = roadResult.rows[0].site_id;
    const excessPct = Math.round((speedKmh - limitKmh) / limitKmh * 1000) / 10;

    // Pas de dépassement
    if (speedKmh <= limitKmh * THRESHOLD_WARNING) {
      return { violation: false, severity: null, speed_kmh: speedKmh, limit_kmh: limitKmh, excess_pct: excessPct };
    }

    // Déterminer la sévérité
    const severity: 'WARNING' | 'CRITICAL' = speedKmh > limitKmh * THRESHOLD_CRITICAL
      ? 'CRITICAL'
      : 'WARNING';

    // Enregistrer l'infraction
    const violId = await this.recordViolation({ siteId, equipmentId, roadId, speedKmh, limitKmh, lat, lon });

    return {
      violation:  true,
      severity,
      speed_kmh:  speedKmh,
      limit_kmh:  limitKmh,
      excess_pct: excessPct,
      viol_id:    violId,
    };
  }

  /**
   * Insère une infraction de vitesse dans la base de données.
   * Retourne l'UUID de l'infraction créée.
   */
  async recordViolation(data: ViolationInput): Promise<string> {
    const excessPct = Math.round((data.speedKmh - data.limitKmh) / data.limitKmh * 1000) / 10;
    const severity: 'WARNING' | 'CRITICAL' = data.speedKmh > data.limitKmh * THRESHOLD_CRITICAL
      ? 'CRITICAL'
      : 'WARNING';

    const result = await query(
      `INSERT INTO operations.speed_violation
         (site_id, equipment_id, road_id, speed_kmh, limit_kmh, excess_pct, lat, lon, severity)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING viol_id`,
      [
        data.siteId,
        data.equipmentId,
        data.roadId,
        data.speedKmh,
        data.limitKmh,
        excessPct,
        data.lat ?? null,
        data.lon ?? null,
        severity,
      ]
    );

    return result.rows[0].viol_id as string;
  }

  /**
   * Liste les infractions pour un site sur les N dernières heures.
   * Filtrage optionnel par équipement (pour la fiche camion).
   *
   * @param siteId      - Mine concernée
   * @param hours       - Fenêtre temporelle (défaut : 8h)
   * @param equipmentId - Filtrer sur un camion spécifique (optionnel)
   */
  async getViolations(
    siteId: string,
    hours = 8,
    equipmentId?: string
  ): Promise<SpeedViolation[]> {
    const params: unknown[] = [siteId, hours];
    let equipFilter = '';
    if (equipmentId) {
      params.push(equipmentId);
      equipFilter = `AND sv.equipment_id = $${params.length}`;
    }

    const result = await query(
      `SELECT
         sv.viol_id,
         sv.equipment_id,
         e.fleet_number,
         hr.name AS road_name,
         TO_CHAR(sv.detected_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS detected_at,
         sv.speed_kmh::NUMERIC,
         sv.limit_kmh::NUMERIC,
         sv.excess_pct::NUMERIC,
         sv.lat::NUMERIC,
         sv.lon::NUMERIC,
         sv.severity
       FROM operations.speed_violation sv
       JOIN core.equipment e ON sv.equipment_id = e.equipment_id
       JOIN core.haul_road hr ON sv.road_id = hr.road_id
       WHERE sv.site_id = $1
         AND sv.detected_at >= NOW() - ($2 || ' hours')::INTERVAL
         ${equipFilter}
       ORDER BY sv.detected_at DESC`,
      params
    );

    return result.rows.map(r => ({
      viol_id:      r.viol_id,
      equipment_id: r.equipment_id,
      fleet_number: r.fleet_number,
      road_name:    r.road_name,
      detected_at:  r.detected_at,
      speed_kmh:    parseFloat(r.speed_kmh) || 0,
      limit_kmh:    parseFloat(r.limit_kmh) || 0,
      excess_pct:   parseFloat(r.excess_pct) || 0,
      lat:          r.lat !== null ? parseFloat(r.lat) : null,
      lon:          r.lon !== null ? parseFloat(r.lon) : null,
      severity:     r.severity,
    }));
  }

  /**
   * Résumé des infractions du poste : classement par camion et par route.
   * Permet d'identifier les chauffeurs et les tronçons à risque.
   */
  async getViolationSummary(siteId: string, shiftId?: string): Promise<ViolationSummary> {
    // Filtre temporel : poste ou les 12 dernières heures
    let timeFilter = `sv.detected_at >= NOW() - INTERVAL '12 hours'`;
    const params: unknown[] = [siteId];

    if (shiftId) {
      params.push(shiftId);
      // On prend la fenêtre du poste
      const shiftRes = await query(
        `SELECT start_time, (start_time + (sd.duration_hours || ' hours')::INTERVAL) AS end_time
         FROM core.shift s JOIN core.shift_definition sd ON s.shift_def_id = sd.shift_def_id
         WHERE s.shift_id = $1`,
        [shiftId]
      );
      if (shiftRes.rows.length > 0) {
        const { start_time, end_time } = shiftRes.rows[0];
        params.push(start_time, end_time);
        timeFilter = `sv.detected_at BETWEEN $${params.length - 1} AND $${params.length}`;
      }
    }

    // Par camion
    const byTruck = await query(
      `SELECT
         sv.equipment_id,
         e.fleet_number,
         COUNT(sv.viol_id)::INTEGER AS violations_count,
         COUNT(sv.viol_id) FILTER (WHERE sv.severity = 'CRITICAL')::INTEGER AS critical_count,
         ROUND(MAX(sv.excess_pct), 1)::NUMERIC AS max_excess_pct
       FROM operations.speed_violation sv
       JOIN core.equipment e ON sv.equipment_id = e.equipment_id
       WHERE sv.site_id = $1 AND ${timeFilter}
       GROUP BY sv.equipment_id, e.fleet_number
       ORDER BY violations_count DESC`,
      params
    );

    // Par route
    const byRoad = await query(
      `SELECT
         sv.road_id,
         hr.name AS road_name,
         hr.speed_limit_kmh::NUMERIC,
         COUNT(sv.viol_id)::INTEGER AS violations_count,
         ROUND(AVG(sv.excess_pct), 1)::NUMERIC AS avg_excess_pct
       FROM operations.speed_violation sv
       JOIN core.haul_road hr ON sv.road_id = hr.road_id
       WHERE sv.site_id = $1 AND ${timeFilter}
       GROUP BY sv.road_id, hr.name, hr.speed_limit_kmh
       ORDER BY violations_count DESC`,
      params
    );

    const totalViolations = byTruck.rows.reduce((s, r) => s + r.violations_count, 0);
    const criticalCount   = byTruck.rows.reduce((s, r) => s + r.critical_count, 0);

    return {
      by_truck: byTruck.rows.map(r => ({
        equipment_id:     r.equipment_id,
        fleet_number:     r.fleet_number,
        violations_count: r.violations_count,
        critical_count:   r.critical_count,
        max_excess_pct:   parseFloat(r.max_excess_pct) || 0,
      })),
      by_road: byRoad.rows.map(r => ({
        road_id:          r.road_id,
        road_name:        r.road_name,
        speed_limit_kmh:  parseFloat(r.speed_limit_kmh) || 0,
        violations_count: r.violations_count,
        avg_excess_pct:   parseFloat(r.avg_excess_pct) || 0,
      })),
      total_violations: totalViolations,
      critical_count:   criticalCount,
    };
  }

  /**
   * Retourne les limites de vitesse par tronçon de route pour un site.
   * Affiché sur la carte du dispatcher pour informer les conducteurs.
   */
  async getRoadSpeedLimits(siteId: string): Promise<RoadSpeedLimit[]> {
    const result = await query(
      `SELECT
         hr.road_id,
         hr.name,
         hr.speed_limit_kmh::NUMERIC,
         hr.road_class,
         hr.distance_km::NUMERIC,
         COALESCE(ls.name, '?') AS start_location,
         COALESCE(le.name, '?') AS end_location,
         hr.active
       FROM core.haul_road hr
       LEFT JOIN core.location ls ON hr.start_location_id = ls.location_id
       LEFT JOIN core.location le ON hr.end_location_id = le.location_id
       WHERE hr.site_id = $1
       ORDER BY hr.road_class, hr.name`,
      [siteId]
    );

    return result.rows.map(r => ({
      road_id:         r.road_id,
      name:            r.name,
      speed_limit_kmh: parseFloat(r.speed_limit_kmh) || 30,
      road_class:      r.road_class,
      distance_km:     parseFloat(r.distance_km) || 0,
      start_location:  r.start_location,
      end_location:    r.end_location,
      active:          r.active,
    }));
  }
}

// Singleton exporté
export const speedMonitor = new SpeedMonitor();
