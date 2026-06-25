import { Request, Response } from 'express';
import { query } from '../config/database';

// ──────────────────────────────────────────────
// PNEUS
// ──────────────────────────────────────────────

export async function listTyres(req: Request, res: Response): Promise<void> {
  const { status, manufacturer } = req.query;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (status)       { conditions.push(`t.status = $${idx++}`);       params.push(status); }
  if (manufacturer) { conditions.push(`t.manufacturer = $${idx++}`); params.push(manufacturer); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await query(
    `SELECT
       t.*,
       ti.equipment_id,
       e.fleet_number,
       ti.position_code,
       ti.install_date,
       ROUND(e.current_hours - ti.install_hours, 0) AS hours_since_install
     FROM core.tyre t
     LEFT JOIN core.tyre_installation ti
       ON ti.tyre_id = t.tyre_id AND ti.removal_date IS NULL
     LEFT JOIN core.equipment e ON ti.equipment_id = e.equipment_id
     ${where}
     ORDER BY t.status, t.manufacturer, t.model`,
    params
  );

  res.json(result.rows);
}

export async function getTyresByEquipment(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  const result = await query(
    `SELECT
       ti.*,
       t.serial_number, t.manufacturer, t.model, t.size,
       t.total_hours, t.purchase_date, t.status AS tyre_status,
       ROUND(e.current_hours - ti.install_hours, 0) AS hours_on_wheel_current
     FROM core.tyre_installation ti
     JOIN core.tyre t ON ti.tyre_id = t.tyre_id
     JOIN core.equipment e ON ti.equipment_id = e.equipment_id
     WHERE ti.equipment_id = $1 AND ti.removal_date IS NULL
     ORDER BY ti.position_code`,
    [id]
  );

  res.json(result.rows);
}

export async function getTyreHistory(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  const result = await query(
    `SELECT
       ti.*,
       e.fleet_number,
       t.serial_number, t.manufacturer, t.model, t.size
     FROM core.tyre_installation ti
     JOIN core.tyre t ON ti.tyre_id = t.tyre_id
     JOIN core.equipment e ON ti.equipment_id = e.equipment_id
     WHERE ti.tyre_id = $1
     ORDER BY ti.install_date DESC`,
    [id]
  );

  res.json(result.rows);
}

export async function createTyre(req: Request, res: Response): Promise<void> {
  const { serialNumber, manufacturer, model, size, plyRating, purchaseDate, purchaseCost } = req.body;

  if (!serialNumber || !manufacturer) {
    res.status(400).json({ error: 'serialNumber and manufacturer required' });
    return;
  }

  const result = await query(
    `INSERT INTO core.tyre
       (serial_number, manufacturer, model, size, ply_rating, purchase_date, purchase_cost, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'NEW')
     RETURNING *`,
    [serialNumber, manufacturer, model || null, size || null, plyRating || null, purchaseDate || null, purchaseCost || null]
  );

  res.status(201).json(result.rows[0]);
}

export async function installTyre(req: Request, res: Response): Promise<void> {
  const { tyreId, equipmentId, positionCode, installDate } = req.body;

  if (!tyreId || !equipmentId || !positionCode) {
    res.status(400).json({ error: 'tyreId, equipmentId, positionCode required' });
    return;
  }

  // Remove any existing tyre at this position
  await query(
    `UPDATE core.tyre_installation
     SET removal_date = $1, removal_reason = 'REPLACED'
     WHERE equipment_id = $2 AND position_code = $3 AND removal_date IS NULL`,
    [installDate || new Date(), equipmentId, positionCode]
  );

  // Get current equipment hours
  const eq = await query('SELECT current_hours FROM core.equipment WHERE equipment_id = $1', [equipmentId]);
  const installHours = eq.rows[0]?.current_hours || 0;

  const result = await query(
    `INSERT INTO core.tyre_installation
       (tyre_id, equipment_id, position_code, install_date, install_hours)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [tyreId, equipmentId, positionCode, installDate || new Date(), installHours]
  );

  // Update tyre status
  await query(`UPDATE core.tyre SET status = 'INSTALLED' WHERE tyre_id = $1`, [tyreId]);

  res.status(201).json(result.rows[0]);
}

export async function removeTyre(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { removalDate, removalReason, scrapped } = req.body;

  const result = await query(
    `UPDATE core.tyre_installation
     SET removal_date = $1, removal_reason = $2
     WHERE installation_id = $3
     RETURNING *`,
    [removalDate || new Date(), removalReason || 'REMOVED', id]
  );

  if (!result.rows[0]) {
    res.status(404).json({ error: 'Installation not found' });
    return;
  }

  // Update tyre status
  const newStatus = scrapped ? 'SCRAPPED' : 'NEW';
  await query(
    `UPDATE core.tyre SET status = $1 WHERE tyre_id = $2`,
    [newStatus, result.rows[0].tyre_id]
  );

  res.json(result.rows[0]);
}

export async function getTyreSummary(req: Request & { user?: { siteId: string } }, res: Response): Promise<void> {
  const siteId = req.query.siteId || req.user?.siteId;

  const result = await query(
    `SELECT
       COUNT(*) AS total_tyres,
       COUNT(*) FILTER (WHERE t.status = 'NEW')       AS in_stock,
       COUNT(*) FILTER (WHERE t.status = 'INSTALLED') AS installed,
       COUNT(*) FILTER (WHERE t.status = 'SCRAPPED')  AS scrapped,
       COUNT(ti.installation_id) FILTER (WHERE ti.hours_on_wheel > 10000) AS near_end_of_life
     FROM core.tyre t
     LEFT JOIN core.tyre_installation ti
       ON ti.tyre_id = t.tyre_id AND ti.removal_date IS NULL`,
    []
  );

  // Tyres with high hours (near end of life)
  const nearEOL = await query(
    `SELECT
       t.serial_number, t.manufacturer, t.model, t.size,
       e.fleet_number,
       ti.position_code,
       ROUND(e.current_hours - ti.install_hours, 0) AS hours_on_wheel
     FROM core.tyre_installation ti
     JOIN core.tyre t ON ti.tyre_id = t.tyre_id
     JOIN core.equipment e ON ti.equipment_id = e.equipment_id
     WHERE ti.removal_date IS NULL
       AND (e.current_hours - ti.install_hours) > 8000
     ORDER BY hours_on_wheel DESC
     LIMIT 10`
  );

  res.json({
    summary: result.rows[0],
    nearEndOfLife: nearEOL.rows,
  });
}
