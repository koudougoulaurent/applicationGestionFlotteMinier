-- ============================================================
-- FMS MINING - DATABASE SCHEMA
-- Fleet Management System for Open-Pit Mining
-- PostgreSQL 15 + PostGIS 3.3
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- Schemas
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS operations;
CREATE SCHEMA IF NOT EXISTS maintenance;
CREATE SCHEMA IF NOT EXISTS fuel;
CREATE SCHEMA IF NOT EXISTS reporting;

-- ============================================================
-- CORE SCHEMA
-- ============================================================

-- Mine Sites
CREATE TABLE core.mine_site (
    site_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code         VARCHAR(20) UNIQUE NOT NULL,
    name         VARCHAR(100) NOT NULL,
    country      VARCHAR(50),
    region       VARCHAR(100),
    timezone     VARCHAR(50) DEFAULT 'UTC',
    latitude     NUMERIC(10,7),
    longitude    NUMERIC(10,7),
    elevation    NUMERIC(10,2),
    active       BOOLEAN DEFAULT TRUE,
    created_at   TIMESTAMP DEFAULT NOW()
);

-- Shifts
CREATE TABLE core.shift_definition (
    shift_def_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id      UUID REFERENCES core.mine_site(site_id),
    shift_name   VARCHAR(50) NOT NULL,
    start_hour   INTEGER NOT NULL CHECK (start_hour BETWEEN 0 AND 23),
    duration_hours INTEGER NOT NULL DEFAULT 12,
    color        VARCHAR(10) DEFAULT '#4CAF50'
);

-- Active Shifts
CREATE TABLE core.shift (
    shift_id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id      UUID REFERENCES core.mine_site(site_id),
    shift_def_id UUID REFERENCES core.shift_definition(shift_def_id),
    shift_date   DATE NOT NULL,
    start_time   TIMESTAMP NOT NULL,
    end_time     TIMESTAMP,
    supervisor_id UUID,
    status       VARCHAR(20) DEFAULT 'ACTIVE', -- ACTIVE, CLOSED
    created_at   TIMESTAMP DEFAULT NOW()
);

-- Locations / Zones
CREATE TABLE core.location (
    location_id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id       UUID REFERENCES core.mine_site(site_id),
    code          VARCHAR(30) UNIQUE NOT NULL,
    name          VARCHAR(100) NOT NULL,
    location_type VARCHAR(30) NOT NULL,
    -- PIT, DUMP, STOCKPILE, CRUSHER, WORKSHOP, FUEL_STATION, PARKING, BLAST_ZONE
    latitude      NUMERIC(10,7),
    longitude     NUMERIC(10,7),
    elevation     NUMERIC(10,2),
    radius_m      NUMERIC(10,2) DEFAULT 100,   -- geofence radius
    geom          GEOMETRY(POINT, 4326),
    capacity_tonnes NUMERIC(15,2),
    active        BOOLEAN DEFAULT TRUE,
    created_at    TIMESTAMP DEFAULT NOW()
);

-- Geofence Polygons
CREATE TABLE core.geofence (
    geofence_id  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    location_id  UUID REFERENCES core.location(location_id),
    name         VARCHAR(100),
    polygon      GEOMETRY(POLYGON, 4326),
    active       BOOLEAN DEFAULT TRUE
);

-- Haul Roads
CREATE TABLE core.haul_road (
    road_id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id           UUID REFERENCES core.mine_site(site_id),
    name              VARCHAR(100),
    start_location_id UUID REFERENCES core.location(location_id),
    end_location_id   UUID REFERENCES core.location(location_id),
    distance_km       NUMERIC(10,2),
    avg_gradient      NUMERIC(10,2),
    max_grade         NUMERIC(10,2),
    road_class        VARCHAR(20) DEFAULT 'PRIMARY', -- PRIMARY, SECONDARY, SERVICE
    speed_limit_kmh   INTEGER DEFAULT 40,
    active            BOOLEAN DEFAULT TRUE
);

-- Road Condition Monitoring
CREATE TABLE core.road_condition (
    condition_id  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    road_id       UUID REFERENCES core.haul_road(road_id),
    reported_at   TIMESTAMP DEFAULT NOW(),
    condition     VARCHAR(20), -- GOOD, FAIR, POOR, CLOSED
    issue_type    VARCHAR(50), -- POTHOLE, RUTTING, DUST, WET, DAMAGE
    reporter_id   UUID,
    resolved_at   TIMESTAMP
);

-- Weather Stations
CREATE TABLE core.weather_station (
    station_id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id      UUID REFERENCES core.mine_site(site_id),
    name         VARCHAR(100),
    latitude     NUMERIC(10,7),
    longitude    NUMERIC(10,7),
    active       BOOLEAN DEFAULT TRUE
);

-- Weather Readings
CREATE TABLE core.weather_reading (
    reading_id    BIGSERIAL PRIMARY KEY,
    station_id    UUID REFERENCES core.weather_station(station_id),
    recorded_at   TIMESTAMP DEFAULT NOW(),
    temperature_c NUMERIC(5,2),
    humidity_pct  NUMERIC(5,2),
    wind_speed_ms NUMERIC(5,2),
    wind_dir_deg  INTEGER,
    rainfall_mm   NUMERIC(8,2),
    visibility_m  INTEGER,
    dust_index    INTEGER
);

-- Materials
CREATE TABLE core.material (
    material_id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code          VARCHAR(20) UNIQUE NOT NULL,
    name          VARCHAR(100) NOT NULL,
    category      VARCHAR(50), -- ORE, WASTE, OVERBURDEN, TOPSOIL
    density_t_m3  NUMERIC(10,3) DEFAULT 2.7,
    swell_factor  NUMERIC(5,3) DEFAULT 1.3,
    cut_off_grade NUMERIC(10,4),
    color         VARCHAR(10) DEFAULT '#888888'
);

-- ============================================================
-- EQUIPMENT SCHEMA
-- ============================================================

-- Equipment Types
CREATE TABLE core.equipment_type (
    type_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code         VARCHAR(30) UNIQUE NOT NULL,
    name         VARCHAR(100) NOT NULL,
    category     VARCHAR(50) NOT NULL,
    -- TRUCK, EXCAVATOR, LOADER, DOZER, DRILL, GRADER, WATER_TRUCK, SERVICE
    manufacturer VARCHAR(50),
    icon         VARCHAR(50)
);

-- Equipment
CREATE TABLE core.equipment (
    equipment_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id           UUID REFERENCES core.mine_site(site_id),
    type_id           UUID REFERENCES core.equipment_type(type_id),
    fleet_number      VARCHAR(30) UNIQUE NOT NULL,
    serial_number     VARCHAR(100),
    model             VARCHAR(100),
    year_manufactured INTEGER,
    payload_capacity  NUMERIC(10,2),     -- tonnes
    fuel_capacity     NUMERIC(10,2),     -- liters
    fuel_type         VARCHAR(20) DEFAULT 'DIESEL',
    engine_model      VARCHAR(100),
    tire_count        INTEGER DEFAULT 6,
    purchase_date     DATE,
    purchase_cost     NUMERIC(15,2),
    current_hours     NUMERIC(12,2) DEFAULT 0,
    current_km        NUMERIC(12,2) DEFAULT 0,
    status            VARCHAR(30) DEFAULT 'AVAILABLE',
    current_location_id UUID REFERENCES core.location(location_id),
    current_operator_id UUID,
    latitude          NUMERIC(10,7),
    longitude         NUMERIC(10,7),
    health_score      INTEGER DEFAULT 100 CHECK (health_score BETWEEN 0 AND 100),
    active            BOOLEAN DEFAULT TRUE,
    created_at        TIMESTAMP DEFAULT NOW()
);

-- Status Codes Reference
CREATE TABLE core.status_code (
    status_code  VARCHAR(30) PRIMARY KEY,
    description  VARCHAR(100),
    category     VARCHAR(30),
    -- PRODUCTIVE, IDLE, DOWN, STANDBY
    color        VARCHAR(10) DEFAULT '#888888',
    counts_as_operating BOOLEAN DEFAULT FALSE
);

INSERT INTO core.status_code VALUES
('AVAILABLE',    'Ready for assignment',           'STANDBY',    '#4CAF50', FALSE),
('OPERATING',    'Actively working',               'PRODUCTIVE', '#2196F3', TRUE),
('LOADING',      'Being loaded at shovel',         'PRODUCTIVE', '#2196F3', TRUE),
('HAULING',      'Hauling material',               'PRODUCTIVE', '#2196F3', TRUE),
('DUMPING',      'Unloading at dump/crusher',      'PRODUCTIVE', '#2196F3', TRUE),
('RETURNING',    'Returning empty to shovel',      'PRODUCTIVE', '#00BCD4', TRUE),
('QUEUING',      'Waiting in queue',               'IDLE',       '#FF9800', FALSE),
('IDLE',         'Idle / waiting',                 'IDLE',       '#FF9800', FALSE),
('DOWN',         'Breakdown / unplanned stop',     'DOWN',       '#F44336', FALSE),
('MAINTENANCE',  'Planned maintenance',            'DOWN',       '#9C27B0', FALSE),
('REFUELING',    'At fuel station',                'STANDBY',    '#FF5722', FALSE),
('SHIFT_CHANGE', 'Shift handover in progress',     'STANDBY',    '#607D8B', FALSE),
('STANDBY',      'On standby',                     'STANDBY',    '#9E9E9E', FALSE),
('BLASTING',     'Waiting for blast clearance',   'IDLE',       '#FF5722', FALSE),
('INSPECTION',   'Safety inspection',             'STANDBY',    '#795548', FALSE);

-- Equipment Status Timeline
CREATE TABLE operations.equipment_status_timeline (
    timeline_id      BIGSERIAL,
    equipment_id     UUID NOT NULL REFERENCES core.equipment(equipment_id),
    status_code      VARCHAR(30) NOT NULL REFERENCES core.status_code(status_code),
    start_time       TIMESTAMP NOT NULL,
    end_time         TIMESTAMP,
    duration_seconds BIGINT,
    location_id      UUID REFERENCES core.location(location_id),
    operator_id      UUID,
    shift_id         UUID REFERENCES core.shift(shift_id),
    source           VARCHAR(30) DEFAULT 'SYSTEM', -- SYSTEM, MANUAL, GPS, SENSOR
    reason_code      VARCHAR(50),
    remarks          TEXT,
    PRIMARY KEY (timeline_id, start_time)
) PARTITION BY RANGE (start_time);

CREATE TABLE operations.equipment_status_timeline_2024
    PARTITION OF operations.equipment_status_timeline
    FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');

CREATE TABLE operations.equipment_status_timeline_2025
    PARTITION OF operations.equipment_status_timeline
    FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');

CREATE TABLE operations.equipment_status_timeline_2026
    PARTITION OF operations.equipment_status_timeline
    FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

-- Status Transition Audit
CREATE TABLE operations.status_transition (
    transition_id   BIGSERIAL PRIMARY KEY,
    equipment_id    UUID NOT NULL REFERENCES core.equipment(equipment_id),
    from_status     VARCHAR(30),
    to_status       VARCHAR(30) NOT NULL,
    transition_time TIMESTAMP NOT NULL DEFAULT NOW(),
    source          VARCHAR(30),
    operator_id     UUID,
    auto_detected   BOOLEAN DEFAULT FALSE
);

-- GPS Positions
CREATE TABLE operations.equipment_position (
    position_id   BIGSERIAL,
    equipment_id  UUID NOT NULL REFERENCES core.equipment(equipment_id),
    position_time TIMESTAMP NOT NULL,
    latitude      NUMERIC(10,7) NOT NULL,
    longitude     NUMERIC(10,7) NOT NULL,
    altitude      NUMERIC(10,2),
    speed_kmh     NUMERIC(10,2),
    heading       NUMERIC(10,2),
    accuracy_m    NUMERIC(10,2),
    geom          GEOMETRY(POINT, 4326),
    status_code   VARCHAR(30),
    engine_on     BOOLEAN,
    payload_tonnes NUMERIC(10,2),
    PRIMARY KEY (position_id, position_time)
) PARTITION BY RANGE (position_time);

CREATE TABLE operations.equipment_position_2024
    PARTITION OF operations.equipment_position
    FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');

CREATE TABLE operations.equipment_position_2025
    PARTITION OF operations.equipment_position
    FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');

CREATE TABLE operations.equipment_position_2026
    PARTITION OF operations.equipment_position
    FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

-- Geofence Events
CREATE TABLE operations.geofence_event (
    event_id      BIGSERIAL PRIMARY KEY,
    equipment_id  UUID REFERENCES core.equipment(equipment_id),
    geofence_id   UUID REFERENCES core.geofence(geofence_id),
    location_id   UUID REFERENCES core.location(location_id),
    event_type    VARCHAR(10) NOT NULL, -- ENTER, EXIT
    event_time    TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================
-- OPERATORS
-- ============================================================

CREATE TABLE core.operator (
    operator_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id            UUID REFERENCES core.mine_site(site_id),
    employee_no        VARCHAR(20) UNIQUE NOT NULL,
    first_name         VARCHAR(100) NOT NULL,
    last_name          VARCHAR(100) NOT NULL,
    photo_url          TEXT,
    certification_level VARCHAR(50),
    -- TRAINEE, OPERATOR, SENIOR, SUPERVISOR
    certifications     JSONB DEFAULT '[]',
    -- array of equipment type codes
    phone              VARCHAR(30),
    email              VARCHAR(100),
    emergency_contact  VARCHAR(100),
    hire_date          DATE,
    license_no         VARCHAR(50),
    license_expiry     DATE,
    medical_expiry     DATE,
    active             BOOLEAN DEFAULT TRUE,
    created_at         TIMESTAMP DEFAULT NOW()
);

-- Operator Assignments (current shift)
CREATE TABLE operations.operator_assignment (
    assignment_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    operator_id   UUID REFERENCES core.operator(operator_id),
    equipment_id  UUID REFERENCES core.equipment(equipment_id),
    shift_id      UUID REFERENCES core.shift(shift_id),
    start_time    TIMESTAMP NOT NULL,
    end_time      TIMESTAMP,
    status        VARCHAR(20) DEFAULT 'ACTIVE'
);

-- Operator Fatigue Monitoring
CREATE TABLE operations.fatigue_event (
    fatigue_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    operator_id     UUID REFERENCES core.operator(operator_id),
    equipment_id    UUID REFERENCES core.equipment(equipment_id),
    shift_id        UUID REFERENCES core.shift(shift_id),
    event_time      TIMESTAMP DEFAULT NOW(),
    consecutive_hours NUMERIC(5,2),
    alert_level     VARCHAR(20), -- WARNING, CRITICAL
    acknowledged    BOOLEAN DEFAULT FALSE,
    action_taken    TEXT
);

-- ============================================================
-- PRODUCTION
-- ============================================================

-- Production Plans
CREATE TABLE operations.production_plan (
    plan_id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id           UUID REFERENCES core.mine_site(site_id),
    plan_date         DATE NOT NULL,
    shift_id          UUID REFERENCES core.shift(shift_id),
    material_id       UUID REFERENCES core.material(material_id),
    source_location_id UUID REFERENCES core.location(location_id),
    dest_location_id  UUID REFERENCES core.location(location_id),
    target_tonnes     NUMERIC(15,2),
    target_loads      INTEGER,
    target_bcm        NUMERIC(15,2),
    created_by        UUID,
    created_at        TIMESTAMP DEFAULT NOW()
);

-- Dispatch Assignments
CREATE TABLE operations.dispatch_assignment (
    assignment_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id            UUID REFERENCES core.mine_site(site_id),
    shift_id           UUID REFERENCES core.shift(shift_id),
    truck_id           UUID REFERENCES core.equipment(equipment_id),
    loader_id          UUID REFERENCES core.equipment(equipment_id),
    source_location_id UUID REFERENCES core.location(location_id),
    dest_location_id   UUID REFERENCES core.location(location_id),
    material_id        UUID REFERENCES core.material(material_id),
    priority           INTEGER DEFAULT 1,
    assigned_time      TIMESTAMP DEFAULT NOW(),
    acknowledged_time  TIMESTAMP,
    status             VARCHAR(20) DEFAULT 'PENDING',
    -- PENDING, ACKNOWLEDGED, IN_PROGRESS, COMPLETED, CANCELLED
    dispatcher_id      UUID,
    road_id            UUID REFERENCES core.haul_road(road_id)
);

-- Haul Cycle (Header)
CREATE TABLE operations.haul_cycle (
    cycle_id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id              UUID REFERENCES core.mine_site(site_id),
    shift_id             UUID REFERENCES core.shift(shift_id),
    truck_id             UUID NOT NULL REFERENCES core.equipment(equipment_id),
    loader_id            UUID REFERENCES core.equipment(equipment_id),
    operator_id          UUID REFERENCES core.operator(operator_id),
    material_id          UUID REFERENCES core.material(material_id),
    source_location_id   UUID REFERENCES core.location(location_id),
    dest_location_id     UUID REFERENCES core.location(location_id),
    road_id              UUID REFERENCES core.haul_road(road_id),
    dispatch_id          UUID REFERENCES operations.dispatch_assignment(assignment_id),
    cycle_start          TIMESTAMP NOT NULL,
    cycle_end            TIMESTAMP,
    total_duration_s     INTEGER,
    queue_duration_s     INTEGER,
    loading_duration_s   INTEGER,
    haul_duration_s      INTEGER,
    dump_duration_s      INTEGER,
    return_duration_s    INTEGER,
    payload_tonnes       NUMERIC(12,2),
    target_payload       NUMERIC(12,2),
    payload_factor       NUMERIC(5,3),    -- actual/target
    distance_km          NUMERIC(10,2),
    fuel_consumed_l      NUMERIC(10,2),
    overloaded           BOOLEAN DEFAULT FALSE,
    data_quality         VARCHAR(20) DEFAULT 'GOOD',
    -- GOOD, ESTIMATED, INCOMPLETE
    created_at           TIMESTAMP DEFAULT NOW()
);

-- Haul Cycle Timeline (Phases)
CREATE TABLE operations.haul_cycle_phase (
    phase_id         BIGSERIAL PRIMARY KEY,
    cycle_id         UUID NOT NULL REFERENCES operations.haul_cycle(cycle_id),
    sequence_no      INTEGER NOT NULL,
    phase            VARCHAR(30) NOT NULL,
    -- QUEUE_AT_SHOVEL, LOADING, WAIT_FOR_DISPATCH
    -- HAULING, QUEUE_AT_DUMP, DUMPING, RETURNING
    -- DELAY, REFUELING, BREAKDOWN
    start_time       TIMESTAMP NOT NULL,
    end_time         TIMESTAMP,
    duration_seconds INTEGER,
    location_id      UUID REFERENCES core.location(location_id)
);

-- Payload Measurements
CREATE TABLE operations.payload_measurement (
    measurement_id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    equipment_id     UUID REFERENCES core.equipment(equipment_id),
    cycle_id         UUID REFERENCES operations.haul_cycle(cycle_id),
    measured_at      TIMESTAMP DEFAULT NOW(),
    payload_tonnes   NUMERIC(12,2),
    method           VARCHAR(20) DEFAULT 'ONBOARD', -- ONBOARD, WEIGHBRIDGE, ESTIMATE
    pass_number      INTEGER DEFAULT 1
);

-- Unified Equipment Event Timeline
CREATE TABLE operations.equipment_event_timeline (
    event_id         BIGSERIAL,
    equipment_id     UUID NOT NULL REFERENCES core.equipment(equipment_id),
    event_type       VARCHAR(50) NOT NULL,
    event_subtype    VARCHAR(50),
    start_time       TIMESTAMP NOT NULL,
    end_time         TIMESTAMP,
    duration_seconds INTEGER,
    location_id      UUID REFERENCES core.location(location_id),
    operator_id      UUID,
    shift_id         UUID REFERENCES core.shift(shift_id),
    reference_id     UUID,
    payload          JSONB,
    PRIMARY KEY (event_id, start_time)
) PARTITION BY RANGE (start_time);

CREATE TABLE operations.equipment_event_timeline_2025
    PARTITION OF operations.equipment_event_timeline
    FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');

CREATE TABLE operations.equipment_event_timeline_2026
    PARTITION OF operations.equipment_event_timeline
    FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

-- Alarms
CREATE TABLE operations.alarm (
    alarm_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    equipment_id  UUID REFERENCES core.equipment(equipment_id),
    site_id       UUID REFERENCES core.mine_site(site_id),
    alarm_code    VARCHAR(50) NOT NULL,
    alarm_type    VARCHAR(50),
    -- SAFETY, MECHANICAL, OPERATIONAL, SYSTEM, GEOFENCE
    severity      VARCHAR(20) DEFAULT 'INFO',
    -- INFO, WARNING, CRITICAL, EMERGENCY
    event_time    TIMESTAMP DEFAULT NOW(),
    cleared_time  TIMESTAMP,
    message       TEXT,
    acknowledged  BOOLEAN DEFAULT FALSE,
    ack_by        UUID,
    ack_time      TIMESTAMP,
    location_id   UUID REFERENCES core.location(location_id)
);

-- Telemetry (Engine / CAN bus data)
CREATE TABLE operations.telemetry_event (
    telemetry_id  BIGSERIAL,
    equipment_id  UUID NOT NULL REFERENCES core.equipment(equipment_id),
    event_time    TIMESTAMP NOT NULL,
    engine_rpm    INTEGER,
    engine_temp_c NUMERIC(6,2),
    oil_pressure  NUMERIC(8,2),
    coolant_temp_c NUMERIC(6,2),
    battery_v     NUMERIC(6,2),
    transmission_temp_c NUMERIC(6,2),
    hydraulic_temp_c    NUMERIC(6,2),
    load_payload_t      NUMERIC(10,2),
    brake_temp_c        NUMERIC(6,2),
    tire_pressure_fl    NUMERIC(6,2),
    tire_pressure_fr    NUMERIC(6,2),
    fuel_level_pct      NUMERIC(5,2),
    adblue_level_pct    NUMERIC(5,2),
    fault_codes         JSONB,
    PRIMARY KEY (telemetry_id, event_time)
) PARTITION BY RANGE (event_time);

CREATE TABLE operations.telemetry_event_2026
    PARTITION OF operations.telemetry_event
    FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

-- ============================================================
-- MAINTENANCE SCHEMA
-- ============================================================

CREATE TABLE maintenance.maintenance_schedule (
    schedule_id    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    equipment_id   UUID REFERENCES core.equipment(equipment_id),
    maintenance_type VARCHAR(50), -- PM1000H, PM2000H, PM5000H, ANNUAL, DAILY_CHECK
    description    TEXT,
    interval_hours NUMERIC(10,2),
    interval_days  INTEGER,
    last_done_hours NUMERIC(12,2),
    last_done_date  DATE,
    next_due_hours  NUMERIC(12,2),
    next_due_date   DATE,
    active         BOOLEAN DEFAULT TRUE
);

CREATE TABLE maintenance.work_order (
    work_order_id  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    equipment_id   UUID REFERENCES core.equipment(equipment_id),
    work_order_no  VARCHAR(30) UNIQUE NOT NULL,
    wo_type        VARCHAR(30) NOT NULL,
    -- PREVENTIVE, CORRECTIVE, PREDICTIVE, INSPECTION, BREAKDOWN
    priority       VARCHAR(20) DEFAULT 'NORMAL',
    -- LOW, NORMAL, HIGH, URGENT, EMERGENCY
    title          VARCHAR(200),
    description    TEXT,
    opened_at      TIMESTAMP DEFAULT NOW(),
    scheduled_start TIMESTAMP,
    actual_start   TIMESTAMP,
    closed_at      TIMESTAMP,
    estimated_hours NUMERIC(10,2),
    actual_hours    NUMERIC(10,2),
    labor_cost      NUMERIC(15,2),
    parts_cost      NUMERIC(15,2),
    total_cost      NUMERIC(15,2),
    status         VARCHAR(20) DEFAULT 'OPEN',
    -- OPEN, SCHEDULED, IN_PROGRESS, ON_HOLD, COMPLETED, CANCELLED
    created_by     UUID,
    assigned_to    UUID,
    schedule_id    UUID REFERENCES maintenance.maintenance_schedule(schedule_id)
);

CREATE TABLE maintenance.work_order_task (
    task_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    work_order_id  UUID REFERENCES maintenance.work_order(work_order_id),
    sequence_no    INTEGER DEFAULT 1,
    description    TEXT NOT NULL,
    estimated_hours NUMERIC(10,2),
    actual_hours    NUMERIC(10,2),
    technician_id  UUID,
    status         VARCHAR(20) DEFAULT 'PENDING',
    completed_at   TIMESTAMP,
    notes          TEXT
);

CREATE TABLE maintenance.breakdown (
    breakdown_id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    equipment_id   UUID REFERENCES core.equipment(equipment_id),
    work_order_id  UUID REFERENCES maintenance.work_order(work_order_id),
    detected_time  TIMESTAMP DEFAULT NOW(),
    repaired_time  TIMESTAMP,
    system         VARCHAR(100), -- ENGINE, HYDRAULICS, ELECTRICAL, TYRES, STRUCTURE
    component      VARCHAR(100),
    failure_mode   VARCHAR(100),
    severity       VARCHAR(20) DEFAULT 'MEDIUM',
    -- LOW, MEDIUM, HIGH, CRITICAL
    description    TEXT,
    root_cause     TEXT,
    downtime_hours NUMERIC(10,2),
    repair_cost    NUMERIC(15,2)
);

CREATE TABLE maintenance.parts_inventory (
    part_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id        UUID REFERENCES core.mine_site(site_id),
    part_number    VARCHAR(50) UNIQUE NOT NULL,
    description    VARCHAR(200),
    category       VARCHAR(50),
    unit           VARCHAR(20) DEFAULT 'EA',
    qty_on_hand    NUMERIC(12,2) DEFAULT 0,
    qty_reserved   NUMERIC(12,2) DEFAULT 0,
    min_stock_level NUMERIC(12,2) DEFAULT 0,
    unit_cost      NUMERIC(15,2),
    location       VARCHAR(100)
);

CREATE TABLE maintenance.work_order_part (
    id             BIGSERIAL PRIMARY KEY,
    work_order_id  UUID REFERENCES maintenance.work_order(work_order_id),
    part_id        UUID REFERENCES maintenance.parts_inventory(part_id),
    qty_requested  NUMERIC(12,2),
    qty_used       NUMERIC(12,2),
    unit_cost      NUMERIC(15,2)
);

-- Equipment Health Scoring
CREATE TABLE maintenance.equipment_health (
    health_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    equipment_id   UUID REFERENCES core.equipment(equipment_id),
    assessed_at    TIMESTAMP DEFAULT NOW(),
    overall_score  INTEGER CHECK (overall_score BETWEEN 0 AND 100),
    engine_score   INTEGER,
    hydraulics_score INTEGER,
    structural_score INTEGER,
    electrical_score INTEGER,
    tyres_score    INTEGER,
    mtbf_hours     NUMERIC(10,2), -- Mean Time Between Failures
    mttr_hours     NUMERIC(10,2), -- Mean Time To Repair
    availability_pct NUMERIC(5,2),
    notes          TEXT
);

-- ============================================================
-- FUEL SCHEMA
-- ============================================================

CREATE TABLE fuel.fuel_station (
    station_id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id        UUID REFERENCES core.mine_site(site_id),
    location_id    UUID REFERENCES core.location(location_id),
    name           VARCHAR(100),
    fuel_type      VARCHAR(20) DEFAULT 'DIESEL',
    tank_capacity_l NUMERIC(15,2),
    current_level_l NUMERIC(15,2),
    active         BOOLEAN DEFAULT TRUE
);

CREATE TABLE fuel.fuel_inventory (
    inventory_id   BIGSERIAL PRIMARY KEY,
    station_id     UUID REFERENCES fuel.fuel_station(station_id),
    recorded_at    TIMESTAMP DEFAULT NOW(),
    level_liters   NUMERIC(15,2),
    daily_consumption NUMERIC(12,2),
    days_remaining NUMERIC(8,2)
);

CREATE TABLE fuel.fuel_transaction (
    transaction_id  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    equipment_id    UUID REFERENCES core.equipment(equipment_id),
    station_id      UUID REFERENCES fuel.fuel_station(station_id),
    operator_id     UUID REFERENCES core.operator(operator_id),
    shift_id        UUID REFERENCES core.shift(shift_id),
    transaction_time TIMESTAMP DEFAULT NOW(),
    quantity_liters NUMERIC(12,2) NOT NULL,
    fuel_type       VARCHAR(20) DEFAULT 'DIESEL',
    unit_cost       NUMERIC(10,4),
    total_cost      NUMERIC(15,2),
    odometer_km     NUMERIC(12,2),
    engine_hours    NUMERIC(12,2),
    tank_level_before NUMERIC(5,2),
    tank_level_after  NUMERIC(5,2),
    authorized_by   UUID,
    reference_no    VARCHAR(50)
);

-- Fuel Efficiency Benchmarks
CREATE TABLE fuel.fuel_benchmark (
    benchmark_id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    equipment_id   UUID REFERENCES core.equipment(equipment_id),
    period_date    DATE,
    liters_per_hour NUMERIC(10,3),
    liters_per_tonne NUMERIC(10,3),
    liters_per_km  NUMERIC(10,3),
    total_liters   NUMERIC(12,2),
    operating_hours NUMERIC(10,2)
);

-- ============================================================
-- TYRE MANAGEMENT
-- ============================================================

CREATE TABLE core.tyre (
    tyre_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    serial_number  VARCHAR(50) UNIQUE,
    manufacturer   VARCHAR(50),
    model          VARCHAR(100),
    size           VARCHAR(30),
    ply_rating     VARCHAR(10),
    purchase_date  DATE,
    purchase_cost  NUMERIC(15,2),
    status         VARCHAR(20) DEFAULT 'NEW',
    -- NEW, INSTALLED, RETREADED, SCRAPPED
    total_hours    NUMERIC(10,2) DEFAULT 0,
    total_km       NUMERIC(12,2) DEFAULT 0
);

CREATE TABLE core.tyre_installation (
    installation_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tyre_id         UUID REFERENCES core.tyre(tyre_id),
    equipment_id    UUID REFERENCES core.equipment(equipment_id),
    position_code   VARCHAR(10) NOT NULL,
    -- FL, FR, RL1, RL2, RR1, RR2
    install_date    DATE NOT NULL,
    install_hours   NUMERIC(12,2),
    removal_date    DATE,
    removal_hours   NUMERIC(12,2),
    removal_reason  VARCHAR(50),
    hours_on_wheel  NUMERIC(10,2)
);

-- Tyre Pressure Monitoring
CREATE TABLE core.tyre_pressure_log (
    log_id         BIGSERIAL PRIMARY KEY,
    equipment_id   UUID REFERENCES core.equipment(equipment_id),
    tyre_id        UUID REFERENCES core.tyre(tyre_id),
    position_code  VARCHAR(10),
    recorded_at    TIMESTAMP DEFAULT NOW(),
    pressure_kpa   NUMERIC(8,2),
    temp_c         NUMERIC(6,2),
    status         VARCHAR(20)
    -- OK, LOW, HIGH, CRITICAL
);

-- ============================================================
-- USERS & ROLES
-- ============================================================

CREATE TABLE core.role (
    role_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role_name      VARCHAR(50) UNIQUE NOT NULL,
    description    VARCHAR(200),
    permissions    JSONB DEFAULT '{}'
);

CREATE TABLE core.app_user (
    user_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id        UUID REFERENCES core.mine_site(site_id),
    role_id        UUID REFERENCES core.role(role_id),
    username       VARCHAR(50) UNIQUE NOT NULL,
    email          VARCHAR(100) UNIQUE,
    password_hash  TEXT NOT NULL,
    first_name     VARCHAR(100),
    last_name      VARCHAR(100),
    operator_id    UUID REFERENCES core.operator(operator_id),
    last_login     TIMESTAMP,
    active         BOOLEAN DEFAULT TRUE,
    created_at     TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- REPORTING
-- ============================================================

CREATE TABLE reporting.kpi_snapshot (
    snapshot_id    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id        UUID REFERENCES core.mine_site(site_id),
    shift_id       UUID REFERENCES core.shift(shift_id),
    snapshot_time  TIMESTAMP DEFAULT NOW(),
    period_type    VARCHAR(20), -- HOURLY, SHIFT, DAILY, WEEKLY, MONTHLY
    tonnes_moved   NUMERIC(15,2),
    loads_completed INTEGER,
    avg_cycle_time_s NUMERIC(10,2),
    avg_payload_t  NUMERIC(10,2),
    fleet_utilization_pct NUMERIC(5,2),
    availability_pct NUMERIC(5,2),
    oee_pct        NUMERIC(5,2),
    fuel_consumed_l NUMERIC(15,2),
    active_trucks  INTEGER,
    active_loaders INTEGER,
    total_downtime_h NUMERIC(10,2),
    payload_factor NUMERIC(5,3),
    bcm_moved      NUMERIC(15,2)
);
