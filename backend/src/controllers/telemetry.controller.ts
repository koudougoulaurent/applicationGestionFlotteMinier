import { Request, Response } from 'express';
import { query } from '../config/database';

// ──────────────────────────────────────────────
// TÉLÉMÉTRIE MOTEUR / SANTÉ MACHINES
// ──────────────────────────────────────────────

export async function getLatestTelemetry(req: Request, res: Response): Promise<void> {
  const { equipmentId } = req.params;

  const result = await query(
    `SELECT t.*
     FROM operations.telemetry_event t
     WHERE t.equipment_id = $1
     ORDER BY t.event_time DESC
     LIMIT 1`,
    [equipmentId]
  );

  res.json(result.rows[0] || null);
}

export async function getTelemetryHistory(req: Request, res: Response): Promise<void> {
  const { equipmentId } = req.params;
  const { hours = '4', param = 'engine_temp_c' } = req.query;

  // Whitelist allowed columns to prevent SQL injection via query param
  const ALLOWED_PARAMS = [
    'engine_rpm', 'engine_temp_c', 'oil_pressure', 'coolant_temp_c',
    'battery_v', 'hydraulic_temp_c', 'fuel_level_pct', 'load_payload_t',
    'brake_temp_c', 'tire_pressure_fl',
  ];

  const col = ALLOWED_PARAMS.includes(param as string) ? param : 'engine_temp_c';

  const result = await query(
    `SELECT event_time, ${col} AS value
     FROM operations.telemetry_event
     WHERE equipment_id = $1
       AND event_time >= NOW() - ($2 || ' hours')::INTERVAL
     ORDER BY event_time
     LIMIT 500`,
    [equipmentId, hours]
  );

  res.json(result.rows);
}

export async function ingestTelemetry(req: Request, res: Response): Promise<void> {
  const { equipmentId } = req.params;
  const {
    engineRpm, engineTempC, oilPressure, coolantTempC,
    batteryV, hydraulicTempC, fuelLevelPct, loadPayloadT,
    brakeTempC, tirePressureFl, tirePressureFr, faultCodes,
  } = req.body;

  await query(
    `INSERT INTO operations.telemetry_event
       (equipment_id, event_time, engine_rpm, engine_temp_c, oil_pressure,
        coolant_temp_c, battery_v, hydraulic_temp_c, fuel_level_pct,
        load_payload_t, brake_temp_c, tire_pressure_fl, tire_pressure_fr, fault_codes)
     VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      equipmentId, engineRpm || null, engineTempC || null, oilPressure || null,
      coolantTempC || null, batteryV || null, hydraulicTempC || null,
      fuelLevelPct || null, loadPayloadT || null, brakeTempC || null,
      tirePressureFl || null, tirePressureFr || null,
      faultCodes ? JSON.stringify(faultCodes) : null,
    ]
  );

  // Auto-generate alarm if critical thresholds exceeded
  const alerts: string[] = [];

  if (engineTempC && engineTempC > 105) {
    alerts.push('ENGINE_OVERHEAT');
    await query(
      `INSERT INTO operations.alarm
         (equipment_id, site_id, alarm_code, alarm_type, severity, message)
       SELECT $1, site_id, 'ENGINE_OVERHEAT', 'MECHANICAL', 'CRITICAL',
              'Température moteur critique: ' || $2 || '°C'
       FROM core.equipment WHERE equipment_id = $1`,
      [equipmentId, engineTempC]
    );
  }

  if (oilPressure && oilPressure < 2) {
    alerts.push('LOW_OIL_PRESSURE');
    await query(
      `INSERT INTO operations.alarm
         (equipment_id, site_id, alarm_code, alarm_type, severity, message)
       SELECT $1, site_id, 'LOW_OIL_PRESSURE', 'MECHANICAL', 'CRITICAL',
              'Pression huile faible: ' || $2 || ' bar'
       FROM core.equipment WHERE equipment_id = $1`,
      [equipmentId, oilPressure]
    );
  }

  if (fuelLevelPct && fuelLevelPct < 15) {
    alerts.push('FUEL_LOW');
    await query(
      `INSERT INTO operations.alarm
         (equipment_id, site_id, alarm_code, alarm_type, severity, message)
       SELECT $1, site_id, 'FUEL_LOW', 'OPERATIONAL', 'WARNING',
              'Niveau carburant faible: ' || $2 || '%'
       FROM core.equipment WHERE equipment_id = $1`,
      [equipmentId, fuelLevelPct]
    );
  }

  // Update fuel level on equipment if provided
  if (fuelLevelPct !== undefined) {
    await query(
      `UPDATE core.equipment
       SET status = CASE WHEN $2 < 10 AND status = 'AVAILABLE' THEN 'REFUELING' ELSE status END
       WHERE equipment_id = $1`,
      [equipmentId, fuelLevelPct]
    );
  }

  res.json({ recorded: true, alerts });
}

export async function getFleetTelemetrySummary(req: Request & { user?: { siteId: string } }, res: Response): Promise<void> {
  const siteId = req.query.siteId || req.user?.siteId;

  // Latest reading per equipment
  const result = await query(
    `SELECT DISTINCT ON (e.equipment_id)
       e.equipment_id,
       e.fleet_number,
       et.category,
       t.event_time,
       t.engine_temp_c,
       t.oil_pressure,
       t.coolant_temp_c,
       t.fuel_level_pct,
       t.hydraulic_temp_c,
       t.engine_rpm,
       t.fault_codes,
       CASE
         WHEN t.engine_temp_c > 105 THEN 'CRITICAL'
         WHEN t.engine_temp_c > 95  THEN 'WARNING'
         WHEN t.oil_pressure < 2    THEN 'CRITICAL'
         WHEN t.fuel_level_pct < 10 THEN 'CRITICAL'
         WHEN t.fuel_level_pct < 20 THEN 'WARNING'
         ELSE 'OK'
       END AS health_status
     FROM core.equipment e
     JOIN core.equipment_type et ON e.type_id = et.type_id
     LEFT JOIN operations.telemetry_event t ON t.equipment_id = e.equipment_id
     WHERE e.site_id = $1 AND e.active = TRUE
     ORDER BY e.equipment_id, t.event_time DESC`,
    [siteId]
  );

  res.json(result.rows);
}

// ──────────────────────────────────────────────
// MÉTÉO
// ──────────────────────────────────────────────

export async function getWeather(req: Request & { user?: { siteId: string } }, res: Response): Promise<void> {
  const siteId = req.query.siteId || req.user?.siteId;

  const latest = await query(
    `SELECT wr.*, ws.name AS station_name
     FROM core.weather_reading wr
     JOIN core.weather_station ws ON wr.station_id = ws.station_id
     WHERE ws.site_id = $1
     ORDER BY wr.recorded_at DESC
     LIMIT 1`,
    [siteId]
  );

  const history = await query(
    `SELECT wr.recorded_at, wr.temperature_c, wr.rainfall_mm, wr.wind_speed_ms, wr.dust_index
     FROM core.weather_reading wr
     JOIN core.weather_station ws ON wr.station_id = ws.station_id
     WHERE ws.site_id = $1
       AND wr.recorded_at >= NOW() - INTERVAL '24 hours'
     ORDER BY wr.recorded_at`,
    [siteId]
  );

  res.json({ latest: latest.rows[0] || null, history: history.rows });
}

export async function recordWeather(req: Request, res: Response): Promise<void> {
  const { stationId, temperatureC, humidityPct, windSpeedMs, windDirDeg, rainfallMm, visibilityM, dustIndex } = req.body;

  if (!stationId) {
    res.status(400).json({ error: 'stationId required' });
    return;
  }

  await query(
    `INSERT INTO core.weather_reading
       (station_id, temperature_c, humidity_pct, wind_speed_ms, wind_dir_deg,
        rainfall_mm, visibility_m, dust_index)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [stationId, temperatureC || null, humidityPct || null, windSpeedMs || null,
     windDirDeg || null, rainfallMm || null, visibilityM || null, dustIndex || null]
  );

  // Alert if heavy rain or low visibility
  if ((rainfallMm && rainfallMm > 5) || (visibilityM && visibilityM < 200)) {
    const station = await query(
      'SELECT site_id FROM core.weather_station WHERE station_id = $1', [stationId]
    );
    if (station.rows[0]) {
      await query(
        `INSERT INTO operations.alarm
           (site_id, alarm_code, alarm_type, severity, message)
         VALUES ($1, 'WEATHER_ALERT', 'SAFETY', 'WARNING', $2)`,
        [
          station.rows[0].site_id,
          rainfallMm > 5
            ? `Forte pluie détectée: ${rainfallMm} mm/h`
            : `Visibilité très réduite: ${visibilityM}m`,
        ]
      );
    }
  }

  res.json({ recorded: true });
}
