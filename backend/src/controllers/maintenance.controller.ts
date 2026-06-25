import { Request, Response } from 'express';
import { query } from '../config/database';

export async function listWorkOrders(req: Request, res: Response): Promise<void> {
  const { equipmentId, status, priority, type } = req.query;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (equipmentId) { conditions.push(`wo.equipment_id = $${idx++}`); params.push(equipmentId); }
  if (status)      { conditions.push(`wo.status = $${idx++}`);       params.push(status); }
  if (priority)    { conditions.push(`wo.priority = $${idx++}`);     params.push(priority); }
  if (type)        { conditions.push(`wo.wo_type = $${idx++}`);      params.push(type); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await query(
    `SELECT
       wo.*,
       e.fleet_number,
       et.category,
       COUNT(t.task_id) AS task_count,
       COUNT(t.task_id) FILTER (WHERE t.status = 'COMPLETED') AS tasks_done
     FROM maintenance.work_order wo
     JOIN core.equipment e ON wo.equipment_id = e.equipment_id
     JOIN core.equipment_type et ON e.type_id = et.type_id
     LEFT JOIN maintenance.work_order_task t ON t.work_order_id = wo.work_order_id
     ${where}
     GROUP BY wo.work_order_id, e.fleet_number, et.category
     ORDER BY
       CASE wo.priority WHEN 'EMERGENCY' THEN 1 WHEN 'URGENT' THEN 2
         WHEN 'HIGH' THEN 3 WHEN 'NORMAL' THEN 4 ELSE 5 END,
       wo.opened_at DESC`,
    params
  );

  res.json(result.rows);
}

export async function createWorkOrder(req: Request & { user?: { userId: string } }, res: Response): Promise<void> {
  const {
    equipmentId, woType, priority, title, description,
    estimatedHours, scheduledStart
  } = req.body;

  if (!equipmentId || !woType || !title) {
    res.status(400).json({ error: 'equipmentId, woType, title required' });
    return;
  }

  // Generate WO number
  const woCount = await query('SELECT COUNT(*) FROM maintenance.work_order');
  const woNo = `WO-${new Date().getFullYear()}-${String(parseInt(woCount.rows[0].count) + 1).padStart(4, '0')}`;

  const result = await query(
    `INSERT INTO maintenance.work_order
       (equipment_id, work_order_no, wo_type, priority, title, description,
        estimated_hours, scheduled_start, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'OPEN', $9)
     RETURNING *`,
    [
      equipmentId, woNo, woType, priority || 'NORMAL', title, description || null,
      estimatedHours || null, scheduledStart || null, req.user?.userId
    ]
  );

  // If breakdown/emergency - update equipment status
  if (woType === 'BREAKDOWN' || priority === 'EMERGENCY') {
    await query(
      `UPDATE core.equipment SET status = 'DOWN' WHERE equipment_id = $1`, [equipmentId]
    );
  }

  res.status(201).json(result.rows[0]);
}

export async function closeWorkOrder(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { actualHours, laborCost, partsCost, notes } = req.body;

  const totalCost = (laborCost || 0) + (partsCost || 0);

  const result = await query(
    `UPDATE maintenance.work_order SET
       status = 'COMPLETED',
       closed_at = NOW(),
       actual_hours = $1,
       labor_cost = $2,
       parts_cost = $3,
       total_cost = $4
     WHERE work_order_id = $5
     RETURNING *`,
    [actualHours || null, laborCost || null, partsCost || null, totalCost, id]
  );

  if (!result.rows[0]) {
    res.status(404).json({ error: 'Work order not found' });
    return;
  }

  // Restore equipment availability
  await query(
    `UPDATE core.equipment SET status = 'AVAILABLE'
     WHERE equipment_id = $1 AND status IN ('DOWN', 'MAINTENANCE')`,
    [result.rows[0].equipment_id]
  );

  res.json(result.rows[0]);
}

export async function listBreakdowns(req: Request, res: Response): Promise<void> {
  const result = await query(
    `SELECT
       b.*,
       e.fleet_number,
       et.category,
       wo.work_order_no, wo.status AS wo_status
     FROM maintenance.breakdown b
     JOIN core.equipment e ON b.equipment_id = e.equipment_id
     JOIN core.equipment_type et ON e.type_id = et.type_id
     LEFT JOIN maintenance.work_order wo ON b.work_order_id = wo.work_order_id
     ORDER BY b.detected_time DESC
     LIMIT 100`
  );
  res.json(result.rows);
}

export async function getMaintenanceDue(req: Request, res: Response): Promise<void> {
  const result = await query(
    `SELECT * FROM reporting.v_maintenance_due ORDER BY hours_remaining ASC`
  );
  res.json(result.rows);
}

export async function getEquipmentHealth(req: Request, res: Response): Promise<void> {
  const result = await query(
    `SELECT
       e.equipment_id, e.fleet_number, e.model, e.current_hours, e.health_score,
       et.category,
       COUNT(wo.work_order_id) FILTER (WHERE wo.status NOT IN ('COMPLETED','CANCELLED')) AS open_wos,
       COUNT(b.breakdown_id) FILTER (WHERE b.repaired_time IS NULL) AS active_breakdowns,
       AVG(eh.overall_score) AS avg_health
     FROM core.equipment e
     JOIN core.equipment_type et ON e.type_id = et.type_id
     LEFT JOIN maintenance.work_order wo ON wo.equipment_id = e.equipment_id
     LEFT JOIN maintenance.breakdown b ON b.equipment_id = e.equipment_id
     LEFT JOIN maintenance.equipment_health eh ON eh.equipment_id = e.equipment_id
     WHERE e.active = TRUE
     GROUP BY e.equipment_id, e.fleet_number, e.model, e.current_hours, e.health_score, et.category
     ORDER BY e.health_score ASC`,
  );
  res.json(result.rows);
}
