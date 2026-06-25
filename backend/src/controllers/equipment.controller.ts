import { Request, Response } from 'express';
import { query } from '../config/database';
import { AuthRequest } from '../middleware/auth';

export async function listEquipment(req: Request, res: Response): Promise<void> {
  const { siteId, category, status } = req.query;

  const conditions: string[] = ['e.active = TRUE'];
  const params: unknown[] = [];
  let idx = 1;

  if (siteId)   { conditions.push(`e.site_id = $${idx++}`);    params.push(siteId); }
  if (category) { conditions.push(`et.category = $${idx++}`);  params.push(category); }
  if (status)   { conditions.push(`e.status = $${idx++}`);     params.push(status); }

  const sql = `
    SELECT
      e.equipment_id, e.fleet_number, e.model, e.serial_number,
      e.year_manufactured, e.payload_capacity, e.fuel_capacity,
      e.current_hours, e.current_km, e.status, e.health_score,
      e.latitude, e.longitude,
      et.category, et.name AS type_name, et.manufacturer, et.icon,
      sc.color AS status_color, sc.category AS status_category,
      o.first_name || ' ' || o.last_name AS operator_name,
      o.operator_id, o.employee_no,
      l.name AS location_name, l.location_type
    FROM core.equipment e
    JOIN core.equipment_type et ON e.type_id = et.type_id
    LEFT JOIN core.status_code sc ON e.status = sc.status_code
    LEFT JOIN core.operator o ON e.current_operator_id = o.operator_id
    LEFT JOIN core.location l ON e.current_location_id = l.location_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY et.category, e.fleet_number
  `;

  const result = await query(sql, params);
  res.json(result.rows);
}

export async function getEquipment(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  const result = await query(
    `SELECT
       e.*,
       et.category, et.name AS type_name, et.manufacturer, et.icon,
       sc.color AS status_color,
       o.first_name || ' ' || o.last_name AS operator_name,
       l.name AS location_name
     FROM core.equipment e
     JOIN core.equipment_type et ON e.type_id = et.type_id
     LEFT JOIN core.status_code sc ON e.status = sc.status_code
     LEFT JOIN core.operator o ON e.current_operator_id = o.operator_id
     LEFT JOIN core.location l ON e.current_location_id = l.location_id
     WHERE e.equipment_id = $1`,
    [id]
  );

  if (!result.rows[0]) {
    res.status(404).json({ error: 'Equipment not found' });
    return;
  }
  res.json(result.rows[0]);
}

export async function updateStatus(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { status, reason, locationId, operatorId } = req.body;

  if (!status) {
    res.status(400).json({ error: 'Status required' });
    return;
  }

  // Validate status
  const validStatus = await query(
    'SELECT status_code FROM core.status_code WHERE status_code = $1', [status]
  );
  if (!validStatus.rows[0]) {
    res.status(400).json({ error: 'Invalid status code' });
    return;
  }

  // Get current status
  const current = await query(
    'SELECT status FROM core.equipment WHERE equipment_id = $1', [id]
  );
  if (!current.rows[0]) {
    res.status(404).json({ error: 'Equipment not found' });
    return;
  }

  const prevStatus = current.rows[0].status;

  // Close previous timeline entry
  await query(
    `UPDATE operations.equipment_status_timeline
     SET end_time = NOW(),
         duration_seconds = EXTRACT(EPOCH FROM (NOW() - start_time))::BIGINT
     WHERE equipment_id = $1 AND end_time IS NULL`,
    [id]
  );

  // Open new timeline entry
  await query(
    `INSERT INTO operations.equipment_status_timeline
       (equipment_id, status_code, start_time, location_id, operator_id, source, reason_code)
     VALUES ($1, $2, NOW(), $3, $4, 'MANUAL', $5)`,
    [id, status, locationId || null, operatorId || null, reason || null]
  );

  // Record transition
  await query(
    `INSERT INTO operations.status_transition (equipment_id, from_status, to_status, source)
     VALUES ($1, $2, $3, 'MANUAL')`,
    [id, prevStatus, status]
  );

  // Update equipment
  await query(
    `UPDATE core.equipment
     SET status = $1,
         current_location_id = COALESCE($2, current_location_id),
         current_operator_id = COALESCE($3, current_operator_id)
     WHERE equipment_id = $4`,
    [status, locationId || null, operatorId || null, id]
  );

  // Socket.io — broadcast status change
  const io = req.app.get('io');
  const eqInfo = await query(
    `SELECT e.fleet_number, e.site_id, et.category
     FROM core.equipment e JOIN core.equipment_type et ON e.type_id = et.type_id
     WHERE e.equipment_id = $1`, [id]
  );
  const eq = eqInfo.rows[0];
  if (io && eq) {
    const payload = {
      equipment_id:    id,
      fleet_number:    eq.fleet_number,
      category:        eq.category,
      previous_status: prevStatus,
      new_status:      status,
      reason:          reason || null,
      timestamp:       new Date().toISOString(),
    };
    io.to(`site:${eq.site_id}`).emit('equipment:status', payload);
    if (status === 'DOWN' || status === 'MAINTENANCE') {
      io.to(`site:${eq.site_id}`).emit('equipment:down', payload);
    }
  }

  res.json({ success: true, previousStatus: prevStatus, newStatus: status });
}

export async function getStatusTimeline(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { from, to, limit = '100' } = req.query;

  const conditions = ['equipment_id = $1'];
  const params: unknown[] = [id];
  let idx = 2;

  if (from) { conditions.push(`start_time >= $${idx++}`); params.push(from); }
  if (to)   { conditions.push(`start_time <= $${idx++}`); params.push(to); }

  const result = await query(
    `SELECT
       t.*, sc.color, sc.category AS status_category,
       l.name AS location_name,
       o.first_name || ' ' || o.last_name AS operator_name
     FROM operations.equipment_status_timeline t
     LEFT JOIN core.status_code sc ON t.status_code = sc.status_code
     LEFT JOIN core.location l ON t.location_id = l.location_id
     LEFT JOIN core.operator o ON t.operator_id = o.operator_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY start_time DESC
     LIMIT $${idx}`,
    [...params, parseInt(limit as string)]
  );

  res.json(result.rows);
}

export async function getEquipmentKpi(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { shiftId } = req.query;

  // Status time breakdown
  const statusBreakdown = await query(
    `SELECT
       status_code,
       sc.color,
       sc.category AS status_category,
       SUM(duration_seconds) AS total_seconds,
       COUNT(*) AS occurrences
     FROM operations.equipment_status_timeline t
     JOIN core.status_code sc ON t.status_code = sc.status_code
     WHERE t.equipment_id = $1
       AND ($2::UUID IS NULL OR t.shift_id = $2)
       AND t.duration_seconds IS NOT NULL
     GROUP BY status_code, sc.color, sc.category
     ORDER BY total_seconds DESC`,
    [id, shiftId || null]
  );

  // Cycle stats
  const cycleStats = await query(
    `SELECT
       COUNT(*) AS cycle_count,
       ROUND(AVG(payload_tonnes), 2) AS avg_payload,
       ROUND(SUM(payload_tonnes), 2) AS total_tonnes,
       ROUND(AVG(total_duration_s)/60.0, 2) AS avg_cycle_min,
       ROUND(AVG(payload_factor) * 100, 1) AS avg_payload_factor_pct
     FROM operations.haul_cycle
     WHERE truck_id = $1
       AND ($2::UUID IS NULL OR shift_id = $2)
       AND cycle_end IS NOT NULL`,
    [id, shiftId || null]
  );

  // Fuel
  const fuelStats = await query(
    `SELECT
       COUNT(*) AS fill_count,
       ROUND(SUM(quantity_liters), 2) AS total_liters,
       ROUND(AVG(quantity_liters), 2) AS avg_fill
     FROM fuel.fuel_transaction
     WHERE equipment_id = $1
       AND ($2::UUID IS NULL OR shift_id = $2)`,
    [id, shiftId || null]
  );

  res.json({
    statusBreakdown: statusBreakdown.rows,
    cycleStats: cycleStats.rows[0],
    fuelStats: fuelStats.rows[0],
  });
}

export async function listEquipmentTypes(req: Request, res: Response): Promise<void> {
  const result = await query(
    `SELECT type_id, code, name, category, manufacturer, icon
     FROM core.equipment_type ORDER BY category, name`
  );
  res.json(result.rows);
}

export async function createEquipment(req: AuthRequest, res: Response): Promise<void> {
  const {
    siteId, typeId, fleetNumber, serialNumber, model, yearManufactured,
    payloadCapacity, fuelCapacity, maxSpeedKmh, engineModel, enginePower,
    currentHours, currentKm, status, latitude, longitude, notes,
  } = req.body;

  const existingFleet = await query(
    `SELECT equipment_id FROM core.equipment WHERE fleet_number = $1 AND site_id = $2`,
    [fleetNumber, siteId]
  );
  if (existingFleet.rows[0]) {
    res.status(409).json({ error: `Numéro de flotte ${fleetNumber} déjà utilisé sur ce site` });
    return;
  }

  const result = await query(
    `INSERT INTO core.equipment
       (site_id, type_id, fleet_number, serial_number, model, year_manufactured,
        payload_capacity, fuel_capacity, current_hours, current_km, status,
        latitude, longitude, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,TRUE)
     RETURNING equipment_id`,
    [
      siteId, typeId, fleetNumber, serialNumber || null, model,
      yearManufactured || null, payloadCapacity || null, fuelCapacity || null,
      currentHours || 0, currentKm || 0, status || 'AVAILABLE',
      latitude || null, longitude || null,
    ]
  );

  const newId = result.rows[0].equipment_id;

  // Insert initial status timeline entry
  await query(
    `INSERT INTO operations.equipment_status_timeline
       (equipment_id, status_code, start_time, source)
     VALUES ($1, $2, NOW(), 'SYSTEM')`,
    [newId, status || 'AVAILABLE']
  );

  res.status(201).json({ equipment_id: newId, fleet_number: fleetNumber });
}

export async function updateEquipment(req: AuthRequest, res: Response): Promise<void> {
  const { id } = req.params;
  const {
    typeId, fleetNumber, serialNumber, model, yearManufactured,
    payloadCapacity, fuelCapacity, currentHours, currentKm,
    status, latitude, longitude, operatorId, locationId, active,
  } = req.body;

  const current = await query(
    `SELECT equipment_id, fleet_number, status, site_id FROM core.equipment WHERE equipment_id = $1`,
    [id]
  );
  if (!current.rows[0]) {
    res.status(404).json({ error: 'Équipement introuvable' });
    return;
  }

  // Check fleet number uniqueness if changed
  if (fleetNumber && fleetNumber !== current.rows[0].fleet_number) {
    const dup = await query(
      `SELECT equipment_id FROM core.equipment WHERE fleet_number = $1 AND site_id = $2 AND equipment_id != $3`,
      [fleetNumber, current.rows[0].site_id, id]
    );
    if (dup.rows[0]) {
      res.status(409).json({ error: `Numéro de flotte ${fleetNumber} déjà utilisé` });
      return;
    }
  }

  // If status changed, update timeline
  if (status && status !== current.rows[0].status) {
    await query(
      `UPDATE operations.equipment_status_timeline
       SET end_time = NOW(), duration_seconds = EXTRACT(EPOCH FROM (NOW() - start_time))::BIGINT
       WHERE equipment_id = $1 AND end_time IS NULL`,
      [id]
    );
    await query(
      `INSERT INTO operations.equipment_status_timeline
         (equipment_id, status_code, start_time, source)
       VALUES ($1, $2, NOW(), 'MANUAL')`,
      [id, status]
    );
    await query(
      `INSERT INTO operations.status_transition (equipment_id, from_status, to_status, source)
       VALUES ($1, $2, $3, 'MANUAL')`,
      [id, current.rows[0].status, status]
    );
  }

  await query(
    `UPDATE core.equipment SET
       type_id              = COALESCE($1,  type_id),
       fleet_number         = COALESCE($2,  fleet_number),
       serial_number        = COALESCE($3,  serial_number),
       model                = COALESCE($4,  model),
       year_manufactured    = COALESCE($5,  year_manufactured),
       payload_capacity     = COALESCE($6,  payload_capacity),
       fuel_capacity        = COALESCE($7,  fuel_capacity),
       current_hours        = COALESCE($8,  current_hours),
       current_km           = COALESCE($9,  current_km),
       status               = COALESCE($10, status),
       latitude             = COALESCE($11, latitude),
       longitude            = COALESCE($12, longitude),
       current_operator_id  = COALESCE($13, current_operator_id),
       current_location_id  = COALESCE($14, current_location_id),
       active               = COALESCE($15, active)
     WHERE equipment_id = $16`,
    [
      typeId || null, fleetNumber || null, serialNumber ?? null, model || null,
      yearManufactured ?? null, payloadCapacity ?? null, fuelCapacity ?? null,
      currentHours ?? null, currentKm ?? null, status || null,
      latitude ?? null, longitude ?? null,
      operatorId ?? null, locationId ?? null,
      active !== undefined ? active : null,
      id,
    ]
  );

  res.json({ success: true });
}

export async function deactivateEquipment(req: AuthRequest, res: Response): Promise<void> {
  const { id } = req.params;

  const current = await query(
    `SELECT equipment_id, fleet_number FROM core.equipment WHERE equipment_id = $1`, [id]
  );
  if (!current.rows[0]) {
    res.status(404).json({ error: 'Équipement introuvable' });
    return;
  }

  await query(
    `UPDATE core.equipment SET active = FALSE, status = 'DOWN', current_operator_id = NULL WHERE equipment_id = $1`,
    [id]
  );

  res.json({ success: true, message: `Équipement ${current.rows[0].fleet_number} désactivé` });
}
