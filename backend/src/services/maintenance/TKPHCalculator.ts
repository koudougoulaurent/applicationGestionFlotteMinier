/**
 * TKPHCalculator.ts
 * Calcul du TKPH (Tonnes-Kilomètres Par Heure) réel par pneu.
 *
 * Qu'est-ce que le TKPH ?
 *   C'est une mesure de la chaleur générée dans un pneu.
 *   Plus un camion transporte lourd et va vite, plus les pneus chauffent.
 *
 * Formule TKPH réel = (charge_moy_tonnes × vitesse_moy_kmh) × 2
 * (× 2 car le pneu supporte la charge sur le trajet chargé ET déchargé)
 *
 * Alerte si TKPH_réel / TKPH_nominal > 0.85 (85% de la capacité du pneu)
 *
 * Température estimée °C = TKPH_réel × 0.12 + température_ambiante
 * (modèle simplifié — un vrai système utilise des capteurs IR)
 */

import { query } from '../../config/database';

// ── Types ────────────────────────────────────────────────────────────────────

/** Résultat du calcul TKPH pour un pneu d'un équipement */
export interface TKPHResult {
  equipment_id: string;
  fleet_number: string;
  position: string;
  tkph_actual: number;
  tkph_nominal: number;
  load_pct: number;
  temp_est_c: number;
  /** TRUE si le pneu dépasse 85% de sa capacité TKPH */
  overloaded: boolean;
  alert_level: 'OK' | 'WARNING' | 'CRITICAL';
}

/** Statut TKPH global d'un équipement */
export interface EquipmentTKPHStatus {
  equipment_id: string;
  fleet_number: string;
  model: string;
  positions: PositionTKPH[];
  worst_load_pct: number;
  alert_level: 'OK' | 'WARNING' | 'CRITICAL';
}

export interface PositionTKPH {
  position: string;
  tkph_actual: number;
  tkph_nominal: number;
  load_pct: number;
  temp_est_c: number;
  overloaded: boolean;
}

// ── Constantes ────────────────────────────────────────────────────────────────
// TKPH nominal par défaut selon le modèle de camion
// Basé sur les spécifications Bridgestone VRDP / Michelin XADN (pneus géants miniers)
// Valeurs calculées pour 6 pneus avec répartition 30/70 avant/arrière
const DEFAULT_TKPH_NOMINAL: Record<string, number> = {
  'CAT 797F':      4000,  // Pneu 59/80R63 – classe 363t
  'CAT 793F':      3500,  // Pneu 46/90R57 – classe 218t
  'Komatsu 930E':  3800,  // Pneu 53/80R63 – classe 290t
};
const FALLBACK_TKPH_NOMINAL = 3500;

// Température ambiante estimée (mine zambie = ~28°C en journée)
const AMBIENT_TEMP_C = 28;

// Seuils d'alerte
const THRESHOLD_WARNING  = 0.75; // 75% → surveiller
const THRESHOLD_CRITICAL = 0.85; // 85% → surchauffe imminente

// Positions pneus pour un camion à essieu arrière double (6 pneus)
const TYRE_POSITIONS = ['FL', 'FR', 'RL1', 'RL2', 'RR1', 'RR2'];

// ── Classe principale ─────────────────────────────────────────────────────────

export class TKPHCalculator {

  /**
   * Calcule le TKPH réel pour tous les pneus d'un équipement.
   * Basé sur les cycles de la journée (haul_cycle).
   *
   * Stocke le résultat dans maintenance.tyre_tkph.
   *
   * @param equipmentId - UUID du camion
   * @param siteId      - Mine concernée
   */
  async calculateForEquipment(equipmentId: string, siteId: string): Promise<TKPHResult[]> {
    // Récupérer les données de cycles des dernières 12h pour ce camion
    const cyclesResult = await query(
      `SELECT
         e.model,
         e.payload_capacity AS nominal_payload,
         -- Charge moyenne en tonnes par cycle
         AVG(hc.payload_tonnes)::NUMERIC AS avg_payload,
         -- Vitesse moyenne estimée depuis distance et durée
         AVG(hc.distance_km / NULLIF(hc.haul_duration_s / 3600.0, 0))::NUMERIC AS avg_speed_kmh
       FROM operations.haul_cycle hc
       JOIN core.equipment e ON hc.truck_id = e.equipment_id
       WHERE hc.truck_id = $1
         AND hc.site_id = $2
         AND hc.cycle_end IS NOT NULL
         AND hc.cycle_start >= NOW() - INTERVAL '12 hours'
         AND hc.haul_duration_s > 0
       GROUP BY e.model, e.payload_capacity`,
      [equipmentId, siteId]
    );

    if (cyclesResult.rows.length === 0) {
      return [];
    }

    const row = cyclesResult.rows[0];
    const avgPayload  = parseFloat(row.avg_payload) || 0;
    const avgSpeedKmh = Math.min(parseFloat(row.avg_speed_kmh) || 25, 60); // cap 60 km/h
    const modelName   = row.model as string;

    // TKPH par pneu = (charge × vitesse × 2 allers-retours) / 6 pneus
    // Simplifié : payload × speed / 3   (= × 2 / 6)
    // Donne des valeurs cohérentes avec les fiches techniques pneus Michelin/Bridgestone
    const tkphActual = Math.round(avgPayload * avgSpeedKmh / 3 * 10) / 10;

    // TKPH nominal depuis la table de référence ou valeur par défaut
    const tkphNominal = this._getTkphNominal(modelName);

    // Température estimée (augmente avec le % de charge du pneu)
    const loadRatio  = tkphNominal > 0 ? tkphActual / tkphNominal : 0;
    const tempEstC   = Math.round((AMBIENT_TEMP_C + loadRatio * 40) * 10) / 10; // max +40°C

    const results: TKPHResult[] = [];

    // Chercher le fleet_number
    const equipResult = await query(
      `SELECT fleet_number FROM core.equipment WHERE equipment_id = $1`,
      [equipmentId]
    );
    const fleetNumber = equipResult.rows[0]?.fleet_number ?? 'UNKNOWN';

    // Calculer et stocker pour chaque position de pneu
    for (const position of TYRE_POSITIONS) {
      // Légère variation par position (RL/RR supportent plus de charge)
      const posMultiplier = position.startsWith('R') ? 1.08 : 0.95;
      const posActual   = Math.round(tkphActual * posMultiplier * 10) / 10;
      const loadPct     = Math.round(posActual / tkphNominal * 1000) / 10;
      const posTemp     = Math.round((posActual * 0.12 + AMBIENT_TEMP_C) * 10) / 10;
      const overloaded  = loadPct >= THRESHOLD_CRITICAL * 100;
      const alertLevel  = loadPct >= THRESHOLD_CRITICAL * 100
        ? 'CRITICAL'
        : loadPct >= THRESHOLD_WARNING * 100
          ? 'WARNING'
          : 'OK';

      // Upsert dans maintenance.tyre_tkph
      await query(
        `INSERT INTO maintenance.tyre_tkph
           (equipment_id, position, calc_date, tkph_actual, tkph_nominal, load_pct, temp_est_c)
         VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, $6)
         ON CONFLICT (equipment_id, position, calc_date)
         DO UPDATE SET
           tkph_actual  = EXCLUDED.tkph_actual,
           tkph_nominal = EXCLUDED.tkph_nominal,
           load_pct     = EXCLUDED.load_pct,
           temp_est_c   = EXCLUDED.temp_est_c`,
        [equipmentId, position, posActual, tkphNominal, loadPct, posTemp]
      );

      results.push({
        equipment_id: equipmentId,
        fleet_number: fleetNumber,
        position,
        tkph_actual:  posActual,
        tkph_nominal: tkphNominal,
        load_pct:     loadPct,
        temp_est_c:   posTemp,
        overloaded,
        alert_level:  alertLevel,
      });
    }

    return results;
  }

  /**
   * Lance le calcul TKPH pour tous les camions actifs du site.
   * Appelé périodiquement (ex: toutes les heures) ou en fin de poste.
   *
   * @param siteId - Mine concernée
   * @returns Nombre d'équipements traités
   */
  async calculateForSite(siteId: string): Promise<number> {
    const trucksResult = await query(
      `SELECT equipment_id
       FROM core.equipment e
       JOIN core.equipment_type et ON e.type_id = et.type_id
       WHERE e.site_id = $1
         AND e.active = TRUE
         AND et.category = 'TRUCK'`,
      [siteId]
    );

    let processed = 0;
    for (const row of trucksResult.rows) {
      try {
        await this.calculateForEquipment(row.equipment_id as string, siteId);
        processed++;
      } catch {
        // Continuer si un camion échoue (ex: pas de cycles)
      }
    }

    return processed;
  }

  /**
   * Retourne le statut TKPH actuel de toute la flotte.
   * Lit directement depuis maintenance.tyre_tkph (calculs déjà faits).
   *
   * Résultat groupé par équipement avec le pneu le plus chargé mis en avant.
   */
  async getTKPHStatus(siteId: string): Promise<EquipmentTKPHStatus[]> {
    // Essaye d'abord les données du jour, puis les 7 derniers jours
    const result = await query(
      `SELECT
         e.equipment_id,
         e.fleet_number,
         e.model,
         tt.position,
         tt.tkph_actual::NUMERIC,
         tt.tkph_nominal::NUMERIC,
         tt.load_pct::NUMERIC,
         tt.temp_est_c::NUMERIC
       FROM maintenance.tyre_tkph tt
       JOIN core.equipment e ON tt.equipment_id = e.equipment_id
       WHERE e.site_id = $1
         AND tt.calc_date >= CURRENT_DATE - INTERVAL '7 days'
       ORDER BY e.fleet_number, tt.position, tt.calc_date DESC`,
      [siteId]
    );

    // Si la table est vide, renvoie les camions avec valeurs nominales par défaut
    if (result.rows.length === 0) {
      return this._buildDefaultTKPHStatus(siteId);
    }

    // Grouper par équipement (prendre seulement la valeur la plus récente par position)
    const equipMap = new Map<string, EquipmentTKPHStatus>();
    const seenPositions = new Set<string>();  // équipement_id + position

    for (const r of result.rows) {
      const equipId = r.equipment_id as string;
      const posKey  = `${equipId}::${r.position as string}`;
      if (seenPositions.has(posKey)) continue;  // garde seulement la plus récente
      seenPositions.add(posKey);

      if (!equipMap.has(equipId)) {
        equipMap.set(equipId, {
          equipment_id:   equipId,
          fleet_number:   r.fleet_number as string,
          model:          r.model as string,
          positions:      [],
          worst_load_pct: 0,
          alert_level:    'OK',
        });
      }

      const status = equipMap.get(equipId)!;
      const loadPct = parseFloat(r.load_pct) || 0;

      status.positions.push({
        position:     r.position as string,
        tkph_actual:  parseFloat(r.tkph_actual) || 0,
        tkph_nominal: parseFloat(r.tkph_nominal) || 0,
        load_pct:     loadPct,
        temp_est_c:   parseFloat(r.temp_est_c) || 0,
        overloaded:   loadPct >= THRESHOLD_CRITICAL * 100,
      });

      if (loadPct > status.worst_load_pct) {
        status.worst_load_pct = loadPct;
        status.alert_level = loadPct >= THRESHOLD_CRITICAL * 100
          ? 'CRITICAL'
          : loadPct >= THRESHOLD_WARNING * 100
            ? 'WARNING'
            : 'OK';
      }
    }

    return Array.from(equipMap.values());
  }

  /** Construit un statut TKPH par défaut quand aucune donnée n'est disponible. */
  private async _buildDefaultTKPHStatus(siteId: string): Promise<EquipmentTKPHStatus[]> {
    const trucks = await query(
      `SELECT e.equipment_id, e.fleet_number, e.model
       FROM core.equipment e
       JOIN core.equipment_type et ON e.type_id = et.type_id
       WHERE e.site_id = $1 AND e.active = TRUE AND et.category = 'TRUCK'
       ORDER BY e.fleet_number`,
      [siteId]
    );
    return trucks.rows.map(r => {
      const nominal = this._getTkphNominal(r.model as string);
      return {
        equipment_id:   r.equipment_id as string,
        fleet_number:   r.fleet_number as string,
        model:          r.model as string,
        positions:      TYRE_POSITIONS.map(pos => ({
          position:     pos,
          tkph_actual:  0,
          tkph_nominal: nominal,
          load_pct:     0,
          temp_est_c:   AMBIENT_TEMP_C,
          overloaded:   false,
        })),
        worst_load_pct: 0,
        alert_level:    'OK' as const,
      };
    });
  }

  /**
   * Retourne uniquement les pneus dépassant 85% de leur TKPH nominal.
   * Utilisé pour les alertes et la liste d'intervention.
   */
  async getOverloadedTyres(siteId: string): Promise<TKPHResult[]> {
    const result = await query(
      `SELECT
         e.equipment_id,
         e.fleet_number,
         tt.position,
         tt.tkph_actual::NUMERIC,
         tt.tkph_nominal::NUMERIC,
         tt.load_pct::NUMERIC,
         tt.temp_est_c::NUMERIC
       FROM maintenance.tyre_tkph tt
       JOIN core.equipment e ON tt.equipment_id = e.equipment_id
       WHERE e.site_id = $1
         AND tt.calc_date = CURRENT_DATE
         AND tt.load_pct >= ${THRESHOLD_CRITICAL * 100}
       ORDER BY tt.load_pct DESC`,
      [siteId]
    );

    return result.rows.map(r => {
      const loadPct = parseFloat(r.load_pct) || 0;
      return {
        equipment_id: r.equipment_id as string,
        fleet_number: r.fleet_number as string,
        position:     r.position as string,
        tkph_actual:  parseFloat(r.tkph_actual) || 0,
        tkph_nominal: parseFloat(r.tkph_nominal) || 0,
        load_pct:     loadPct,
        temp_est_c:   parseFloat(r.temp_est_c) || 0,
        overloaded:   true,
        alert_level:  'CRITICAL',
      };
    });
  }

  // ── Helper privé ────────────────────────────────────────────────────────────

  /** Retourne le TKPH nominal selon le modèle de camion */
  private _getTkphNominal(model: string): number {
    for (const [key, value] of Object.entries(DEFAULT_TKPH_NOMINAL)) {
      if (model.includes(key)) return value;
    }
    return FALLBACK_TKPH_NOMINAL;
  }
}

// Singleton exporté
export const tkphCalculator = new TKPHCalculator();
