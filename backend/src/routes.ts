import { Router, Request, Response } from 'express';
import { q } from './db';

const r = Router();

// ── Pelles ────────────────────────────────────────────────────────────
r.get('/pelles', async (_req, res: Response) => {
  const { rows } = await q(`SELECT * FROM v.pelles ORDER BY code`);
  res.json(rows);
});
r.post('/pelles', async (req: Request, res: Response) => {
  const { code, modele, operateur } = req.body as Record<string, string>;
  const { rows } = await q(
    `INSERT INTO v.pelles (code,modele,operateur) VALUES($1,$2,$3) RETURNING *`,
    [code.toUpperCase(), modele, operateur]);
  res.status(201).json(rows[0]);
});
r.patch('/pelles/:id', async (req: Request, res: Response) => {
  const { modele, operateur, statut } = req.body as Record<string, string>;
  const { rows } = await q(
    `UPDATE v.pelles SET modele=$1,operateur=$2,statut=$3 WHERE id=$4 RETURNING *`,
    [modele, operateur, statut, req.params.id]);
  res.json(rows[0]);
});
r.delete('/pelles/:id', async (req: Request, res: Response) => {
  await q(`UPDATE v.zones SET pelle_id=NULL WHERE pelle_id=$1`, [req.params.id]);
  await q(`DELETE FROM v.pelles WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});

// ── Zones ─────────────────────────────────────────────────────────────
r.get('/zones', async (_req, res: Response) => {
  const { rows } = await q(`
    SELECT z.*,
      p.code AS pelle_code, p.modele AS pelle_modele,
      p.operateur AS pelle_operateur, p.statut AS pelle_statut,
      (SELECT COUNT(*) FROM v.engins WHERE zone_id=z.id)::int                         AS nb_engins,
      (SELECT COUNT(*) FROM v.engins WHERE zone_id=z.id AND statut='DISPONIBLE')::int AS nb_dispos,
      (SELECT COUNT(*) FROM v.engins WHERE zone_id=z.id AND statut='EN_ATTENTE')::int AS nb_file,
      (SELECT COUNT(*) FROM v.voyages WHERE zone_id=z.id AND statut='EN_ROUTE')::int  AS nb_en_route,
      (SELECT COALESCE(SUM(payload_t),0) FROM v.voyages
         WHERE zone_id=z.id AND DATE(heure_depart)=CURRENT_DATE
           AND statut IN ('EN_ROUTE','AU_DUMP','COMPLETE'))                            AS tonnes_jour,
      COALESCE(
        json_agg(DISTINCT jsonb_build_object(
          'id',d.id,'code',d.code,'nom',d.nom,'type',d.type,
          'distance_km',zd.distance_km,'duree_min',zd.duree_min
        )) FILTER (WHERE d.id IS NOT NULL), '[]'
      ) AS dumps
    FROM v.zones z
    LEFT JOIN v.pelles p ON p.id = z.pelle_id
    LEFT JOIN v.zone_dumps zd ON zd.zone_id = z.id
    LEFT JOIN v.dumps d ON d.id = zd.dump_id
    GROUP BY z.id, p.id ORDER BY z.code
  `);
  res.json(rows);
});
r.post('/zones', async (req: Request, res: Response) => {
  const { code, nom, type_minerai, pelle_id, capacite_queue, couleur } = req.body as Record<string, string>;
  const { rows } = await q(
    `INSERT INTO v.zones (code,nom,type_minerai,pelle_id,capacite_queue,couleur)
     VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [code.toUpperCase(), nom, type_minerai, pelle_id || null, capacite_queue || 3, couleur || 'blue']);
  res.status(201).json(rows[0]);
});
r.patch('/zones/:id', async (req: Request, res: Response) => {
  const { nom, type_minerai, pelle_id, capacite_queue, couleur } = req.body as Record<string, string>;
  const { rows } = await q(
    `UPDATE v.zones SET nom=$1,type_minerai=$2,pelle_id=$3,capacite_queue=$4,couleur=$5
     WHERE id=$6 RETURNING *`,
    [nom, type_minerai, pelle_id || null, capacite_queue, couleur, req.params.id]);
  res.json(rows[0]);
});
r.delete('/zones/:id', async (req: Request, res: Response) => {
  await q(`DELETE FROM v.zones WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});
r.post('/zones/:id/dumps', async (req: Request, res: Response) => {
  const { dump_id, distance_km, duree_min } = req.body as Record<string, string | number>;
  await q(
    `INSERT INTO v.zone_dumps (zone_id,dump_id,distance_km,duree_min)
     VALUES($1,$2,$3,$4) ON CONFLICT (zone_id,dump_id)
     DO UPDATE SET distance_km=$3,duree_min=$4`,
    [req.params.id, dump_id, distance_km || 3, duree_min || 25]);
  res.json({ ok: true });
});
r.delete('/zones/:zoneId/dumps/:dumpId', async (req: Request, res: Response) => {
  await q(`DELETE FROM v.zone_dumps WHERE zone_id=$1 AND dump_id=$2`,
    [req.params.zoneId, req.params.dumpId]);
  res.json({ ok: true });
});

// ── Dumps ─────────────────────────────────────────────────────────────
r.get('/dumps', async (_req, res: Response) => {
  const { rows } = await q(`
    SELECT d.*,
      (SELECT COUNT(*) FROM v.voyages WHERE dump_id=d.id AND statut='AU_DUMP')::int     AS camions_presents,
      (SELECT COALESCE(SUM(payload_t),0) FROM v.voyages
         WHERE dump_id=d.id AND DATE(heure_depart)=CURRENT_DATE
           AND statut IN ('AU_DUMP','COMPLETE'))                                         AS tonnes_recues_jour,
      (SELECT COUNT(*) FROM v.voyages
         WHERE dump_id=d.id AND DATE(heure_depart)=CURRENT_DATE
           AND statut='COMPLETE')::int                                                   AS voyages_jour
    FROM v.dumps d ORDER BY d.code
  `);
  res.json(rows);
});
r.post('/dumps', async (req: Request, res: Response) => {
  const { code, nom, type } = req.body as Record<string, string>;
  const { rows } = await q(
    `INSERT INTO v.dumps (code,nom,type) VALUES($1,$2,$3) RETURNING *`,
    [code.toUpperCase(), nom, type || 'DUMP']);
  res.status(201).json(rows[0]);
});
r.patch('/dumps/:id', async (req: Request, res: Response) => {
  const { nom, type } = req.body as Record<string, string>;
  const { rows } = await q(
    `UPDATE v.dumps SET nom=$1,type=$2 WHERE id=$3 RETURNING *`, [nom, type, req.params.id]);
  res.json(rows[0]);
});
r.delete('/dumps/:id', async (req: Request, res: Response) => {
  await q(`DELETE FROM v.dumps WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});

// ── Engins ────────────────────────────────────────────────────────────
r.get('/engins', async (req: Request, res: Response) => {
  const { zone_id } = req.query;
  const { rows } = await q(`
    SELECT e.*,
      z.code AS zone_code,
      (SELECT id FROM v.voyages WHERE engin_id=e.id
         AND statut NOT IN ('COMPLETE','ANNULE') ORDER BY created_at DESC LIMIT 1) AS voyage_actif_id
    FROM v.engins e
    LEFT JOIN v.zones z ON z.id=e.zone_id
    WHERE ($1::int IS NULL OR e.zone_id=$1::int)
    ORDER BY e.zone_id, e.numero
  `, [zone_id || null]);
  res.json(rows);
});
r.post('/engins', async (req: Request, res: Response) => {
  const { numero, modele, zone_id, capacite_t } = req.body as Record<string, unknown>;
  const { rows } = await q(
    `INSERT INTO v.engins (numero,modele,zone_id,capacite_t)
     VALUES($1,$2,$3,$4) RETURNING *`,
    [numero, modele || 'CAT 793F', zone_id, capacite_t || 220]);
  res.status(201).json(rows[0]);
});
r.patch('/engins/:id', async (req: Request, res: Response) => {
  const { zone_id, statut, capacite_t, modele } = req.body as Record<string, unknown>;
  const { rows } = await q(
    `UPDATE v.engins SET zone_id=$1,statut=$2,capacite_t=$3,modele=$4 WHERE id=$5 RETURNING *`,
    [zone_id, statut, capacite_t, modele, req.params.id]);
  res.json(rows[0]);
});
r.delete('/engins/:id', async (req: Request, res: Response) => {
  await q(`DELETE FROM v.engins WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});

// ── Voyages ───────────────────────────────────────────────────────────
r.get('/voyages', async (req: Request, res: Response) => {
  const { zone_id, statut, dump_id, limit = '100' } = req.query;
  const { rows } = await q(`
    SELECT v.*,
      e.numero AS engin, e.modele AS engin_modele, e.capacite_t,
      z.code AS zone_code, z.nom AS zone_nom, z.couleur AS zone_couleur,
      d.code AS dump_code, d.nom AS dump_nom, d.type AS dump_type,
      EXTRACT(EPOCH FROM (NOW() - v.heure_depart))/60              AS elapsed_min,
      EXTRACT(EPOCH FROM (COALESCE(v.heure_retour,v.heure_au_dump,NOW()) - v.heure_depart))/60 AS duree_reelle_min
    FROM v.voyages v
    JOIN v.engins e ON e.id=v.engin_id
    JOIN v.zones  z ON z.id=v.zone_id
    JOIN v.dumps  d ON d.id=v.dump_id
    WHERE ($1::int IS NULL OR v.zone_id=$1::int)
      AND ($2::text IS NULL OR v.statut=$2::text)
      AND ($3::int IS NULL OR v.dump_id=$3::int)
    ORDER BY v.heure_depart DESC LIMIT $4::int
  `, [zone_id || null, statut || null, dump_id || null, limit]);
  res.json(rows);
});

r.post('/voyages', async (req: Request, res: Response) => {
  const { engin_id, zone_id, dump_id, operateur, type_materiau, payload_t, shift, heure_depart, duree_estime_min, notes } =
    req.body as Record<string, unknown>;

  // Récupérer durée estimée depuis zone_dumps si non fournie
  let duree = duree_estime_min;
  if (!duree) {
    const zd = await q(`SELECT duree_min FROM v.zone_dumps WHERE zone_id=$1 AND dump_id=$2`, [zone_id, dump_id]);
    duree = zd.rows[0]?.duree_min ?? 25;
  }

  const { rows } = await q(`
    INSERT INTO v.voyages (engin_id,zone_id,dump_id,operateur,type_materiau,payload_t,shift,heure_depart,duree_estime_min,notes)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *
  `, [engin_id, zone_id, dump_id, operateur || null, type_materiau || null,
      payload_t || null, shift || 'J',
      heure_depart ? new Date(heure_depart as string) : new Date(),
      duree, notes || null]);

  // Mettre à jour statut engin
  await q(`UPDATE v.engins SET statut='EN_ROUTE' WHERE id=$1`, [engin_id]);

  res.status(201).json(rows[0]);
});

// Marquer arrivée au dump
r.patch('/voyages/:id/au-dump', async (req: Request, res: Response) => {
  const { rows } = await q(`
    UPDATE v.voyages SET statut='AU_DUMP', heure_au_dump=NOW() WHERE id=$1 RETURNING *
  `, [req.params.id]);
  if (rows[0]) await q(`UPDATE v.engins SET statut='AU_DUMP' WHERE id=$1`, [rows[0].engin_id]);
  res.json(rows[0]);
});

// Marquer retour (voyage complet)
r.patch('/voyages/:id/retour', async (req: Request, res: Response) => {
  const { rows } = await q(`
    UPDATE v.voyages SET statut='COMPLETE', heure_retour=NOW(),
      heure_au_dump=COALESCE(heure_au_dump,NOW())
    WHERE id=$1 RETURNING *
  `, [req.params.id]);
  if (rows[0]) await q(`UPDATE v.engins SET statut='DISPONIBLE' WHERE id=$1`, [rows[0].engin_id]);
  res.json(rows[0]);
});

r.delete('/voyages/:id', async (req: Request, res: Response) => {
  const { rows } = await q(`DELETE FROM v.voyages WHERE id=$1 RETURNING engin_id,statut`, [req.params.id]);
  if (rows[0] && rows[0].statut !== 'COMPLETE')
    await q(`UPDATE v.engins SET statut='DISPONIBLE' WHERE id=$1`, [rows[0].engin_id]);
  res.json({ ok: true });
});

// ── Stats globales ────────────────────────────────────────────────────
r.get('/stats', async (_req, res: Response) => {
  const { rows } = await q(`
    SELECT
      (SELECT COUNT(*) FROM v.voyages WHERE DATE(heure_depart)=CURRENT_DATE)::int              AS voyages_jour,
      (SELECT COUNT(*) FROM v.voyages WHERE statut='EN_ROUTE')::int                            AS en_route,
      (SELECT COUNT(*) FROM v.voyages WHERE statut='AU_DUMP')::int                             AS au_dump,
      (SELECT COUNT(*) FROM v.engins  WHERE statut='DISPONIBLE')::int                          AS dispos,
      (SELECT COALESCE(SUM(payload_t),0) FROM v.voyages
         WHERE DATE(heure_depart)=CURRENT_DATE)                                                AS tonnes_jour,
      (SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (heure_retour-heure_depart))/60),0)
         FROM v.voyages WHERE statut='COMPLETE' AND DATE(heure_depart)=CURRENT_DATE)           AS cycle_moyen_min,
      (SELECT COUNT(*) FROM v.engins WHERE statut NOT IN ('EN_PANNE','PAUSE'))::int            AS engins_actifs
  `);
  res.json(rows[0]);
});

export default r;
