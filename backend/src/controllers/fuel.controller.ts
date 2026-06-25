import { Request, Response } from 'express';
import { query } from '../config/database';

export async function listTransactions(req: Request, res: Response): Promise<void> {
  const { equipmentId, date, limit = '50' } = req.query;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (equipmentId) { conditions.push(`ft.equipment_id = $${idx++}`); params.push(equipmentId); }
  if (date)        { conditions.push(`DATE(ft.transaction_time) = $${idx++}`); params.push(date); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await query(
    `SELECT
       ft.*,
       e.fleet_number, et.category,
       o.first_name || ' ' || o.last_name AS operator_name,
       l.name AS station_name
     FROM fuel.fuel_transaction ft
     JOIN core.equipment e ON ft.equipment_id = e.equipment_id
     JOIN core.equipment_type et ON e.type_id = et.type_id
     LEFT JOIN core.operator o ON ft.operator_id = o.operator_id
     LEFT JOIN core.location l ON ft.station_id = l.location_id
     ${where}
     ORDER BY ft.transaction_time DESC
     LIMIT $${idx}`,
    [...params, parseInt(limit as string)]
  );

  res.json(result.rows);
}

export async function createTransaction(req: Request & { user?: { userId: string; siteId: string } }, res: Response): Promise<void> {
  const { equipmentId, stationId, operatorId, quantityLiters, unitCost, odometerKm, engineHours, shiftId } = req.body;

  if (!equipmentId || !quantityLiters) {
    res.status(400).json({ error: 'equipmentId, quantityLiters required' });
    return;
  }

  const totalCost = unitCost ? (quantityLiters * unitCost) : null;

  const result = await query(
    `INSERT INTO fuel.fuel_transaction
       (equipment_id, station_id, operator_id, shift_id,
        quantity_liters, unit_cost, total_cost, odometer_km, engine_hours)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [equipmentId, stationId || null, operatorId || null, shiftId || null,
     quantityLiters, unitCost || null, totalCost, odometerKm || null, engineHours || null]
  );

  const tx = result.rows[0];

  // Socket.io — push fuel:event to site room
  const io = req.app.get('io');
  const siteId = req.user?.siteId;
  if (io && siteId && tx) {
    const eq = await query(
      `SELECT e.fleet_number, et.category
       FROM core.equipment e JOIN core.equipment_type et ON e.type_id = et.type_id
       WHERE e.equipment_id = $1`, [tx.equipment_id]
    );
    io.to(`site:${siteId}`).emit('fuel:event', {
      transaction_id:  tx.transaction_id,
      equipment_id:    tx.equipment_id,
      fleet_number:    eq.rows[0]?.fleet_number,
      category:        eq.rows[0]?.category,
      quantity_liters: parseFloat(tx.quantity_liters) || 0,
      unit_cost:       tx.unit_cost ? parseFloat(tx.unit_cost) : null,
      total_cost:      tx.total_cost ? parseFloat(tx.total_cost) : null,
      timestamp:       tx.transaction_time,
    });
  }

  res.status(201).json(tx);
}

export async function getFuelSummary(req: Request & { user?: { siteId: string } }, res: Response): Promise<void> {
  const { siteId, from, to } = req.query;
  const site = siteId || req.user?.siteId;

  const result = await query(
    `SELECT
       et.category,
       COUNT(DISTINCT ft.equipment_id) AS equipment_count,
       SUM(ft.quantity_liters) AS total_liters,
       SUM(ft.total_cost) AS total_cost,
       ROUND(AVG(ft.quantity_liters), 2) AS avg_fill,
       COUNT(*) AS transactions
     FROM fuel.fuel_transaction ft
     JOIN core.equipment e ON ft.equipment_id = e.equipment_id
     JOIN core.equipment_type et ON e.type_id = et.type_id
     WHERE e.site_id = $1
       AND ($2::TIMESTAMP IS NULL OR ft.transaction_time >= $2)
       AND ($3::TIMESTAMP IS NULL OR ft.transaction_time <= $3)
     GROUP BY et.category
     ORDER BY total_liters DESC`,
    [site, from || null, to || null]
  );

  // Daily trend
  const trend = await query(
    `SELECT
       DATE(ft.transaction_time) AS fuel_date,
       SUM(ft.quantity_liters) AS total_liters,
       COUNT(*) AS transactions
     FROM fuel.fuel_transaction ft
     JOIN core.equipment e ON ft.equipment_id = e.equipment_id
     WHERE e.site_id = $1
       AND ft.transaction_time >= NOW() - INTERVAL '30 days'
     GROUP BY DATE(ft.transaction_time)
     ORDER BY fuel_date`,
    [site]
  );

  res.json({ byCategory: result.rows, dailyTrend: trend.rows });
}

export async function getStationLevels(req: Request & { user?: { siteId: string } }, res: Response): Promise<void> {
  const siteId = req.query.siteId || req.user?.siteId;

  const result = await query(
    `SELECT
       fs.*,
       l.name AS location_name,
       ROUND(100.0 * fs.current_level_l / NULLIF(fs.tank_capacity_l, 0), 1) AS fill_pct
     FROM fuel.fuel_station fs
     LEFT JOIN core.location l ON fs.location_id = l.location_id
     WHERE fs.site_id = $1 AND fs.active = TRUE`,
    [siteId]
  );

  res.json(result.rows);
}
