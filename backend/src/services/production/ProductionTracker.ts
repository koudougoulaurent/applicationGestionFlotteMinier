/**
 * ProductionTracker.ts
 * Calcule et agrège les KPIs de production en temps réel.
 * Compare les tonnes extraites vs l'objectif du poste.
 *
 * Logique principale :
 *   1. Charge l'objectif du poste depuis operations.production_target
 *   2. Somme les cycles haul terminés depuis operations.haul_cycle
 *   3. Calcule le taux d'avancement et la projection fin de poste
 */

import { query } from '../../config/database';

// ── Types ────────────────────────────────────────────────────────────────────

/** KPI principal du poste : production actuelle vs objectif */
export interface ShiftProductionKPI {
  shift_id: string | null;
  shift_name: string | null;
  shift_date: string | null;
  /** Tonnes chargées depuis le début du poste */
  actual_tonnes: number;
  /** Objectif fixé pour ce poste */
  target_tonnes: number;
  /** Progression en % (actual / target × 100) */
  achievement_pct: number;
  /** Nombre de cycles terminés */
  total_cycles: number;
  /** Objectif en nombre de cycles */
  target_cycles: number | null;
  /** Heures écoulées depuis le début du poste */
  elapsed_hours: number;
  /** Projection des tonnes à la fin du poste (extrapolation linéaire) */
  projected_tonnes: number;
  /** Tonnes produites par heure en moyenne depuis le début */
  tonnes_per_hour: number;
  /** Productivité par camion actif (tonnes/heure) */
  productivity_per_truck: number;
  /** Nombre de camions actifs */
  active_trucks: number;
}

/** Production heure par heure sur les 12 dernières heures */
export interface HourlyBreakdown {
  hour: string;
  tonnes: number;
  cycles: number;
}

/** Détail par pelle : quelles tonnes chaque pelle a-t-elle chargées */
export interface LoaderBreakdown {
  loader_id: string;
  fleet_number: string;
  tonnes: number;
  cycles: number;
  avg_payload: number;
}

/** Classement des camions par tonnes transportées */
export interface TruckRanking {
  rank: number;
  equipment_id: string;
  fleet_number: string;
  operator_name: string | null;
  tonnes: number;
  cycles: number;
  avg_payload: number;
  avg_cycle_min: number;
}

// ── Classe principale ─────────────────────────────────────────────────────────

export class ProductionTracker {

  /**
   * Calcule le KPI principal de production pour un site et un poste.
   * Si shiftId n'est pas fourni, utilise le poste ACTIVE du site.
   *
   * Requêtes :
   *   - operations.production_target → objectif
   *   - operations.haul_cycle → cycles terminés
   *   - core.shift → dates/heures du poste
   */
  async getShiftProductionKPI(siteId: string, shiftId?: string): Promise<ShiftProductionKPI> {
    // Résoudre le poste actif si pas fourni
    const resolvedShiftId = await this._resolveShiftId(siteId, shiftId);

    // Requête combinée : objectif + production réelle
    const result = await query(
      `SELECT
         s.shift_id,
         sd.shift_name,
         s.shift_date::TEXT,
         -- Objectif du poste
         COALESCE(pt.target_tonnes, 6000) AS target_tonnes,
         COALESCE(pt.target_cycles, 120)  AS target_cycles,
         -- Production réelle : somme des cycles terminés
         COALESCE(SUM(hc.payload_tonnes), 0)::NUMERIC AS actual_tonnes,
         COUNT(hc.cycle_id)::INTEGER AS total_cycles,
         -- Temps écoulé depuis le début du poste (en heures)
         ROUND(EXTRACT(EPOCH FROM (NOW() - s.start_time)) / 3600.0, 2) AS elapsed_hours,
         -- Durée totale du poste en heures
         sd.duration_hours
       FROM core.shift s
       JOIN core.shift_definition sd ON s.shift_def_id = sd.shift_def_id
       LEFT JOIN operations.production_target pt ON pt.shift_id = s.shift_id
       LEFT JOIN operations.haul_cycle hc
         ON hc.shift_id = s.shift_id
        AND hc.cycle_end IS NOT NULL
        AND hc.site_id = $1
       WHERE s.shift_id = $2
       GROUP BY s.shift_id, sd.shift_name, s.shift_date, s.start_time,
                pt.target_tonnes, pt.target_cycles, sd.duration_hours`,
      [siteId, resolvedShiftId]
    );

    if (result.rows.length === 0) {
      return this._emptyKPI();
    }

    const row = result.rows[0];

    // Calculs dérivés
    const actualTonnes = parseFloat(row.actual_tonnes) || 0;
    const targetTonnes = parseFloat(row.target_tonnes) || 6000;
    const elapsedHours = parseFloat(row.elapsed_hours) || 0;
    const durationHours = parseFloat(row.duration_hours) || 12;
    const achievementPct = targetTonnes > 0
      ? Math.round((actualTonnes / targetTonnes) * 1000) / 10
      : 0;

    // Projection linéaire : si on continue au même rythme, combien à la fin ?
    const tonnesPerHour = elapsedHours > 0 ? actualTonnes / elapsedHours : 0;
    const projectedTonnes = Math.round(tonnesPerHour * durationHours);

    // Nombre de camions actifs sur le poste
    const trucksResult = await query(
      `SELECT COUNT(DISTINCT hc.truck_id)::INTEGER AS active_trucks
       FROM operations.haul_cycle hc
       WHERE hc.shift_id = $1 AND hc.cycle_end IS NOT NULL`,
      [resolvedShiftId]
    );
    const activeTrucks = trucksResult.rows[0]?.active_trucks || 1;
    const productivityPerTruck = activeTrucks > 0
      ? Math.round((tonnesPerHour / activeTrucks) * 10) / 10
      : 0;

    return {
      shift_id:              row.shift_id,
      shift_name:            row.shift_name,
      shift_date:            row.shift_date,
      actual_tonnes:         actualTonnes,
      target_tonnes:         targetTonnes,
      achievement_pct:       achievementPct,
      total_cycles:          row.total_cycles || 0,
      target_cycles:         row.target_cycles || null,
      elapsed_hours:         elapsedHours,
      projected_tonnes:      projectedTonnes,
      tonnes_per_hour:       Math.round(tonnesPerHour * 10) / 10,
      productivity_per_truck: productivityPerTruck,
      active_trucks:         activeTrucks,
    };
  }

  /**
   * Retourne la production heure par heure sur les 12 dernières heures.
   * Utile pour le graphique d'évolution de production dans le dashboard.
   *
   * Requête sur operations.haul_cycle groupé par heure (DATE_TRUNC).
   */
  async getHourlyBreakdown(siteId: string, shiftId?: string): Promise<HourlyBreakdown[]> {
    const resolvedShiftId = await this._resolveShiftId(siteId, shiftId);

    const result = await query(
      `SELECT
         TO_CHAR(DATE_TRUNC('hour', hc.cycle_start), 'YYYY-MM-DD"T"HH24:MI:SS') AS hour,
         ROUND(SUM(hc.payload_tonnes), 0)::NUMERIC AS tonnes,
         COUNT(hc.cycle_id)::INTEGER AS cycles
       FROM operations.haul_cycle hc
       WHERE hc.site_id = $1
         AND hc.shift_id = $2
         AND hc.cycle_end IS NOT NULL
       GROUP BY DATE_TRUNC('hour', hc.cycle_start)
       ORDER BY hour ASC`,
      [siteId, resolvedShiftId]
    );

    return result.rows.map(r => ({
      hour:   r.hour,
      tonnes: parseFloat(r.tonnes) || 0,
      cycles: r.cycles,
    }));
  }

  /**
   * Détail de production par pelle (loader).
   * Permet de comparer les performances des pelles EX-201, EX-202...
   *
   * Requête sur haul_cycle groupé par loader_id.
   */
  async getLoaderBreakdown(siteId: string, shiftId?: string): Promise<LoaderBreakdown[]> {
    const resolvedShiftId = await this._resolveShiftId(siteId, shiftId);

    const result = await query(
      `SELECT
         e.equipment_id AS loader_id,
         e.fleet_number,
         ROUND(SUM(hc.payload_tonnes), 0)::NUMERIC AS tonnes,
         COUNT(hc.cycle_id)::INTEGER AS cycles,
         ROUND(AVG(hc.payload_tonnes), 1)::NUMERIC AS avg_payload
       FROM operations.haul_cycle hc
       JOIN core.equipment e ON hc.loader_id = e.equipment_id
       WHERE hc.site_id = $1
         AND hc.shift_id = $2
         AND hc.cycle_end IS NOT NULL
         AND hc.loader_id IS NOT NULL
       GROUP BY e.equipment_id, e.fleet_number
       ORDER BY tonnes DESC`,
      [siteId, resolvedShiftId]
    );

    return result.rows.map(r => ({
      loader_id:   r.loader_id,
      fleet_number: r.fleet_number,
      tonnes:      parseFloat(r.tonnes) || 0,
      cycles:      r.cycles,
      avg_payload: parseFloat(r.avg_payload) || 0,
    }));
  }

  /**
   * Classement des camions du meilleur au moins bon par tonnes transportées.
   * Le TOP 3 est ensuite repris dans le rapport de poste.
   *
   * Requête sur haul_cycle avec rang calculé par ROW_NUMBER().
   */
  async getTruckRanking(siteId: string, shiftId?: string): Promise<TruckRanking[]> {
    const resolvedShiftId = await this._resolveShiftId(siteId, shiftId);

    const result = await query(
      `SELECT
         ROW_NUMBER() OVER (ORDER BY SUM(hc.payload_tonnes) DESC)::INTEGER AS rank,
         e.equipment_id,
         e.fleet_number,
         o.first_name || ' ' || o.last_name AS operator_name,
         ROUND(SUM(hc.payload_tonnes), 0)::NUMERIC AS tonnes,
         COUNT(hc.cycle_id)::INTEGER AS cycles,
         ROUND(AVG(hc.payload_tonnes), 1)::NUMERIC AS avg_payload,
         ROUND(AVG(hc.total_duration_s) / 60.0, 1)::NUMERIC AS avg_cycle_min
       FROM operations.haul_cycle hc
       JOIN core.equipment e ON hc.truck_id = e.equipment_id
       LEFT JOIN core.operator o ON hc.operator_id = o.operator_id
       WHERE hc.site_id = $1
         AND hc.shift_id = $2
         AND hc.cycle_end IS NOT NULL
       GROUP BY e.equipment_id, e.fleet_number, o.first_name, o.last_name
       ORDER BY tonnes DESC`,
      [siteId, resolvedShiftId]
    );

    return result.rows.map(r => ({
      rank:          r.rank,
      equipment_id:  r.equipment_id,
      fleet_number:  r.fleet_number,
      operator_name: r.operator_name ?? null,
      tonnes:        parseFloat(r.tonnes) || 0,
      cycles:        r.cycles,
      avg_payload:   parseFloat(r.avg_payload) || 0,
      avg_cycle_min: parseFloat(r.avg_cycle_min) || 0,
    }));
  }

  // ── Helpers privés ──────────────────────────────────────────────────────────

  /** Résout l'ID du poste : utilise shiftId fourni ou cherche le poste ACTIVE */
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

  /** Retourne un objet KPI vide quand aucun poste n'est trouvé */
  private _emptyKPI(): ShiftProductionKPI {
    return {
      shift_id: null, shift_name: null, shift_date: null,
      actual_tonnes: 0, target_tonnes: 6000, achievement_pct: 0,
      total_cycles: 0, target_cycles: null, elapsed_hours: 0,
      projected_tonnes: 0, tonnes_per_hour: 0,
      productivity_per_truck: 0, active_trucks: 0,
    };
  }
}

// Singleton exporté : une seule instance partagée dans toute l'app
export const productionTracker = new ProductionTracker();
