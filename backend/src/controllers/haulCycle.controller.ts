import { Request, Response } from 'express';
import { query } from '../config/database';

export async function listCycles(req: Request, res: Response): Promise<void> {
  const { truckId, shiftId, date, limit = '50' } = req.query;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (truckId)  { conditions.push(`hc.truck_id = $${idx++}`);  params.push(truckId); }
  if (shiftId)  { conditions.push(`hc.shift_id = $${idx++}`);  params.push(shiftId); }
  if (date)     { conditions.push(`DATE(hc.cycle_start) = $${idx++}`); params.push(date); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await query(
    `SELECT
       hc.*,
       et.fleet_number AS truck_number,
       el.fleet_number AS loader_number,
       ls.name AS source_name,
       ld.name AS dest_name,
       m.name AS material_name, m.color AS material_color,
       o.first_name || ' ' || o.last_name AS operator_name
     FROM operations.haul_cycle hc
     JOIN core.equipment et ON hc.truck_id = et.equipment_id
     LEFT JOIN core.equipment el ON hc.loader_id = el.equipment_id
     LEFT JOIN core.location ls ON hc.source_location_id = ls.location_id
     LEFT JOIN core.location ld ON hc.dest_location_id = ld.location_id
     LEFT JOIN core.material m ON hc.material_id = m.material_id
     LEFT JOIN core.operator o ON hc.operator_id = o.operator_id
     ${where}
     ORDER BY hc.cycle_start DESC
     LIMIT $${idx}`,
    [...params, parseInt(limit as string)]
  );

  res.json(result.rows);
}

export async function createCycle(req: Request & { user?: { siteId: string } }, res: Response): Promise<void> {
  const {
    truckId, loaderId, operatorId, materialId,
    sourceLocationId, destLocationId, shiftId,
    payload_tonnes, dispatchId
  } = req.body;

  if (!truckId || !sourceLocationId) {
    res.status(400).json({ error: 'truckId and sourceLocationId required' });
    return;
  }

  // Get truck payload capacity for factor calculation
  const truck = await query(
    'SELECT payload_capacity FROM core.equipment WHERE equipment_id = $1', [truckId]
  );
  const targetPayload = truck.rows[0]?.payload_capacity || 0;
  const payloadFactor = targetPayload > 0 ? (payload_tonnes / targetPayload) : null;
  const overloaded = payloadFactor ? payloadFactor > 1.1 : false;

  const result = await query(
    `INSERT INTO operations.haul_cycle
       (site_id, shift_id, truck_id, loader_id, operator_id, material_id,
        source_location_id, dest_location_id, dispatch_id,
        cycle_start, payload_tonnes, target_payload, payload_factor, overloaded)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10, $11, $12, $13)
     RETURNING *`,
    [
      req.user?.siteId, shiftId || null, truckId, loaderId || null,
      operatorId || null, materialId || null, sourceLocationId,
      destLocationId || null, dispatchId || null,
      payload_tonnes || null, targetPayload || null, payloadFactor, overloaded
    ]
  );

  res.status(201).json(result.rows[0]);
}

export async function completeCycle(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const {
    payload_tonnes, dumpTime,
    loadStart, loadEnd, haulStart, dumpStart, returnStart,
    fuelConsumed, distanceKm, dataQuality
  } = req.body;

  const truck = await query(
    `SELECT hc.truck_id, e.payload_capacity
     FROM operations.haul_cycle hc
     JOIN core.equipment e ON hc.truck_id = e.equipment_id
     WHERE hc.cycle_id = $1`, [id]
  );

  if (!truck.rows[0]) {
    res.status(404).json({ error: 'Cycle not found' });
    return;
  }

  const targetPayload = truck.rows[0].payload_capacity;
  const payloadFactor = targetPayload > 0 ? (payload_tonnes / targetPayload) : null;

  // Calculate phase durations in seconds
  const loadingS  = loadStart && loadEnd ? Math.round((new Date(loadEnd).getTime() - new Date(loadStart).getTime()) / 1000) : null;
  const haulingS  = haulStart && dumpStart ? Math.round((new Date(dumpStart).getTime() - new Date(haulStart).getTime()) / 1000) : null;
  const dumpS     = dumpStart && returnStart ? Math.round((new Date(returnStart).getTime() - new Date(dumpStart).getTime()) / 1000) : null;

  const cycleEnd = dumpTime || new Date().toISOString();

  const result = await query(
    `UPDATE operations.haul_cycle SET
       cycle_end = $1,
       payload_tonnes = COALESCE($2, payload_tonnes),
       payload_factor = COALESCE($3, payload_factor),
       overloaded = COALESCE($4, overloaded),
       loading_duration_s = COALESCE($5, loading_duration_s),
       haul_duration_s = COALESCE($6, haul_duration_s),
       dump_duration_s = COALESCE($7, dump_duration_s),
       total_duration_s = EXTRACT(EPOCH FROM ($1::TIMESTAMP - cycle_start))::INT,
       fuel_consumed_l = COALESCE($8, fuel_consumed_l),
       distance_km = COALESCE($9, distance_km),
       data_quality = COALESCE($10, data_quality)
     WHERE cycle_id = $11
     RETURNING *`,
    [
      cycleEnd, payload_tonnes || null, payloadFactor,
      payloadFactor ? payloadFactor > 1.1 : false,
      loadingS, haulingS, dumpS,
      fuelConsumed || null, distanceKm || null,
      dataQuality || 'GOOD', id
    ]
  );

  const cycle = result.rows[0];

  // Incrémenter current_hours du camion (durée cycle convertie en heures)
  if (cycle.total_duration_s && cycle.total_duration_s > 0) {
    const deltaHours = cycle.total_duration_s / 3600;
    await query(
      `UPDATE core.equipment
       SET current_hours = current_hours + $1
       WHERE equipment_id = $2`,
      [deltaHours, cycle.truck_id]
    );

    // Vérifier si PM déclenchée après mise à jour des heures
    const pmCheck = await query(
      `SELECT ms.schedule_id, ms.maintenance_type, ms.description,
              ms.next_due_hours, e.fleet_number, e.site_id,
              (e.current_hours + $1) AS new_hours
       FROM maintenance.maintenance_schedule ms
       JOIN core.equipment e ON ms.equipment_id = e.equipment_id
       WHERE ms.equipment_id = $2
         AND ms.active = TRUE
         AND e.current_hours + $1 >= ms.next_due_hours
         AND NOT EXISTS (
           SELECT 1 FROM maintenance.work_order wo
           WHERE wo.schedule_id = ms.schedule_id
             AND wo.status NOT IN ('COMPLETED','CANCELLED')
         )`,
      [deltaHours, cycle.truck_id]
    );

    for (const pm of pmCheck.rows) {
      const woCount = await query('SELECT COUNT(*) FROM maintenance.work_order');
      const woNo = `PM-${new Date().getFullYear()}-${String(parseInt(woCount.rows[0].count) + 1).padStart(4, '0')}`;
      await query(
        `INSERT INTO maintenance.work_order
           (equipment_id, work_order_no, wo_type, priority, title, description, status, schedule_id)
         VALUES ($1, $2, 'PREVENTIVE', 'HIGH',
                 $3 || ' — ' || $4,
                 'Déclenchement automatique PM à ' || ROUND($5) || 'h',
                 'OPEN', $6)`,
        [cycle.truck_id, woNo, pm.maintenance_type, pm.fleet_number, pm.new_hours, pm.schedule_id]
      );
      await query(
        `INSERT INTO operations.alarm
           (equipment_id, site_id, alarm_code, alarm_type, severity, message)
         VALUES ($1, $2, 'PM_DUE', 'OPERATIONAL', 'WARNING', $3)`,
        [
          cycle.truck_id, pm.site_id,
          `${pm.fleet_number} — ${pm.maintenance_type} échue à ${Math.round(pm.next_due_hours)}h (actuel: ${Math.round(pm.new_hours)}h)`
        ]
      );
    }
  }

  // Socket.io — push cycle:complete + refresh shift production
  const io = req.app.get('io');
  if (io && cycle) {
    // Get site + context
    const ctx = await query(
      `SELECT hc.site_id, hc.shift_id, hc.truck_id, hc.payload_tonnes,
              e.fleet_number, ls.name AS source_name, ld.name AS dest_name,
              m.name AS material_name, m.color AS material_color
       FROM operations.haul_cycle hc
       JOIN core.equipment e ON hc.truck_id = e.equipment_id
       LEFT JOIN core.location ls ON hc.source_location_id = ls.location_id
       LEFT JOIN core.location ld ON hc.dest_location_id = ld.location_id
       LEFT JOIN core.material m ON hc.material_id = m.material_id
       WHERE hc.cycle_id = $1`, [id]
    );
    const c = ctx.rows[0];
    if (c) {
      io.to(`site:${c.site_id}`).emit('cycle:complete', {
        cycle_id:        cycle.cycle_id,
        truck_id:        c.truck_id,
        fleet_number:    c.fleet_number,
        payload_tonnes:  parseFloat(c.payload_tonnes) || 0,
        duration_s:      cycle.total_duration_s,
        source_name:     c.source_name,
        dest_name:       c.dest_name,
        material_name:   c.material_name,
        material_color:  c.material_color,
        shift_id:        c.shift_id,
        timestamp:       new Date().toISOString(),
      });

      // Immediate shift production recalculation
      if (c.shift_id) {
        const prod = await query(`
          SELECT
            COUNT(*)                            AS cycles_count,
            COALESCE(SUM(payload_tonnes), 0)    AS actual_tonnes,
            COALESCE(AVG(payload_tonnes), 0)    AS avg_payload,
            COALESCE(AVG(total_duration_s/60.0),0) AS avg_cycle_min
          FROM operations.haul_cycle
          WHERE shift_id = $1 AND cycle_end IS NOT NULL`, [c.shift_id]
        );
        const plan = await query(
          `SELECT target_tonnes FROM operations.production_plan WHERE shift_id = $1 LIMIT 1`, [c.shift_id]
        );
        const actual   = parseFloat(prod.rows[0]?.actual_tonnes) || 0;
        const target   = plan.rows[0]?.target_tonnes ? parseFloat(plan.rows[0].target_tonnes) : null;
        io.to(`site:${c.site_id}`).emit('production:shift', {
          shift_id:        c.shift_id,
          cycles_count:    parseInt(prod.rows[0]?.cycles_count) || 0,
          actual_tonnes:   actual,
          avg_payload:     parseFloat(prod.rows[0]?.avg_payload) || 0,
          avg_cycle_min:   parseFloat(prod.rows[0]?.avg_cycle_min) || 0,
          target_tonnes:   target,
          achievement_pct: target && target > 0 ? Math.round((actual / target) * 100) : null,
          updated_at:      new Date().toISOString(),
        });
      }
    }
  }

  res.json(cycle);
}

export async function getCyclePhases(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const result = await query(
    `SELECT p.*, l.name AS location_name
     FROM operations.haul_cycle_phase p
     LEFT JOIN core.location l ON p.location_id = l.location_id
     WHERE p.cycle_id = $1
     ORDER BY p.sequence_no`,
    [id]
  );
  res.json(result.rows);
}

export async function getProductionSummary(req: Request & { user?: { siteId: string } }, res: Response): Promise<void> {
  const { siteId, shiftId, date, groupBy = 'truck' } = req.query;
  const site = siteId || req.user?.siteId;

  const result = await query(
    `SELECT * FROM reporting.v_daily_production
     WHERE site_id = $1
       AND ($2::DATE IS NULL OR production_date = $2)
     ORDER BY production_date DESC, total_tonnes DESC`,
    [site, date || null]
  );

  res.json(result.rows);
}
