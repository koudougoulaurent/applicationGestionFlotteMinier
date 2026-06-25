-- ============================================================
-- FMS MINING - SEED DATA (Demo Mine)
-- ============================================================

-- Mine Site
INSERT INTO core.mine_site (site_id, code, name, country, region, timezone, latitude, longitude, elevation)
VALUES ('a1b2c3d4-0001-0001-0001-000000000001', 'KGHM-01', 'Nchanga Open-Pit Mine', 'Zambia', 'Copperbelt', 'Africa/Lusaka', -12.5, 27.85, 1250);

-- Shift Definitions
INSERT INTO core.shift_definition (shift_def_id, site_id, shift_name, start_hour, duration_hours, color)
VALUES
('5d000001-0000-0000-0000-000000000001', 'a1b2c3d4-0001-0001-0001-000000000001', 'Day Shift',   6, 12, '#FFC107'),
('5d000001-0000-0000-0000-000000000002', 'a1b2c3d4-0001-0001-0001-000000000001', 'Night Shift', 18, 12, '#3F51B5');

-- Active Shift
INSERT INTO core.shift (shift_id, site_id, shift_def_id, shift_date, start_time, status)
VALUES
('5a000001-0000-0000-0000-000000000001', 'a1b2c3d4-0001-0001-0001-000000000001',
 '5d000001-0000-0000-0000-000000000001', CURRENT_DATE,
 DATE_TRUNC('day', NOW()) + INTERVAL '6 hours', 'ACTIVE');

-- Locations
INSERT INTO core.location (location_id, site_id, code, name, location_type, latitude, longitude, elevation, radius_m) VALUES
('10c00001-0000-0000-0000-000000000001', 'a1b2c3d4-0001-0001-0001-000000000001', 'PIT-1',   'Pit North Face',   'PIT',         -12.490, 27.840, 1200, 300),
('10c00001-0000-0000-0000-000000000002', 'a1b2c3d4-0001-0001-0001-000000000001', 'PIT-2',   'Pit South Bench',  'PIT',         -12.510, 27.850, 1180, 300),
('10c00001-0000-0000-0000-000000000003', 'a1b2c3d4-0001-0001-0001-000000000001', 'PIT-3',   'Pit East Face',    'PIT',         -12.500, 27.870, 1190, 300),
('10c00001-0000-0000-0000-000000000004', 'a1b2c3d4-0001-0001-0001-000000000001', 'DUMP-1',  'Waste Dump North', 'DUMP',        -12.470, 27.830, 1270, 400),
('10c00001-0000-0000-0000-000000000005', 'a1b2c3d4-0001-0001-0001-000000000001', 'DUMP-2',  'Waste Dump East',  'DUMP',        -12.490, 27.890, 1260, 400),
('10c00001-0000-0000-0000-000000000006', 'a1b2c3d4-0001-0001-0001-000000000001', 'STCK-1',  'Ore Stockpile A',  'STOCKPILE',   -12.520, 27.835, 1255, 200),
('10c00001-0000-0000-0000-000000000007', 'a1b2c3d4-0001-0001-0001-000000000001', 'CRUSH-1', 'Primary Crusher',  'CRUSHER',     -12.525, 27.840, 1250, 150),
('10c00001-0000-0000-0000-000000000008', 'a1b2c3d4-0001-0001-0001-000000000001', 'FUEL-1',  'Main Fuel Station','FUEL_STATION', -12.505, 27.855, 1255, 100),
('10c00001-0000-0000-0000-000000000009', 'a1b2c3d4-0001-0001-0001-000000000001', 'SHOP-1',  'Main Workshop',    'WORKSHOP',    -12.508, 27.858, 1255, 200),
('10c00001-0000-0000-0000-000000000010', 'a1b2c3d4-0001-0001-0001-000000000001', 'PARK-1',  'Truck Parking',    'PARKING',     -12.503, 27.852, 1256, 200);

-- Update geom from lat/lon
UPDATE core.location SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
WHERE geom IS NULL;

-- Equipment Types
INSERT INTO core.equipment_type (type_id, code, name, category, manufacturer, icon) VALUES
('e0000001-0000-0000-0000-000000000001', 'CAT-797F',   'CAT 797F Haul Truck',    'TRUCK',     'Caterpillar', 'truck'),
('e0000001-0000-0000-0000-000000000002', 'CAT-793F',   'CAT 793F Haul Truck',    'TRUCK',     'Caterpillar', 'truck'),
('e0000001-0000-0000-0000-000000000003', 'KOM-930E',   'Komatsu 930E Haul Truck','TRUCK',     'Komatsu',     'truck'),
('e0000001-0000-0000-0000-000000000004', 'CAT-6060',   'CAT 6060 Hydraulic Shovel','EXCAVATOR','Caterpillar', 'excavator'),
('e0000001-0000-0000-0000-000000000005', 'LIE-996',    'Liebherr R 9600 Shovel', 'EXCAVATOR', 'Liebherr',    'excavator'),
('e0000001-0000-0000-0000-000000000006', 'CAT-D11',    'CAT D11 Dozer',          'DOZER',     'Caterpillar', 'dozer'),
('e0000001-0000-0000-0000-000000000007', 'CAT-16M',    'CAT 16M Motor Grader',   'GRADER',    'Caterpillar', 'grader'),
('e0000001-0000-0000-0000-000000000008', 'KOM-WA900',  'Komatsu WA900 Loader',   'LOADER',    'Komatsu',     'loader'),
('e0000001-0000-0000-0000-000000000009', 'CAT-MD6250', 'CAT MD6250 Rotary Drill','DRILL',     'Caterpillar', 'drill'),
('e0000001-0000-0000-0000-000000000010', 'CAT-WT',     'CAT Water Truck',        'WATER_TRUCK','Caterpillar','water-truck');

-- Materials
INSERT INTO core.material VALUES
(uuid_generate_v4(), 'ORE-CU',  'Copper Ore',  'ORE',        2.8, 1.35, 0.5, '#B87333'),
(uuid_generate_v4(), 'WASTE',   'Waste Rock',  'WASTE',      2.7, 1.30, NULL, '#757575'),
(uuid_generate_v4(), 'OVRB',    'Overburden',  'OVERBURDEN', 2.2, 1.25, NULL, '#8D6E63'),
(uuid_generate_v4(), 'TOPSOIL', 'Top Soil',    'TOPSOIL',    1.5, 1.20, NULL, '#4CAF50');

-- Roles
INSERT INTO core.role (role_id, role_name, description) VALUES
('a01e0001-0000-0000-0000-000000000001', 'ADMIN',                'Full system access'),
('a01e0001-0000-0000-0000-000000000002', 'DISPATCHER',           'Real-time dispatch operations'),
('a01e0001-0000-0000-0000-000000000003', 'SUPERVISOR',           'Shift supervision'),
('a01e0001-0000-0000-0000-000000000004', 'MAINTENANCE_MANAGER',  'Maintenance management'),
('a01e0001-0000-0000-0000-000000000005', 'MINE_ENGINEER',        'Planning and reporting'),
('a01e0001-0000-0000-0000-000000000006', 'OPERATOR',             'Equipment operator view');

-- Admin User (password: Admin@Mine2024)
INSERT INTO core.app_user (user_id, site_id, role_id, username, email, password_hash, first_name, last_name)
VALUES (
    uuid_generate_v4(),
    'a1b2c3d4-0001-0001-0001-000000000001',
    'a01e0001-0000-0000-0000-000000000001',
    'admin',
    'admin@mine.com',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/iewmO3.pj/ZNJN9Qm',
    'System', 'Administrator'
);

-- Dispatcher User (password: Dispatch@2024)
INSERT INTO core.app_user (user_id, site_id, role_id, username, email, password_hash, first_name, last_name)
VALUES (
    uuid_generate_v4(),
    'a1b2c3d4-0001-0001-0001-000000000001',
    'a01e0001-0000-0000-0000-000000000002',
    'dispatcher',
    'dispatcher@mine.com',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/iewmO3.pj/ZNJN9Qm',
    'Jean', 'Dupont'
);

-- Equipment (Haul Trucks)
INSERT INTO core.equipment (equipment_id, site_id, type_id, fleet_number, model, year_manufactured, payload_capacity, fuel_capacity, current_hours, current_km, status, latitude, longitude, active)
VALUES
('eb000001-0000-0000-0000-000000000001','a1b2c3d4-0001-0001-0001-000000000001','e0000001-0000-0000-0000-000000000001','DT-101','CAT 797F',2019,363,4732,12450,95000,'HAULING',-12.495,27.845,TRUE),
('eb000001-0000-0000-0000-000000000002','a1b2c3d4-0001-0001-0001-000000000001','e0000001-0000-0000-0000-000000000001','DT-102','CAT 797F',2019,363,4732,11200,88000,'LOADING',-12.493,27.842,TRUE),
('eb000001-0000-0000-0000-000000000003','a1b2c3d4-0001-0001-0001-000000000001','e0000001-0000-0000-0000-000000000001','DT-103','CAT 797F',2020,363,4732,9800,75000,'RETURNING',-12.497,27.847,TRUE),
('eb000001-0000-0000-0000-000000000004','a1b2c3d4-0001-0001-0001-000000000001','e0000001-0000-0000-0000-000000000002','DT-104','CAT 793F',2018,227,3028,18500,142000,'AVAILABLE',-12.503,27.852,TRUE),
('eb000001-0000-0000-0000-000000000005','a1b2c3d4-0001-0001-0001-000000000001','e0000001-0000-0000-0000-000000000002','DT-105','CAT 793F',2018,227,3028,17200,133000,'DUMPING',-12.519,27.836,TRUE),
('eb000001-0000-0000-0000-000000000006','a1b2c3d4-0001-0001-0001-000000000001','e0000001-0000-0000-0000-000000000003','DT-106','Komatsu 930E',2021,290,4500,8100,64000,'HAULING',-12.501,27.861,TRUE),
('eb000001-0000-0000-0000-000000000007','a1b2c3d4-0001-0001-0001-000000000001','e0000001-0000-0000-0000-000000000003','DT-107','Komatsu 930E',2021,290,4500,7800,61000,'DOWN',-12.508,27.858,TRUE),
('eb000001-0000-0000-0000-000000000008','a1b2c3d4-0001-0001-0001-000000000001','e0000001-0000-0000-0000-000000000002','DT-108','CAT 793F',2017,227,3028,21000,165000,'MAINTENANCE',-12.508,27.858,TRUE),
('eb000001-0000-0000-0000-000000000009','a1b2c3d4-0001-0001-0001-000000000001','e0000001-0000-0000-0000-000000000001','DT-109','CAT 797F',2022,363,4732,5200,41000,'QUEUING',-12.491,27.841,TRUE),
('eb000001-0000-0000-0000-000000000010','a1b2c3d4-0001-0001-0001-000000000001','e0000001-0000-0000-0000-000000000002','DT-110','CAT 793F',2020,227,3028,10800,84000,'REFUELING',-12.505,27.855,TRUE);

-- Excavators
INSERT INTO core.equipment (equipment_id, site_id, type_id, fleet_number, model, year_manufactured, payload_capacity, fuel_capacity, current_hours, current_km, status, latitude, longitude, active)
VALUES
('eb000001-0000-0000-0000-000000000011','a1b2c3d4-0001-0001-0001-000000000001','e0000001-0000-0000-0000-000000000004','EX-201','CAT 6060',2018,600,10000,14200,0,'OPERATING',-12.493,27.841,TRUE),
('eb000001-0000-0000-0000-000000000012','a1b2c3d4-0001-0001-0001-000000000001','e0000001-0000-0000-0000-000000000005','EX-202','Liebherr R 9600',2020,600,10000,9800,0,'OPERATING',-12.509,27.869,TRUE),
('eb000001-0000-0000-0000-000000000013','a1b2c3d4-0001-0001-0001-000000000001','e0000001-0000-0000-0000-000000000004','EX-203','CAT 6060',2021,600,10000,7200,0,'IDLE',-12.499,27.849,TRUE);

-- Dozers
INSERT INTO core.equipment (equipment_id, site_id, type_id, fleet_number, model, year_manufactured, payload_capacity, fuel_capacity, current_hours, current_km, status, latitude, longitude, active)
VALUES
('eb000001-0000-0000-0000-000000000014','a1b2c3d4-0001-0001-0001-000000000001','e0000001-0000-0000-0000-000000000006','DZ-301','CAT D11',2019,NULL,1930,11500,0,'OPERATING',-12.468,27.829,TRUE),
('eb000001-0000-0000-0000-000000000015','a1b2c3d4-0001-0001-0001-000000000001','e0000001-0000-0000-0000-000000000006','DZ-302','CAT D11',2020,NULL,1930,9200,0,'AVAILABLE',-12.470,27.831,TRUE);

-- Grader
INSERT INTO core.equipment (equipment_id, site_id, type_id, fleet_number, model, year_manufactured, payload_capacity, fuel_capacity, current_hours, current_km, status, latitude, longitude, active)
VALUES
('eb000001-0000-0000-0000-000000000016','a1b2c3d4-0001-0001-0001-000000000001','e0000001-0000-0000-0000-000000000007','GR-401','CAT 16M',2019,NULL,550,8900,72000,'OPERATING',-12.479,27.837,TRUE);

-- Operators
INSERT INTO core.operator (operator_id, site_id, employee_no, first_name, last_name, certification_level, phone, hire_date, active) VALUES
('0b000001-0000-0000-0000-000000000001','a1b2c3d4-0001-0001-0001-000000000001','EMP-001','Moses','Banda','SENIOR','+260971000001','2018-03-15',TRUE),
('0b000001-0000-0000-0000-000000000002','a1b2c3d4-0001-0001-0001-000000000001','EMP-002','Grace','Mutale','OPERATOR','+260971000002','2019-06-20',TRUE),
('0b000001-0000-0000-0000-000000000003','a1b2c3d4-0001-0001-0001-000000000001','EMP-003','John','Mwanza','SENIOR','+260971000003','2017-11-10',TRUE),
('0b000001-0000-0000-0000-000000000004','a1b2c3d4-0001-0001-0001-000000000001','EMP-004','Alice','Phiri','OPERATOR','+260971000004','2020-01-08',TRUE),
('0b000001-0000-0000-0000-000000000005','a1b2c3d4-0001-0001-0001-000000000001','EMP-005','Patrick','Lungu','SENIOR','+260971000005','2016-07-25',TRUE),
('0b000001-0000-0000-0000-000000000006','a1b2c3d4-0001-0001-0001-000000000001','EMP-006','Catherine','Zulu','OPERATOR','+260971000006','2021-04-12',TRUE),
('0b000001-0000-0000-0000-000000000007','a1b2c3d4-0001-0001-0001-000000000001','EMP-007','David','Tembo','SUPERVISOR','+260971000007','2015-02-18',TRUE),
('0b000001-0000-0000-0000-000000000008','a1b2c3d4-0001-0001-0001-000000000001','EMP-008','Susan','Njovu','OPERATOR','+260971000008','2022-09-30',TRUE);

-- Assign operators to equipment
UPDATE core.equipment SET current_operator_id = '0b000001-0000-0000-0000-000000000001' WHERE equipment_id = 'eb000001-0000-0000-0000-000000000001';
UPDATE core.equipment SET current_operator_id = '0b000001-0000-0000-0000-000000000002' WHERE equipment_id = 'eb000001-0000-0000-0000-000000000002';
UPDATE core.equipment SET current_operator_id = '0b000001-0000-0000-0000-000000000003' WHERE equipment_id = 'eb000001-0000-0000-0000-000000000003';
UPDATE core.equipment SET current_operator_id = '0b000001-0000-0000-0000-000000000005' WHERE equipment_id = 'eb000001-0000-0000-0000-000000000006';

-- Sample haul cycles (last 2 hours)
INSERT INTO operations.haul_cycle (cycle_id, site_id, shift_id, truck_id, loader_id, operator_id, material_id, source_location_id, dest_location_id,
    cycle_start, cycle_end, total_duration_s, queue_duration_s, loading_duration_s, haul_duration_s, dump_duration_s, return_duration_s,
    payload_tonnes, target_payload, payload_factor, distance_km)
SELECT
    uuid_generate_v4(),
    'a1b2c3d4-0001-0001-0001-000000000001',
    '5a000001-0000-0000-0000-000000000001',
    truck_id,
    loader_id,
    operator_id,
    (SELECT material_id FROM core.material WHERE code = 'ORE-CU' LIMIT 1),
    '10c00001-0000-0000-0000-000000000001',
    '10c00001-0000-0000-0000-000000000007',
    NOW() - (n || ' minutes')::INTERVAL - INTERVAL '42 minutes',
    NOW() - (n || ' minutes')::INTERVAL,
    2520,
    180, 420, 780, 240, 600,
    -- payload between 280-370t for 797F
    320 + (RANDOM() * 50)::INT,
    363,
    0.92,
    4.2
FROM (
    SELECT 'eb000001-0000-0000-0000-000000000001'::UUID AS truck_id,
           'eb000001-0000-0000-0000-000000000011'::UUID AS loader_id,
           '0b000001-0000-0000-0000-000000000001'::UUID AS operator_id,
           n
    FROM generate_series(5, 120, 42) AS n
    UNION ALL
    SELECT 'eb000001-0000-0000-0000-000000000002'::UUID,
           'eb000001-0000-0000-0000-000000000011'::UUID,
           '0b000001-0000-0000-0000-000000000002'::UUID,
           n
    FROM generate_series(7, 120, 44) AS n
    UNION ALL
    SELECT 'eb000001-0000-0000-0000-000000000003'::UUID,
           'eb000001-0000-0000-0000-000000000012'::UUID,
           '0b000001-0000-0000-0000-000000000003'::UUID,
           n
    FROM generate_series(3, 120, 43) AS n
) sub;

-- Fuel Station (inserted before transactions so FK is satisfied)
INSERT INTO fuel.fuel_station (station_id, site_id, location_id, name, tank_capacity_l, current_level_l)
VALUES ('f0e10000-0000-0000-0000-000000000001', 'a1b2c3d4-0001-0001-0001-000000000001', '10c00001-0000-0000-0000-000000000008', 'Main Fuel Station', 500000, 312000)
ON CONFLICT DO NOTHING;

-- Fuel Transactions
INSERT INTO fuel.fuel_transaction (equipment_id, station_id, operator_id, shift_id, quantity_liters, unit_cost, total_cost, odometer_km, engine_hours)
VALUES
('eb000001-0000-0000-0000-000000000001','f0e10000-0000-0000-0000-000000000001','0b000001-0000-0000-0000-000000000001','5a000001-0000-0000-0000-000000000001',850,1.45,1232.50,95000,12450),
('eb000001-0000-0000-0000-000000000002','f0e10000-0000-0000-0000-000000000001','0b000001-0000-0000-0000-000000000002','5a000001-0000-0000-0000-000000000001',920,1.45,1334.00,88000,11200),
('eb000001-0000-0000-0000-000000000003','f0e10000-0000-0000-0000-000000000001','0b000001-0000-0000-0000-000000000003','5a000001-0000-0000-0000-000000000001',780,1.45,1131.00,75000,9800),
('eb000001-0000-0000-0000-000000000006','f0e10000-0000-0000-0000-000000000001','0b000001-0000-0000-0000-000000000005','5a000001-0000-0000-0000-000000000001',650,1.45, 942.50,64000,8100);

-- Active Alarms
INSERT INTO operations.alarm (equipment_id, site_id, alarm_code, alarm_type, severity, message, acknowledged)
VALUES
('eb000001-0000-0000-0000-000000000007','a1b2c3d4-0001-0001-0001-000000000001','BREAKDOWN_001','MECHANICAL','CRITICAL','Engine overheating detected - immediate shutdown',FALSE),
('eb000001-0000-0000-0000-000000000008','a1b2c3d4-0001-0001-0001-000000000001','PM_DUE_001','OPERATIONAL','WARNING','Scheduled PM2000H overdue by 50 hours',TRUE),
('eb000001-0000-0000-0000-000000000010','a1b2c3d4-0001-0001-0001-000000000001','FUEL_LOW_001','OPERATIONAL','WARNING','Fuel level below 15%',FALSE),
('eb000001-0000-0000-0000-000000000009','a1b2c3d4-0001-0001-0001-000000000001','QUEUE_TIME','OPERATIONAL','INFO','Queue time exceeds 15 minutes at EX-201',FALSE);

-- Maintenance Breakdown Record
INSERT INTO maintenance.work_order (work_order_no, equipment_id, wo_type, priority, title, description, status, opened_at)
VALUES
('WO-2024-0501','eb000001-0000-0000-0000-000000000007','BREAKDOWN','EMERGENCY','Engine Overheating - DT-107','Engine coolant temperature critical alarm triggered. Unit shut down for investigation.',  'IN_PROGRESS', NOW() - INTERVAL '30 minutes'),
('WO-2024-0502','eb000001-0000-0000-0000-000000000008','PREVENTIVE','HIGH','PM2000H Service - DT-108','Scheduled 2000 hour preventive maintenance service', 'IN_PROGRESS', NOW() - INTERVAL '4 hours');

INSERT INTO maintenance.breakdown (equipment_id, detected_time, system, component, severity, description)
VALUES
('eb000001-0000-0000-0000-000000000007', NOW() - INTERVAL '30 minutes', 'ENGINE', 'Cooling System', 'CRITICAL', 'Coolant temperature exceeded 115°C. Likely coolant leak or thermostat failure.');

-- Maintenance Schedule for PM
INSERT INTO maintenance.maintenance_schedule (equipment_id, maintenance_type, description, interval_hours, last_done_hours, next_due_hours)
SELECT e.equipment_id, 'PM250H', '250 Hour Service', 250,
    ROUND(e.current_hours / 250) * 250,
    (ROUND(e.current_hours / 250) + 1) * 250
FROM core.equipment e
WHERE e.active = TRUE;

INSERT INTO maintenance.maintenance_schedule (equipment_id, maintenance_type, description, interval_hours, last_done_hours, next_due_hours)
SELECT e.equipment_id, 'PM1000H', '1000 Hour Service', 1000,
    ROUND(e.current_hours / 1000) * 1000,
    (ROUND(e.current_hours / 1000) + 1) * 1000
FROM core.equipment e
WHERE e.active = TRUE;

-- Production Plan for current shift
INSERT INTO operations.production_plan (site_id, shift_id, plan_date, target_tonnes, target_loads, source_location_id, dest_location_id)
SELECT
    'a1b2c3d4-0001-0001-0001-000000000001',
    '5a000001-0000-0000-0000-000000000001',
    CURRENT_DATE,
    24000,
    72,
    '10c00001-0000-0000-0000-000000000001',
    '10c00001-0000-0000-0000-000000000007';

-- Haul Roads
INSERT INTO core.haul_road (site_id, name, start_location_id, end_location_id, distance_km, avg_gradient, speed_limit_kmh, road_class)
VALUES
('a1b2c3d4-0001-0001-0001-000000000001', 'Pit North to Crusher', '10c00001-0000-0000-0000-000000000001', '10c00001-0000-0000-0000-000000000007', 4.2, -8.5, 40, 'PRIMARY'),
('a1b2c3d4-0001-0001-0001-000000000001', 'Pit South to Crusher', '10c00001-0000-0000-0000-000000000002', '10c00001-0000-0000-0000-000000000007', 3.8, -7.2, 40, 'PRIMARY'),
('a1b2c3d4-0001-0001-0001-000000000001', 'Pit North to Dump 1',  '10c00001-0000-0000-0000-000000000001', '10c00001-0000-0000-0000-000000000004', 2.8, -3.0, 50, 'PRIMARY'),
('a1b2c3d4-0001-0001-0001-000000000001', 'Pit East to Dump 2',   '10c00001-0000-0000-0000-000000000003', '10c00001-0000-0000-0000-000000000005', 3.5,  4.2, 40, 'PRIMARY');

-- Fuel Station already inserted above before fuel_transaction
