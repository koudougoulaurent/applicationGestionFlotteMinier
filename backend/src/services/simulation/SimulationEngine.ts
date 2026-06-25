/**
 * SimulationEngine.ts — Module 5 : Moteur de Simulation FMS Mining
 * ============================================================
 * Simule le comportement complet de la flotte avant déploiement terrain.
 *
 * Chaque camion est une machine à états qui passe par les phases :
 *   IDLE → MOVING_TO_SOURCE → QUEUING → LOADING → HAULING → DUMPING → RETURNING → IDLE
 *
 * Le moteur :
 *   - S'exécute à 1 tick/seconde (configurable)
 *   - Supporte un multiplicateur de vitesse jusqu'à 20x
 *   - Génère des données GPS, télémétrie, cycles haul et carburant réalistes
 *   - Diffuse toutes les mises à jour via Socket.io (temps réel)
 *   - Persiste les cycles complets en base de données
 *
 * Usage :
 *   const engine = SimulationEngine.getInstance();
 *   engine.init(io);
 *   await engine.start(siteId, 5);  // démarrer à 5x
 *   engine.pause();
 *   engine.resume();
 *   await engine.stop();
 * ============================================================
 */

import { query } from '../../config/database';
import { Server as SocketServer } from 'socket.io';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Les 10 phases du cycle d'un camion minier.
 * Correspondance avec les statuts équipement dans la DB :
 *   IDLE              → AVAILABLE
 *   MOVING_TO_SOURCE  → OPERATING
 *   QUEUING_AT_SOURCE → QUEUING
 *   LOADING           → LOADING
 *   HAULING           → HAULING
 *   QUEUING_AT_DEST   → QUEUING
 *   DUMPING           → DUMPING
 *   RETURNING         → RETURNING
 *   REFUELING         → REFUELING
 *   DOWN              → DOWN
 */
type TruckPhase =
  | 'IDLE'
  | 'MOVING_TO_SOURCE'
  | 'QUEUING_AT_SOURCE'
  | 'LOADING'
  | 'HAULING'
  | 'QUEUING_AT_DEST'
  | 'DUMPING'
  | 'RETURNING'
  | 'REFUELING'
  | 'DOWN';

/** État complet d'un camion simulé en mémoire */
interface TruckState {
  // ── Identité ─────────────────────────────────────────────
  equipmentId:     string;
  fleetNumber:     string;
  siteId:          string;
  payloadCapacity: number;    // capacité nominale (tonnes)

  // ── Position GPS ─────────────────────────────────────────
  lat:      number;           // latitude actuelle (WGS84)
  lon:      number;           // longitude actuelle
  startLat: number;           // position au début de la phase courante
  startLon: number;           // (référence pour l'interpolation)
  heading:  number;           // cap en degrés (0°=Nord, 90°=Est…)
  speed_kmh: number;          // vitesse actuelle

  // ── Machine à états ───────────────────────────────────────
  phase:           TruckPhase;
  phaseProgress:   number;    // avancement dans la phase : 0.0 → 1.0
  phaseDuration_s: number;    // durée totale de la phase (secondes simulées)

  // ── Mission en cours ──────────────────────────────────────
  // Assignée lors du dispatch (pelle source → destination)
  sourceId?:    string;       // location_id de la pelle
  sourceLat?:   number;
  sourceLon?:   number;
  loaderId?:    string;       // equipment_id de la pelle
  destId?:      string;       // location_id du déversoir/concasseur
  destLat?:     number;
  destLon?:     number;
  materialId?:  string;
  shiftId?:     string;

  // ── Cycle haul en cours ───────────────────────────────────
  cycleId?:       string;
  cycleStart?:    Date;
  payloadTonnes?: number;     // charge actuelle (0 = vide)

  // Durées cumulées par phase (pour calcul des KPIs du cycle)
  queueAtSource_s: number;
  loading_s:       number;
  haul_s:          number;
  queueAtDest_s:   number;
  dump_s:          number;
  return_s:        number;

  // ── Consommables ──────────────────────────────────────────
  fuelLevel_pct: number;      // niveau carburant (%)

  // ── Santé / Maintenance ───────────────────────────────────
  engineHours:             number;  // heures moteur accumulées
  healthScore:             number;  // score de santé (0-100)
  breakdownCountThisShift: number;  // pannes ce poste

  // ── Statistiques du poste ─────────────────────────────────
  cyclesThisShift: number;
  tonnesThisShift: number;
}

/** Pelle/excavateur dans la simulation */
interface LoaderInfo {
  equipmentId: string;
  fleetNumber: string;
  locationId:  string;
  lat:         number;
  lon:         number;
  materialId?: string;
  queue:       number;   // nombre de camions actuellement en file
}

/** Destination (déversoir, concasseur, stockpile) */
interface DestInfo {
  locationId: string;
  name:       string;
  lat:        number;
  lon:        number;
}

// ── Durées réalistes par phase (secondes) ────────────────────────────────────
// Basé sur les benchmarks opérationnels d'une mine à ciel ouvert
// avec des camions CAT 793 (190t) et des pelles Komatsu PC7000

const PHASE_DURATION_S: Record<TruckPhase, number> = {
  IDLE:               0,    // Pas de durée — attend un dispatch
  MOVING_TO_SOURCE:   300,  // ~5 min (recalculé selon distance réelle)
  QUEUING_AT_SOURCE:  120,  // ~2 min d'attente moyenne
  LOADING:            210,  // ~3.5 min = 3 passes de pelle × 70 sec/passe
  HAULING:            480,  // ~8 min (recalculé selon distance réelle)
  QUEUING_AT_DEST:    60,   // ~1 min au déversoir
  DUMPING:            90,   // ~1.5 min pour déverser
  RETURNING:          360,  // ~6 min retour à vide (plus rapide car camion léger)
  REFUELING:          420,  // ~7 min pour faire le plein (4000 L à 600 L/min)
  DOWN:               1800, // ~30 min de panne minimum
};

// Consommation carburant par phase (litres/heure)
// Réservoir standard d'un CAT 793 : 4,732 L
const FUEL_LPH: Record<TruckPhase, number> = {
  IDLE:               8,    // moteur au ralenti
  MOVING_TO_SOURCE:   55,   // déplacement à vide
  QUEUING_AT_SOURCE:  12,   // attente moteur tournant
  LOADING:            35,   // manœuvres lentes
  HAULING:            85,   // pleine charge, souvent en montée
  QUEUING_AT_DEST:    12,   // attente
  DUMPING:            40,   // manœuvres de déversement
  RETURNING:          50,   // retour à vide (accélération possible)
  REFUELING:          8,    // moteur au ralenti
  DOWN:               0,    // moteur coupé
};

// Capacité réservoir supposée pour le calcul du %
const TANK_CAPACITY_L = 4732;

// ── Classe principale ─────────────────────────────────────────────────────────

export class SimulationEngine {
  private static instance: SimulationEngine;

  // Socket.io pour les broadcasts temps réel
  private io!: SocketServer;

  // État de la simulation
  private status: 'STOPPED' | 'RUNNING' | 'PAUSED' = 'STOPPED';
  private siteId:          string = '';
  private speedMultiplier: number = 1.0;
  private shiftId:         string | null = null;

  // Flotte en mémoire (performances > DB)
  private trucks:       Map<string, TruckState> = new Map();
  private loaders:      LoaderInfo[] = [];
  private destinations: DestInfo[]   = [];

  // Timer du tick principal
  private timer:        NodeJS.Timeout | null = null;
  private lastTickTime: number = 0;

  // Compteurs globaux
  private totalCycles: number = 0;
  private totalTonnes: number = 0;
  private startRealTime: Date | null = null;

  // Singleton — une seule instance par processus Node.js
  private constructor() {}

  static getInstance(): SimulationEngine {
    if (!SimulationEngine.instance) {
      SimulationEngine.instance = new SimulationEngine();
    }
    return SimulationEngine.instance;
  }

  /** Injecte l'instance Socket.io (appelé depuis server.ts après init) */
  init(io: SocketServer): void {
    this.io = io;
  }

  // ── API publique ──────────────────────────────────────────────────────────

  /** Démarre la simulation pour un site */
  async start(siteId: string, speedMultiplier = 1.0): Promise<void> {
    if (this.status === 'RUNNING') {
      throw new Error('La simulation est déjà en cours');
    }

    this.siteId          = siteId;
    this.speedMultiplier = Math.max(0.5, Math.min(20, speedMultiplier));
    this.totalCycles     = 0;
    this.totalTonnes     = 0;
    this.startRealTime   = new Date();

    await this.loadSiteData();

    this.status       = 'RUNNING';
    this.lastTickTime = Date.now();

    // Tick toutes les secondes (temps réel)
    this.timer = setInterval(() => { void this.tick(); }, 1000);

    await this.upsertSimState('RUNNING');
    this.broadcast('simulation:started', {
      siteId,
      speedMultiplier:  this.speedMultiplier,
      truckCount:       this.trucks.size,
      loaderCount:      this.loaders.length,
      destCount:        this.destinations.length,
    });

    console.log(
      `[SIM] ▶ site=${siteId} camions=${this.trucks.size} ` +
      `pelles=${this.loaders.length} vitesse=${this.speedMultiplier}x`
    );
  }

  /** Arrête la simulation et remet les camions en AVAILABLE */
  async stop(): Promise<void> {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.status = 'STOPPED';

    // Remet tous les camions simulés en AVAILABLE en DB
    for (const truck of this.trucks.values()) {
      await query(
        `UPDATE core.equipment SET status = 'AVAILABLE' WHERE equipment_id = $1`,
        [truck.equipmentId]
      ).catch(() => {});
    }
    this.trucks.clear();

    await this.upsertSimState('STOPPED');
    this.broadcast('simulation:stopped', {
      totalCycles: this.totalCycles,
      totalTonnes: Math.round(this.totalTonnes),
    });
    console.log(`[SIM] ■ Arrêté — ${this.totalCycles} cycles, ${this.totalTonnes.toFixed(0)} t`);
  }

  /** Suspend la simulation (état des camions conservé) */
  pause(): void {
    if (this.status !== 'RUNNING') return;
    this.status = 'PAUSED';
    this.broadcast('simulation:paused', {});
    console.log('[SIM] ⏸ En pause');
  }

  /** Reprend après une pause */
  resume(): void {
    if (this.status !== 'PAUSED') return;
    this.status       = 'RUNNING';
    this.lastTickTime = Date.now(); // évite un grand saut de temps simulé
    this.broadcast('simulation:resumed', {});
    console.log('[SIM] ▶ Reprise');
  }

  /** Change le multiplicateur de vitesse (0.5x – 20x) */
  setSpeed(multiplier: number): void {
    this.speedMultiplier = Math.max(0.5, Math.min(20, multiplier));
    this.broadcast('simulation:speed_changed', { speedMultiplier: this.speedMultiplier });
  }

  /** Retourne l'état courant de la simulation pour l'API */
  getStatus() {
    const uptime_s = this.startRealTime
      ? (Date.now() - this.startRealTime.getTime()) / 1000
      : 0;

    return {
      status:          this.status,
      siteId:          this.siteId,
      speedMultiplier: this.speedMultiplier,
      uptime_s:        Math.round(uptime_s),
      totalCycles:     this.totalCycles,
      totalTonnes:     Math.round(this.totalTonnes),
      truckCount:      this.trucks.size,
      loaderCount:     this.loaders.length,
      trucks: Array.from(this.trucks.values()).map(t => ({
        equipmentId:     t.equipmentId,
        fleetNumber:     t.fleetNumber,
        phase:           t.phase,
        status:          phaseToStatus(t.phase),
        lat:             +t.lat.toFixed(7),
        lon:             +t.lon.toFixed(7),
        heading:         Math.round(t.heading),
        speed_kmh:       Math.round(t.speed_kmh),
        phaseProgress:   Math.round(t.phaseProgress * 100),
        phaseDuration_s: Math.round(t.phaseDuration_s),
        fuelLevel_pct:   Math.round(t.fuelLevel_pct),
        healthScore:     Math.round(t.healthScore),
        payloadTonnes:   t.payloadTonnes ? +t.payloadTonnes.toFixed(1) : 0,
        cyclesThisShift: t.cyclesThisShift,
        tonnesThisShift: +t.tonnesThisShift.toFixed(1),
        loaderId:        t.loaderId,
        destId:          t.destId,
      })),
    };
  }

  // ── Chargement des données ────────────────────────────────────────────────

  /**
   * Charge depuis la DB les camions, pelles et destinations du site.
   * Si certaines données manquent (ex: pas de pelles assignées), crée
   * des entités virtuelles pour que la simulation puisse tout de même démarrer.
   */
  private async loadSiteData(): Promise<void> {
    // Poste actif (pour rattacher les cycles haul)
    const shiftRes = await query(
      `SELECT shift_id FROM core.shift WHERE site_id = $1 AND status = 'ACTIVE' LIMIT 1`,
      [this.siteId]
    );
    this.shiftId = shiftRes.rows[0]?.shift_id ?? null;

    // Centre géographique du site (pour les entités virtuelles)
    const siteRes = await query(
      `SELECT latitude, longitude FROM core.mine_site WHERE site_id = $1`,
      [this.siteId]
    );
    const center = {
      lat: parseFloat(siteRes.rows[0]?.latitude) || -12.500,
      lon: parseFloat(siteRes.rows[0]?.longitude) || 27.855,
    };

    // Réinitialise les camions opérationnels en AVAILABLE pour la simulation
    // (DOWN et MAINTENANCE restent dans leur état — ils sont hors service)
    await query(
      `UPDATE core.equipment e
       SET status = 'AVAILABLE'
       FROM core.equipment_type et
       WHERE e.type_id = et.type_id
         AND et.category = 'TRUCK'
         AND e.site_id = $1
         AND e.active = TRUE
         AND e.status NOT IN ('DOWN', 'MAINTENANCE', 'AVAILABLE', 'IDLE', 'STANDBY')`,
      [this.siteId]
    );

    // ── Camions disponibles (max 15 pour la simulation) ───────
    const truckRes = await query(
      `SELECT e.equipment_id, e.fleet_number, e.payload_capacity,
              COALESCE(e.latitude,  $2) AS lat,
              COALESCE(e.longitude, $3) AS lon,
              e.current_hours, e.health_score, e.fuel_capacity
       FROM core.equipment e
       JOIN core.equipment_type et ON e.type_id = et.type_id
       WHERE et.category = 'TRUCK'
         AND e.site_id = $1
         AND e.active = TRUE
         AND e.status IN ('AVAILABLE', 'IDLE', 'STANDBY')
       ORDER BY e.fleet_number
       LIMIT 15`,
      [this.siteId, center.lat, center.lon]
    );

    for (const row of truckRes.rows) {
      // Disperse les camions autour du centre (évite la superposition)
      const jitter = () => (Math.random() - 0.5) * 0.01;
      const lat = parseFloat(row.lat) + jitter();
      const lon = parseFloat(row.lon) + jitter();

      this.trucks.set(row.equipment_id, {
        equipmentId:     row.equipment_id,
        fleetNumber:     row.fleet_number,
        siteId:          this.siteId,
        payloadCapacity: parseFloat(row.payload_capacity) || 190,

        lat, lon,
        startLat: lat,
        startLon: lon,
        heading:  Math.random() * 360,
        speed_kmh: 0,

        phase:           'IDLE',
        phaseProgress:   0,
        phaseDuration_s: 0,

        fuelLevel_pct: 40 + Math.random() * 50,  // 40-90% au démarrage
        engineHours:   parseFloat(row.current_hours) || 0,
        healthScore:   parseFloat(row.health_score)  || 85,
        breakdownCountThisShift: 0,

        queueAtSource_s: 0, loading_s: 0, haul_s: 0,
        queueAtDest_s:   0, dump_s:    0, return_s: 0,

        cyclesThisShift: 0,
        tonnesThisShift: 0,
      });
    }

    // ── Pelles actives ────────────────────────────────────────
    const loaderRes = await query(
      `SELECT e.equipment_id, e.fleet_number,
              COALESCE(l.latitude,  $2) AS lat,
              COALESCE(l.longitude, $3) AS lon,
              l.location_id,
              m.material_id, m.name AS material_name
       FROM core.equipment e
       JOIN core.equipment_type et ON e.type_id = et.type_id
       LEFT JOIN core.location l ON e.current_location_id = l.location_id
       LEFT JOIN operations.production_plan pp
         ON pp.shift_id = $4 AND pp.source_location_id = l.location_id
       LEFT JOIN core.material m ON m.material_id = pp.material_id
       WHERE et.category IN ('EXCAVATOR', 'LOADER')
         AND e.site_id = $1 AND e.active = TRUE
       LIMIT 5`,
      [this.siteId, center.lat, center.lon, this.shiftId]
    );

    if (loaderRes.rows.length === 0) {
      // Aucune pelle en DB → crée deux pelles virtuelles dans la fosse
      this.loaders = [
        { equipmentId: 'virt-loader-1', fleetNumber: 'EX-001',
          locationId: 'virt-loc-1',
          lat: center.lat - 0.020, lon: center.lon - 0.015, queue: 0 },
        { equipmentId: 'virt-loader-2', fleetNumber: 'EX-002',
          locationId: 'virt-loc-2',
          lat: center.lat + 0.010, lon: center.lon + 0.020, queue: 0 },
      ];
    } else {
      this.loaders = loaderRes.rows.map(r => ({
        equipmentId:  r.equipment_id,
        fleetNumber:  r.fleet_number,
        locationId:   r.location_id ?? `virt-loc-${r.equipment_id}`,
        lat:          parseFloat(r.lat),
        lon:          parseFloat(r.lon),
        materialId:   r.material_id ?? undefined,
        materialName: r.material_name ?? undefined,
        queue:        0,
      }));
    }

    // ── Destinations (déversoirs, concasseurs, stockpiles) ────
    const destRes = await query(
      `SELECT location_id, name,
              COALESCE(latitude,  $2) AS lat,
              COALESCE(longitude, $3) AS lon
       FROM core.location
       WHERE site_id = $1
         AND location_type IN ('DUMP', 'CRUSHER', 'STOCKPILE')
         AND active = TRUE
       LIMIT 5`,
      [this.siteId, center.lat, center.lon]
    );

    if (destRes.rows.length === 0) {
      this.destinations = [
        { locationId: 'virt-dump-1', name: 'Déversoir Principal',
          lat: center.lat + 0.030, lon: center.lon - 0.025 },
        { locationId: 'virt-dump-2', name: 'Concasseur',
          lat: center.lat - 0.025, lon: center.lon + 0.030 },
      ];
    } else {
      this.destinations = destRes.rows.map(r => ({
        locationId: r.location_id,
        name:       r.name,
        lat:        parseFloat(r.lat),
        lon:        parseFloat(r.lon),
      }));
    }

    console.log(
      `[SIM] Données chargées — ${this.trucks.size} camions, ` +
      `${this.loaders.length} pelles, ${this.destinations.length} destinations`
    );
  }

  // ── Tick principal ────────────────────────────────────────────────────────

  /**
   * Cœur de la simulation — exécuté toutes les secondes.
   * Fait avancer chaque camion de (elapsed_réel × speed) secondes simulées.
   */
  private async tick(): Promise<void> {
    if (this.status !== 'RUNNING') return;

    const now         = Date.now();
    const realElapsed = (now - this.lastTickTime) / 1000;  // secondes réelles
    const simElapsed  = realElapsed * this.speedMultiplier; // secondes simulées
    this.lastTickTime = now;

    // Plafond de sécurité : jamais plus de 60 s simulées par tick
    // (évite les sauts d'état si le timer est retardé par le GC ou l'I/O)
    const dt = Math.min(simElapsed, 60);

    const gpsUpdates: Array<{
      equipment_id: string; fleet_number: string;
      latitude: number; longitude: number;
      speed_kmh: number; heading: number;
      status: string; payload_tonnes: number;
      fuel_level_pct: number;
    }> = [];

    // Avance tous les camions
    for (const truck of this.trucks.values()) {
      await this.advanceTruck(truck, dt);

      gpsUpdates.push({
        equipment_id:  truck.equipmentId,
        fleet_number:  truck.fleetNumber,
        latitude:      +truck.lat.toFixed(7),
        longitude:     +truck.lon.toFixed(7),
        speed_kmh:     Math.round(truck.speed_kmh),
        heading:       Math.round(truck.heading),
        status:        phaseToStatus(truck.phase),
        payload_tonnes: truck.payloadTonnes ?? 0,
        fuel_level_pct: Math.round(truck.fuelLevel_pct),
      });
    }

    // Diffuse les positions GPS à tous les clients du site
    if (gpsUpdates.length > 0) {
      this.io.to(`site:${this.siteId}`).emit('gps:update', gpsUpdates);
    }

    // Persiste en DB environ 1 fois toutes les 5 secondes réelles
    if (Math.random() < 0.2) {
      await this.persistPositions(gpsUpdates).catch(() => {});
    }
  }

  // ── Machine à états ───────────────────────────────────────────────────────

  /** Fait avancer un camion de dt secondes simulées */
  private async advanceTruck(truck: TruckState, dt: number): Promise<void> {
    // IDLE : tente d'obtenir un dispatch
    if (truck.phase === 'IDLE') {
      await this.tryDispatch(truck);
      return;
    }

    // DOWN : attend la fin de la réparation
    if (truck.phase === 'DOWN') {
      truck.phaseProgress += dt / truck.phaseDuration_s;
      if (truck.phaseProgress >= 1.0) {
        truck.healthScore = Math.min(100, truck.healthScore + 20);
        await this.transitionTo(truck, 'IDLE');
      }
      return;
    }

    // Avance dans la phase courante
    truck.phaseProgress += dt / truck.phaseDuration_s;

    // Cumule les durées par phase (pour les KPIs du cycle)
    this.accumulateDuration(truck, dt);

    // Mise à jour de la position GPS
    this.updatePosition(truck);

    // Consommation carburant :
    // litres consommés = LPH / 3600 × dt_secondes → % = litres / TANK × 100
    const liters = (FUEL_LPH[truck.phase] / 3600) * dt;
    truck.fuelLevel_pct -= (liters / TANK_CAPACITY_L) * 100;
    truck.fuelLevel_pct  = Math.max(0, truck.fuelLevel_pct);

    // Heures moteur (sauf DOWN)
    truck.engineHours += dt / 3600;

    // Dégradation légère de la santé avec l'usage
    // (très rare par tick : ~1 point perdu toutes les 2000 heures simulées)
    if (Math.random() < 0.0001 * dt) {
      truck.healthScore = Math.max(0, truck.healthScore - 0.5);
    }

    // Risque de panne : plus le camion est en mauvais état, plus le risque est élevé
    // Probabilité de base = 0.01% par heure simulée × coefficient de santé
    const breakdownProb = ((100 - truck.healthScore) / 100) * 0.0001 * dt;
    if (Math.random() < breakdownProb) {
      await this.triggerBreakdown(truck);
      return;
    }

    // Carburant critique → ravitaillement dès le retour
    if (truck.fuelLevel_pct < 8 && truck.phase === 'RETURNING') {
      await this.transitionTo(truck, 'REFUELING');
      return;
    }

    // Phase terminée → transition
    if (truck.phaseProgress >= 1.0) {
      await this.handlePhaseComplete(truck);
    }
  }

  /** Accumule la durée dans le bon compteur selon la phase */
  private accumulateDuration(truck: TruckState, dt: number): void {
    switch (truck.phase) {
      case 'QUEUING_AT_SOURCE': truck.queueAtSource_s += dt; break;
      case 'LOADING':           truck.loading_s       += dt; break;
      case 'HAULING':           truck.haul_s          += dt; break;
      case 'QUEUING_AT_DEST':   truck.queueAtDest_s   += dt; break;
      case 'DUMPING':           truck.dump_s          += dt; break;
      case 'RETURNING':         truck.return_s        += dt; break;
    }
  }

  /** Gère la fin d'une phase et enchaîne la suivante */
  private async handlePhaseComplete(truck: TruckState): Promise<void> {
    switch (truck.phase) {

      case 'MOVING_TO_SOURCE':
        // Arrivé à la pelle : se mettre en file
        truck.lat = truck.sourceLat!;
        truck.lon = truck.sourceLon!;
        await this.transitionTo(truck, 'QUEUING_AT_SOURCE');
        break;

      case 'QUEUING_AT_SOURCE':
        // File écoulée → début du chargement
        await this.transitionTo(truck, 'LOADING');
        break;

      case 'LOADING':
        // Chargement terminé : payload = 80-105% de la capacité nominale
        // (légère surcharge possible, comme en réalité)
        truck.payloadTonnes = truck.payloadCapacity * (0.80 + Math.random() * 0.25);
        truck.lat           = truck.sourceLat!;
        truck.lon           = truck.sourceLon!;
        await this.transitionTo(truck, 'HAULING');
        break;

      case 'HAULING':
        // Arrivé au déversoir
        truck.lat = truck.destLat!;
        truck.lon = truck.destLon!;
        await this.transitionTo(truck, 'QUEUING_AT_DEST');
        break;

      case 'QUEUING_AT_DEST':
        await this.transitionTo(truck, 'DUMPING');
        break;

      case 'DUMPING': {
        // Déversement terminé → enregistre le cycle en DB
        const tonnes        = truck.payloadTonnes ?? 0;
        truck.payloadTonnes = 0;
        truck.cyclesThisShift++;
        truck.tonnesThisShift += tonnes;
        this.totalCycles++;
        this.totalTonnes += tonnes;

        await this.saveCycle(truck, tonnes);

        truck.lat = truck.destLat!;
        truck.lon = truck.destLon!;

        // Notifie les clients d'un nouveau cycle terminé
        this.io.to(`site:${this.siteId}`).emit('production:cycle_complete', {
          equipment_id:   truck.equipmentId,
          fleet_number:   truck.fleetNumber,
          payload_tonnes: +tonnes.toFixed(1),
          total_cycles:   this.totalCycles,
          total_tonnes:   +this.totalTonnes.toFixed(0),
        });

        await this.transitionTo(truck, 'RETURNING');
        break;
      }

      case 'RETURNING':
        // Retour terminé → disponible pour le prochain dispatch
        truck.lat = truck.sourceLat!;
        truck.lon = truck.sourceLon!;
        await query(
          `UPDATE core.equipment SET status = 'AVAILABLE' WHERE equipment_id = $1`,
          [truck.equipmentId]
        ).catch(() => {});
        await this.transitionTo(truck, 'IDLE');
        break;

      case 'REFUELING':
        // Plein terminé
        truck.fuelLevel_pct = 90 + Math.random() * 5;
        await this.saveFuelTransaction(truck);
        await this.transitionTo(truck, 'IDLE');
        break;
    }
  }

  /** Transition vers un nouvel état de la machine */
  private async transitionTo(truck: TruckState, newPhase: TruckPhase): Promise<void> {
    const oldPhase = truck.phase;
    truck.phase         = newPhase;
    truck.phaseProgress = 0;
    truck.startLat      = truck.lat;
    truck.startLon      = truck.lon;

    // Durée de base avec ±20% de variation (réalisme)
    const base      = PHASE_DURATION_S[newPhase];
    const variation = 0.8 + Math.random() * 0.4;
    truck.phaseDuration_s = Math.max(10, base * variation);

    // Durées calculées selon la distance réelle pour les phases de déplacement
    if (newPhase === 'MOVING_TO_SOURCE' && truck.sourceLat != null) {
      const km = haversineKm(truck.lat, truck.lon, truck.sourceLat, truck.sourceLon!);
      // 30 km/h moyen à vide sur routes minières
      truck.phaseDuration_s = Math.max(30, (km / 30) * 3600);
    }
    if (newPhase === 'HAULING' && truck.destLat != null) {
      const km = haversineKm(truck.lat, truck.lon, truck.destLat!, truck.destLon!);
      // 25 km/h chargé (plus lent, souvent en montée)
      truck.phaseDuration_s = Math.max(30, (km / 25) * 3600);
    }
    if (newPhase === 'RETURNING' && truck.sourceLat != null) {
      const km = haversineKm(truck.lat, truck.lon, truck.sourceLat!, truck.sourceLon!);
      // 35 km/h à vide (plus rapide)
      truck.phaseDuration_s = Math.max(30, (km / 35) * 3600);
    }

    // Met à jour le statut en DB
    const dbStatus = phaseToStatus(newPhase);
    await query(
      `UPDATE core.equipment SET status = $1 WHERE equipment_id = $2`,
      [dbStatus, truck.equipmentId]
    ).catch(() => {});

    // Journal de simulation
    await query(
      `INSERT INTO simulation.event_log
         (site_id, event_type, equipment_id, fleet_number, payload)
       VALUES ($1, 'PHASE_CHANGE', $2, $3, $4)`,
      [this.siteId, truck.equipmentId, truck.fleetNumber,
       JSON.stringify({ from: oldPhase, to: newPhase,
                        duration_s: Math.round(truck.phaseDuration_s) })]
    ).catch(() => {});

    // Notification temps réel
    this.io.to(`site:${this.siteId}`).emit('truck:phase_change', {
      equipment_id: truck.equipmentId,
      fleet_number: truck.fleetNumber,
      phase:        newPhase,
      status:       dbStatus,
      timestamp:    new Date().toISOString(),
    });
  }

  // ── Dispatch et affectation ───────────────────────────────────────────────

  /**
   * Affecte un camion IDLE à la pelle la moins chargée.
   * Stratégie simple mais efficace : round-robin par file.
   */
  private async tryDispatch(truck: TruckState): Promise<void> {
    if (!this.loaders.length || !this.destinations.length) return;

    // Pelle avec la plus petite file d'attente (load balancing)
    const loader = [...this.loaders].sort((a, b) => a.queue - b.queue)[0];
    const dest   = this.destinations[Math.floor(Math.random() * this.destinations.length)];

    truck.sourceId  = loader.locationId;
    truck.sourceLat = loader.lat;
    truck.sourceLon = loader.lon;
    truck.loaderId  = loader.equipmentId;
    truck.destId    = dest.locationId;
    truck.destLat   = dest.lat;
    truck.destLon   = dest.lon;
    truck.shiftId   = this.shiftId ?? undefined;

    // Réinitialise les durées du cycle
    truck.queueAtSource_s = 0;
    truck.loading_s       = 0;
    truck.haul_s          = 0;
    truck.queueAtDest_s   = 0;
    truck.dump_s          = 0;
    truck.return_s        = 0;

    // Crée le cycle haul en DB (sera complété à la fin)
    truck.cycleId    = await this.createCycleRecord(truck, loader, dest);
    truck.cycleStart = new Date();

    loader.queue++;  // incrémente la file de la pelle

    await this.transitionTo(truck, 'MOVING_TO_SOURCE');
  }

  /** Simule une panne sur un camion */
  private async triggerBreakdown(truck: TruckState): Promise<void> {
    truck.breakdownCountThisShift++;
    truck.healthScore     = Math.max(20, truck.healthScore - 15);
    truck.phase           = 'DOWN';
    truck.phaseProgress   = 0;
    truck.speed_kmh       = 0;
    truck.startLat        = truck.lat;
    truck.startLon        = truck.lon;
    // Durée de réparation : 20-50 minutes simulées
    truck.phaseDuration_s = 1200 + Math.random() * 1800;

    await query(
      `UPDATE core.equipment SET status = 'DOWN' WHERE equipment_id = $1`,
      [truck.equipmentId]
    ).catch(() => {});

    await query(
      `INSERT INTO operations.alarm
         (equipment_id, site_id, alarm_code, alarm_type, severity, message)
       VALUES ($1, $2, 'SIM_BREAKDOWN', 'MECHANICAL', 'CRITICAL', $3)`,
      [truck.equipmentId, this.siteId,
       `[SIM] Panne simulée — ${truck.fleetNumber} (santé ${Math.round(truck.healthScore)}%)`]
    ).catch(() => {});

    this.io.to(`site:${this.siteId}`).emit('truck:breakdown', {
      equipment_id:       truck.equipmentId,
      fleet_number:       truck.fleetNumber,
      health_score:       Math.round(truck.healthScore),
      repair_duration_min: Math.round(truck.phaseDuration_s / 60),
      timestamp:          new Date().toISOString(),
    });

    console.log(`[SIM] ⚠ Panne : ${truck.fleetNumber} (${Math.round(truck.phaseDuration_s/60)} min)`);
  }

  // ── Positionnement GPS ────────────────────────────────────────────────────

  /**
   * Met à jour la position GPS du camion selon sa phase.
   * - Phases de déplacement : interpolation linéaire vers la destination
   * - Phases statiques (chargement, déversement) : légères vibrations
   * - Phases d'attente : immobile
   */
  private updatePosition(truck: TruckState): void {
    const p = Math.min(truck.phaseProgress, 1.0);

    switch (truck.phase) {
      case 'MOVING_TO_SOURCE':
        // Déplacement à vide vers la pelle
        truck.lat       = lerp(truck.startLat, truck.sourceLat!, p);
        truck.lon       = lerp(truck.startLon, truck.sourceLon!, p);
        truck.speed_kmh = 30 + Math.random() * 15;
        truck.heading   = bearing(truck.lat, truck.lon, truck.sourceLat!, truck.sourceLon!);
        break;

      case 'HAULING':
        // Déplacement chargé vers le déversoir (plus lent)
        truck.lat       = lerp(truck.startLat, truck.destLat!, p);
        truck.lon       = lerp(truck.startLon, truck.destLon!, p);
        truck.speed_kmh = 20 + Math.random() * 10;
        truck.heading   = bearing(truck.lat, truck.lon, truck.destLat!, truck.destLon!);
        break;

      case 'RETURNING':
        // Retour à vide (plus rapide)
        truck.lat       = lerp(truck.startLat, truck.sourceLat!, p);
        truck.lon       = lerp(truck.startLon, truck.sourceLon!, p);
        truck.speed_kmh = 35 + Math.random() * 15;
        truck.heading   = bearing(truck.lat, truck.lon, truck.sourceLat!, truck.sourceLon!);
        break;

      case 'LOADING':
      case 'DUMPING':
        // Manœuvres lentes avec vibrations (réaliste)
        truck.lat      += (Math.random() - 0.5) * 0.000015;
        truck.lon      += (Math.random() - 0.5) * 0.000015;
        truck.speed_kmh = 2 + Math.random() * 3;
        truck.heading   = (truck.heading + (Math.random() - 0.5) * 20 + 360) % 360;
        break;

      default:
        // IDLE, QUEUING, REFUELING, DOWN → arrêt
        truck.speed_kmh = 0;
        break;
    }
  }

  // ── Persistance en base de données ───────────────────────────────────────

  /** Crée un enregistrement de cycle haul au début du dispatch */
  private async createCycleRecord(
    truck: TruckState,
    loader: LoaderInfo,
    dest: DestInfo
  ): Promise<string | undefined> {
    const isVirtual = (id: string) => id.startsWith('virt-');

    const res = await query(
      `INSERT INTO operations.haul_cycle
         (site_id, shift_id, truck_id, loader_id, material_id,
          source_location_id, dest_location_id, cycle_start, data_quality)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), 'GOOD')
       RETURNING cycle_id`,
      [
        this.siteId,
        this.shiftId,
        truck.equipmentId,
        isVirtual(loader.equipmentId) ? null : loader.equipmentId,
        loader.materialId ?? null,
        isVirtual(loader.locationId)  ? null : loader.locationId,
        isVirtual(dest.locationId)    ? null : dest.locationId,
      ]
    ).catch(() => ({ rows: [] as { cycle_id: string }[] }));

    return res.rows[0]?.cycle_id;
  }

  /** Met à jour le cycle avec les durées et le payload final */
  private async saveCycle(truck: TruckState, tonnes: number): Promise<void> {
    if (!truck.cycleId) return;

    const total = truck.queueAtSource_s + truck.loading_s + truck.haul_s +
                  truck.queueAtDest_s   + truck.dump_s    + truck.return_s;

    // Carburant estimé : ~150 L pour un cycle type d'un CAT 793
    const fuel = 100 + Math.random() * 100;

    await query(
      `UPDATE operations.haul_cycle
       SET cycle_end          = NOW(),
           total_duration_s   = $1,
           queue_duration_s   = $2,
           loading_duration_s = $3,
           haul_duration_s    = $4,
           dump_duration_s    = $5,
           return_duration_s  = $6,
           payload_tonnes     = $7,
           target_payload     = $8,
           payload_factor     = $9,
           fuel_consumed_l    = $10,
           overloaded         = $11
       WHERE cycle_id = $12`,
      [
        Math.round(total),
        Math.round(truck.queueAtSource_s),
        Math.round(truck.loading_s),
        Math.round(truck.haul_s),
        Math.round(truck.dump_s),
        Math.round(truck.return_s),
        +tonnes.toFixed(2),
        truck.payloadCapacity,
        +(tonnes / truck.payloadCapacity).toFixed(3),
        +fuel.toFixed(1),
        tonnes > truck.payloadCapacity * 1.1,
        truck.cycleId,
      ]
    ).catch(() => {});

    // Met à jour les heures moteur de l'équipement
    await query(
      `UPDATE core.equipment
       SET current_hours = $1, health_score = $2
       WHERE equipment_id = $3`,
      [+truck.engineHours.toFixed(1), Math.round(truck.healthScore), truck.equipmentId]
    ).catch(() => {});
  }

  /** Enregistre une transaction de ravitaillement carburant */
  private async saveFuelTransaction(truck: TruckState): Promise<void> {
    // Quantité ravitaillée = de 10% restant à 90% → environ 80% du réservoir
    const qty = Math.round(TANK_CAPACITY_L * 0.80 * (1 + (Math.random() - 0.5) * 0.2));
    await query(
      `INSERT INTO fuel.fuel_transaction
         (equipment_id, transaction_time, quantity_liters,
          fuel_type, unit_cost, total_cost, engine_hours)
       VALUES ($1, NOW(), $2, 'DIESEL', 1.45, $3, $4)`,
      [truck.equipmentId, qty, +(qty * 1.45).toFixed(2), +truck.engineHours.toFixed(1)]
    ).catch(() => {});
  }

  /** Persiste les positions GPS en base */
  private async persistPositions(updates: Array<{
    equipment_id: string; latitude: number; longitude: number;
    speed_kmh: number; heading: number; status: string; payload_tonnes: number;
  }>): Promise<void> {
    for (const u of updates) {
      await query(
        `INSERT INTO operations.equipment_position
           (equipment_id, position_time, latitude, longitude,
            speed_kmh, heading, status_code, payload_tonnes,
            geom, engine_on)
         VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7,
                 ST_SetSRID(ST_MakePoint($3, $2), 4326), TRUE)`,
        [u.equipment_id, u.latitude, u.longitude,
         u.speed_kmh, u.heading, u.status, u.payload_tonnes]
      ).catch(() => {});
    }
  }

  /** Met à jour l'état de simulation en base (table simulation.state) */
  private async upsertSimState(status: string): Promise<void> {
    await query(
      `INSERT INTO simulation.state
         (site_id, status, speed_multiplier, real_start_time, total_cycles, total_tonnes)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (site_id) DO UPDATE
         SET status = $2, speed_multiplier = $3, total_cycles = $5,
             total_tonnes = $6, updated_at = NOW()`,
      [this.siteId, status, this.speedMultiplier,
       this.startRealTime, this.totalCycles, Math.round(this.totalTonnes)]
    ).catch(() => {});
  }

  /** Diffuse un événement Socket.io à tous les clients du site */
  private broadcast(event: string, data: object): void {
    if (this.io) {
      this.io.to(`site:${this.siteId}`).emit(event, data);
    }
  }
}

// ── Fonctions utilitaires pures ───────────────────────────────────────────────

/** Mappe une phase de simulation sur un statut équipement de la DB */
function phaseToStatus(phase: TruckPhase): string {
  const map: Record<TruckPhase, string> = {
    IDLE:               'AVAILABLE',
    MOVING_TO_SOURCE:   'OPERATING',
    QUEUING_AT_SOURCE:  'QUEUING',
    LOADING:            'LOADING',
    HAULING:            'HAULING',
    QUEUING_AT_DEST:    'QUEUING',
    DUMPING:            'DUMPING',
    RETURNING:          'RETURNING',
    REFUELING:          'REFUELING',
    DOWN:               'DOWN',
  };
  return map[phase] ?? 'STANDBY';
}

/**
 * Distance entre deux coordonnées GPS en kilomètres (formule de Haversine).
 * Précision < 0.5% pour des distances < 500 km.
 */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Interpolation linéaire : retourne a + (b−a)×t, clampé entre a et b */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

/**
 * Cap entre deux points GPS en degrés (0=Nord, 90=Est, 180=Sud, 270=Ouest).
 * Utilisé pour orienter le camion dans sa direction de déplacement.
 */
function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon  = (lon2 - lon1) * Math.PI / 180;
  const lat1r = lat1 * Math.PI / 180;
  const lat2r = lat2 * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2r);
  const x = Math.cos(lat1r) * Math.sin(lat2r) -
            Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

// Instance singleton exportée
export const simulationEngine = SimulationEngine.getInstance();
