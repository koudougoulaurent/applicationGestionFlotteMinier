import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { liveTelemetry, RealTrame } from '../services/telemetry/LiveTelemetryService';
import { query } from '../config/database';

/**
 * POST /api/v1/telemetry/live
 *
 * Reçoit une trame GPS temps réel d'un engin physique.
 * L'engin prend immédiatement le dessus sur son jumeau simulé
 * dans /simulation/status.
 *
 * Body :
 *   fleetNumber    string   — ex. "TK-007"
 *   lat            number   — latitude WGS84
 *   lon            number   — longitude WGS84
 *   speed_kmh      number   — vitesse GPS
 *   heading        number   — cap 0-359°
 *   payload_kg     number   — poids charge (0 = vide)
 *   fuelLevel_pct  number   — niveau carburant 0-100
 *   engineRunning  boolean  — moteur en marche
 *   timestamp?     string   — ISO 8601 (défaut: now)
 *   healthScore?   number   — score santé 0-100
 */
export async function ingestLive(req: AuthRequest, res: Response): Promise<void> {
  const body = req.body as Partial<RealTrame>;

  // Validation basique
  if (!body.fleetNumber || body.lat == null || body.lon == null) {
    res.status(400).json({ error: 'fleetNumber, lat, lon requis' });
    return;
  }

  // Enrichir l'equipmentId depuis la DB si absent
  let equipmentId = body.equipmentId;
  if (!equipmentId) {
    const row = await query(
      `SELECT equipment_id FROM core.equipment
       WHERE fleet_number = $1 AND active = TRUE LIMIT 1`,
      [body.fleetNumber]
    ).then(r => r.rows[0]).catch(() => null);
    equipmentId = row?.equipment_id;
  }

  const trame: RealTrame = {
    fleetNumber:   body.fleetNumber,
    lat:           Number(body.lat),
    lon:           Number(body.lon),
    speed_kmh:     Number(body.speed_kmh ?? 0),
    heading:       Number(body.heading ?? 0),
    payload_kg:    Number(body.payload_kg ?? 0),
    fuelLevel_pct: Number(body.fuelLevel_pct ?? 100),
    healthScore:   body.healthScore != null ? Number(body.healthScore) : undefined,
    engineRunning: body.engineRunning !== false,
    timestamp:     body.timestamp ?? new Date().toISOString(),
    equipmentId,
  };

  const { phase, isNew } = liveTelemetry.ingest(trame);

  res.json({
    ok:           true,
    fleetNumber:  trame.fleetNumber,
    inferredPhase: phase,
    isNew,
    ts:           trame.timestamp,
  });
}

/**
 * GET /api/v1/telemetry/live/status
 * Retourne les engins réels actuellement connectés.
 */
export async function getLiveStatus(_req: AuthRequest, res: Response): Promise<void> {
  res.json(liveTelemetry.stats());
}
