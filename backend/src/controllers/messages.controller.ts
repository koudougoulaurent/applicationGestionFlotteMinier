import { Request, Response } from 'express';
import { query } from '../config/database';

type AuthRequest = Request & { user?: { siteId: string; firstName?: string; lastName?: string; role?: string } };

/** GET /api/v1/messages?siteId=X&fleetNumber=DT-101&limit=50 */
export async function getMessages(req: AuthRequest, res: Response): Promise<void> {
  const siteId      = (req.query.siteId as string) || req.user?.siteId;
  const fleetNumber = req.query.fleetNumber as string | undefined;
  const limit       = Math.min(100, parseInt(req.query.limit as string || '50', 10));
  if (!siteId) { res.status(400).json({ error: 'siteId requis' }); return; }

  const params: unknown[] = [siteId, limit];
  let where = 'WHERE dm.site_id = $1';
  if (fleetNumber) { where += ` AND dm.fleet_number = $${params.length + 1}`; params.splice(params.length - 1, 0, fleetNumber); params[params.length - 1] = limit; }

  const { rows } = await query(
    `SELECT dm.message_id, dm.sender_role, dm.sender_name, dm.fleet_number,
            dm.direction, dm.message, dm.priority,
            dm.sent_at, dm.read_at, dm.ack_at,
            e.equipment_id
     FROM operations.dispatch_message dm
     LEFT JOIN core.equipment e ON dm.fleet_number = e.fleet_number
     ${where}
     ORDER BY dm.sent_at DESC
     LIMIT $${params.length}`,
    params
  );
  res.json(rows.map(r => ({
    messageId:   r.message_id,
    senderRole:  r.sender_role,
    senderName:  r.sender_name,
    fleetNumber: r.fleet_number,
    direction:   r.direction,
    message:     r.message,
    priority:    r.priority,
    sentAt:      r.sent_at,
    readAt:      r.read_at,
    ackAt:       r.ack_at,
    isUnread:    r.direction === 'FROM_TRUCK' && !r.ack_at,
  })));
}

/** POST /api/v1/messages — dispatcher envoie un message à un camion */
export async function sendMessage(req: AuthRequest, res: Response): Promise<void> {
  const { siteId, fleetNumber, message, priority = 'NORMAL', direction = 'TO_TRUCK' } =
    req.body as { siteId?: string; fleetNumber?: string; message?: string; priority?: string; direction?: string };
  const resolvedSiteId = siteId || req.user?.siteId;
  const senderName = `${req.user?.firstName ?? ''} ${req.user?.lastName ?? ''}`.trim() || 'Dispatcher';
  const senderRole = req.user?.role ?? 'DISPATCHER';

  if (!resolvedSiteId || !message) { res.status(400).json({ error: 'siteId et message requis' }); return; }

  const { rows } = await query(
    `INSERT INTO operations.dispatch_message
       (site_id, sender_role, sender_name, fleet_number, direction, message, priority)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [resolvedSiteId, senderRole, senderName, fleetNumber ?? null, direction, message, priority]
  );
  res.status(201).json(rows[0]);
}

/** PATCH /api/v1/messages/:id/ack — chauffeur accuse réception */
export async function ackMessage(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { rows } = await query(
    `UPDATE operations.dispatch_message SET ack_at = NOW(), read_at = COALESCE(read_at, NOW())
     WHERE message_id = $1 RETURNING *`,
    [id]
  );
  if (!rows.length) { res.status(404).json({ error: 'Message introuvable' }); return; }
  res.json(rows[0]);
}

/** PATCH /api/v1/messages/:id/read */
export async function markRead(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  await query(`UPDATE operations.dispatch_message SET read_at = NOW() WHERE message_id = $1 AND read_at IS NULL`, [id]);
  res.json({ ok: true });
}

/** GET /api/v1/messages/unread-count?siteId=X */
export async function getUnreadCount(req: AuthRequest, res: Response): Promise<void> {
  const siteId = (req.query.siteId as string) || req.user?.siteId;
  if (!siteId) { res.status(400).json({ error: 'siteId requis' }); return; }
  const { rows } = await query(
    `SELECT COUNT(*) AS count FROM operations.dispatch_message
     WHERE site_id = $1 AND direction = 'FROM_TRUCK' AND ack_at IS NULL`,
    [siteId]
  );
  res.json({ unreadCount: parseInt(rows[0].count) });
}

/** POST /api/v1/dispatch/manual-assign — dispatcher force l'assignation d'un camion */
export async function manualAssign(req: AuthRequest, res: Response): Promise<void> {
  const { truckFleet, loaderFleet, destination, siteId } =
    req.body as { truckFleet: string; loaderFleet: string; destination: string; siteId?: string };
  const resolvedSiteId = siteId || req.user?.siteId;
  if (!resolvedSiteId || !truckFleet || !loaderFleet) {
    res.status(400).json({ error: 'truckFleet, loaderFleet requis' }); return;
  }

  // Log the manual assignment as a message
  const dispName = `${req.user?.firstName ?? ''} ${req.user?.lastName ?? ''}`.trim() || 'Dispatcher';
  await query(
    `INSERT INTO operations.dispatch_message
       (site_id, sender_role, sender_name, fleet_number, direction, message, priority)
     VALUES ($1,'DISPATCHER',$2,$3,'TO_TRUCK',$4,'NORMAL')`,
    [resolvedSiteId, dispName, truckFleet,
      `Assignation manuelle → Pelle ${loaderFleet}${destination ? ` · Destination : ${destination}` : ''}`]
  );

  res.json({
    ok: true,
    message: `${truckFleet} assigné à ${loaderFleet}${destination ? ` → ${destination}` : ''}`,
    sentAt: new Date().toISOString(),
  });
}
