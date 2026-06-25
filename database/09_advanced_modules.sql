-- ============================================================
-- FMS MINING - MODULE 6 : Tables avancées (Matière, Délais,
--   Vitesse, TKPH, Objectifs, Rapports de poste)
-- ============================================================
-- POUR DÉBUTANTS : chaque CREATE TABLE crée une nouvelle
-- "feuille de calcul" dans la base de données.
-- Les REFERENCES établissent des liens entre tables (clés étrangères).
-- Les INDEX accélèrent les recherches, comme l'index d'un livre.
-- ============================================================

-- ── 1. operations.material_load ───────────────────────────────────────────────
-- Trace chaque chargement de camion : type de minerai, grade Cu%,
-- source (face du pit), destination (crusher, dump...).
-- Permet de vérifier que le bon matériau va au bon endroit.
CREATE TABLE IF NOT EXISTS operations.material_load (
  load_id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Mine et poste concernés
  site_id         UUID REFERENCES core.mine_site(site_id),
  shift_id        UUID REFERENCES core.shift(shift_id),
  -- Camion qui transporte et pelle qui charge
  truck_id        UUID REFERENCES core.equipment(equipment_id),
  loader_id       UUID REFERENCES core.equipment(equipment_id),
  -- D'où vient le matériau et où il va
  source_id       UUID REFERENCES core.location(location_id),
  destination_id  UUID REFERENCES core.location(location_id),
  -- Type : OXIDE | SULPHIDE | LOW_GRADE | WASTE | TOPSOIL
  material_type   VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',
  -- Grade en cuivre (pourcentage, ex: 1.250 = 1.25%)
  grade_cu_pct    NUMERIC(5,3),
  -- Poids effectivement chargé
  payload_tonnes  NUMERIC(8,2),
  -- Horodatages du chargement et du déchargement
  loaded_at       TIMESTAMP DEFAULT NOW(),
  dumped_at       TIMESTAMP,
  -- TRUE si le camion a bien été envoyé à la bonne destination
  correct_dest    BOOLEAN DEFAULT TRUE,
  notes           TEXT
);
-- Index pour accélérer les recherches par site/date, par poste, par camion
CREATE INDEX IF NOT EXISTS idx_ml_site  ON operations.material_load(site_id, loaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_ml_shift ON operations.material_load(shift_id);
CREATE INDEX IF NOT EXISTS idx_ml_truck ON operations.material_load(truck_id);


-- ── 2. operations.delay_category ─────────────────────────────────────────────
-- Table de référence : liste standardisée des codes de délai.
-- Exemple : WAIT-SHO = camion en file d'attente devant la pelle.
-- affects_ma = TRUE si ce délai impacte la disponibilité mécanique (MA).
CREATE TABLE IF NOT EXISTS operations.delay_category (
  cat_id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Code court unique (ex: 'WAIT-SHO')
  code       VARCHAR(10) UNIQUE NOT NULL,
  -- Libellé lisible (ex: 'Attente pelle (file)')
  label      VARCHAR(80) NOT NULL,
  -- Famille : OPERATIONAL | STANDBY | BLAST | WEATHER | MAINTENANCE | ADMIN
  type       VARCHAR(20) NOT NULL,
  -- TRUE = délai planifié (ex: maintenance préventive, tir de mine)
  planned    BOOLEAN DEFAULT FALSE,
  -- TRUE = ce délai entre dans le calcul de la disponibilité mécanique
  affects_ma BOOLEAN DEFAULT TRUE
);

-- Insertion des codes de délai standards pour une mine open-pit
INSERT INTO operations.delay_category (code, label, type, planned, affects_ma) VALUES
  ('WAIT-SHO', 'Attente pelle (file)',        'OPERATIONAL', FALSE, FALSE),
  ('WAIT-FUE', 'Attente carburant',            'STANDBY',     FALSE, FALSE),
  ('WAIT-WAT', 'Attente arrosage piste',       'STANDBY',     FALSE, FALSE),
  ('WAIT-BLA', 'Arrêt tir (blast zone)',       'BLAST',       TRUE,  FALSE),
  ('WAIT-WEA', 'Arrêt météo',                 'WEATHER',     FALSE, FALSE),
  ('WAIT-TRA', 'Congestion trafic',            'OPERATIONAL', FALSE, FALSE),
  ('MAINT-PM', 'Maintenance préventive',       'MAINTENANCE', TRUE,  TRUE),
  ('MAINT-CM', 'Réparation corrective',        'MAINTENANCE', FALSE, TRUE),
  ('MAINT-TY', 'Changement pneu',              'MAINTENANCE', FALSE, TRUE),
  ('SHIFT-CH', 'Changement de poste',          'ADMIN',       TRUE,  FALSE),
  ('IDLE-OTH', 'Arrêt autre',                 'STANDBY',     FALSE, FALSE)
ON CONFLICT (code) DO NOTHING;


-- ── 3. operations.delay_event ─────────────────────────────────────────────────
-- Enregistre chaque période d'arrêt d'un équipement.
-- ended_at NULL = délai encore en cours (ouvert).
-- auto_detected = TRUE quand c'est le système qui l'a détecté automatiquement.
CREATE TABLE IF NOT EXISTS operations.delay_event (
  event_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id       UUID REFERENCES core.mine_site(site_id),
  shift_id      UUID REFERENCES core.shift(shift_id),
  equipment_id  UUID REFERENCES core.equipment(equipment_id),
  cat_id        UUID REFERENCES operations.delay_category(cat_id),
  -- Début de l'arrêt (obligatoire)
  started_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  -- Fin de l'arrêt (NULL = toujours en cours)
  ended_at      TIMESTAMP,
  notes         TEXT,
  -- Indique si l'arrêt a été détecté automatiquement (GPS/capteur)
  auto_detected BOOLEAN DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_de_site  ON operations.delay_event(site_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_de_equip ON operations.delay_event(equipment_id);
CREATE INDEX IF NOT EXISTS idx_de_shift ON operations.delay_event(shift_id);


-- ── 4. operations.speed_violation ────────────────────────────────────────────
-- Enregistre chaque dépassement de vitesse détecté par GPS.
-- severity : WARNING (>10% de la limite) ou CRITICAL (>25%).
-- excess_pct = pourcentage de dépassement, ex: 15.0 = 15% trop vite.
CREATE TABLE IF NOT EXISTS operations.speed_violation (
  viol_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id      UUID REFERENCES core.mine_site(site_id),
  equipment_id UUID REFERENCES core.equipment(equipment_id),
  road_id      UUID REFERENCES core.haul_road(road_id),
  detected_at  TIMESTAMP DEFAULT NOW(),
  -- Vitesse mesurée par GPS
  speed_kmh    NUMERIC(6,2) NOT NULL,
  -- Limite autorisée sur ce tronçon
  limit_kmh    NUMERIC(6,2) NOT NULL,
  -- Calcul automatique : (speed - limit) / limit * 100
  excess_pct   NUMERIC(5,2),
  -- Coordonnées GPS au moment de l'infraction
  lat          NUMERIC(10,7),
  lon          NUMERIC(10,7),
  -- WARNING ou CRITICAL
  severity     VARCHAR(10) DEFAULT 'WARNING'
);
CREATE INDEX IF NOT EXISTS idx_sv_site  ON operations.speed_violation(site_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_sv_equip ON operations.speed_violation(equipment_id);


-- ── 5. maintenance.tyre_tkph ──────────────────────────────────────────────────
-- TKPH = Tonnes-Kilomètres Par Heure. Indicateur de chaleur des pneus.
-- Si TKPH_réel dépasse 85% du TKPH_nominal, le pneu risque la surchauffe.
-- position : FL (front-left), FR, RL1, RL2, RR1, RR2 (pneus double essieu)
CREATE TABLE IF NOT EXISTS maintenance.tyre_tkph (
  tkph_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  equipment_id UUID REFERENCES core.equipment(equipment_id),
  -- Position du pneu sur le camion (ex: 'FL', 'RR1')
  position     VARCHAR(10) NOT NULL,
  -- Date du calcul (un calcul par jour par position)
  calc_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  -- TKPH mesuré dans les conditions réelles de travail
  tkph_actual  NUMERIC(8,2),
  -- TKPH maximum autorisé par le fabricant pour ce pneu
  tkph_nominal NUMERIC(8,2),
  -- Pourcentage de charge : tkph_actual / tkph_nominal * 100
  load_pct     NUMERIC(5,2),
  -- Température estimée en °C (calculée depuis TKPH)
  temp_est_c   NUMERIC(6,2),
  -- Un seul enregistrement par (camion, position, jour)
  UNIQUE(equipment_id, position, calc_date)
);


-- ── 6. operations.production_target ──────────────────────────────────────────
-- Objectif de production par poste.
-- Le dispatcher fixe ces objectifs en début de poste.
-- Permet de calculer le taux d'achievement en temps réel.
CREATE TABLE IF NOT EXISTS operations.production_target (
  target_id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id       UUID REFERENCES core.mine_site(site_id),
  shift_id      UUID REFERENCES core.shift(shift_id),
  -- Objectif en tonnes pour ce poste
  target_tonnes NUMERIC(12,2) NOT NULL DEFAULT 6000,
  -- Nombre de cycles visés
  target_cycles INTEGER DEFAULT 120,
  -- Ratio minerai/stérile attendu (%)
  ore_ratio_pct NUMERIC(5,2) DEFAULT 40,
  -- Un seul objectif par poste
  UNIQUE(shift_id)
);


-- ── 7. reporting.shift_report ─────────────────────────────────────────────────
-- Rapport complet généré automatiquement en fin de poste.
-- Agrège toutes les métriques : production, disponibilité, délais, matière.
-- top_trucks et incidents sont en JSONB (format JSON flexible).
CREATE TABLE IF NOT EXISTS reporting.shift_report (
  report_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id         UUID REFERENCES core.mine_site(site_id),
  -- Un seul rapport par poste
  shift_id        UUID REFERENCES core.shift(shift_id) UNIQUE,
  generated_at    TIMESTAMP DEFAULT NOW(),
  -- Production vs objectif
  total_tonnes    NUMERIC(12,2),
  target_tonnes   NUMERIC(12,2),
  achievement_pct NUMERIC(5,2),
  total_cycles    INTEGER,
  -- Disponibilités (%) selon standard minier
  ma_pct          NUMERIC(5,2),  -- Disponibilité Mécanique
  pa_pct          NUMERIC(5,2),  -- Disponibilité Physique
  ua_pct          NUMERIC(5,2),  -- Utilisation
  -- Temps perdu en délais (minutes)
  total_delay_min NUMERIC(10,2),
  -- Répartition minerai / stérile
  ore_tonnes      NUMERIC(12,2),
  waste_tonnes    NUMERIC(12,2),
  avg_grade_cu    NUMERIC(5,3),
  -- Flotte
  trucks_active   INTEGER,
  trucks_down     INTEGER,
  -- JSON : [{rank, fleet_number, tonnes, cycles}]
  top_trucks      JSONB,
  -- JSON : [{type, equipment_id, description}]
  incidents       JSONB,
  -- Données détaillées complètes
  detail_json     JSONB
);


-- ── 8. operations.loader_queue ────────────────────────────────────────────────
-- Snapshot de la file d'attente devant chaque pelle.
-- Pris toutes les quelques minutes pour analyser les goulots d'étranglement.
-- queue_count = nombre de camions en attente devant la pelle.
CREATE TABLE IF NOT EXISTS operations.loader_queue (
  snap_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  loader_id    UUID REFERENCES core.equipment(equipment_id),
  shift_id     UUID REFERENCES core.shift(shift_id),
  -- Moment du snapshot
  snapped_at   TIMESTAMP DEFAULT NOW(),
  -- Combien de camions attendent ?
  queue_count  INTEGER DEFAULT 0,
  -- Temps d'attente moyen en minutes
  avg_wait_min NUMERIC(6,2)
);


-- ============================================================
-- DONNÉES DE TEST
-- ============================================================

-- ── Objectif du poste actif ──────────────────────────────────────────────────
-- On insère un objectif de 6000 tonnes pour le poste en cours
INSERT INTO operations.production_target (site_id, shift_id, target_tonnes, target_cycles, ore_ratio_pct)
SELECT
  'a1b2c3d4-0001-0001-0001-000000000001'::UUID,
  shift_id,
  6000,
  120,
  40.0
FROM core.shift
WHERE site_id = 'a1b2c3d4-0001-0001-0001-000000000001'
  AND status = 'ACTIVE'
LIMIT 1
ON CONFLICT (shift_id) DO NOTHING;


-- ── Événements de délai variés ────────────────────────────────────────────────
-- Simule les arrêts survenus pendant le poste actif
INSERT INTO operations.delay_event
  (site_id, shift_id, equipment_id, cat_id, started_at, ended_at, notes, auto_detected)
SELECT
  'a1b2c3d4-0001-0001-0001-000000000001'::UUID,
  s.shift_id,
  e.equipment_id,
  dc.cat_id,
  NOW() - (offset_min || ' minutes')::INTERVAL,
  CASE WHEN ended THEN NOW() - (offset_min || ' minutes')::INTERVAL + (dur_min || ' minutes')::INTERVAL ELSE NULL END,
  note_text,
  TRUE
FROM
  (SELECT shift_id FROM core.shift WHERE site_id = 'a1b2c3d4-0001-0001-0001-000000000001' AND status = 'ACTIVE' LIMIT 1) s,
  (VALUES
    ('eb000001-0000-0000-0000-000000000001'::UUID, 'WAIT-SHO', 180,  8,  TRUE,  'File pelle EX-201'),
    ('eb000001-0000-0000-0000-000000000002'::UUID, 'WAIT-FUE', 150, 25, TRUE,  'Ravitaillement carburant'),
    ('eb000001-0000-0000-0000-000000000003'::UUID, 'MAINT-TY',  90, 45, TRUE,  'Crevaison pneu FL'),
    ('eb000001-0000-0000-0000-000000000004'::UUID, 'WAIT-BLA',  60, 20, TRUE,  'Zone tir blast-01'),
    ('eb000001-0000-0000-0000-000000000007'::UUID, 'MAINT-CM',  30, 0,  FALSE, 'En cours - moteur hydraulique'),
    ('eb000001-0000-0000-0000-000000000009'::UUID, 'WAIT-SHO',  15, 12, TRUE,  'File pelle EX-202'),
    ('eb000001-0000-0000-0000-000000000006'::UUID, 'WAIT-WAT',  10,  6, TRUE,  'Arrosage piste principale'),
    ('eb000001-0000-0000-0000-000000000005'::UUID, 'WAIT-TRA', 200, 18, TRUE,  'Congestion au niveau du crusher')
  ) AS d(truck_uuid, delay_code, offset_min, dur_min, ended, note_text)
JOIN core.equipment e ON e.equipment_id = d.truck_uuid
JOIN operations.delay_category dc ON dc.code = d.delay_code;


-- ── Chargements matière variés ────────────────────────────────────────────────
-- Simule des chargements de minerai et stérile du poste actif
INSERT INTO operations.material_load
  (site_id, shift_id, truck_id, loader_id, source_id, destination_id,
   material_type, grade_cu_pct, payload_tonnes, loaded_at, dumped_at, correct_dest, notes)
SELECT
  'a1b2c3d4-0001-0001-0001-000000000001'::UUID,
  s.shift_id,
  d.truck_uuid,
  d.loader_uuid,
  d.source_uuid,
  d.dest_uuid,
  d.mat_type,
  d.grade_cu,
  d.payload_t,
  NOW() - (d.offset_min || ' minutes')::INTERVAL,
  NOW() - (d.offset_min || ' minutes')::INTERVAL + INTERVAL '22 minutes',
  d.correct_d,
  d.note_text
FROM
  (SELECT shift_id FROM core.shift WHERE site_id = 'a1b2c3d4-0001-0001-0001-000000000001' AND status = 'ACTIVE' LIMIT 1) s,
  (VALUES
    ('eb000001-0000-0000-0000-000000000001'::UUID, 'eb000001-0000-0000-0000-000000000011'::UUID,
     '10c00001-0000-0000-0000-000000000001'::UUID, '10c00001-0000-0000-0000-000000000007'::UUID,
     'OXIDE',    1.520, 345.0, 200, TRUE,  'Ox grade A'),
    ('eb000001-0000-0000-0000-000000000002'::UUID, 'eb000001-0000-0000-0000-000000000011'::UUID,
     '10c00001-0000-0000-0000-000000000002'::UUID, '10c00001-0000-0000-0000-000000000004'::UUID,
     'WASTE',    0.050, 320.0, 155, TRUE,  'Stérile bench sud'),
    ('eb000001-0000-0000-0000-000000000003'::UUID, 'eb000001-0000-0000-0000-000000000012'::UUID,
     '10c00001-0000-0000-0000-000000000003'::UUID, '10c00001-0000-0000-0000-000000000007'::UUID,
     'SULPHIDE', 2.100, 358.0, 110, TRUE,  'Sulfures face est'),
    ('eb000001-0000-0000-0000-000000000004'::UUID, 'eb000001-0000-0000-0000-000000000012'::UUID,
     '10c00001-0000-0000-0000-000000000001'::UUID, '10c00001-0000-0000-0000-000000000006'::UUID,
     'LOW_GRADE', 0.350, 310.0, 80, TRUE,  'Low grade stockpile'),
    ('eb000001-0000-0000-0000-000000000005'::UUID, 'eb000001-0000-0000-0000-000000000011'::UUID,
     '10c00001-0000-0000-0000-000000000002'::UUID, '10c00001-0000-0000-0000-000000000007'::UUID,
     'OXIDE',    1.820, 362.0, 50, TRUE,   'Grade B oxyde bench 2'),
    ('eb000001-0000-0000-0000-000000000006'::UUID, 'eb000001-0000-0000-0000-000000000012'::UUID,
     '10c00001-0000-0000-0000-000000000003'::UUID, '10c00001-0000-0000-0000-000000000004'::UUID,
     'WASTE',    0.030, 285.0, 30, TRUE,   'Stérile face est'),
    ('eb000001-0000-0000-0000-000000000009'::UUID, 'eb000001-0000-0000-0000-000000000011'::UUID,
     '10c00001-0000-0000-0000-000000000001'::UUID, '10c00001-0000-0000-0000-000000000004'::UUID,
     'OXIDE',    1.350, 330.0, 15, FALSE,  'MAUVAISE DESTINATION : minerai envoyé au dump!'),
    ('eb000001-0000-0000-0000-000000000010'::UUID, 'eb000001-0000-0000-0000-000000000011'::UUID,
     '10c00001-0000-0000-0000-000000000002'::UUID, '10c00001-0000-0000-0000-000000000005'::UUID,
     'WASTE',    0.020, 295.0, 5, TRUE,    'Stérile dump est')
  ) AS d(truck_uuid, loader_uuid, source_uuid, dest_uuid, mat_type, grade_cu, payload_t, offset_min, correct_d, note_text);


-- ── Infractions de vitesse variées ────────────────────────────────────────────
-- Simule des dépassements de vitesse détectés par GPS
INSERT INTO operations.speed_violation
  (site_id, equipment_id, road_id, detected_at, speed_kmh, limit_kmh, excess_pct, lat, lon, severity)
SELECT
  'a1b2c3d4-0001-0001-0001-000000000001'::UUID,
  d.truck_uuid,
  r.road_id,
  NOW() - (d.offset_min || ' minutes')::INTERVAL,
  d.speed_kmh,
  d.limit_kmh,
  ROUND((d.speed_kmh - d.limit_kmh) / d.limit_kmh * 100.0, 2),
  d.lat_val,
  d.lon_val,
  CASE WHEN (d.speed_kmh - d.limit_kmh) / d.limit_kmh > 0.25 THEN 'CRITICAL' ELSE 'WARNING' END
FROM
  (SELECT road_id FROM core.haul_road WHERE site_id = 'a1b2c3d4-0001-0001-0001-000000000001' LIMIT 1) r,
  (VALUES
    ('eb000001-0000-0000-0000-000000000001'::UUID, 240, 38.5, 30.0, -12.497, 27.847),
    ('eb000001-0000-0000-0000-000000000003'::UUID, 210, 42.0, 30.0, -12.495, 27.845),
    ('eb000001-0000-0000-0000-000000000006'::UUID, 170, 36.0, 30.0, -12.501, 27.861),
    ('eb000001-0000-0000-0000-000000000002'::UUID, 120, 35.0, 30.0, -12.493, 27.842),
    ('eb000001-0000-0000-0000-000000000001'::UUID,  85, 40.2, 30.0, -12.498, 27.846),
    ('eb000001-0000-0000-0000-000000000005'::UUID,  55, 34.0, 30.0, -12.519, 27.836),
    ('eb000001-0000-0000-0000-000000000009'::UUID,  40, 33.5, 30.0, -12.491, 27.841)
  ) AS d(truck_uuid, offset_min, speed_kmh, limit_kmh, lat_val, lon_val);
