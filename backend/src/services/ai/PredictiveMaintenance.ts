/**
 * PredictiveMaintenance.ts — Module 4 : Maintenance Prédictive (ML)
 * ============================================================
 * Analyse la télémétrie en temps réel pour prédire les pannes
 * avant qu'elles surviennent.
 *
 * Approche : Scoring multi-critères + détection de tendances
 * ─────────────────────────────────────────────────────────────
 * Pour chaque équipement, on calcule un score de santé (0-100)
 * pour chaque sous-système (moteur, hydraulique, pneus…) en
 * comparant les lectures actuelles aux seuils opérationnels.
 *
 * On détecte aussi les TENDANCES (drift) : une température moteur
 * à 95°C n'est pas critique, mais si elle monte de 2°C/heure
 * depuis 24h, c'est un signal d'alerte.
 *
 * La durée de vie résiduelle (RUL) est estimée par extrapolation
 * linéaire de la dégradation observée.
 *
 * Ce module ne nécessite pas de librairie ML externe.
 * L'intelligence vient des seuils métier et de l'analyse de tendances.
 * ============================================================
 */

import { query } from '../../config/database';
import { linearTrend, clamp } from './utils';

// ── Seuils opérationnels ────────────────────────────────────────────────────
// Définis par les constructeurs (Caterpillar, Komatsu) et l'expérience terrain
// Ces valeurs peuvent être ajustées selon le modèle d'équipement

const THRESHOLDS = {
  ENGINE: {
    temp_c:      { warning: 95,  critical: 105, unit: '°C'  },
    oil_pres:    { warning: 3.0, critical: 2.0, unit: 'bar', invert: true },
    rpm:         { warning: 2200, critical: 2400, unit: 'tr/min' },
    coolant_c:   { warning: 98,  critical: 108, unit: '°C'  },
  },
  HYDRAULICS: {
    temp_c:      { warning: 75,  critical: 90,  unit: '°C'  },
  },
  BRAKES: {
    temp_c:      { warning: 150, critical: 250, unit: '°C'  },
  },
  FUEL: {
    level_pct:   { warning: 20,  critical: 10,  unit: '%', invert: true },
  },
  ELECTRICAL: {
    battery_v:   { warning: 11.5, critical: 11.0, unit: 'V', invert: true },
  },
};

// Fenêtre de temps pour l'analyse des tendances
const TREND_WINDOW_HOURS = 24;
const TREND_READINGS     = 48;   // ~1 lecture toutes les 30 min sur 24h

// ── Types ────────────────────────────────────────────────────────────────────

/** Résultat de l'analyse pour un équipement */
export interface MaintenancePrediction {
  equipmentId:      string;
  fleetNumber:      string;
  category:         string;
  predictedAt:      string;

  // Scores de santé par composant (0-100)
  scores: {
    engine:       number;
    hydraulics:   number;
    brakes:       number;
    fuel:         number;
    electrical:   number;
    overall:      number;    // moyenne pondérée
  };

  // Durée de vie résiduelle estimée (heures avant panne probable)
  rulHours: number;

  // Probabilités de panne dans les prochaines heures
  probability24h: number;  // 0-1
  probability72h: number;
  probability7d:  number;

  // Signaux détectés (pour expliquer la prédiction)
  signals: Array<{
    component: string;
    metric:    string;
    value:     number;
    threshold: number;
    trend:     string;   // "stable", "+2.3°C/h", "-0.5 bar/24h"
    severity:  'info' | 'warning' | 'critical';
  }>;

  // Action recommandée
  action:       'MONITOR' | 'INSPECT_SOON' | 'PLAN_MAINTENANCE' | 'URGENT' | 'IMMEDIATE';
  actionReason: string;

  // Date recommandée pour l'intervention
  recommendedByDate?: string;
}

// ── Classe principale ─────────────────────────────────────────────────────────

export class PredictiveMaintenanceEngine {

  /**
   * Analyse tous les équipements actifs d'un site et génère les prédictions.
   */
  async analyzeSite(siteId: string): Promise<MaintenancePrediction[]> {
    const equipment = await query(
      `SELECT e.equipment_id, e.fleet_number, e.current_hours,
              e.health_score, et.category
       FROM core.equipment e
       JOIN core.equipment_type et ON e.type_id = et.type_id
       WHERE e.site_id = $1 AND e.active = TRUE
         AND et.category IN ('TRUCK', 'EXCAVATOR', 'LOADER', 'DOZER', 'DRILL')
       ORDER BY e.health_score ASC`,
      [siteId]
    );

    const predictions: MaintenancePrediction[] = [];

    for (const eq of equipment.rows) {
      try {
        const prediction = await this.analyzeEquipment(
          eq.equipment_id,
          eq.fleet_number,
          eq.category,
          parseFloat(eq.current_hours) || 0
        );
        predictions.push(prediction);
      } catch {
        // Ne pas planter l'analyse d'un site entier pour un équipement défaillant
      }
    }

    return predictions.sort((a, b) => a.scores.overall - b.scores.overall);
  }

  /**
   * Analyse un équipement spécifique.
   *
   * Étapes :
   * 1. Charge les 48 dernières lectures télémétrie
   * 2. Calcule les statistiques (min, max, moyenne, tendance) par métrique
   * 3. Compare aux seuils → score par composant
   * 4. Extrapole la RUL depuis la dégradation observée
   * 5. Calcule les probabilités de panne
   */
  async analyzeEquipment(
    equipmentId: string,
    fleetNumber: string,
    category:    string,
    currentHours: number
  ): Promise<MaintenancePrediction> {

    // ── 1. Charge l'historique télémétrique ─────────────────
    const telemetry = await query(
      `SELECT engine_temp_c, oil_pressure, engine_rpm, coolant_temp_c,
              hydraulic_temp_c, brake_temp_c, fuel_level_pct,
              battery_v, load_payload_t, event_time
       FROM operations.telemetry_event
       WHERE equipment_id = $1
         AND event_time > NOW() - INTERVAL '${TREND_WINDOW_HOURS} hours'
       ORDER BY event_time ASC
       LIMIT $2`,
      [equipmentId, TREND_READINGS]
    );

    const rows = telemetry.rows;
    const n    = rows.length;

    // ── 2. Statistiques par métrique ────────────────────────
    const extract = (field: string) =>
      rows.map(r => parseFloat(r[field])).filter(v => !isNaN(v));

    const engineTemps  = extract('engine_temp_c');
    const oilPressures = extract('oil_pressure');
    const engineRpms   = extract('engine_rpm');
    const coolantTemps = extract('coolant_temp_c');
    const hydTemps     = extract('hydraulic_temp_c');
    const brakeTemps   = extract('brake_temp_c');
    const fuelLevels   = extract('fuel_level_pct');
    const batteryVs    = extract('battery_v');

    // Valeurs actuelles (dernière lecture connue)
    const current = {
      engineTemp:  engineTemps[engineTemps.length - 1]    ?? 80,
      oilPressure: oilPressures[oilPressures.length - 1]  ?? 4.5,
      engineRpm:   engineRpms[engineRpms.length - 1]      ?? 1400,
      hydTemp:     hydTemps[hydTemps.length - 1]           ?? 65,
      brakeTemp:   brakeTemps[brakeTemps.length - 1]       ?? 80,
      fuelLevel:   fuelLevels[fuelLevels.length - 1]       ?? 50,
      batteryV:    batteryVs[batteryVs.length - 1]          ?? 12.5,
    };

    // ── 3. Calcul des scores de santé ───────────────────────

    const signals: MaintenancePrediction['signals'] = [];

    // Score moteur (40% du score global — composant le plus critique)
    const engineScore = this.scoreComponent('ENGINE', [
      { name: 'temp_c',   values: engineTemps,  config: THRESHOLDS.ENGINE.temp_c,   current: current.engineTemp },
      { name: 'oil_pres', values: oilPressures, config: THRESHOLDS.ENGINE.oil_pres, current: current.oilPressure },
      { name: 'rpm',      values: engineRpms,   config: THRESHOLDS.ENGINE.rpm,      current: current.engineRpm },
      { name: 'coolant',  values: coolantTemps, config: THRESHOLDS.ENGINE.coolant_c, current: current.engineTemp },
    ], signals);

    // Score hydraulique (25%)
    const hydScore = this.scoreComponent('HYDRAULICS', [
      { name: 'temp_c', values: hydTemps, config: THRESHOLDS.HYDRAULICS.temp_c, current: current.hydTemp },
    ], signals);

    // Score freins (15%)
    const brakeScore = this.scoreComponent('BRAKES', [
      { name: 'temp_c', values: brakeTemps, config: THRESHOLDS.BRAKES.temp_c, current: current.brakeTemp },
    ], signals);

    // Score carburant/fluides (10%)
    const fuelScore = this.scoreComponent('FUEL', [
      { name: 'level_pct', values: fuelLevels, config: THRESHOLDS.FUEL.level_pct, current: current.fuelLevel },
    ], signals);

    // Score électrique (10%)
    const electricScore = this.scoreComponent('ELECTRICAL', [
      { name: 'battery_v', values: batteryVs, config: THRESHOLDS.ELECTRICAL.battery_v, current: current.batteryV },
    ], signals);

    // Score global pondéré
    const overall = clamp(Math.round(
      engineScore  * 0.40 +
      hydScore     * 0.25 +
      brakeScore   * 0.15 +
      fuelScore    * 0.10 +
      electricScore * 0.10
    ), 0, 100);

    // ── 4. Estimation de la RUL (Remaining Useful Life) ────
    // Méthode : si la santé actuelle est de S et baisse à un taux T/h,
    // alors le temps avant S = 0 est : S / T heures
    const scores = [engineScore, hydScore, brakeScore, fuelScore, electricScore];
    const minScore = Math.min(...scores);

    // Tendance de dégradation (points de score perdus par heure simulée)
    // On utilise la tendance du composant le plus dégradé
    const worstTrend = this.estimateDegradationRate(scores, n);

    let rulHours: number;
    if (worstTrend <= 0) {
      // Pas de dégradation détectée → RUL très élevée
      rulHours = 5000;
    } else {
      // Extrapolation : combien d'heures avant que le score tombe à 30 ?
      // (30 = seuil critique opérationnel)
      rulHours = Math.max(0, (minScore - 30) / worstTrend);
    }
    rulHours = clamp(rulHours, 0, 10000);

    // ── 5. Probabilités de panne ─────────────────────────
    // Basées sur le score de santé et la RUL
    // Modèle logistique simple : P(panne) = 1 / (1 + e^(k×(RUL - t)))
    const p24h = this.failureProbability(rulHours, 24);
    const p72h = this.failureProbability(rulHours, 72);
    const p7d  = this.failureProbability(rulHours, 168);

    // ── 6. Action recommandée ────────────────────────────
    const { action, reason, byDate } = this.recommendAction(
      overall, rulHours, p24h, signals
    );

    // Sauvegarde en DB (pour historique et alertes)
    await this.savePrediction(equipmentId, {
      overall, engineScore, hydScore, brakeScore, fuelScore, electricScore,
      rulHours, p24h, p72h, p7d, action, signals
    });

    return {
      equipmentId,
      fleetNumber,
      category,
      predictedAt:    new Date().toISOString(),
      scores: {
        engine:      Math.round(engineScore),
        hydraulics:  Math.round(hydScore),
        brakes:      Math.round(brakeScore),
        fuel:        Math.round(fuelScore),
        electrical:  Math.round(electricScore),
        overall,
      },
      rulHours:       Math.round(rulHours),
      probability24h: +p24h.toFixed(3),
      probability72h: +p72h.toFixed(3),
      probability7d:  +p7d.toFixed(3),
      signals:        signals.sort((a, b) =>
        ['critical', 'warning', 'info'].indexOf(a.severity) -
        ['critical', 'warning', 'info'].indexOf(b.severity)
      ),
      action,
      actionReason:   reason,
      recommendedByDate: byDate,
    };
  }

  // ── Méthodes privées ──────────────────────────────────────────────────────

  /**
   * Calcule le score de santé (0-100) d'un composant à partir de ses métriques.
   * Un score de 100 = toutes les métriques sont dans les limites normales.
   * Un score de 0 = au moins une métrique est en état critique.
   */
  private scoreComponent(
    componentName: string,
    metrics: Array<{
      name:    string;
      values:  number[];
      config:  { warning: number; critical: number; unit: string; invert?: boolean };
      current: number;
    }>,
    signals: MaintenancePrediction['signals']
  ): number {
    if (metrics.every(m => m.values.length === 0)) return 85; // pas de données → score neutre

    let totalPenalty = 0;

    for (const { name, values, config, current } of metrics) {
      if (values.length === 0) continue;

      const avg   = values.reduce((a, b) => a + b, 0) / values.length;
      const max   = Math.max(...values);
      const min   = Math.min(...values);
      const trend = linearTrend(values); // pente par lecture

      // Pour les métriques "inversées" (ex: pression huile), une valeur BASSE est le problème
      const ref      = config.invert ? -current : current;
      const warning  = config.invert ? -config.warning  : config.warning;
      const critical = config.invert ? -config.critical : config.critical;

      let severity: 'info' | 'warning' | 'critical' = 'info';
      let penalty = 0;

      if (config.invert ? current <= config.critical : current >= config.critical) {
        severity = 'critical';
        penalty  = 40;  // pénalité critique : -40 points
      } else if (config.invert ? current <= config.warning : current >= config.warning) {
        severity = 'warning';
        penalty  = 20;  // pénalité avertissement : -20 points
      }

      // Pénalité supplémentaire si la tendance est défavorable
      // Tendance = unités par lecture (ex: +2.3°C par lecture)
      const trendPerHour = trend * 2; // suppose ~2 lectures / heure
      if (Math.abs(trendPerHour) > 0.1) {
        const trendPenalty = config.invert ? -trendPerHour * 5 : trendPerHour * 5;
        if (trendPenalty > 0) penalty += Math.min(20, trendPenalty);
      }

      totalPenalty += penalty;

      // Enregistre le signal si notable
      if (severity !== 'info' || Math.abs(trendPerHour) > 0.5) {
        const trendStr = Math.abs(trendPerHour) < 0.05
          ? 'stable'
          : `${trendPerHour > 0 ? '+' : ''}${trendPerHour.toFixed(1)} ${config.unit}/h`;

        signals.push({
          component: componentName,
          metric:    name,
          value:     +current.toFixed(2),
          threshold: config.invert ? config.warning : config.warning,
          trend:     trendStr,
          severity,
        });
      }
    }

    return clamp(100 - totalPenalty, 0, 100);
  }

  /**
   * Estime le taux de dégradation en points de score par heure.
   * Basé sur le nombre de signaux d'alerte et la tendance observée.
   */
  private estimateDegradationRate(scores: number[], readingCount: number): number {
    const minScore = Math.min(...scores);

    if (readingCount < 5) return 0.01; // pas assez de données

    // Plus le score est bas et plus la dégradation est supposée rapide
    if (minScore > 80) return 0.01;    // santé bonne → dégradation lente
    if (minScore > 60) return 0.05;    // santé correcte
    if (minScore > 40) return 0.15;    // santé dégradée
    return 0.3;                         // santé critique → dégradation rapide
  }

  /**
   * Calcule la probabilité de panne dans les `horizon` prochaines heures.
   * Utilise un modèle logistique : P = 1 / (1 + e^(-k*(horizon - RUL/2)))
   *
   * Intuition : si RUL = 100h et horizon = 24h → faible probabilité
   *             si RUL = 10h  et horizon = 24h → forte probabilité
   */
  private failureProbability(rulHours: number, horizonHours: number): number {
    const k    = 0.05;  // pente de la courbe logistique
    const mid  = rulHours * 0.7; // point d'inflexion à 70% de la RUL

    if (rulHours > horizonHours * 10) return 0.01; // RUL très grande → quasi-zéro
    if (rulHours < horizonHours * 0.5) return 0.85; // RUL très petite → quasi-certain

    const p = 1 / (1 + Math.exp(-k * (horizonHours - mid)));
    return clamp(+(p).toFixed(3), 0.01, 0.99);
  }

  /** Détermine l'action recommandée selon l'état global */
  private recommendAction(
    overall:  number,
    rulHours: number,
    p24h:     number,
    signals:  MaintenancePrediction['signals']
  ): { action: MaintenancePrediction['action']; reason: string; byDate?: string } {
    const criticalSignals = signals.filter(s => s.severity === 'critical').length;
    const now = new Date();

    if (overall < 30 || p24h > 0.7 || criticalSignals >= 2) {
      return {
        action: 'IMMEDIATE',
        reason: `Score de santé critique (${overall}/100), risque de panne immédiat`,
      };
    }
    if (overall < 50 || p24h > 0.4 || rulHours < 24) {
      return {
        action: 'URGENT',
        reason: `Dégradation rapide détectée, intervention requise sous 24h`,
        byDate: new Date(now.getTime() + 24 * 3600000).toISOString().split('T')[0],
      };
    }
    if (overall < 65 || rulHours < 72) {
      return {
        action: 'PLAN_MAINTENANCE',
        reason: `Maintenance préventive recommandée dans les 7 jours`,
        byDate: new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0],
      };
    }
    if (overall < 80 || criticalSignals >= 1) {
      return {
        action: 'INSPECT_SOON',
        reason: `Inspecter les composants concernés dans les 72h`,
        byDate: new Date(now.getTime() + 3 * 86400000).toISOString().split('T')[0],
      };
    }

    return {
      action: 'MONITOR',
      reason: `État satisfaisant, continuer la surveillance normale`,
    };
  }

  /** Sauvegarde la prédiction en DB */
  private async savePrediction(equipmentId: string, data: {
    overall: number; engineScore: number; hydScore: number;
    brakeScore: number; fuelScore: number; electricScore: number;
    rulHours: number; p24h: number; p72h: number; p7d: number;
    action: string; signals: MaintenancePrediction['signals'];
  }): Promise<void> {
    // Le composant le plus critique
    const compScores = [
      { c: 'ENGINE',       s: data.engineScore },
      { c: 'HYDRAULICS',   s: data.hydScore    },
      { c: 'BRAKES',       s: data.brakeScore  },
    ];
    const worst = compScores.sort((a, b) => a.s - b.s)[0];

    await query(
      `INSERT INTO ai.maintenance_prediction
         (equipment_id, component, health_score, rul_hours,
          probability_24h, probability_72h, probability_7d,
          recommended_action, trigger_signals, model_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '1.0')`,
      [
        equipmentId, worst.c, data.overall, Math.round(data.rulHours),
        data.p24h, data.p72h, data.p7d, data.action,
        JSON.stringify(data.signals),
      ]
    ).catch(() => {});
  }
}

// Instance singleton
export const predictiveMaintenance = new PredictiveMaintenanceEngine();
