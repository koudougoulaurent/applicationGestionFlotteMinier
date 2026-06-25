/**
 * overview.controller.ts
 *
 * UN SEUL endpoint qui agrège toutes les données critiques de la mine
 * pour alimenter le Command Center en temps réel.
 *
 * Principe : le frontend n'a besoin que d'UN seul appel pour avoir
 *            une vue complète et cohérente de la situation.
 *
 * Source de vérité :
 *  - Production live → SimulationEngine (en mémoire, pas la DB historique)
 *  - Flotte          → core.equipment
 *  - Capteurs        → dernières lectures BNR
 *  - Sécurité        → violations (2h) + délais actifs
 *  - Maintenance     → prédictions ML (top 5 risques)
 *  - Alarmes         → table operations.alarm ou simulation events
 */

import { Request, Response } from 'express';
import { simulationEngine }      from '../services/simulation/SimulationEngine';
import { predictiveMaintenance } from '../services/ai/PredictiveMaintenance';
import { query }                 from '../config/database';

type AuthRequest = Request & { user?: { siteId: string } };

export async function getOverview(req: AuthRequest, res: Response): Promise<void> {
  const siteId = (req.query.siteId as string) || req.user?.siteId;
  if (!siteId) { res.status(400).json({ error: 'siteId requis' }); return; }

  try {
    // ── 1. Simulation en mémoire (source de vérité live) ─────────────────────
    const sim = simulationEngine.getStatus();
    const simData = {
      status:          sim.status,
      speedMultiplier: sim.speedMultiplier,
      uptime_s:        sim.uptime_s,
      totalCycles:     sim.totalCycles,
      totalTonnes:     Math.round(sim.totalTonnes),
      trucks:          sim.trucks,
      truckCount:      sim.trucks.length,
    };

    // ── 2. Flotte (comptages rapides) ─────────────────────────────────────────
    const fleetRes = await query(
      `SELECT
         COUNT(*)                                                           AS total,
         COUNT(*) FILTER (WHERE e.status NOT IN ('DOWN','MAINTENANCE'))     AS operational,
         COUNT(*) FILTER (WHERE e.status = 'DOWN')                         AS down,
         COUNT(*) FILTER (WHERE e.status = 'MAINTENANCE')                  AS in_maintenance,
         COUNT(*) FILTER (WHERE et.category = 'TRUCK')                     AS trucks,
         COUNT(*) FILTER (WHERE et.category IN ('EXCAVATOR','LOADER'))     AS loaders
       FROM core.equipment e
       JOIN core.equipment_type et ON e.type_id = et.type_id
       WHERE e.site_id = $1 AND e.active = TRUE`,
      [siteId]
    );
    const fleet = fleetRes.rows[0];

    // ── 3. Capteurs BNR (dernière lecture par station) ────────────────────────
    const bnrRes = await query(
      `SELECT bs.code AS station_code, bs.name AS station_name,
              br.stability_index, br.vibration_mms, br.status, br.recorded_at
       FROM sensors.bnr_station bs
       LEFT JOIN LATERAL (
         SELECT stability_index, vibration_mms, status, recorded_at
         FROM sensors.bnr_reading
         WHERE station_id = bs.station_id
         ORDER BY recorded_at DESC LIMIT 1
       ) br ON TRUE
       WHERE bs.site_id = $1
       ORDER BY bs.code`,
      [siteId]
    );
    const bnrReadings = bnrRes.rows.map(r => ({
      stationCode:    r.station_code,
      stationName:    r.station_name,
      stabilityIndex: r.stability_index ? parseFloat(r.stability_index) : null,
      vibrationMms:   r.vibration_mms   ? parseFloat(r.vibration_mms)   : null,
      status:         r.status ?? 'NO_DATA',
      recordedAt:     r.recorded_at,
    }));
    const bnrStatus =
      bnrReadings.some(r => r.status === 'CRITICAL') ? 'CRITICAL' :
      bnrReadings.some(r => r.status === 'WARNING')  ? 'WARNING'  :
      bnrReadings.every(r => r.status === 'NORMAL')  ? 'NORMAL'   : 'NO_DATA';

    // ── 4. Violations de vitesse (dernières 2 heures) ─────────────────────────
    const violRes = await query(
      `SELECT sv.severity, e.fleet_number,
              sv.speed_kmh, sv.limit_kmh, sv.excess_pct,
              TO_CHAR(sv.detected_at, 'HH24:MI') AS time_label
       FROM operations.speed_violation sv
       JOIN core.equipment e ON sv.equipment_id = e.equipment_id
       WHERE sv.site_id = $1
         AND sv.detected_at >= NOW() - INTERVAL '2 hours'
       ORDER BY sv.detected_at DESC
       LIMIT 10`,
      [siteId]
    );
    const violations = violRes.rows.map(r => ({
      severity:    r.severity,
      fleetNumber: r.fleet_number,
      speedKmh:    parseFloat(r.speed_kmh),
      limitKmh:    parseFloat(r.limit_kmh),
      excessPct:   parseFloat(r.excess_pct),
      timeLabel:   r.time_label,
    }));

    // ── 5. Délais actifs (camions bloqués en ce moment) ──────────────────────
    const delayRes = await query(
      `SELECT e.fleet_number, dc.code AS cat_code, dc.label AS cat_label,
              ROUND(EXTRACT(EPOCH FROM (NOW() - de.started_at)) / 60)::INTEGER AS duration_min
       FROM operations.delay_event de
       JOIN core.equipment e ON de.equipment_id = e.equipment_id
       JOIN operations.delay_category dc ON de.cat_id = dc.cat_id
       WHERE de.site_id = $1 AND de.ended_at IS NULL
       ORDER BY de.started_at ASC`,
      [siteId]
    );
    const activeDelays = delayRes.rows.map(r => ({
      fleetNumber:  r.fleet_number,
      catCode:      r.cat_code,
      catLabel:     r.cat_label,
      durationMin:  r.duration_min,
    }));

    // ── 6. Maintenance — top 5 risques (via service ML) ──────────────────────
    let maintenanceRisks: Array<{
      fleetNumber: string; healthScore: number;
      rulHours: number; action: string;
    }> = [];
    try {
      const predictions = await predictiveMaintenance.analyzeSite(siteId);
      maintenanceRisks = predictions
        .sort((a, b) => (a.scores?.overall ?? 100) - (b.scores?.overall ?? 100))
        .slice(0, 5)
        .map(p => ({
          fleetNumber: p.fleetNumber,
          healthScore: p.scores?.overall ?? 100,
          rulHours:    p.rulHours,
          action:      p.action ?? 'MONITOR',
        }));
    } catch { /* si le service ML échoue, on renvoie un tableau vide */ }

    // ── 7. MA% global (disponibilité mécanique) ───────────────────────────────
    // MA = (total_hours - maintenance_hours) / total_hours × 100
    // Approximation rapide : % d'équipements non-DOWN et non-MAINTENANCE
    const totalEquip = parseInt(fleet.trucks) || 1;
    const downEquip  = parseInt(fleet.down) || 0;
    const maPct = Math.round(((totalEquip - downEquip) / totalEquip) * 100);

    // ── 8. Objectif de production du poste actif ─────────────────────────────
    const targetRes = await query(
      `SELECT pt.target_tonnes, pt.target_cycles
       FROM operations.production_target pt
       JOIN core.shift s ON pt.shift_id = s.shift_id
       WHERE s.site_id = $1 AND s.status = 'ACTIVE'
       LIMIT 1`,
      [siteId]
    );
    const productionTarget = {
      targetTonnes: parseFloat(targetRes.rows[0]?.target_tonnes) || 6000,
      targetCycles: parseInt(targetRes.rows[0]?.target_cycles)   || 120,
    };

    // ── Réponse finale ────────────────────────────────────────────────────────
    res.json({
      simulation:        simData,
      fleet: {
        total:         parseInt(fleet.total),
        operational:   parseInt(fleet.operational),
        down:          parseInt(fleet.down),
        inMaintenance: parseInt(fleet.in_maintenance),
        trucks:        parseInt(fleet.trucks),
        loaders:       parseInt(fleet.loaders),
      },
      production: {
        // Source : simulation en mémoire (données de la session courante)
        sessionCycles:   simData.totalCycles,
        sessionTonnes:   simData.totalTonnes,
        targetTonnes:    productionTarget.targetTonnes,
        targetCycles:    productionTarget.targetCycles,
        achievementPct:  simData.totalTonnes > 0
          ? Math.min(9999, +(simData.totalTonnes / productionTarget.targetTonnes * 100).toFixed(1))
          : 0,
        ratePerHour:     simData.uptime_s > 0
          ? +(simData.totalTonnes / (simData.uptime_s / 3600)).toFixed(1)
          : 0,
      },
      safety: {
        violations2h:     violations.length,
        criticalCount:    violations.filter(v => v.severity === 'CRITICAL').length,
        activeDelays:     activeDelays.length,
        bnrStatus,
        bnrReadings,
        recentViolations: violations.slice(0, 5),
        activeDelayList:  activeDelays,
      },
      maintenance: {
        maPct,
        urgentCount:  maintenanceRisks.filter(r => r.action === 'URGENT').length,
        risks:        maintenanceRisks,
      },
      lastUpdated: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[overview] error:', msg);
    res.status(500).json({ error: msg });
  }
}
