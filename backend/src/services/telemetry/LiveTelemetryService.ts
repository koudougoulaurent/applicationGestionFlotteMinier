/**
 * LiveTelemetryService — mode hybride simulation + réel
 *
 * Maintient un registre en mémoire des engins réels connectés.
 * Quand un engin envoie sa position GPS, il "prend le dessus" sur son
 * jumeau simulé dans /simulation/status.
 * Après REAL_TTL_MS sans signal, l'engin repasse en mode simulé automatiquement.
 */

// Haversine distance in km
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Geofences mine Nchanga ────────────────────────────────────────────────────
interface Geofence {
  code: string;
  type: 'PIT' | 'CRUSHER' | 'DUMP' | 'FUEL_STATION' | 'PARKING' | 'STOCKPILE' | 'WORKSHOP';
  lat: number;
  lon: number;
  radiusKm: number;
}

const GEOFENCES: Geofence[] = [
  { code: 'PIT-1',   type: 'PIT',          lat: -12.490, lon: 27.840, radiusKm: 0.35 },
  { code: 'PIT-2',   type: 'PIT',          lat: -12.510, lon: 27.850, radiusKm: 0.35 },
  { code: 'PIT-3',   type: 'PIT',          lat: -12.500, lon: 27.870, radiusKm: 0.35 },
  { code: 'CRUSH-1', type: 'CRUSHER',      lat: -12.525, lon: 27.840, radiusKm: 0.30 },
  { code: 'DUMP-1',  type: 'DUMP',         lat: -12.470, lon: 27.830, radiusKm: 0.30 },
  { code: 'DUMP-2',  type: 'DUMP',         lat: -12.490, lon: 27.890, radiusKm: 0.30 },
  { code: 'STCK-1',  type: 'STOCKPILE',    lat: -12.520, lon: 27.835, radiusKm: 0.25 },
  { code: 'FUEL-1',  type: 'FUEL_STATION', lat: -12.505, lon: 27.855, radiusKm: 0.15 },
  { code: 'PARK-1',  type: 'PARKING',      lat: -12.503, lon: 27.852, radiusKm: 0.20 },
  { code: 'SHOP-1',  type: 'WORKSHOP',     lat: -12.508, lon: 27.858, radiusKm: 0.15 },
];

function zoneAt(lat: number, lon: number): Geofence | null {
  let closest: Geofence | null = null;
  let minDist = Infinity;
  for (const g of GEOFENCES) {
    const d = haversineKm(lat, lon, g.lat, g.lon);
    if (d <= g.radiusKm && d < minDist) { closest = g; minDist = d; }
  }
  return closest;
}

// ── Trame reçue d'un engin réel ───────────────────────────────────────────────
export interface RealTrame {
  fleetNumber:     string;
  lat:             number;
  lon:             number;
  speed_kmh:       number;
  heading:         number;
  payload_kg:      number;       // 0 si vide, poids brut si chargé
  fuelLevel_pct:   number;
  healthScore?:    number;
  engineRunning:   boolean;
  timestamp:       string;       // ISO 8601
  equipmentId?:    string;       // optionnel — enrichi depuis la DB si absent
}

// ── État interne d'un engin réel ──────────────────────────────────────────────
interface LiveTruck {
  fleetNumber:    string;
  equipmentId:    string;
  lat:            number;
  lon:            number;
  speed_kmh:      number;
  heading:        number;
  payload_kg:     number;
  fuelLevel_pct:  number;
  healthScore:    number;
  engineRunning:  boolean;
  phase:          string;
  prevPayload_kg: number;        // pour détecter chargement/déversement
  zone:           Geofence | null;
  lastSeen:       number;        // Date.now()
  cyclesThisShift:number;
  tonnesThisShift:number;
}

// ── Machine à états géofencing ────────────────────────────────────────────────
const MAX_PAYLOAD_KG = 220_000;   // CAT 793 capacity
const LOADED_THRESHOLD = 0.15;    // > 15% du max = chargé

function inferPhase(truck: LiveTruck, trame: RealTrame): string {
  const zone = zoneAt(trame.lat, trame.lon);
  const payloadRatio = trame.payload_kg / MAX_PAYLOAD_KG;
  const isLoaded = payloadRatio > LOADED_THRESHOLD;
  const isMoving = trame.speed_kmh > 2;
  const payloadDelta = trame.payload_kg - truck.prevPayload_kg;

  if (!trame.engineRunning) return 'DOWN';

  if (!zone) {
    // En transit entre zones
    if (isLoaded)  return 'HAULING';
    if (!isLoaded) return 'RETURNING';
  }

  switch (zone!.type) {
    case 'PIT':
      if (!isLoaded && !isMoving)            return 'QUEUING_AT_SOURCE';
      if (payloadDelta > 2000)               return 'LOADING';  // payload monte
      if (isLoaded && isMoving)              return 'HAULING';  // part chargé
      return 'MOVING_TO_SOURCE';

    case 'CRUSHER':
    case 'DUMP':
    case 'STOCKPILE':
      if (isLoaded && !isMoving)             return 'QUEUING_AT_DEST';
      if (payloadDelta < -5000)              return 'DUMPING';  // payload descend vite
      if (!isLoaded && truck.phase === 'DUMPING') return 'RETURNING';
      if (!isLoaded)                         return 'RETURNING';
      return 'QUEUING_AT_DEST';

    case 'FUEL_STATION':
      return 'REFUELING';

    case 'PARKING':
    case 'WORKSHOP':
      if (!isMoving) return 'IDLE';
      return truck.phase; // garde l'état précédent si traverse le parking en mouvement
  }

  return truck.phase;
}

// ── Service singleton ─────────────────────────────────────────────────────────
const REAL_TTL_MS = 30_000; // 30s sans signal → retour en mode simulé

class LiveTelemetryService {
  private trucks = new Map<string, LiveTruck>();

  /** Ingestion d'une trame GPS réelle depuis un engin */
  ingest(trame: RealTrame): { phase: string; isNew: boolean } {
    const now = Date.now();
    const existing = this.trucks.get(trame.fleetNumber);

    const phase = existing
      ? inferPhase(existing, trame)
      : (trame.payload_kg / MAX_PAYLOAD_KG > LOADED_THRESHOLD ? 'HAULING' : 'IDLE');

    const updated: LiveTruck = {
      fleetNumber:     trame.fleetNumber,
      equipmentId:     trame.equipmentId ?? existing?.equipmentId ?? trame.fleetNumber,
      lat:             trame.lat,
      lon:             trame.lon,
      speed_kmh:       trame.speed_kmh,
      heading:         trame.heading,
      payload_kg:      trame.payload_kg,
      fuelLevel_pct:   trame.fuelLevel_pct,
      healthScore:     trame.healthScore ?? existing?.healthScore ?? 95,
      engineRunning:   trame.engineRunning,
      phase,
      prevPayload_kg:  existing?.payload_kg ?? trame.payload_kg,
      zone:            zoneAt(trame.lat, trame.lon),
      lastSeen:        now,
      cyclesThisShift: existing?.cyclesThisShift ?? 0,
      tonnesThisShift: existing?.tonnesThisShift ?? 0,
    };

    // Incrémenter les cycles quand un camion passe de DUMPING → RETURNING
    if (existing?.phase === 'DUMPING' && phase === 'RETURNING') {
      updated.cyclesThisShift += 1;
      updated.tonnesThisShift += existing.payload_kg / 1000;
    }

    this.trucks.set(trame.fleetNumber, updated);
    return { phase, isNew: !existing };
  }

  /** Retourne les engins réels encore dans la fenêtre TTL */
  getLiveFleetNumbers(): Set<string> {
    const now = Date.now();
    const alive = new Set<string>();
    this.trucks.forEach((t, fn) => {
      if (now - t.lastSeen < REAL_TTL_MS) alive.add(fn);
    });
    return alive;
  }

  /** Sérialise un engin réel au format compatible simulation/status */
  serialize(fleetNumber: string): (Record<string, unknown> & { isReal: true }) | null {
    const t = this.trucks.get(fleetNumber);
    if (!t) return null;
    const now = Date.now();
    if (now - t.lastSeen >= REAL_TTL_MS) return null;

    const staleness_s = Math.round((now - t.lastSeen) / 1000);

    return {
      equipmentId:     t.equipmentId,
      fleetNumber:     t.fleetNumber,
      phase:           t.phase,
      status:          t.engineRunning ? 'ACTIVE' : 'DOWN',
      lat:             +t.lat.toFixed(7),
      lon:             +t.lon.toFixed(7),
      heading:         Math.round(t.heading),
      speed_kmh:       Math.round(t.speed_kmh),
      phaseProgress:   0,        // non calculé en mode réel
      phaseDuration_s: staleness_s,
      fuelLevel_pct:   Math.round(t.fuelLevel_pct),
      healthScore:     Math.round(t.healthScore),
      payloadTonnes:   +(t.payload_kg / 1000).toFixed(1),
      cyclesThisShift: t.cyclesThisShift,
      tonnesThisShift: +t.tonnesThisShift.toFixed(1),
      loaderId:        null,
      destId:          t.zone?.code ?? null,
      isReal:          true as const,
      lastSeen_s:      staleness_s,
    };
  }

  /** Purge les engins perdus depuis > 5 minutes */
  purgeStale() {
    const cutoff = Date.now() - 5 * 60_000;
    this.trucks.forEach((t, fn) => {
      if (t.lastSeen < cutoff) this.trucks.delete(fn);
    });
  }

  /** Statistiques pour le monitoring */
  stats() {
    const now = Date.now();
    const alive = Array.from(this.trucks.values()).filter(t => now - t.lastSeen < REAL_TTL_MS);
    return {
      total: this.trucks.size,
      alive: alive.length,
      trucks: alive.map(t => ({
        fleetNumber: t.fleetNumber,
        phase:       t.phase,
        lastSeen_s:  Math.round((now - t.lastSeen) / 1000),
      })),
    };
  }
}

export const liveTelemetry = new LiveTelemetryService();

// Purge automatique toutes les 5 minutes
setInterval(() => liveTelemetry.purgeStale(), 5 * 60_000);
