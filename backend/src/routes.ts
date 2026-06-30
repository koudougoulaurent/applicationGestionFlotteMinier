import { Router, Request, Response } from 'express';
import { q } from './db';

const r = Router();

// ── Zones ──────────────────────────────────────────────────────────────
r.get('/zones', async (_req, res: Response) => {
  const zones = await q(`
    SELECT z.id, z.code, z.nom, z.materiau, z.couleur,
           COUNT(DISTINCT e.id)::int AS nb_engins,
           COALESCE(
             json_agg(DISTINCT jsonb_build_object('id', d.id, 'code', d.code, 'nom', d.nom))
             FILTER (WHERE d.id IS NOT NULL), '[]'
           ) AS dumps
    FROM v.zones z
    LEFT JOIN v.engins  e  ON e.zone_id = z.id
    LEFT JOIN v.zone_dumps zd ON zd.zone_id = z.id
    LEFT JOIN v.dumps   d  ON d.id = zd.dump_id
    GROUP BY z.id ORDER BY z.code
  `);
  res.json(zones.rows);
});

r.post('/zones', async (req: Request, res: Response) => {
  const { code, nom, materiau, couleur } = req.body as Record<string, string>;
  const row = await q(
    `INSERT INTO v.zones (code, nom, materiau, couleur) VALUES ($1,$2,$3,$4) RETURNING *`,
    [code.toUpperCase(), nom, materiau, couleur || 'blue']
  );
  res.status(201).json(row.rows[0]);
});

r.patch('/zones/:id', async (req: Request, res: Response) => {
  const { nom, materiau, couleur } = req.body as Record<string, string>;
  const row = await q(
    `UPDATE v.zones SET nom=$1, materiau=$2, couleur=$3 WHERE id=$4 RETURNING *`,
    [nom, materiau, couleur, req.params.id]
  );
  res.json(row.rows[0]);
});

r.delete('/zones/:id', async (req: Request, res: Response) => {
  await q(`DELETE FROM v.zones WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});

// Zone ↔ Dump links
r.get('/zones/:id/dumps', async (req: Request, res: Response) => {
  const rows = await q(
    `SELECT d.* FROM v.dumps d JOIN v.zone_dumps zd ON zd.dump_id=d.id WHERE zd.zone_id=$1 ORDER BY d.code`,
    [req.params.id]
  );
  res.json(rows.rows);
});

r.post('/zones/:id/dumps', async (req: Request, res: Response) => {
  const { dump_id } = req.body as { dump_id: number };
  await q(`INSERT INTO v.zone_dumps (zone_id,dump_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.params.id, dump_id]);
  res.json({ ok: true });
});

r.delete('/zones/:zoneId/dumps/:dumpId', async (req: Request, res: Response) => {
  await q(`DELETE FROM v.zone_dumps WHERE zone_id=$1 AND dump_id=$2`, [req.params.zoneId, req.params.dumpId]);
  res.json({ ok: true });
});

// ── Dumps ──────────────────────────────────────────────────────────────
r.get('/dumps', async (_req, res: Response) => {
  const rows = await q(`SELECT * FROM v.dumps ORDER BY code`);
  res.json(rows.rows);
});

r.post('/dumps', async (req: Request, res: Response) => {
  const { code, nom } = req.body as Record<string, string>;
  const row = await q(
    `INSERT INTO v.dumps (code, nom) VALUES ($1,$2) RETURNING *`,
    [code.toUpperCase(), nom]
  );
  res.status(201).json(row.rows[0]);
});

r.delete('/dumps/:id', async (req: Request, res: Response) => {
  await q(`DELETE FROM v.dumps WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});

// ── Engins ─────────────────────────────────────────────────────────────
r.get('/engins', async (req: Request, res: Response) => {
  const { zone_id } = req.query;
  const rows = await q(
    `SELECT e.*,
            (SELECT statut FROM v.voyages WHERE engin_id=e.id AND statut='EN_COURS' LIMIT 1) AS statut_voyage
     FROM v.engins e
     WHERE ($1::int IS NULL OR e.zone_id=$1::int)
     ORDER BY e.numero`,
    [zone_id || null]
  );
  res.json(rows.rows);
});

r.post('/engins', async (req: Request, res: Response) => {
  const { numero, zone_id, capacite_t } = req.body as Record<string, unknown>;
  const row = await q(
    `INSERT INTO v.engins (numero, zone_id, capacite_t) VALUES ($1,$2,$3) RETURNING *`,
    [numero, zone_id, capacite_t || 220]
  );
  res.status(201).json(row.rows[0]);
});

r.patch('/engins/:id', async (req: Request, res: Response) => {
  const { zone_id, capacite_t } = req.body as Record<string, unknown>;
  const row = await q(
    `UPDATE v.engins SET zone_id=$1, capacite_t=$2 WHERE id=$3 RETURNING *`,
    [zone_id, capacite_t, req.params.id]
  );
  res.json(row.rows[0]);
});

r.delete('/engins/:id', async (req: Request, res: Response) => {
  await q(`DELETE FROM v.engins WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});

// ── Voyages ────────────────────────────────────────────────────────────
r.get('/voyages', async (req: Request, res: Response) => {
  const { zone_id, statut, limit = '50' } = req.query;
  const rows = await q(`
    SELECT v.id, v.operateur, v.materiau, v.payload_t, v.shift,
           v.heure_depart, v.heure_arrivee, v.statut, v.notes,
           v.created_at,
           e.numero AS engin,
           z.code   AS zone_code, z.nom AS zone_nom,
           d.code   AS dump_code, d.nom AS dump_nom,
           EXTRACT(EPOCH FROM (COALESCE(v.heure_arrivee, NOW()) - v.heure_depart))/60 AS duree_min
    FROM v.voyages v
    JOIN v.engins e ON e.id = v.engin_id
    JOIN v.zones  z ON z.id = v.zone_id
    JOIN v.dumps  d ON d.id = v.dump_id
    WHERE ($1::int IS NULL OR v.zone_id = $1::int)
      AND ($2::text IS NULL OR v.statut = $2::text)
    ORDER BY v.heure_depart DESC
    LIMIT $3::int
  `, [zone_id || null, statut || null, limit]);
  res.json(rows.rows);
});

r.post('/voyages', async (req: Request, res: Response) => {
  const { engin_id, zone_id, dump_id, operateur, materiau, payload_t, shift, heure_depart, notes } =
    req.body as Record<string, unknown>;
  const row = await q(`
    INSERT INTO v.voyages (engin_id, zone_id, dump_id, operateur, materiau, payload_t, shift, heure_depart, notes)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    RETURNING *
  `, [engin_id, zone_id, dump_id, operateur, materiau, payload_t, shift || 'J', heure_depart || new Date(), notes]);
  res.status(201).json(row.rows[0]);
});

r.patch('/voyages/:id/terminer', async (req: Request, res: Response) => {
  const { heure_arrivee } = req.body as { heure_arrivee?: string };
  const row = await q(`
    UPDATE v.voyages SET statut='COMPLETE', heure_arrivee=COALESCE($1::timestamptz, NOW())
    WHERE id=$2 RETURNING *
  `, [heure_arrivee || null, req.params.id]);
  res.json(row.rows[0]);
});

r.delete('/voyages/:id', async (req: Request, res: Response) => {
  await q(`DELETE FROM v.voyages WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});

// ── Stats rapides ──────────────────────────────────────────────────────
r.get('/stats', async (_req, res: Response) => {
  const rows = await q(`
    SELECT
      (SELECT COUNT(*) FROM v.voyages WHERE DATE(heure_depart)=CURRENT_DATE)::int     AS voyages_today,
      (SELECT COUNT(*) FROM v.voyages WHERE statut='EN_COURS')::int                    AS en_cours,
      (SELECT COALESCE(SUM(payload_t),0) FROM v.voyages WHERE DATE(heure_depart)=CURRENT_DATE AND statut='COMPLETE') AS tonnes_today,
      (SELECT COUNT(*) FROM v.engins)::int                                             AS nb_engins
  `);
  res.json(rows.rows[0]);
});

export default r;
