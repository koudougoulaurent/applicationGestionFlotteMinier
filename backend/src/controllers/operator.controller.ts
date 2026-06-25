import { Request, Response } from 'express';
import { query } from '../config/database';
import { AuthRequest } from '../middleware/auth';

export async function listOperators(req: Request, res: Response): Promise<void> {
  const { siteId, active } = req.query;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (siteId) { conditions.push(`o.site_id = $${idx++}`); params.push(siteId); }
  if (active !== undefined) { conditions.push(`o.active = $${idx++}`); params.push(active === 'true'); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await query(
    `SELECT
       o.*,
       e.fleet_number AS assigned_equipment,
       et.category AS equipment_category
     FROM core.operator o
     LEFT JOIN core.equipment e ON e.current_operator_id = o.operator_id AND e.active = TRUE
     LEFT JOIN core.equipment_type et ON e.type_id = et.type_id
     ${where}
     ORDER BY o.last_name, o.first_name`,
    params
  );

  res.json(result.rows);
}

export async function getOperatorStats(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { shiftId } = req.query;

  const cycles = await query(
    `SELECT
       COUNT(*) AS cycles,
       ROUND(SUM(payload_tonnes), 2) AS total_tonnes,
       ROUND(AVG(payload_tonnes), 2) AS avg_payload,
       ROUND(AVG(total_duration_s)/60.0, 1) AS avg_cycle_min
     FROM operations.haul_cycle
     WHERE operator_id = $1
       AND ($2::UUID IS NULL OR shift_id = $2)
       AND cycle_end IS NOT NULL`,
    [id, shiftId || null]
  );

  res.json({ cycles: cycles.rows[0] });
}

export async function createOperator(req: AuthRequest, res: Response): Promise<void> {
  const {
    siteId, employeeNo, firstName, lastName, phone, email,
    certificationLevel, licenseExpiry, medicalExpiry, certifications, hireDate,
  } = req.body;

  const dup = await query(
    `SELECT operator_id FROM core.operator WHERE employee_no = $1 AND site_id = $2`,
    [employeeNo, siteId]
  );
  if (dup.rows[0]) {
    res.status(409).json({ error: `Matricule ${employeeNo} déjà utilisé` });
    return;
  }

  const result = await query(
    `INSERT INTO core.operator
       (site_id, employee_no, first_name, last_name, phone, email,
        certification_level, license_expiry, medical_expiry, certifications, hire_date, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE)
     RETURNING operator_id`,
    [
      siteId, employeeNo, firstName, lastName, phone || null, email || null,
      certificationLevel || 'OPERATOR',
      licenseExpiry || null, medicalExpiry || null,
      certifications ? JSON.stringify(certifications) : null,
      hireDate || null,
    ]
  );

  res.status(201).json({ operator_id: result.rows[0].operator_id });
}

export async function updateOperator(req: AuthRequest, res: Response): Promise<void> {
  const { id } = req.params;
  const {
    employeeNo, firstName, lastName, phone, email,
    certificationLevel, licenseExpiry, medicalExpiry, certifications, active, hireDate,
  } = req.body;

  const current = await query(
    `SELECT operator_id FROM core.operator WHERE operator_id = $1`, [id]
  );
  if (!current.rows[0]) {
    res.status(404).json({ error: 'Opérateur introuvable' });
    return;
  }

  await query(
    `UPDATE core.operator SET
       employee_no         = COALESCE($1,  employee_no),
       first_name          = COALESCE($2,  first_name),
       last_name           = COALESCE($3,  last_name),
       phone               = COALESCE($4,  phone),
       email               = COALESCE($5,  email),
       certification_level = COALESCE($6,  certification_level),
       license_expiry      = COALESCE($7,  license_expiry),
       medical_expiry      = COALESCE($8,  medical_expiry),
       certifications      = COALESCE($9,  certifications),
       hire_date           = COALESCE($10, hire_date),
       active              = COALESCE($11, active)
     WHERE operator_id = $12`,
    [
      employeeNo || null, firstName || null, lastName || null,
      phone ?? null, email ?? null, certificationLevel || null,
      licenseExpiry ?? null, medicalExpiry ?? null,
      certifications ? JSON.stringify(certifications) : null,
      hireDate ?? null,
      active !== undefined ? active : null,
      id,
    ]
  );

  res.json({ success: true });
}

export async function deactivateOperator(req: AuthRequest, res: Response): Promise<void> {
  const { id } = req.params;

  const current = await query(
    `SELECT operator_id, first_name, last_name FROM core.operator WHERE operator_id = $1`, [id]
  );
  if (!current.rows[0]) {
    res.status(404).json({ error: 'Opérateur introuvable' });
    return;
  }

  // Unassign from equipment
  await query(
    `UPDATE core.equipment SET current_operator_id = NULL WHERE current_operator_id = $1`, [id]
  );

  await query(`UPDATE core.operator SET active = FALSE WHERE operator_id = $1`, [id]);

  const { first_name, last_name } = current.rows[0];
  res.json({ success: true, message: `${first_name} ${last_name} désactivé(e)` });
}
