import { Request, Response } from 'express';
import { query } from '../config/database';

// ──────────────────────────────────────────────
// RÉFÉRENTIELS
// ──────────────────────────────────────────────

export async function listMaterials(_req: Request, res: Response): Promise<void> {
  const result = await query(
    `SELECT material_id, code, name, category, density_t_m3, color
     FROM core.material ORDER BY category, name`
  );
  res.json(result.rows);
}

// ──────────────────────────────────────────────
// PRODUCTION PLANNING & RECONCILIATION
// ──────────────────────────────────────────────

/** Daily production reconciliation (actual vs plan) for a date range */
export async function getDailyReconciliation(
  req: Request & { user?: { siteId: string } },
  res: Response
): Promise<void> {
  const siteId = req.query.siteId || req.user?.siteId;
  const days = Math.min(30, parseInt(req.query.days as string || '14'));

  const result = await query(
    `SELECT
       DATE(hc.cycle_start) AS day,
       COUNT(hc.cycle_id) AS cycles,
       ROUND(SUM(hc.payload_tonnes), 0) AS actual_tonnes,
       ROUND(AVG(hc.payload_tonnes), 1) AS avg_payload,
       ROUND(AVG(hc.total_duration_s) / 60.0, 1) AS avg_cycle_min,
       COUNT(hc.cycle_id) FILTER (WHERE hc.overloaded) AS overloaded_count,
       -- Plan target for that day (sum across all shifts)
       COALESCE((
         SELECT SUM(pp.target_tonnes)
         FROM operations.production_plan pp
         JOIN core.shift s ON pp.shift_id = s.shift_id
         WHERE s.site_id = $1 AND DATE(s.shift_date) = DATE(hc.cycle_start)
       ), 0) AS plan_tonnes
     FROM operations.haul_cycle hc
     WHERE hc.site_id = $1
       AND hc.cycle_start >= NOW() - ($2 || ' days')::INTERVAL
       AND hc.cycle_end IS NOT NULL
     GROUP BY DATE(hc.cycle_start)
     ORDER BY day DESC`,
    [siteId, days]
  );

  // Fill in days with plan but no production
  res.json(result.rows);
}

/** Per-shift reconciliation for a specific date */
export async function getShiftReconciliation(
  req: Request & { user?: { siteId: string } },
  res: Response
): Promise<void> {
  const siteId = req.query.siteId || req.user?.siteId;
  const date = req.query.date as string || new Date().toISOString().slice(0, 10);

  const result = await query(
    `SELECT
       s.shift_id,
       sd.shift_name,
       sd.color,
       s.shift_date,
       s.status AS shift_status,
       o.first_name || ' ' || o.last_name AS supervisor,
       -- Actual
       COUNT(hc.cycle_id) AS actual_cycles,
       ROUND(COALESCE(SUM(hc.payload_tonnes), 0), 0) AS actual_tonnes,
       ROUND(COALESCE(AVG(hc.total_duration_s) / 60.0, 0), 1) AS avg_cycle_min,
       -- Plan
       COALESCE(pp.target_tonnes, 0) AS plan_tonnes,
       COALESCE(pp.target_loads, 0) AS plan_cycles,
       -- Achievement
       ROUND(
         100.0 * COALESCE(SUM(hc.payload_tonnes), 0) / NULLIF(pp.target_tonnes, 0),
       1) AS achievement_pct
     FROM core.shift s
     JOIN core.shift_definition sd ON s.shift_def_id = sd.shift_def_id
     LEFT JOIN core.operator o ON s.supervisor_id = o.operator_id
     LEFT JOIN operations.haul_cycle hc ON hc.shift_id = s.shift_id AND hc.cycle_end IS NOT NULL
     LEFT JOIN operations.production_plan pp ON pp.shift_id = s.shift_id
     WHERE s.site_id = $1 AND s.shift_date = $2
     GROUP BY s.shift_id, sd.shift_name, sd.color, s.shift_date, s.status,
              o.first_name, o.last_name, pp.target_tonnes, pp.target_loads
     ORDER BY sd.shift_name`,
    [siteId, date]
  );

  res.json(result.rows);
}

/** By-material production breakdown */
export async function getMaterialBreakdown(
  req: Request & { user?: { siteId: string } },
  res: Response
): Promise<void> {
  const siteId = req.query.siteId || req.user?.siteId;
  const date = req.query.date as string || new Date().toISOString().slice(0, 10);

  const result = await query(
    `SELECT
       m.name AS material,
       m.color AS material_color,
       ls.name AS source,
       ld.name AS destination,
       COUNT(hc.cycle_id) AS cycles,
       ROUND(SUM(hc.payload_tonnes), 0) AS tonnes,
       ROUND(AVG(hc.payload_tonnes), 1) AS avg_payload,
       ROUND(AVG(hc.total_duration_s) / 60.0, 1) AS avg_cycle_min,
       COUNT(hc.cycle_id) FILTER (WHERE hc.overloaded) AS overloaded
     FROM operations.haul_cycle hc
     LEFT JOIN core.material m ON hc.material_id = m.material_id
     LEFT JOIN core.location ls ON hc.source_location_id = ls.location_id
     LEFT JOIN core.location ld ON hc.dest_location_id = ld.location_id
     WHERE hc.site_id = $1
       AND DATE(hc.cycle_start) = $2
       AND hc.cycle_end IS NOT NULL
     GROUP BY m.name, m.color, ls.name, ld.name
     ORDER BY tonnes DESC`,
    [siteId, date]
  );

  res.json(result.rows);
}

/** Per-truck performance for a date */
export async function getTruckPerformance(
  req: Request & { user?: { siteId: string } },
  res: Response
): Promise<void> {
  const siteId = req.query.siteId || req.user?.siteId;
  const date = req.query.date as string || new Date().toISOString().slice(0, 10);

  const result = await query(
    `SELECT
       e.fleet_number,
       et.category,
       o.first_name || ' ' || o.last_name AS operator_name,
       COUNT(hc.cycle_id) AS cycles,
       ROUND(SUM(hc.payload_tonnes), 0) AS tonnes,
       ROUND(AVG(hc.payload_tonnes), 1) AS avg_payload,
       ROUND(AVG(hc.payload_factor), 3) AS avg_payload_factor,
       ROUND(AVG(hc.total_duration_s) / 60.0, 1) AS avg_cycle_min,
       ROUND(AVG(hc.queue_duration_s) / 60.0, 1) AS avg_queue_min,
       COUNT(hc.cycle_id) FILTER (WHERE hc.overloaded) AS overloaded,
       -- Benchmark: tonnes per hour in shift
       ROUND(SUM(hc.payload_tonnes) / NULLIF(
         EXTRACT(EPOCH FROM MAX(hc.cycle_end) - MIN(hc.cycle_start)) / 3600.0, 0
       ), 1) AS tonnes_per_hour
     FROM operations.haul_cycle hc
     JOIN core.equipment e ON hc.truck_id = e.equipment_id
     JOIN core.equipment_type et ON e.type_id = et.type_id
     LEFT JOIN core.operator o ON hc.operator_id = o.operator_id
     WHERE hc.site_id = $1
       AND DATE(hc.cycle_start) = $2
       AND hc.cycle_end IS NOT NULL
     GROUP BY e.fleet_number, et.category, o.first_name, o.last_name
     ORDER BY tonnes DESC`,
    [siteId, date]
  );

  res.json(result.rows);
}

/** Create or update a production plan */
export async function upsertProductionPlan(
  req: Request & { user?: { siteId: string } },
  res: Response
): Promise<void> {
  const { shiftId, targetTonnes, targetLoads, sourceLocationId, destLocationId, notes } = req.body;

  if (!shiftId || !targetTonnes) {
    res.status(400).json({ error: 'shiftId and targetTonnes required' });
    return;
  }

  const result = await query(
    `INSERT INTO operations.production_plan
       (site_id, shift_id, plan_date, target_tonnes, target_loads,
        source_location_id, dest_location_id, notes)
     SELECT
       $1, $2, s.shift_date, $3, $4, $5, $6, $7
     FROM core.shift s WHERE s.shift_id = $2
     ON CONFLICT (shift_id) DO UPDATE
       SET target_tonnes = EXCLUDED.target_tonnes,
           target_loads = EXCLUDED.target_loads,
           notes = EXCLUDED.notes
     RETURNING *`,
    [
      req.user?.siteId,
      shiftId,
      targetTonnes,
      targetLoads || null,
      sourceLocationId || null,
      destLocationId || null,
      notes || null,
    ]
  );

  res.json(result.rows[0]);
}

// ──────────────────────────────────────────────
// ROUTE CONDITIONS
// ──────────────────────────────────────────────

export async function listRoadConditions(
  req: Request & { user?: { siteId: string } },
  res: Response
): Promise<void> {
  try {
    const siteId = req.query.siteId || req.user?.siteId;

    const result = await query(
      `SELECT
         rc.*,
         hr.name AS road_name,
         hr.distance_km,
         hr.avg_gradient,
         hr.speed_limit_kmh,
         hr.road_class,
         ls.name AS start_location,
         le.name AS end_location
       FROM core.road_condition rc
       JOIN core.haul_road hr ON rc.road_id = hr.road_id
       LEFT JOIN core.location ls ON hr.start_location_id = ls.location_id
       LEFT JOIN core.location le ON hr.end_location_id = le.location_id
       WHERE hr.site_id = $1
         AND (rc.valid_until IS NULL OR rc.valid_until > NOW())
       ORDER BY rc.severity DESC, rc.reported_at DESC`,
      [siteId]
    );

    const roads = await query(
      `SELECT
         hr.road_id, hr.name AS road_name, hr.distance_km,
         hr.avg_gradient, hr.speed_limit_kmh, hr.road_class,
         ls.name AS start_location, le.name AS end_location,
         hr.active
       FROM core.haul_road hr
       LEFT JOIN core.location ls ON hr.start_location_id = ls.location_id
       LEFT JOIN core.location le ON hr.end_location_id = le.location_id
       WHERE hr.site_id = $1
       ORDER BY hr.road_class, hr.name`,
      [siteId]
    );

    res.json({
      conditions: result.rows,
      roads: roads.rows,
    });
  } catch (err) {
    console.error('listRoadConditions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function recordRoadCondition(
  req: Request & { user?: { siteId: string } },
  res: Response
): Promise<void> {
  try {
    const { roadId, conditionType, severity, description, speedReduction, closedFlag, validUntil } = req.body;

    if (!roadId || !conditionType) {
      res.status(400).json({ error: 'roadId and conditionType required' });
      return;
    }

    await query(
      `UPDATE core.road_condition
       SET valid_until = NOW()
       WHERE road_id = $1 AND (valid_until IS NULL OR valid_until > NOW())`,
      [roadId]
    );

    const result = await query(
      `INSERT INTO core.road_condition
         (road_id, condition_type, severity, description, speed_reduction_kmh, closed, valid_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        roadId,
        conditionType,
        severity || 'LOW',
        description || null,
        speedReduction || 0,
        closedFlag || false,
        validUntil || null,
      ]
    );

    if (closedFlag || severity === 'HIGH') {
      const road = await query('SELECT hr.site_id, hr.name FROM core.haul_road hr WHERE hr.road_id = $1', [roadId]);
      if (road.rows[0]) {
        await query(
          `INSERT INTO operations.alarm
             (site_id, alarm_code, alarm_type, severity, message)
           VALUES ($1, 'ROAD_CONDITION', 'SAFETY', $2, $3)`,
          [
            road.rows[0].site_id,
            closedFlag ? 'CRITICAL' : 'WARNING',
            `Route ${road.rows[0].name} : ${conditionType}${closedFlag ? ' — FERMÉE' : ''}`,
          ]
        );
      }
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('recordRoadCondition error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function clearRoadCondition(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    await query(
      `UPDATE core.road_condition SET valid_until = NOW() WHERE condition_id = $1`,
      [id]
    );
    res.json({ cleared: true });
  } catch (err) {
    console.error('clearRoadCondition error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
