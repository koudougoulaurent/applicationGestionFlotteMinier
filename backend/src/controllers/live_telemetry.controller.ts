import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { liveTelemetry, RealTrame } from '../services/telemetry/LiveTelemetryService';
import { query } from '../config/database';
import { liveTelemetrySchema } from '../schemas';

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
  // Validation Zod — coordonnées, ranges, format fleetNumber
  const parsed = liveTelemetrySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Données invalides', details: parsed.error.flatten().fieldErrors });
    return;
  }
  const body = parsed.data;

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

  // Vérification anti-spoofing : le fleetNumber doit exister dans la DB
  // (sauf pour les admins qui peuvent tester n'importe quel numéro)
  if (!equipmentId && req.user?.role !== 'ADMIN') {
    res.status(403).json({ error: `Engin ${body.fleetNumber} non enregistré dans ce site` });
    return;
  }

  const trame: RealTrame = {
    fleetNumber:   body.fleetNumber,
    lat:           body.lat,
    lon:           body.lon,
    speed_kmh:     body.speed_kmh,
    heading:       body.heading,
    payload_kg:    body.payload_kg,
    fuelLevel_pct: body.fuelLevel_pct,
    healthScore:   body.healthScore,
    engineRunning: body.engineRunning,
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
