import { Request, Response } from 'express';
import { query } from '../config/database';

// ──────────────────────────────────────────────
// POSTES DE TRAVAIL (SHIFTS)
// ──────────────────────────────────────────────

export async function listShifts(req: Request & { user?: { siteId: string } }, res: Response): Promise<void> {
  const siteId = req.query.siteId || req.user?.siteId;
  const { from, to, limit = '14' } = req.query;

  const result = await query(
    `SELECT
       s.*,
       sd.shift_name, sd.start_hour, sd.duration_hours, sd.color,
       o.first_name || ' ' || o.last_name AS supervisor_name,
       COUNT(DISTINCT oa.operator_id) AS operator_count,
       COUNT(DISTINCT hc.cycle_id) AS cycle_count,
       ROUND(COALESCE(SUM(hc.payload_tonnes), 0), 0) AS total_tonnes
     FROM core.shift s
     JOIN core.shift_definition sd ON s.shift_def_id = sd.shift_def_id
     LEFT JOIN core.operator o ON s.supervisor_id = o.operator_id
     LEFT JOIN operations.operator_assignment oa ON oa.shift_id = s.shift_id
     LEFT JOIN operations.haul_cycle hc ON hc.shift_id = s.shift_id AND hc.cycle_end IS NOT NULL
     WHERE s.site_id = $1
       AND ($2::DATE IS NULL OR s.shift_date >= $2)
       AND ($3::DATE IS NULL OR s.shift_date <= $3)
     GROUP BY s.shift_id, sd.shift_name, sd.start_hour, sd.duration_hours, sd.color,
              o.first_name, o.last_name
     ORDER BY s.shift_date DESC, sd.start_hour
     LIMIT $4`,
    [siteId, from || null, to || null, parseInt(limit as string)]
  );

  res.json(result.rows);
}

export async function getCurrentShift(req: Request & { user?: { siteId: string } }, res: Response): Promise<void> {
  const siteId = req.query.siteId || req.user?.siteId;

  const result = await query(
    `SELECT
       s.*,
       sd.shift_name, sd.color,
       o.first_name || ' ' || o.last_name AS supervisor_name,
       COUNT(DISTINCT oa.operator_id) AS operator_count,
       ROUND(COALESCE(SUM(hc.payload_tonnes), 0), 0) AS total_tonnes,
       COUNT(DISTINCT hc.cycle_id) AS cycle_count,
       -- Production vs plan
       pp.target_tonnes,
       ROUND(100.0 * COALESCE(SUM(hc.payload_tonnes), 0) / NULLIF(pp.target_tonnes, 0), 1) AS achievement_pct
     FROM core.shift s
     JOIN core.shift_definition sd ON s.shift_def_id = sd.shift_def_id
     LEFT JOIN core.operator o ON s.supervisor_id = o.operator_id
     LEFT JOIN operations.operator_assignment oa ON oa.shift_id = s.shift_id AND oa.status = 'ACTIVE'
     LEFT JOIN operations.haul_cycle hc ON hc.shift_id = s.shift_id AND hc.cycle_end IS NOT NULL
     LEFT JOIN operations.production_plan pp ON pp.shift_id = s.shift_id
     WHERE s.site_id = $1 AND s.status = 'ACTIVE'
     GROUP BY s.shift_id, sd.shift_name, sd.color, o.first_name, o.last_name, pp.target_tonnes
     LIMIT 1`,
    [siteId]
  );

  if (!result.rows[0]) {
    res.json(null);
    return;
  }

  // Equipment status in current shift
  const equipStatus = await query(
    `SELECT
       et.category,
       e.status,
       sc.color,
       COUNT(*) AS count
     FROM core.equipment e
     JOIN core.equipment_type et ON e.type_id = et.type_id
     LEFT JOIN core.status_code sc ON e.status = sc.status_code
     WHERE e.site_id = $1 AND e.active = TRUE
     GROUP BY et.category, e.status, sc.color
     ORDER BY et.category, count DESC`,
    [siteId]
  );

  // Hourly production in current shift
  const hourlyProd = await query(
    `SELECT
       DATE_TRUNC('hour', hc.cycle_start) AS hour,
       COUNT(*) AS cycles,
       ROUND(SUM(hc.payload_tonnes), 0) AS tonnes
     FROM operations.haul_cycle hc
     WHERE hc.shift_id = $1 AND hc.cycle_end IS NOT NULL
     GROUP BY DATE_TRUNC('hour', hc.cycle_start)
     ORDER BY hour`,
    [result.rows[0].shift_id]
  );

  res.json({
    shift:       result.rows[0],
    equipStatus: equipStatus.rows,
    hourlyProd:  hourlyProd.rows,
  });
}

export async function createShift(req: Request & { user?: { siteId: string } }, res: Response): Promise<void> {
  const { shiftDefId, shiftDate, startTime, supervisorId } = req.body;

  if (!shiftDefId || !shiftDate) {
    res.status(400).json({ error: 'shiftDefId and shiftDate required' });
    return;
  }

  // Close any currently active shift
  await query(
    `UPDATE core.shift SET status = 'CLOSED', end_time = NOW()
     WHERE site_id = $1 AND status = 'ACTIVE'`,
    [req.user?.siteId]
  );

  const result = await query(
    `INSERT INTO core.shift (site_id, shift_def_id, shift_date, start_time, supervisor_id, status)
     VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
     RETURNING *`,
    [req.user?.siteId, shiftDefId, shiftDate, startTime || new Date(), supervisorId || null]
  );

  res.status(201).json(result.rows[0]);
}

export async function closeShift(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  const result = await query(
    `UPDATE core.shift
     SET status = 'CLOSED', end_time = NOW()
     WHERE shift_id = $1
     RETURNING *`,
    [id]
  );

  if (!result.rows[0]) {
    res.status(404).json({ error: 'Shift not found' });
    return;
  }

  // End all active operator assignments
  await query(
    `UPDATE operations.operator_assignment
     SET status = 'CLOSED', end_time = NOW()
     WHERE shift_id = $1 AND status = 'ACTIVE'`,
    [id]
  );

  res.json(result.rows[0]);
}

export async function getShiftReport(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  // Basic shift data
  const shift = await query(
    `SELECT s.*, sd.shift_name, sd.color
     FROM core.shift s
     JOIN core.shift_definition sd ON s.shift_def_id = sd.shift_def_id
     WHERE s.shift_id = $1`,
    [id]
  );

  if (!shift.rows[0]) {
    res.status(404).json({ error: 'Shift not found' });
    return;
  }

  // Production by material
  const production = await query(
    `SELECT
       m.name AS material, m.color AS material_color,
       ls.name AS source, ld.name AS dest,
       COUNT(*) AS cycles,
       ROUND(SUM(hc.payload_tonnes), 0) AS total_tonnes,
       ROUND(AVG(hc.payload_tonnes), 1) AS avg_payload,
       ROUND(AVG(hc.total_duration_s)/60, 1) AS avg_cycle_min
     FROM operations.haul_cycle hc
     LEFT JOIN core.material m ON hc.material_id = m.material_id
     LEFT JOIN core.location ls ON hc.source_location_id = ls.location_id
     LEFT JOIN core.location ld ON hc.dest_location_id = ld.location_id
     WHERE hc.shift_id = $1 AND hc.cycle_end IS NOT NULL
     GROUP BY m.name, m.color, ls.name, ld.name`,
    [id]
  );

  // Availability per truck
  const availability = await query(
    `SELECT * FROM reporting.v_availability_by_shift WHERE shift_id = $1`,
    [id]
  );

  // Alarms during shift
  const alarms = await query(
    `SELECT a.alarm_code, a.severity, a.event_time, a.message, e.fleet_number
     FROM operations.alarm a
     JOIN core.equipment e ON a.equipment_id = e.equipment_id
     WHERE a.event_time >= (SELECT start_time FROM core.shift WHERE shift_id = $1)
       AND (a.event_time <= (SELECT COALESCE(end_time, NOW()) FROM core.shift WHERE shift_id = $1))
     ORDER BY a.event_time`,
    [id]
  );

  // Fuel
  const fuel = await query(
    `SELECT
       ROUND(SUM(ft.quantity_liters), 0) AS total_liters,
       ROUND(SUM(ft.total_cost), 2) AS total_cost,
       COUNT(*) AS transactions
     FROM fuel.fuel_transaction ft
     WHERE ft.shift_id = $1`,
    [id]
  );

  res.json({
    shift:        shift.rows[0],
    production:   production.rows,
    availability: availability.rows,
    alarms:       alarms.rows,
    fuel:         fuel.rows[0],
  });
}

export async function assignOperatorToShift(req: Request, res: Response): Promise<void> {
  const { operatorId, equipmentId, shiftId } = req.body;

  if (!operatorId || !equipmentId || !shiftId) {
    res.status(400).json({ error: 'operatorId, equipmentId, shiftId required' });
    return;
  }

  // End any current assignment for this operator
  await query(
    `UPDATE operations.operator_assignment
     SET status = 'CLOSED', end_time = NOW()
     WHERE operator_id = $1 AND status = 'ACTIVE'`,
    [operatorId]
  );

  const result = await query(
    `INSERT INTO operations.operator_assignment
       (operator_id, equipment_id, shift_id, start_time, status)
     VALUES ($1, $2, $3, NOW(), 'ACTIVE')
     RETURNING *`,
    [operatorId, equipmentId, shiftId]
  );

  // Update equipment current operator
  await query(
    `UPDATE core.equipment SET current_operator_id = $1 WHERE equipment_id = $2`,
    [operatorId, equipmentId]
  );

  res.status(201).json(result.rows[0]);
}
