import { Request, Response } from 'express';
import { query } from '../config/database';

export async function listDispatches(req: Request, res: Response): Promise<void> {
  const { siteId, shiftId, status } = req.query;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (siteId)  { conditions.push(`da.site_id = $${idx++}`);  params.push(siteId); }
  if (shiftId) { conditions.push(`da.shift_id = $${idx++}`); params.push(shiftId); }
  if (status)  { conditions.push(`da.status = $${idx++}`);   params.push(status); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await query(
    `SELECT
       da.*,
       et.fleet_number AS truck_number,
       el.fleet_number AS loader_number,
       ls.name AS source_name, ls.location_type AS source_type,
       ld.name AS dest_name, ld.location_type AS dest_type,
       m.name AS material_name, m.color AS material_color,
       hr.distance_km
     FROM operations.dispatch_assignment da
     JOIN core.equipment et ON da.truck_id = et.equipment_id
     LEFT JOIN core.equipment el ON da.loader_id = el.equipment_id
     LEFT JOIN core.location ls ON da.source_location_id = ls.location_id
     LEFT JOIN core.location ld ON da.dest_location_id = ld.location_id
     LEFT JOIN core.material m ON da.material_id = m.material_id
     LEFT JOIN core.haul_road hr ON da.road_id = hr.road_id
     ${where}
     ORDER BY da.priority DESC, da.assigned_time DESC`,
    params
  );

  res.json(result.rows);
}

export async function createDispatch(req: Request & { user?: { userId: string; siteId: string } }, res: Response): Promise<void> {
  const {
    truckId, loaderId, sourceLocationId, destLocationId,
    materialId, priority, shiftId, roadId
  } = req.body;

  if (!truckId || !sourceLocationId || !destLocationId) {
    res.status(400).json({ error: 'truckId, sourceLocationId, destLocationId are required' });
    return;
  }

  const result = await query(
    `INSERT INTO operations.dispatch_assignment
       (site_id, shift_id, truck_id, loader_id, source_location_id, dest_location_id,
        material_id, priority, status, dispatcher_id, road_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING', $9, $10)
     RETURNING *`,
    [
      req.user?.siteId, shiftId || null, truckId, loaderId || null,
      sourceLocationId, destLocationId, materialId || null,
      priority || 1, req.user?.userId, roadId || null
    ]
  );

  // Update truck status to OPERATING
  await query(
    `UPDATE core.equipment SET status = 'OPERATING' WHERE equipment_id = $1`,
    [truckId]
  );

  const da = result.rows[0];

  // Socket.io — push dispatch:assigned
  const io = req.app.get('io');
  const siteId = req.user?.siteId;
  if (io && siteId && da) {
    const ctx = await query(
      `SELECT e.fleet_number, et.category,
              ls.name AS source_name, ld.name AS dest_name, m.name AS material_name
       FROM core.equipment e
       JOIN core.equipment_type et ON e.type_id = et.type_id
       LEFT JOIN core.location ls ON ls.location_id = $2
       LEFT JOIN core.location ld ON ld.location_id = $3
       LEFT JOIN core.material m ON m.material_id = $4
       WHERE e.equipment_id = $1`, [truckId, sourceLocationId, destLocationId, materialId || null]
    );
    io.to(`site:${siteId}`).emit('dispatch:assigned', {
      assignment_id:   da.assignment_id,
      truck_id:        truckId,
      fleet_number:    ctx.rows[0]?.fleet_number,
      category:        ctx.rows[0]?.category,
      source_name:     ctx.rows[0]?.source_name,
      dest_name:       ctx.rows[0]?.dest_name,
      material_name:   ctx.rows[0]?.material_name,
      priority:        priority || 1,
      timestamp:       new Date().toISOString(),
    });
  }

  res.status(201).json(da);
}

export async function updateDispatch(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { status } = req.body;

  const validStatuses = ['PENDING', 'ACKNOWLEDGED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
  if (!validStatuses.includes(status)) {
    res.status(400).json({ error: 'Invalid status' });
    return;
  }

  const result = await query(
    `UPDATE operations.dispatch_assignment
     SET status = $1,
         acknowledged_time = CASE WHEN $1 = 'ACKNOWLEDGED' THEN NOW() ELSE acknowledged_time END
     WHERE assignment_id = $2
     RETURNING *`,
    [status, id]
  );

  if (!result.rows[0]) {
    res.status(404).json({ error: 'Dispatch not found' });
    return;
  }

  const da = result.rows[0];

  // Socket.io — push dispatch:updated
  const io = req.app.get('io');
  if (io && da.site_id) {
    io.to(`site:${da.site_id}`).emit('dispatch:updated', {
      assignment_id: da.assignment_id,
      truck_id:      da.truck_id,
      status,
      timestamp:     new Date().toISOString(),
    });
  }

  res.json(da);
}

// Smart dispatch optimizer
export async function suggestAssignments(req: Request & { user?: { siteId: string } }, res: Response): Promise<void> {
  const siteId = req.query.siteId || req.user?.siteId;

  // Available trucks
  const trucks = await query(
    `SELECT e.equipment_id, e.fleet_number, e.payload_capacity,
            e.latitude, e.longitude, e.current_hours,
            l.name AS location_name, l.location_type
     FROM core.equipment e
     LEFT JOIN core.location l ON e.current_location_id = l.location_id
     JOIN core.equipment_type et ON e.type_id = et.type_id
     WHERE et.category = 'TRUCK' AND e.status = 'AVAILABLE'
       AND e.site_id = $1 AND e.active = TRUE
     ORDER BY e.current_hours ASC`,
    [siteId]
  );

  // Active loaders with queue info
  const loaders = await query(
    `SELECT
       e.equipment_id, e.fleet_number,
       e.latitude, e.longitude,
       l.name AS location_name, l.location_id,
       COUNT(da.assignment_id) AS queue_length,
       AVG(EXTRACT(EPOCH FROM (NOW() - da.assigned_time))/60) AS avg_wait_min
     FROM core.equipment e
     JOIN core.equipment_type et ON e.type_id = et.type_id
     LEFT JOIN core.location l ON e.current_location_id = l.location_id
     LEFT JOIN operations.dispatch_assignment da
       ON da.loader_id = e.equipment_id AND da.status IN ('PENDING','IN_PROGRESS')
     WHERE et.category IN ('EXCAVATOR','LOADER') AND e.status IN ('OPERATING','IDLE')
       AND e.site_id = $1 AND e.active = TRUE
     GROUP BY e.equipment_id, e.fleet_number, e.latitude, e.longitude, l.name, l.location_id
     ORDER BY queue_length ASC`,
    [siteId]
  );

  // Active dump destinations
  const destinations = await query(
    `SELECT location_id, name, location_type, latitude, longitude
     FROM core.location
     WHERE site_id = $1 AND location_type IN ('CRUSHER','DUMP','STOCKPILE') AND active = TRUE`,
    [siteId]
  );

  // Build suggestions: match available trucks to least-busy loaders
  const suggestions = trucks.rows.map((truck, i) => {
    const loader = loaders.rows[i % loaders.rows.length];
    const dest = destinations.rows[0];
    return {
      truckId:         truck.equipment_id,
      truckNumber:     truck.fleet_number,
      loaderId:        loader?.equipment_id,
      loaderNumber:    loader?.fleet_number,
      sourceLocationId: loader?.location_id,
      sourceName:      loader?.location_name,
      destLocationId:  dest?.location_id,
      destName:        dest?.name,
      estimatedQueueMin: loader?.avg_wait_min || 0,
      priority:        1,
    };
  });

  res.json({ suggestions, availableTrucks: trucks.rows.length, activeLoaders: loaders.rows.length });
}
