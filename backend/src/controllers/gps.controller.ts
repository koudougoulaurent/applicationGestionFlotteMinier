import { Request, Response } from 'express';
import { query } from '../config/database';

export async function getLatestPositions(req: Request & { user?: { siteId: string } }, res: Response): Promise<void> {
  const siteId = req.query.siteId || req.user?.siteId;
  const { category } = req.query;

  const result = await query(
    `SELECT DISTINCT ON (e.equipment_id)
       e.equipment_id, e.fleet_number, e.status,
       et.category, et.icon,
       e.latitude, e.longitude,
       e.current_hours,
       sc.color AS status_color,
       o.first_name || ' ' || o.last_name AS operator_name,
       l.name AS location_name
     FROM core.equipment e
     JOIN core.equipment_type et ON e.type_id = et.type_id
     LEFT JOIN core.status_code sc ON e.status = sc.status_code
     LEFT JOIN core.operator o ON e.current_operator_id = o.operator_id
     LEFT JOIN core.location l ON e.current_location_id = l.location_id
     WHERE e.site_id = $1 AND e.active = TRUE
       AND e.latitude IS NOT NULL
       AND ($2::VARCHAR IS NULL OR et.category = $2)
     ORDER BY e.equipment_id`,
    [siteId, category || null]
  );

  res.json(result.rows);
}

export async function recordPosition(req: Request, res: Response): Promise<void> {
  const { equipmentId, latitude, longitude, speed, heading, altitude, engineOn, payloadTonnes } = req.body;

  if (!equipmentId || !latitude || !longitude) {
    res.status(400).json({ error: 'equipmentId, latitude, longitude required' });
    return;
  }

  // Insert GPS record
  await query(
    `INSERT INTO operations.equipment_position
       (equipment_id, position_time, latitude, longitude, altitude, speed_kmh, heading, engine_on, payload_tonnes,
        geom)
     VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8,
             ST_SetSRID(ST_MakePoint($3, $2), 4326))`,
    [equipmentId, latitude, longitude, altitude || null, speed || null,
     heading || null, engineOn !== undefined ? engineOn : null, payloadTonnes || null]
  );

  // Update equipment current position
  await query(
    `UPDATE core.equipment SET latitude = $1, longitude = $2 WHERE equipment_id = $3`,
    [latitude, longitude, equipmentId]
  );

  // Check geofences
  const geofenceHits = await query(
    `SELECT g.geofence_id, g.location_id, l.name, l.location_type
     FROM core.geofence g
     JOIN core.location l ON g.location_id = l.location_id
     WHERE g.active = TRUE
       AND ST_Within(
         ST_SetSRID(ST_MakePoint($2, $1), 4326),
         g.polygon
       )`,
    [latitude, longitude]
  );

  res.json({ recorded: true, geofenceHits: geofenceHits.rows });
}

export async function getEquipmentTrail(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { minutes = '60' } = req.query;

  const result = await query(
    `SELECT position_time, latitude, longitude, speed_kmh, heading, payload_tonnes
     FROM operations.equipment_position
     WHERE equipment_id = $1
       AND position_time >= NOW() - ($2 || ' minutes')::INTERVAL
     ORDER BY position_time DESC
     LIMIT 500`,
    [id, minutes]
  );

  res.json(result.rows);
}

export async function getLocations(req: Request & { user?: { siteId: string } }, res: Response): Promise<void> {
  const siteId = req.query.siteId || req.user?.siteId;
  const { type } = req.query;

  const conditions = ['site_id = $1', 'active = TRUE'];
  const params: unknown[] = [siteId];

  if (type) {
    conditions.push(`location_type = $2`);
    params.push(type);
  }

  const result = await query(
    `SELECT * FROM core.location WHERE ${conditions.join(' AND ')} ORDER BY location_type, name`,
    params
  );

  res.json(result.rows);
}
