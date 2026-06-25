import { Request, Response } from 'express';
import { query } from '../config/database';

export async function getDashboardKpis(req: Request & { user?: { siteId: string } }, res: Response): Promise<void> {
  const siteId = req.query.siteId || req.user?.siteId;
  const shiftId = req.query.shiftId as string | undefined;

  // Fleet Status
  const fleet = await query(
    `SELECT * FROM reporting.v_fleet_kpi_realtime WHERE site_id = $1`, [siteId]
  );

  // Production today
  const production = await query(
    `SELECT
       COALESCE(SUM(hc.payload_tonnes), 0) AS tonnes_today,
       COUNT(hc.cycle_id) AS cycles_today,
       ROUND(AVG(hc.payload_tonnes), 2) AS avg_payload,
       ROUND(AVG(hc.total_duration_s)/60.0, 2) AS avg_cycle_min
     FROM operations.haul_cycle hc
     WHERE hc.site_id = $1
       AND DATE(hc.cycle_start) = CURRENT_DATE
       AND hc.cycle_end IS NOT NULL`,
    [siteId]
  );

  // Shift production vs plan
  const plan = await query(
    `SELECT * FROM reporting.v_shift_vs_plan WHERE shift_id = $1`,
    [shiftId || null]
  );

  // Active alarms count by severity
  const alarms = await query(
    `SELECT severity, COUNT(*) AS count
     FROM operations.alarm
     WHERE site_id = $1 AND cleared_time IS NULL
     GROUP BY severity`,
    [siteId]
  );

  // Hourly production trend (last 12 hours)
  const hourlyTrend = await query(
    `SELECT
       DATE_TRUNC('hour', hc.cycle_start) AS hour,
       ROUND(SUM(hc.payload_tonnes), 0) AS tonnes,
       COUNT(*) AS cycles
     FROM operations.haul_cycle hc
     WHERE hc.site_id = $1
       AND hc.cycle_start >= NOW() - INTERVAL '12 hours'
       AND hc.cycle_end IS NOT NULL
     GROUP BY DATE_TRUNC('hour', hc.cycle_start)
     ORDER BY hour`,
    [siteId]
  );

  // Equipment by status
  const statusDist = await query(
    `SELECT
       e.status,
       sc.color,
       sc.category AS status_category,
       COUNT(*) AS count
     FROM core.equipment e
     LEFT JOIN core.status_code sc ON e.status = sc.status_code
     WHERE e.site_id = $1 AND e.active = TRUE
     GROUP BY e.status, sc.color, sc.category
     ORDER BY count DESC`,
    [siteId]
  );

  // Maintenance metrics
  const maintenance = await query(
    `SELECT
       COUNT(*) FILTER (WHERE wo.status IN ('OPEN','IN_PROGRESS')) AS open_wos,
       COUNT(*) FILTER (WHERE wo.priority IN ('EMERGENCY','URGENT') AND wo.status NOT IN ('COMPLETED','CANCELLED')) AS urgent_wos,
       COUNT(*) FILTER (WHERE wo.wo_type = 'BREAKDOWN' AND wo.status NOT IN ('COMPLETED','CANCELLED')) AS active_breakdowns
     FROM maintenance.work_order wo
     JOIN core.equipment e ON wo.equipment_id = e.equipment_id
     WHERE e.site_id = $1`,
    [siteId]
  );

  // Fuel today
  const fuel = await query(
    `SELECT
       ROUND(SUM(ft.quantity_liters), 0) AS liters_today,
       ROUND(SUM(ft.total_cost), 2) AS cost_today
     FROM fuel.fuel_transaction ft
     JOIN core.equipment e ON ft.equipment_id = e.equipment_id
     WHERE e.site_id = $1 AND DATE(ft.transaction_time) = CURRENT_DATE`,
    [siteId]
  );

  // OEE Calculation: Availability × Performance × Quality
  const totalFleet = fleet.rows[0]?.total_trucks || 0;
  const productiveFleet = fleet.rows[0]?.productive_fleet || 0;
  const downFleet = fleet.rows[0]?.down_fleet || 0;
  const availability = totalFleet > 0 ? Math.round(((totalFleet - downFleet) / totalFleet) * 100) : 0;
  const utilization = fleet.rows[0]?.fleet_utilization_pct || 0;
  const payloadFactor = production.rows[0]?.avg_payload && production.rows[0]?.avg_payload > 0
    ? Math.min(100, Math.round((production.rows[0].avg_payload / 363) * 100)) // using 797F max payload
    : 85;
  const oee = Math.round((availability / 100) * (utilization / 100) * (payloadFactor / 100) * 100);

  res.json({
    fleet:        fleet.rows[0] || {},
    production:   production.rows[0] || {},
    plan:         plan.rows[0] || null,
    alarms:       alarms.rows,
    hourlyTrend:  hourlyTrend.rows,
    statusDist:   statusDist.rows,
    maintenance:  maintenance.rows[0] || {},
    fuel:         fuel.rows[0] || {},
    kpi: {
      oee,
      availability,
      utilization: Math.round(utilization),
      payloadFactor,
    },
  });
}

export async function getAvailabilityReport(req: Request & { user?: { siteId: string } }, res: Response): Promise<void> {
  const siteId = req.query.siteId || req.user?.siteId;
  const { from, to, category } = req.query;

  const conditions = ['e.site_id = $1'];
  const params: unknown[] = [siteId];
  let idx = 2;

  if (from)     { conditions.push(`t.start_time >= $${idx++}`);    params.push(from); }
  if (to)       { conditions.push(`t.start_time <= $${idx++}`);    params.push(to); }
  if (category) { conditions.push(`et.category = $${idx++}`);      params.push(category); }

  const result = await query(
    `SELECT
       e.equipment_id,
       e.fleet_number,
       et.category,
       SUM(t.duration_seconds) FILTER (WHERE sc.counts_as_operating) AS operating_s,
       SUM(t.duration_seconds) FILTER (WHERE sc.category = 'DOWN') AS down_s,
       SUM(t.duration_seconds) FILTER (WHERE sc.category = 'IDLE') AS idle_s,
       SUM(t.duration_seconds) AS total_s,
       ROUND(100.0 * SUM(t.duration_seconds) FILTER (WHERE sc.counts_as_operating)
             / NULLIF(SUM(t.duration_seconds), 0), 2) AS utilization_pct,
       ROUND(100.0 * (SUM(t.duration_seconds) - COALESCE(SUM(t.duration_seconds) FILTER (WHERE sc.category = 'DOWN'), 0))
             / NULLIF(SUM(t.duration_seconds), 0), 2) AS availability_pct
     FROM operations.equipment_status_timeline t
     JOIN core.equipment e ON t.equipment_id = e.equipment_id
     JOIN core.equipment_type et ON e.type_id = et.type_id
     JOIN core.status_code sc ON t.status_code = sc.status_code
     WHERE ${conditions.join(' AND ')}
       AND t.duration_seconds IS NOT NULL
     GROUP BY e.equipment_id, e.fleet_number, et.category
     ORDER BY utilization_pct DESC`,
    params
  );

  res.json(result.rows);
}

export async function getCycleTimeKpi(req: Request & { user?: { siteId: string } }, res: Response): Promise<void> {
  const siteId = req.query.siteId || req.user?.siteId;
  const { shiftId, truckId } = req.query;

  const conditions = ['hc.site_id = $1', 'hc.cycle_end IS NOT NULL'];
  const params: unknown[] = [siteId];
  let idx = 2;

  if (shiftId) { conditions.push(`hc.shift_id = $${idx++}`); params.push(shiftId); }
  if (truckId) { conditions.push(`hc.truck_id = $${idx++}`); params.push(truckId); }

  const result = await query(
    `SELECT
       hc.truck_id,
       e.fleet_number,
       hc.source_location_id,
       ls.name AS source,
       hc.dest_location_id,
       ld.name AS destination,
       COUNT(*) AS cycles,
       ROUND(AVG(hc.total_duration_s)/60, 1) AS avg_total_min,
       ROUND(AVG(hc.queue_duration_s)/60, 1) AS avg_queue_min,
       ROUND(AVG(hc.loading_duration_s)/60, 1) AS avg_load_min,
       ROUND(AVG(hc.haul_duration_s)/60, 1) AS avg_haul_min,
       ROUND(AVG(hc.dump_duration_s)/60, 1) AS avg_dump_min,
       ROUND(AVG(hc.return_duration_s)/60, 1) AS avg_return_min,
       ROUND(AVG(hc.payload_tonnes), 1) AS avg_payload_t,
       ROUND(SUM(hc.payload_tonnes), 0) AS total_tonnes
     FROM operations.haul_cycle hc
     JOIN core.equipment e ON hc.truck_id = e.equipment_id
     LEFT JOIN core.location ls ON hc.source_location_id = ls.location_id
     LEFT JOIN core.location ld ON hc.dest_location_id = ld.location_id
     WHERE ${conditions.join(' AND ')}
     GROUP BY hc.truck_id, e.fleet_number, hc.source_location_id, ls.name, hc.dest_location_id, ld.name
     ORDER BY total_tonnes DESC`,
    params
  );

  res.json(result.rows);
}

export async function getAlarms(req: Request & { user?: { siteId: string } }, res: Response): Promise<void> {
  const siteId = req.query.siteId || req.user?.siteId;
  const { acknowledged, severity } = req.query;

  const conditions = ['a.site_id = $1', 'a.cleared_time IS NULL'];
  const params: unknown[] = [siteId];
  let idx = 2;

  if (acknowledged !== undefined) {
    conditions.push(`a.acknowledged = $${idx++}`);
    params.push(acknowledged === 'true');
  }
  if (severity) { conditions.push(`a.severity = $${idx++}`); params.push(severity); }

  const result = await query(
    `SELECT * FROM reporting.v_active_alarms
     WHERE site_id = $1 ${acknowledged !== undefined ? `AND acknowledged = $2` : ''}`,
    params
  );

  res.json(result.rows);
}

export async function acknowledgeAlarm(req: Request & { user?: { userId: string } }, res: Response): Promise<void> {
  const { id } = req.params;

  const result = await query(
    `UPDATE operations.alarm
     SET acknowledged = TRUE, ack_by = $1, ack_time = NOW()
     WHERE alarm_id = $2 RETURNING *`,
    [req.user?.userId, id]
  );

  if (!result.rows[0]) {
    res.status(404).json({ error: 'Alarm not found' });
    return;
  }

  res.json(result.rows[0]);
}
