/**
 * BNRSensor.ts — Module 1 : Capteurs Géophysiques Numériques (BNR)
 * ============================================================
 * Simule et gère les données des capteurs BNR installés en forage.
 * BNR = Borehole Numerical Recording
 *
 * Les capteurs BNR mesurent en continu :
 *   - La stabilité du terrain (indice 0-100)
 *   - Les vibrations (mm/s)
 *   - La déformation du sol (mm)
 *   - L'humidité (%)
 *   - L'activité sismique (magnitude proxy)
 *   - La résistivité électrique (Ohm.m)
 *
 * En mode simulation (avant déploiement terrain), ce module génère
 * des données réalistes selon des profils configurables :
 *   - STABLE   : terrain en bon état (référence normale)
 *   - HUMID    : pluies récentes → humidité élevée
 *   - PRE_BLAST: avant un tir de mines → vibrations croissantes
 *   - POST_BLAST: après un tir → rebond puis stabilisation
 *   - CRITICAL : instabilité détectée → alarmes activées
 * ============================================================
 */

import { query } from '../../config/database';

// ── Types ────────────────────────────────────────────────────────────────────

/** Profil de génération des données simulées */
type SensorProfile = 'STABLE' | 'HUMID' | 'PRE_BLAST' | 'POST_BLAST' | 'CRITICAL';

/** Une lecture de capteur BNR */
export interface BNRReading {
  stationId:         string;
  stationName:       string;
  stationCode:       string;
  lat:               number;
  lon:               number;
  recordedAt:        string;

  // Métriques géophysiques
  stabilityIndex:    number;  // 0-100 (100 = très stable)
  vibration_mms:     number;  // mm/s
  deformation_mm:    number;  // mm (subsidence/soulèvement)
  moisture_pct:      number;  // %
  seismicActivity:   number;  // proxy de magnitude
  resistivity_ohm_m: number;  // Ohm.m

  // Statut calculé
  status:            'NORMAL' | 'WARNING' | 'CRITICAL' | 'ALERT';
  statusReason?:     string;
}

/** Résumé de l'état de toutes les stations d'un site */
export interface SiteSensorSummary {
  siteId:            string;
  totalStations:     number;
  normalCount:       number;
  warningCount:      number;
  criticalCount:     number;
  alertCount:        number;
  overallStatus:     'NORMAL' | 'WARNING' | 'CRITICAL' | 'ALERT';
  lastUpdated:       string;
  readings:          BNRReading[];
  blastZones:        BlastZoneStatus[];
}

/** Statut d'une zone de tir */
export interface BlastZoneStatus {
  zoneId:          string;
  name:            string;
  locationId?:     string;
  status:          'CLEAR' | 'PREPARATION' | 'ACTIVE' | 'POST_BLAST' | 'INSPECTING';
  safetyRadius_m:  number;
  blastScheduled?: string;
  blastCompleted?: string;
  clearanceTime?:  string;
}

// ── Seuils d'alerte ───────────────────────────────────────────────────────────

const ALERT_THRESHOLDS = {
  stability:    { warning: 60, critical: 40, alert: 25 },
  vibration:    { warning: 2,  critical: 5,  alert: 10 },
  deformation:  { warning: 5,  critical: 15, alert: 25 },
  moisture:     { warning: 65, critical: 80, alert: 90 },
  seismic:      { warning: 0.5, critical: 1.0, alert: 1.5 },
};

// Valeurs de référence (terrain en bon état — mine sèche non perturbée)
const BASELINE = {
  stability:    85,
  vibration:    0.3,
  deformation:  0.5,
  moisture:     35,
  seismic:      0.05,
  resistivity:  200,
};

// ── Classe principale ─────────────────────────────────────────────────────────

export class BNRSensorService {

  /**
   * Génère et persiste une lecture simulée pour toutes les stations d'un site.
   * Appelé périodiquement par le moteur de simulation ou un timer.
   */
  async generateReadings(siteId: string, profile: SensorProfile = 'STABLE'): Promise<BNRReading[]> {
    // Charge les stations du site (ou crée des stations virtuelles si aucune)
    const stations = await this.ensureStations(siteId);
    const readings: BNRReading[] = [];

    for (const station of stations) {
      const reading = this.generateSingleReading(station, profile);
      await this.persistReading(station.station_id, reading);
      readings.push({
        ...reading,
        stationId:   station.station_id,
        stationName: station.name,
        stationCode: station.code,
        lat:         parseFloat(station.lat),
        lon:         parseFloat(station.lon),
        recordedAt:  new Date().toISOString(),
      });
    }

    return readings;
  }

  /**
   * Lit les dernières valeurs pour toutes les stations d'un site.
   * Utilisé par le dashboard en temps réel.
   */
  async getLatestReadings(siteId: string): Promise<SiteSensorSummary> {
    // Stations du site
    const stations = await this.ensureStations(siteId);

    // Dernière lecture par station
    const readingsRes = await query(
      `SELECT DISTINCT ON (r.station_id)
         r.reading_id, r.station_id, r.recorded_at,
         r.stability_index, r.vibration_mms, r.deformation_mm,
         r.moisture_pct, r.seismic_activity, r.resistivity_ohm_m, r.status
       FROM sensors.bnr_reading r
       JOIN sensors.bnr_station s ON r.station_id = s.station_id
       WHERE s.site_id = $1
       ORDER BY r.station_id, r.recorded_at DESC`,
      [siteId]
    );

    // Zones de tir actives
    const blastRes = await query(
      `SELECT zone_id, name, location_id, status, safety_radius_m,
              blast_scheduled, blast_completed, clearance_time
       FROM sensors.blast_zone
       WHERE site_id = $1
       ORDER BY CASE status
         WHEN 'ACTIVE'      THEN 1
         WHEN 'POST_BLAST'  THEN 2
         WHEN 'PREPARATION' THEN 3
         ELSE 4 END`,
      [siteId]
    );

    // Construit les lectures enrichies (station + données)
    type StationRow = { station_id: string; name: string; code: string; lat: string; lon: string };
    const stationMap = new Map((stations as StationRow[]).map(s => [s.station_id, s]));
    const readings: BNRReading[] = [];

    for (const row of readingsRes.rows) {
      const station = stationMap.get(row.station_id);
      if (!station) continue;

      readings.push({
        stationId:         row.station_id,
        stationName:       station.name,
        stationCode:       station.code,
        lat:               parseFloat(station.lat),
        lon:               parseFloat(station.lon),
        recordedAt:        row.recorded_at,
        stabilityIndex:    parseFloat(row.stability_index) || 85,
        vibration_mms:     parseFloat(row.vibration_mms)   || 0.3,
        deformation_mm:    parseFloat(row.deformation_mm)  || 0.5,
        moisture_pct:      parseFloat(row.moisture_pct)    || 35,
        seismicActivity:   parseFloat(row.seismic_activity) || 0.05,
        resistivity_ohm_m: parseFloat(row.resistivity_ohm_m) || 200,
        status:            row.status || 'NORMAL',
      });
    }

    // Calcule les compteurs de statut
    const normalCount   = readings.filter(r => r.status === 'NORMAL').length;
    const warningCount  = readings.filter(r => r.status === 'WARNING').length;
    const criticalCount = readings.filter(r => r.status === 'CRITICAL').length;
    const alertCount    = readings.filter(r => r.status === 'ALERT').length;

    const overallStatus: BNRReading['status'] =
      alertCount    > 0 ? 'ALERT'    :
      criticalCount > 0 ? 'CRITICAL' :
      warningCount  > 0 ? 'WARNING'  : 'NORMAL';

    const blastZones: BlastZoneStatus[] = blastRes.rows.map(r => ({
      zoneId:          r.zone_id,
      name:            r.name,
      locationId:      r.location_id,
      status:          r.status,
      safetyRadius_m:  parseFloat(r.safety_radius_m),
      blastScheduled:  r.blast_scheduled,
      blastCompleted:  r.blast_completed,
      clearanceTime:   r.clearance_time,
    }));

    return {
      siteId,
      totalStations:  stations.length,
      normalCount,
      warningCount,
      criticalCount,
      alertCount,
      overallStatus,
      lastUpdated:    new Date().toISOString(),
      readings,
      blastZones,
    };
  }

  /**
   * Retourne l'historique des lectures d'une station sur les dernières heures.
   * Utilisé pour les graphes de tendance.
   */
  async getStationHistory(
    stationId: string,
    hours      = 24
  ): Promise<Array<{
    time:       string;
    stability:  number;
    vibration:  number;
    seismic:    number;
    moisture:   number;
    status:     string;
  }>> {
    const res = await query(
      `SELECT recorded_at, stability_index, vibration_mms,
              seismic_activity, moisture_pct, status
       FROM sensors.bnr_reading
       WHERE station_id = $1
         AND recorded_at > NOW() - INTERVAL '${hours} hours'
       ORDER BY recorded_at ASC`,
      [stationId]
    );

    return res.rows.map(r => ({
      time:      r.recorded_at,
      stability: parseFloat(r.stability_index) || 85,
      vibration: parseFloat(r.vibration_mms)   || 0,
      seismic:   parseFloat(r.seismic_activity) || 0,
      moisture:  parseFloat(r.moisture_pct)    || 0,
      status:    r.status,
    }));
  }

  // ── Génération de données simulées ───────────────────────────────────────

  /**
   * Génère une lecture réaliste pour un profil donné.
   * Chaque profil représente une condition terrain spécifique.
   */
  private generateSingleReading(
    station: { lat: string; lon: string },
    profile: SensorProfile
  ): Omit<BNRReading, 'stationId' | 'stationName' | 'stationCode' | 'lat' | 'lon' | 'recordedAt'> {
    // Bruit naturel : légère variation aléatoire autour de la valeur de base
    const noise = (amplitude: number) => (Math.random() - 0.5) * amplitude;

    let stability:    number;
    let vibration:    number;
    let deformation:  number;
    let moisture:     number;
    let seismic:      number;
    let resistivity:  number;

    switch (profile) {
      case 'STABLE':
        // Terrain sain — toutes les métriques proches des valeurs de référence
        stability   = BASELINE.stability   + noise(10);
        vibration   = BASELINE.vibration   + Math.abs(noise(0.4));
        deformation = BASELINE.deformation + noise(0.3);
        moisture    = BASELINE.moisture    + noise(8);
        seismic     = BASELINE.seismic     + Math.abs(noise(0.08));
        resistivity = BASELINE.resistivity + noise(40);
        break;

      case 'HUMID':
        // Après des pluies — humidité élevée, stabilité légèrement réduite
        stability   = 70 + noise(8);
        vibration   = 0.5 + Math.abs(noise(0.3));
        deformation = 2 + Math.abs(noise(1.5));
        moisture    = 72 + noise(10);   // humidité élevée
        seismic     = 0.1 + Math.abs(noise(0.05));
        resistivity = 80 + noise(20);   // résistivité basse (sol saturé)
        break;

      case 'PRE_BLAST':
        // Avant un tir de mines — préparation des explosifs, vibrations légères
        stability   = 75 + noise(5);
        vibration   = 1.2 + Math.abs(noise(0.5));  // vibrations des foreuses
        deformation = 1 + Math.abs(noise(0.8));
        moisture    = 38 + noise(6);
        seismic     = 0.2 + Math.abs(noise(0.1));
        resistivity = 190 + noise(30);
        break;

      case 'POST_BLAST':
        // Après un tir — vibrations élevées, stabilité réduite temporairement
        stability   = 48 + noise(10);   // instabilité temporaire
        vibration   = 6 + Math.abs(noise(2));    // vibrations fortes !
        deformation = 8 + Math.abs(noise(3));   // déformation liée au tir
        moisture    = 40 + noise(5);
        seismic     = 1.2 + Math.abs(noise(0.3)); // activité sismique élevée
        resistivity = 170 + noise(40);
        break;

      case 'CRITICAL':
        // Instabilité critique — alarme !
        stability   = 22 + noise(6);   // DANGER
        vibration   = 8 + Math.abs(noise(3));
        deformation = 28 + Math.abs(noise(5));
        moisture    = 88 + noise(5);   // terrain saturé
        seismic     = 1.8 + Math.abs(noise(0.4));
        resistivity = 45 + noise(15);  // très basse = eau souterraine
        break;
    }

    // Clamp les valeurs dans des plages réalistes
    stability   = Math.min(100, Math.max(0, stability));
    vibration   = Math.max(0, vibration);
    deformation = Math.max(0, deformation);
    moisture    = Math.min(100, Math.max(0, moisture));
    seismic     = Math.max(0, seismic);
    resistivity = Math.max(1, resistivity);

    // Détermine le statut selon les seuils
    const status = this.computeStatus(stability, vibration, deformation, moisture, seismic);

    return {
      stabilityIndex:    +stability.toFixed(2),
      vibration_mms:     +vibration.toFixed(3),
      deformation_mm:    +deformation.toFixed(2),
      moisture_pct:      +moisture.toFixed(2),
      seismicActivity:   +seismic.toFixed(3),
      resistivity_ohm_m: +resistivity.toFixed(1),
      status,
      statusReason:      this.statusReason(stability, vibration, seismic),
    };
  }

  /** Détermine le niveau d'alerte selon les seuils */
  private computeStatus(
    stability:   number,
    vibration:   number,
    deformation: number,
    moisture:    number,
    seismic:     number
  ): BNRReading['status'] {
    const T = ALERT_THRESHOLDS;

    if (
      stability  < T.stability.alert  ||
      vibration  > T.vibration.alert  ||
      deformation > T.deformation.alert ||
      seismic    > T.seismic.alert
    ) return 'ALERT';

    if (
      stability  < T.stability.critical  ||
      vibration  > T.vibration.critical  ||
      deformation > T.deformation.critical ||
      moisture   > T.moisture.critical   ||
      seismic    > T.seismic.critical
    ) return 'CRITICAL';

    if (
      stability  < T.stability.warning  ||
      vibration  > T.vibration.warning  ||
      deformation > T.deformation.warning ||
      moisture   > T.moisture.warning   ||
      seismic    > T.seismic.warning
    ) return 'WARNING';

    return 'NORMAL';
  }

  /** Génère un message d'explication du statut */
  private statusReason(stability: number, vibration: number, seismic: number): string {
    if (stability < ALERT_THRESHOLDS.stability.alert)  return 'Stabilité critique — évacuation préventive';
    if (vibration > ALERT_THRESHOLDS.vibration.alert)  return 'Vibrations excessives — arrêt activité';
    if (seismic   > ALERT_THRESHOLDS.seismic.critical) return 'Activité sismique anormale';
    if (stability < ALERT_THRESHOLDS.stability.warning) return 'Instabilité légère détectée';
    return 'Paramètres dans les limites normales';
  }

  // ── Persistance ───────────────────────────────────────────────────────────

  /** Sauvegarde une lecture en DB */
  private async persistReading(
    stationId: string,
    reading: Omit<BNRReading, 'stationId' | 'stationName' | 'stationCode' | 'lat' | 'lon' | 'recordedAt'>
  ): Promise<void> {
    await query(
      `INSERT INTO sensors.bnr_reading
         (station_id, stability_index, vibration_mms, deformation_mm,
          moisture_pct, seismic_activity, resistivity_ohm_m, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        stationId,
        reading.stabilityIndex,
        reading.vibration_mms,
        reading.deformation_mm,
        reading.moisture_pct,
        reading.seismicActivity,
        reading.resistivity_ohm_m,
        reading.status,
      ]
    ).catch(() => {});

    // Crée une alarme si critique ou alerte
    if (reading.status === 'CRITICAL' || reading.status === 'ALERT') {
      const stationInfo = await query(
        `SELECT s.site_id, s.name FROM sensors.bnr_station s WHERE s.station_id = $1`,
        [stationId]
      ).catch(() => ({ rows: [] as { site_id: string; name: string }[] }));

      if (stationInfo.rows[0]) {
        await query(
          `INSERT INTO operations.alarm
             (site_id, alarm_code, alarm_type, severity, message)
           VALUES ($1, 'BNR_${reading.status}', 'SAFETY',
                   $2, $3)`,
          [
            stationInfo.rows[0].site_id,
            reading.status === 'ALERT' ? 'EMERGENCY' : 'CRITICAL',
            `[BNR] ${stationInfo.rows[0].name} — ${reading.statusReason || reading.status} ` +
            `(stabilité: ${reading.stabilityIndex}/100, vibration: ${reading.vibration_mms} mm/s)`,
          ]
        ).catch(() => {});
      }
    }
  }

  /**
   * Assure qu'il y a des stations BNR pour le site.
   * Si aucune station n'existe, crée des stations virtuelles de démonstration.
   */
  private async ensureStations(siteId: string): Promise<Array<{
    station_id: string; name: string; code: string; lat: string; lon: string;
  }>> {
    let res = await query(
      `SELECT s.station_id, s.name, s.code,
              COALESCE(s.latitude,  ms.latitude)::TEXT  AS lat,
              COALESCE(s.longitude, ms.longitude)::TEXT AS lon
       FROM sensors.bnr_station s
       JOIN core.mine_site ms ON s.site_id = ms.site_id
       WHERE s.site_id = $1 AND s.active = TRUE
       ORDER BY s.code`,
      [siteId]
    );

    if (res.rows.length > 0) return res.rows;

    // Crée des stations virtuelles pour la démonstration
    const siteRes = await query(
      `SELECT latitude, longitude FROM core.mine_site WHERE site_id = $1`,
      [siteId]
    );
    const center = {
      lat: parseFloat(siteRes.rows[0]?.latitude) || -12.500,
      lon: parseFloat(siteRes.rows[0]?.longitude) || 27.855,
    };

    const virtualStations = [
      { code: 'BNR-N01', name: 'Capteur Nord — Flanc pit',    lat: center.lat - 0.015, lon: center.lon - 0.010 },
      { code: 'BNR-N02', name: 'Capteur Sud — Zone déversoir', lat: center.lat + 0.020, lon: center.lon + 0.015 },
      { code: 'BNR-N03', name: 'Capteur Est — Banc principal', lat: center.lat + 0.005, lon: center.lon - 0.025 },
      { code: 'BNR-N04', name: 'Capteur Ouest — Accès nord',  lat: center.lat - 0.010, lon: center.lon + 0.020 },
    ];

    for (const s of virtualStations) {
      await query(
        `INSERT INTO sensors.bnr_station
           (site_id, name, code, latitude, longitude, sensor_type)
         VALUES ($1, $2, $3, $4, $5, 'FULL')
         ON CONFLICT (code) DO NOTHING`,
        [siteId, s.name, s.code, s.lat, s.lon]
      ).catch(() => {});
    }

    // Re-lit les stations créées
    res = await query(
      `SELECT s.station_id, s.name, s.code,
              s.latitude::TEXT AS lat, s.longitude::TEXT AS lon
       FROM sensors.bnr_station s
       WHERE s.site_id = $1 AND s.active = TRUE
       ORDER BY s.code`,
      [siteId]
    );

    return res.rows;
  }
}

// Instance singleton
export const bnrSensor = new BNRSensorService();
