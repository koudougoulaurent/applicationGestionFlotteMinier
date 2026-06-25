-- ============================================================
-- FMS MINING — EXTENSION SIMULATION & INTELLIGENCE ARTIFICIELLE
-- ============================================================
-- Ce fichier crée les tables nécessaires aux 5 modules du projet :
--   Module 1 : Capteurs géophysiques numériques (BNR)
--   Module 2 : Optimisation dynamique des routes (IA)
--   Module 3 : Dispatch intelligent (algorithme d'optimisation)
--   Module 4 : Maintenance prédictive (scoring ML)
--   Module 5 : Moteur de simulation complet
--
-- Prérequis : scripts 01 à 07 déjà exécutés
-- ============================================================

-- ── Schémas ───────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS simulation;
CREATE SCHEMA IF NOT EXISTS sensors;
CREATE SCHEMA IF NOT EXISTS ai;

-- ============================================================
-- MODULE 5 : MOTEUR DE SIMULATION
-- ============================================================

-- Scénarios de simulation prédéfinis (ex: poste normal, météo dégradée, panne moteur…)
CREATE TABLE simulation.scenario (
    scenario_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id          UUID REFERENCES core.mine_site(site_id),
    name             VARCHAR(100) NOT NULL,
    description      TEXT,

    -- Configuration de la flotte simulée
    truck_count      INTEGER DEFAULT 8,      -- nombre de camions actifs
    loader_count     INTEGER DEFAULT 2,      -- nombre de pelles actives

    -- Conditions environnementales simulées
    -- NORMAL : conditions standard, pas de perturbation
    -- RAIN   : sol glissant → vitesse réduite de 20%, consommation +10%
    -- DUST   : visibilité réduite → vitesse réduite de 15%
    -- FOG    : visibilité très réduite → vitesse réduite de 30%
    weather_preset   VARCHAR(20) DEFAULT 'NORMAL',

    -- Événements programmés à déclencher pendant la simulation
    -- Format JSON : [{"type": "breakdown", "fleet": "T-101", "at_minute": 30}]
    -- Types d'événements : breakdown, fuel_leak, road_closure, blast_clearance
    events_json      JSONB DEFAULT '[]',

    created_by       UUID,
    created_at       TIMESTAMP DEFAULT NOW()
);

-- État courant de la simulation (une ligne par site)
CREATE TABLE simulation.state (
    state_id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id          UUID UNIQUE REFERENCES core.mine_site(site_id),
    scenario_id      UUID REFERENCES simulation.scenario(scenario_id),

    -- STOPPED : simulation arrêtée
    -- RUNNING : simulation en cours
    -- PAUSED  : simulation suspendue (état des camions conservé)
    status           VARCHAR(20) DEFAULT 'STOPPED',

    -- Multiplicateur de vitesse : 1x = temps réel, 5x = 5× plus rapide
    speed_multiplier NUMERIC(5,2) DEFAULT 1.0,

    -- Compteurs cumulés depuis le démarrage
    total_cycles     INTEGER DEFAULT 0,
    total_tonnes     NUMERIC(15,2) DEFAULT 0,
    real_start_time  TIMESTAMP,              -- heure réelle de démarrage
    updated_at       TIMESTAMP DEFAULT NOW()
);

-- Journal chronologique des événements de simulation (pour replay et analyse)
CREATE TABLE simulation.event_log (
    log_id           BIGSERIAL PRIMARY KEY,
    site_id          UUID,
    recorded_at      TIMESTAMP DEFAULT NOW(),

    -- Type d'événement : PHASE_CHANGE, CYCLE_COMPLETE, BREAKDOWN, FUEL_LOW,
    --                    DISPATCH_ASSIGNED, REFUELING, DOWN_REPAIRED
    event_type       VARCHAR(50) NOT NULL,

    equipment_id     UUID,
    fleet_number     VARCHAR(30),

    -- Données spécifiques à l'événement (flexible selon le type)
    -- Ex: {"from": "IDLE", "to": "MOVING_TO_SOURCE", "duration_s": 312}
    payload          JSONB
);

-- Index pour requêtes d'analyse sur le journal
CREATE INDEX idx_sim_event_log_site_time ON simulation.event_log(site_id, recorded_at DESC);
CREATE INDEX idx_sim_event_log_equipment  ON simulation.event_log(equipment_id, recorded_at DESC);

-- Scénario par défaut pour chaque site
INSERT INTO simulation.scenario (name, description, truck_count, loader_count, weather_preset, events_json)
VALUES
(
    'Poste standard — Conditions normales',
    'Simulation d''un poste de 8 heures avec 8 camions et 2 pelles, conditions météo normales.',
    8, 2, 'NORMAL', '[]'
),
(
    'Poste dégradé — Pluie + pannes aléatoires',
    'Simule les effets d''une pluie modérée et introduit 2 pannes programmées.',
    6, 2, 'RAIN',
    '[{"type": "breakdown", "fleet_index": 0, "at_minute": 45},
      {"type": "breakdown", "fleet_index": 2, "at_minute": 90}]'
),
(
    'Test de charge maximale',
    'Simulation avec la flotte complète (15 camions, 4 pelles) pour tester les performances.',
    15, 4, 'NORMAL', '[]'
);


-- ============================================================
-- MODULE 1 : CAPTEURS GÉOPHYSIQUES NUMÉRIQUES (BNR)
-- ============================================================
-- BNR = Borehole Numerical Recording
-- Capteurs installés dans des forages pour mesurer la stabilité
-- du terrain, les vibrations et l'activité sismique.

-- Stations de capteurs BNR déployées sur le site minier
CREATE TABLE sensors.bnr_station (
    station_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id          UUID REFERENCES core.mine_site(site_id),
    name             VARCHAR(100) NOT NULL,
    code             VARCHAR(20) UNIQUE NOT NULL,
    location_id      UUID REFERENCES core.location(location_id),
    latitude         NUMERIC(10,7),
    longitude        NUMERIC(10,7),

    -- Profondeur de forage où le capteur est installé
    depth_m          NUMERIC(8,2),

    -- Type de capteur installé
    -- FULL          : mesure toutes les métriques (vibration, stabilité, humidité, résistivité)
    -- SEISMIC_ONLY  : vibrations et activité sismique uniquement
    -- STABILITY     : stabilité du terrain uniquement
    sensor_type      VARCHAR(20) DEFAULT 'FULL',

    active           BOOLEAN DEFAULT TRUE,
    installed_at     TIMESTAMP DEFAULT NOW()
);

-- Lectures des capteurs BNR (flux de données en temps quasi-réel)
-- Partitionnée par mois pour les hauts volumes de données
CREATE TABLE sensors.bnr_reading (
    reading_id       BIGSERIAL,
    station_id       UUID NOT NULL REFERENCES sensors.bnr_station(station_id),
    recorded_at      TIMESTAMP NOT NULL DEFAULT NOW(),

    -- INDICE DE STABILITÉ (0-100) : mesure la cohésion du terrain
    --   > 80 : stable — conditions normales de travail
    --   60-80 : instabilité légère — surveiller
    --   40-60 : instabilité modérée — réduire la vitesse des engins
    --   < 40  : CRITIQUE — évacuation préventive recommandée
    stability_index  NUMERIC(5,2) CHECK (stability_index BETWEEN 0 AND 100),

    -- VIBRATIONS (mm/s) : mesure les vibrations du sol
    --   < 2 mm/s   : normal (circulation routière)
    --   2-5 mm/s   : attention (tir de mines proche)
    --   > 5 mm/s   : ALERTE (risque de déstabilisation)
    --   > 10 mm/s  : DANGER — arrêt immédiat de l'activité
    vibration_mms    NUMERIC(8,3),

    -- DÉFORMATION (mm) : affaissement ou soulèvement du terrain
    --   < 5 mm/jour : normal
    --   5-20 mm/jour : surveillance renforcée
    --   > 20 mm/jour : ALERTE — risque d'effondrement
    deformation_mm   NUMERIC(8,2),

    -- HUMIDITÉ DU SOL (%) : saturation en eau
    --   > 80% : terrain saturé → risque de glissement
    moisture_pct     NUMERIC(5,2),

    -- ACTIVITÉ SISMIQUE (proxy de magnitude locale)
    --   < 0.5 : activité résiduelle normale
    --   0.5-1.5 : micro-séisme lié aux tirs
    --   > 1.5 : événement sismique à investiguer
    seismic_activity NUMERIC(5,3),

    -- RÉSISTIVITÉ ÉLECTRIQUE (Ohm.m) : détecte la présence d'eau souterraine
    --   Valeurs basses → sol humide ou présence de cavités remplies d'eau
    resistivity_ohm_m NUMERIC(10,2),

    -- Statut calculé automatiquement selon les seuils ci-dessus
    -- NORMAL, WARNING, CRITICAL, ALERT
    status           VARCHAR(20) DEFAULT 'NORMAL',

    PRIMARY KEY (reading_id, recorded_at)
) PARTITION BY RANGE (recorded_at);

CREATE TABLE sensors.bnr_reading_2026
    PARTITION OF sensors.bnr_reading
    FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

CREATE TABLE sensors.bnr_reading_2027
    PARTITION OF sensors.bnr_reading
    FOR VALUES FROM ('2027-01-01') TO ('2028-01-01');

-- Index sur le temps pour les requêtes de dernières lectures
CREATE INDEX idx_bnr_reading_station_time ON sensors.bnr_reading(station_id, recorded_at DESC);

-- Zones de tir surveillées par les capteurs BNR
CREATE TABLE sensors.blast_zone (
    zone_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id          UUID REFERENCES core.mine_site(site_id),
    location_id      UUID REFERENCES core.location(location_id),
    name             VARCHAR(100),

    -- Rayon de sécurité : aucun engin dans ce rayon pendant le tir
    safety_radius_m  NUMERIC(8,2) DEFAULT 500,

    -- Statut du cycle de tir :
    -- CLEAR       : zone libre, circulation normale
    -- PREPARATION : chargement des explosifs en cours
    -- ACTIVE      : tir en cours — zone interdite
    -- POST_BLAST  : après le tir, en attente d'évaluation
    -- INSPECTING  : inspection post-tir en cours
    status           VARCHAR(20) DEFAULT 'CLEAR',

    blast_scheduled  TIMESTAMP,              -- heure prévue du tir
    blast_completed  TIMESTAMP,              -- heure effective du tir
    clearance_time   TIMESTAMP,              -- quand la zone est déclarée sûre

    created_by       UUID,
    created_at       TIMESTAMP DEFAULT NOW()
);


-- ============================================================
-- MODULE 2 : OPTIMISATION DYNAMIQUE DES ROUTES (IA)
-- ============================================================

-- Cache des routes optimisées (évite de recalculer à chaque dispatch)
-- Invalidé quand les conditions changent (météo, état des routes, trafic)
CREATE TABLE ai.route_cache (
    cache_id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    origin_id          UUID REFERENCES core.location(location_id),
    destination_id     UUID REFERENCES core.location(location_id),

    -- Hash des conditions au moment du calcul (état routes + météo + congestion)
    -- Permet de détecter si le cache est encore valide
    conditions_hash    VARCHAR(64),

    -- Résultat de l'optimisation
    -- Séquence ordonnée des location_id sur le trajet optimal
    path_location_ids  UUID[],

    -- Séquence ordonnée des road_id empruntés
    path_road_ids      UUID[],

    total_distance_km  NUMERIC(10,2),
    estimated_min      NUMERIC(10,2),   -- durée estimée en minutes

    -- Score de coût global (distance * gradient * condition * congestion)
    -- Utilisé pour comparer plusieurs routes alternatives
    total_cost         NUMERIC(10,4),

    -- Algorithme utilisé pour calculer cette route
    -- DIJKSTRA : plus court chemin pondéré (défaut)
    -- ASTAR    : A* heuristique (plus rapide sur grands graphes)
    algorithm          VARCHAR(20) DEFAULT 'DIJKSTRA',

    calculated_at      TIMESTAMP DEFAULT NOW(),
    -- Le cache expire quand les conditions changent
    expires_at         TIMESTAMP
);

CREATE INDEX idx_route_cache_od ON ai.route_cache(origin_id, destination_id);


-- ============================================================
-- MODULE 3 : DISPATCH INTELLIGENT (IA)
-- ============================================================

-- Historique des recommandations générées par l'algorithme de dispatch
CREATE TABLE ai.dispatch_recommendation (
    rec_id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id            UUID REFERENCES core.mine_site(site_id),
    generated_at       TIMESTAMP DEFAULT NOW(),
    shift_id           UUID REFERENCES core.shift(shift_id),

    -- Algorithme utilisé :
    -- HUNGARIAN : algorithme optimal pour l'affectation (minimise le coût total)
    -- GREEDY    : affectation gloutonne (rapide, sous-optimal)
    algorithm          VARCHAR(30) DEFAULT 'HUNGARIAN',

    -- Score de confiance de la recommandation (0.0 à 1.0)
    confidence_score   NUMERIC(5,3),

    -- Détail des affectations recommandées
    -- Format : [{"truck_id": "...", "loader_id": "...", "score": 0.92, "reason": "..."}]
    assignments        JSONB NOT NULL,

    -- Amélioration estimée par rapport à l'affectation actuelle
    improvement_pct    NUMERIC(5,2),

    -- La recommandation a-t-elle été appliquée ?
    applied            BOOLEAN DEFAULT FALSE,
    applied_at         TIMESTAMP,
    applied_by         UUID
);


-- ============================================================
-- MODULE 4 : MAINTENANCE PRÉDICTIVE (ML)
-- ============================================================

-- Prédictions de pannes générées par le modèle de scoring
CREATE TABLE ai.maintenance_prediction (
    prediction_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    equipment_id       UUID NOT NULL REFERENCES core.equipment(equipment_id),
    predicted_at       TIMESTAMP DEFAULT NOW(),

    -- Composant concerné par la prédiction
    -- ENGINE, HYDRAULICS, TYRES, BRAKES, TRANSMISSION, ELECTRICAL
    component          VARCHAR(100),

    -- Mode de défaillance prédit (ex: surchauffe moteur, fuite hydraulique…)
    failure_mode       VARCHAR(100),

    -- Probabilités de panne dans les prochaines heures
    probability_24h    NUMERIC(5,3) CHECK (probability_24h BETWEEN 0 AND 1),
    probability_72h    NUMERIC(5,3) CHECK (probability_72h BETWEEN 0 AND 1),
    probability_7d     NUMERIC(5,3) CHECK (probability_7d BETWEEN 0 AND 1),

    -- Durée de vie résiduelle estimée (RUL = Remaining Useful Life)
    -- Nombre d'heures de fonctionnement avant panne probable
    rul_hours          NUMERIC(10,2),

    -- Score de santé du composant : 100 = parfait, 0 = défaillance imminente
    health_score       NUMERIC(5,2),

    -- Signaux télémétrie qui ont déclenché cette prédiction
    -- Format : {"engine_temp_trend": "+2.3°C/h", "oil_pressure_avg": "3.1 bar (bas)"}
    trigger_signals    JSONB,

    -- Action recommandée :
    -- MONITOR         : surveiller, rien d'urgent
    -- INSPECT_SOON    : inspecter dans les 72h
    -- PLAN_MAINTENANCE: planifier une intervention (dans les 7 jours)
    -- URGENT          : intervention requise sous 24h
    -- IMMEDIATE       : arrêter l'engin maintenant
    recommended_action VARCHAR(30),

    -- Date recommandée pour l'intervention
    recommended_by_date DATE,

    -- Version du modèle de scoring utilisé
    model_version      VARCHAR(20) DEFAULT '1.0',

    -- Suivi de la prédiction
    confirmed          BOOLEAN DEFAULT FALSE,   -- la panne a-t-elle eu lieu ?
    confirmed_at       TIMESTAMP
);

CREATE INDEX idx_maint_pred_equipment ON ai.maintenance_prediction(equipment_id, predicted_at DESC);

-- Données d'entraînement : snapshot télémétrique avant une panne confirmée
-- Permet d'améliorer le modèle de scoring au fil du temps
CREATE TABLE ai.failure_training_data (
    data_id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    equipment_id       UUID REFERENCES core.equipment(equipment_id),
    breakdown_id       UUID REFERENCES maintenance.breakdown(breakdown_id),
    component          VARCHAR(100),
    failure_mode       VARCHAR(100),

    -- Statistiques télémétrie sur les 48h avant la panne
    -- Format : {"engine_temp": {"avg": 95.2, "max": 112, "trend_per_h": 1.8}, ...}
    telemetry_snapshot JSONB,

    hours_before_failure NUMERIC(10,2),
    recorded_at        TIMESTAMP DEFAULT NOW()
);
