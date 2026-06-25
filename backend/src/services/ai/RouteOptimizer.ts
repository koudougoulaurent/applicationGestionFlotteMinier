/**
 * RouteOptimizer.ts — Module 2 : Optimisation Dynamique des Routes
 * ============================================================
 * Implémente l'algorithme de Dijkstra sur le graphe des routes minières.
 *
 * Le graphe est construit depuis la table `core.haul_road` de la DB.
 * Chaque arc (route) a un poids calculé selon :
 *   - Distance (km)               → facteur principal
 *   - Gradient (pente)            → pénalité pour les camions chargés
 *   - État de la route            → dégradation si POOR ou FAIR
 *   - Congestion actuelle         → estimation du trafic en temps réel
 *
 * Exemple d'utilisation :
 *   const optimizer = new RouteOptimizer();
 *   await optimizer.buildGraph(siteId);
 *   const route = optimizer.findOptimalRoute(
 *     originLocationId,
 *     destLocationId,
 *     { loaded: true, weatherModifier: 1.2 }
 *   );
 * ============================================================
 */

import { query } from '../../config/database';

// ── Types ────────────────────────────────────────────────────────────────────

/** Un arc dans le graphe (= une route minière) */
interface GraphEdge {
  roadId:      string;
  toLocationId: string;
  distanceKm:  number;    // distance réelle
  gradient:    number;    // % de pente (positif = montée, négatif = descente)
  roadClass:   string;    // PRIMARY, SECONDARY, SERVICE
  speedLimit:  number;    // km/h
  weight:      number;    // poids calculé pour Dijkstra
}

/** Un sommet dans le graphe (= une location) */
interface GraphNode {
  locationId: string;
  lat:        number;
  lon:        number;
  name:       string;
  type:       string;
  edges:      GraphEdge[];
}

/** Résultat d'un calcul de route */
export interface RouteResult {
  found:      boolean;
  path:       Array<{ locationId: string; name: string; lat: number; lon: number }>;
  roadIds:    string[];
  totalDistanceKm:    number;
  estimatedMinutes:   number;
  totalCost:          number;    // coût pondéré (pour comparer des alternatives)
  breakdown: {
    distanceCost:   number;
    gradientCost:   number;
    conditionCost:  number;
    congestionCost: number;
  };
}

/** Options de calcul de route */
export interface RouteOptions {
  loaded?:          boolean;  // camion chargé → pénalité gradient plus forte
  weatherModifier?: number;   // multiplicateur météo (1.0 = normal, 1.2 = pluie)
  avoidRoadIds?:    string[]; // routes à éviter (fermées, conditions POOR)
}

// ── Facteurs de pondération ───────────────────────────────────────────────────
// Ces facteurs permettent d'ajuster l'importance relative de chaque critère.
// Ils peuvent être configurés par les opérateurs selon les priorités du site.

const WEIGHT = {
  // Coût de base : 1 unité par kilomètre
  DISTANCE_PER_KM: 1.0,

  // Pénalité gradient : chaque % de pente coûte X fois plus pour un camion chargé
  // Un camion de 190t chargé consomme ~3× plus en montée qu'à plat
  GRADIENT_LOADED:   0.15,   // 15% de coût supplémentaire par % de pente en montée
  GRADIENT_EMPTY:    0.05,   // 5% en montée à vide

  // Pénalité état de la route
  CONDITION_GOOD:   1.0,     // pas de pénalité
  CONDITION_FAIR:   1.20,    // +20% de temps (ralentissement prudence)
  CONDITION_POOR:   1.60,    // +60% (route dégradée, vitesse limitée)
  CONDITION_CLOSED: Infinity, // route fermée

  // Pénalité congestion (camions en file d'attente sur cette route)
  CONGESTION_PER_TRUCK: 0.05, // +5% par camion déjà sur la route
};

// ── Classe principale ─────────────────────────────────────────────────────────

export class RouteOptimizer {
  // Le graphe est chargé une fois en mémoire et mis à jour périodiquement
  private graph:      Map<string, GraphNode> = new Map();
  private siteId:     string = '';
  private lastBuild:  Date | null = null;

  /**
   * Construit le graphe de routes depuis la base de données.
   * À appeler au démarrage ou après une modification des routes.
   */
  async buildGraph(siteId: string): Promise<void> {
    this.siteId = siteId;
    this.graph.clear();

    // Charge tous les sommets (locations) du site
    const locations = await query(
      `SELECT location_id, name, location_type,
              COALESCE(latitude, 0) AS lat, COALESCE(longitude, 0) AS lon
       FROM core.location
       WHERE site_id = $1 AND active = TRUE`,
      [siteId]
    );

    for (const loc of locations.rows) {
      this.graph.set(loc.location_id, {
        locationId: loc.location_id,
        lat:        parseFloat(loc.lat),
        lon:        parseFloat(loc.lon),
        name:       loc.name,
        type:       loc.location_type,
        edges:      [],
      });
    }

    // Charge toutes les routes (arcs) du site
    const roads = await query(
      `SELECT hr.road_id, hr.start_location_id, hr.end_location_id,
              hr.distance_km, hr.avg_gradient, hr.road_class,
              hr.speed_limit_kmh, hr.active,
              -- Dernier état connu de la route
              rc.condition,
              -- Congestion actuelle : camions actifs sur cette route
              (SELECT COUNT(*) FROM operations.dispatch_assignment da
               WHERE da.road_id = hr.road_id
                 AND da.status IN ('IN_PROGRESS','ACKNOWLEDGED')) AS active_trucks
       FROM core.haul_road hr
       LEFT JOIN LATERAL (
           SELECT condition FROM core.road_condition
           WHERE road_id = hr.road_id
             AND resolved_at IS NULL
           ORDER BY reported_at DESC LIMIT 1
       ) rc ON TRUE
       WHERE hr.site_id = $1 AND hr.active = TRUE`,
      [siteId]
    );

    for (const road of roads.rows) {
      const from = this.graph.get(road.start_location_id);
      const to   = this.graph.get(road.end_location_id);

      if (!from || !to) continue;

      const weight = this.computeEdgeWeight(road);

      // Les routes minières sont bidirectionnelles (on peut circuler dans les deux sens)
      // Mais le poids diffère selon la direction (pente favorable ou défavorable)
      const edgeFwd: GraphEdge = {
        roadId:       road.road_id,
        toLocationId: road.end_location_id,
        distanceKm:   parseFloat(road.distance_km) || 1,
        gradient:     parseFloat(road.avg_gradient) || 0,
        roadClass:    road.road_class,
        speedLimit:   parseInt(road.speed_limit_kmh) || 40,
        weight,
      };

      const edgeBck: GraphEdge = {
        ...edgeFwd,
        toLocationId: road.start_location_id,
        gradient:     -(parseFloat(road.avg_gradient) || 0), // sens inverse → gradient inversé
        weight:       this.computeEdgeWeight({ ...road, avg_gradient: -(road.avg_gradient || 0) }),
      };

      from.edges.push(edgeFwd);
      to.edges.push(edgeBck);
    }

    this.lastBuild = new Date();
    console.log(
      `[ROUTE] Graphe construit — ${this.graph.size} sommets, ` +
      `${roads.rows.length} routes bidirectionnelles`
    );
  }

  /**
   * Calcule la route optimale entre deux locations.
   * Utilise l'algorithme de Dijkstra avec une file de priorité (min-heap simulée).
   *
   * Complexité : O((V + E) × log V) — efficace pour des graphes de taille minière
   * (typiquement < 100 sommets et < 200 arcs)
   */
  findOptimalRoute(
    originId:    string,
    destId:      string,
    options:     RouteOptions = {}
  ): RouteResult {
    const { loaded = false, weatherModifier = 1.0, avoidRoadIds = [] } = options;

    // Vérifie que les sommets existent dans le graphe
    if (!this.graph.has(originId) || !this.graph.has(destId)) {
      return this.noRoute();
    }

    // Si origine = destination, route triviale
    if (originId === destId) {
      const node = this.graph.get(originId)!;
      return {
        found:              true,
        path:               [{ locationId: originId, name: node.name, lat: node.lat, lon: node.lon }],
        roadIds:            [],
        totalDistanceKm:    0,
        estimatedMinutes:   0,
        totalCost:          0,
        breakdown:          { distanceCost: 0, gradientCost: 0, conditionCost: 0, congestionCost: 0 },
      };
    }

    // ── Algorithme de Dijkstra ─────────────────────────────
    // dist[id]   = coût minimal connu pour atteindre ce sommet depuis l'origine
    // prev[id]   = sommet précédent sur le chemin optimal
    // prevRoad[id] = route empruntée pour arriver à ce sommet
    const dist:     Map<string, number> = new Map();
    const prev:     Map<string, string> = new Map();
    const prevRoad: Map<string, string> = new Map();
    const visited:  Set<string>         = new Set();

    // Initialise toutes les distances à l'infini
    for (const id of this.graph.keys()) dist.set(id, Infinity);
    dist.set(originId, 0);

    // File de priorité : tableau trié par coût croissant
    // (suffisant pour des graphes miniers de taille réduite)
    const queue: Array<{ id: string; cost: number }> = [{ id: originId, cost: 0 }];

    while (queue.length > 0) {
      // Extrait le sommet non visité avec le plus petit coût
      queue.sort((a, b) => a.cost - b.cost);
      const { id: currentId } = queue.shift()!;

      if (visited.has(currentId)) continue;
      visited.add(currentId);

      if (currentId === destId) break; // destination atteinte

      const node = this.graph.get(currentId)!;

      for (const edge of node.edges) {
        // Ignore les routes exclues (fermées, conditions critiques)
        if (avoidRoadIds.includes(edge.roadId)) continue;

        // Calcule le coût de cet arc selon les options
        const edgeCost = this.adjustedEdgeWeight(edge, loaded, weatherModifier);
        const newCost  = dist.get(currentId)! + edgeCost;

        if (newCost < (dist.get(edge.toLocationId) ?? Infinity)) {
          dist.set(edge.toLocationId, newCost);
          prev.set(edge.toLocationId, currentId);
          prevRoad.set(edge.toLocationId, edge.roadId);
          queue.push({ id: edge.toLocationId, cost: newCost });
        }
      }
    }

    // Pas de chemin trouvé
    if (dist.get(destId) === Infinity) return this.noRoute();

    // ── Reconstruction du chemin ───────────────────────────
    const pathIds:  string[] = [];
    const roadIds:  string[] = [];
    let current = destId;

    while (current !== originId) {
      pathIds.unshift(current);
      const road = prevRoad.get(current);
      if (road) roadIds.unshift(road);
      current = prev.get(current)!;
    }
    pathIds.unshift(originId);

    // Calcule les métriques finales du trajet
    const pathNodes = pathIds.map(id => {
      const n = this.graph.get(id)!;
      return { locationId: id, name: n.name, lat: n.lat, lon: n.lon };
    });

    let totalDist = 0, gradientCost = 0, conditionCost = 0, congestionCost = 0;

    for (let i = 0; i < pathIds.length - 1; i++) {
      const fromNode = this.graph.get(pathIds[i])!;
      const edge = fromNode.edges.find(e => e.toLocationId === pathIds[i + 1]);
      if (!edge) continue;

      totalDist     += edge.distanceKm;
      gradientCost  += Math.max(0, edge.gradient) * edge.distanceKm *
                       (loaded ? WEIGHT.GRADIENT_LOADED : WEIGHT.GRADIENT_EMPTY);
      conditionCost += edge.weight - edge.distanceKm; // delta par rapport au cas GOOD
      congestionCost += 0; // connu au moment du buildGraph
    }

    // Vitesse effective = vitesse nominale * facteur météo
    const effectiveSpeedKmh = 30 * weatherModifier;
    const estimatedMinutes  = (totalDist / effectiveSpeedKmh) * 60;

    return {
      found:            true,
      path:             pathNodes,
      roadIds,
      totalDistanceKm:  +totalDist.toFixed(3),
      estimatedMinutes: +estimatedMinutes.toFixed(1),
      totalCost:        +(dist.get(destId)! * weatherModifier).toFixed(4),
      breakdown: {
        distanceCost:   +totalDist.toFixed(3),
        gradientCost:   +gradientCost.toFixed(3),
        conditionCost:  +conditionCost.toFixed(3),
        congestionCost: +congestionCost.toFixed(3),
      },
    };
  }

  /**
   * Calcule plusieurs routes alternatives et les classe par coût.
   * Utile pour présenter des options à l'opérateur dispatcher.
   */
  findAlternativeRoutes(
    originId: string,
    destId:   string,
    options:  RouteOptions = {}
  ): RouteResult[] {
    const routes: RouteResult[] = [];

    // Route principale (optimale)
    const main = this.findOptimalRoute(originId, destId, options);
    if (main.found) routes.push(main);

    // Route alternative sans les routes POOR
    const alt = this.findOptimalRoute(originId, destId, {
      ...options,
      avoidRoadIds: this.getPoorConditionRoadIds(),
    });
    if (alt.found && alt.roadIds.join() !== main.roadIds.join()) {
      routes.push(alt);
    }

    return routes;
  }

  /** Retourne les IDs des routes en mauvais état */
  private getPoorConditionRoadIds(): string[] {
    // TODO: requêter la DB pour les routes avec condition = 'POOR'
    // Pour l'instant, retourne un tableau vide (routes toutes disponibles)
    return [];
  }

  /** Calcule le poids d'un arc selon ses caractéristiques */
  private computeEdgeWeight(road: {
    distance_km: number;
    avg_gradient: number;
    condition?: string;
    active_trucks?: number;
    speed_limit_kmh?: number;
  }): number {
    const dist      = parseFloat(road.distance_km as unknown as string) || 1;
    const gradient  = parseFloat(road.avg_gradient as unknown as string) || 0;
    const condition = road.condition || 'GOOD';
    const trucks    = parseInt(road.active_trucks as unknown as string) || 0;

    // Coût distance de base
    let cost = dist * WEIGHT.DISTANCE_PER_KM;

    // Pénalité gradient (montée uniquement — la descente est gratuite)
    // On suppose camion chargé par défaut pour le graphe de base
    if (gradient > 0) {
      cost += gradient * dist * WEIGHT.GRADIENT_LOADED;
    }

    // Pénalité état de la route
    const conditionFactor = {
      'GOOD': WEIGHT.CONDITION_GOOD,
      'FAIR': WEIGHT.CONDITION_FAIR,
      'POOR': WEIGHT.CONDITION_POOR,
      'CLOSED': WEIGHT.CONDITION_CLOSED,
    }[condition] ?? WEIGHT.CONDITION_GOOD;

    cost *= conditionFactor;

    // Pénalité congestion
    cost += trucks * WEIGHT.CONGESTION_PER_TRUCK * dist;

    return cost;
  }

  /** Ajuste le poids d'un arc selon les options de calcul */
  private adjustedEdgeWeight(
    edge:            GraphEdge,
    loaded:          boolean,
    weatherModifier: number
  ): number {
    let cost = edge.distanceKm * WEIGHT.DISTANCE_PER_KM;

    // Gradient : plus pénalisant si le camion est chargé
    if (edge.gradient > 0) {
      const factor = loaded ? WEIGHT.GRADIENT_LOADED : WEIGHT.GRADIENT_EMPTY;
      cost += edge.gradient * edge.distanceKm * factor;
    }

    // Le poids de base intègre déjà les conditions et la congestion
    cost = edge.weight * weatherModifier;

    return cost;
  }

  /** Retourne un résultat "pas de route" */
  private noRoute(): RouteResult {
    return {
      found:            false,
      path:             [],
      roadIds:          [],
      totalDistanceKm:  0,
      estimatedMinutes: 0,
      totalCost:        0,
      breakdown:        { distanceCost: 0, gradientCost: 0, conditionCost: 0, congestionCost: 0 },
    };
  }

  /** Retourne l'état du graphe (pour debug / API) */
  getGraphStats() {
    let totalEdges = 0;
    const nodeList: Array<{ locationId: string; name: string; lat: number; lon: number }> = [];
    for (const [id, node] of this.graph.entries()) {
      totalEdges += node.edges.length;
      nodeList.push({ locationId: id, name: node.name, lat: node.lat, lon: node.lon });
    }
    return {
      nodes:     this.graph.size,
      edges:     totalEdges / 2,
      siteId:    this.siteId,
      lastBuild: this.lastBuild,
      nodeList,  // liste des locations utilisables comme origine/destination
    };
  }
}

// Instance singleton
export const routeOptimizer = new RouteOptimizer();
