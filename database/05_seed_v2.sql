-- ============================================================
-- FMS MINING - SUPPLEMENTAL SEED DATA v2
-- Tyres, Weather Station, Telemetry simulation data
-- ============================================================

-- ── Weather Station ──────────────────────────────────────────
INSERT INTO core.weather_station (station_id, site_id, name, latitude, longitude)
VALUES ('6b000001-0000-0000-0000-000000000001', 'a1b2c3d4-0001-0001-0001-000000000001', 'Mine Weather Station', -12.500, 27.855)
ON CONFLICT DO NOTHING;

-- Initial weather reading
INSERT INTO core.weather_reading (station_id, temperature_c, humidity_pct, wind_speed_ms, wind_dir_deg, rainfall_mm, visibility_m, dust_index)
VALUES ('6b000001-0000-0000-0000-000000000001', 28.5, 62, 3.2, 180, 0, 5000, 3)
ON CONFLICT DO NOTHING;

-- ── Tyres (Stock + Installed on trucks) ──────────────────────
-- Add 6 tyres per haul truck (DT-101 to DT-106 = 36 tyres installed)
-- Plus 8 in stock

DO $$
DECLARE
  truck_ids UUID[];
  truck_id UUID;
  positions TEXT[] := ARRAY['FL','FR','RL1','RL2','RR1','RR2'];
  pos TEXT;
  new_tyre_id UUID;
  truck_hours NUMERIC;
  install_hours NUMERIC;
  i INT;
BEGIN
  -- Get first 6 trucks
  SELECT ARRAY(
    SELECT e.equipment_id
    FROM core.equipment e
    JOIN core.equipment_type et ON e.type_id = et.type_id
    WHERE et.category = 'TRUCK' AND e.active = TRUE
    ORDER BY e.fleet_number
    LIMIT 6
  ) INTO truck_ids;

  FOREACH truck_id IN ARRAY truck_ids
  LOOP
    SELECT current_hours INTO truck_hours FROM core.equipment WHERE equipment_id = truck_id;
    i := 0;

    FOREACH pos IN ARRAY positions
    LOOP
      i := i + 1;
      new_tyre_id := gen_random_uuid();

      -- Create tyre
      INSERT INTO core.tyre (tyre_id, serial_number, manufacturer, model, size, ply_rating, purchase_date, purchase_cost, total_hours, status)
      VALUES (
        new_tyre_id,
        'TYR-' || UPPER(SUBSTR(truck_id::TEXT, 1, 4)) || '-' || pos,
        CASE (i % 3) WHEN 0 THEN 'Michelin' WHEN 1 THEN 'Bridgestone' ELSE 'Goodyear' END,
        CASE (i % 3) WHEN 0 THEN 'XADN' WHEN 1 THEN 'VSNT' ELSE 'ORE D' END,
        '27.00R49',
        40,
        CURRENT_DATE - (RANDOM() * 730)::INT,
        ROUND((28000 + RANDOM() * 5000)::NUMERIC, 0),
        ROUND((truck_hours * 0.6 + RANDOM() * truck_hours * 0.2)::NUMERIC, 0),
        'INSTALLED'
      );

      -- Install on equipment
      install_hours := ROUND((truck_hours * 0.4 + RANDOM() * truck_hours * 0.2)::NUMERIC, 0);

      INSERT INTO core.tyre_installation (tyre_id, equipment_id, position_code, install_date, install_hours)
      VALUES (
        new_tyre_id,
        truck_id,
        pos,
        CURRENT_DATE - (RANDOM() * 90)::INT,
        install_hours
      );
    END LOOP;
  END LOOP;

  -- 8 spare tyres in stock
  FOR i IN 1..8 LOOP
    INSERT INTO core.tyre (serial_number, manufacturer, model, size, ply_rating, purchase_date, purchase_cost, total_hours, status)
    VALUES (
      'TYR-STOCK-' || LPAD(i::TEXT, 3, '0'),
      CASE (i % 3) WHEN 0 THEN 'Michelin' WHEN 1 THEN 'Bridgestone' ELSE 'Goodyear' END,
      CASE (i % 3) WHEN 0 THEN 'XADN' WHEN 1 THEN 'VSNT' ELSE 'ORE D' END,
      '27.00R49',
      40,
      CURRENT_DATE - (RANDOM() * 30)::INT,
      ROUND((28000 + RANDOM() * 5000)::NUMERIC, 0),
      0,
      'NEW'
    );
  END LOOP;
END $$;

-- ── Telemetry (last 4 hours, every 20 min) ───────────────────
DO $$
DECLARE
  eq RECORD;
  ts TIMESTAMPTZ;
  is_op BOOLEAN;
BEGIN
  FOR eq IN
    SELECT e.equipment_id, e.status, et.category
    FROM core.equipment e
    JOIN core.equipment_type et ON e.type_id = et.type_id
    WHERE et.category IN ('TRUCK', 'EXCAVATOR', 'LOADER')
    AND e.active = TRUE
  LOOP
    -- Generate readings every 20 minutes for last 4 hours
    FOR i IN REVERSE 12..0
    LOOP
      ts := NOW() - (i * INTERVAL '20 minutes');
      is_op := eq.status IN ('OPERATING','HAULING','LOADING','DUMPING','RETURNING');

      INSERT INTO operations.telemetry_event
        (equipment_id, event_time, engine_rpm, engine_temp_c, oil_pressure,
         coolant_temp_c, hydraulic_temp_c, fuel_level_pct, brake_temp_c)
      VALUES (
        eq.equipment_id,
        ts,
        CASE WHEN is_op THEN ROUND((1600 + RANDOM() * 600)::NUMERIC, 0)
                         ELSE ROUND((700 + RANDOM() * 200)::NUMERIC, 0) END,
        CASE WHEN is_op THEN ROUND((82 + RANDOM() * 12)::NUMERIC, 1)
                         ELSE ROUND((58 + RANDOM() * 8)::NUMERIC, 1) END,
        CASE WHEN is_op THEN ROUND((4.5 + RANDOM() * 2.5)::NUMERIC, 1)
                         ELSE ROUND((3.5 + RANDOM() * 1.5)::NUMERIC, 1) END,
        CASE WHEN is_op THEN ROUND((85 + RANDOM() * 10)::NUMERIC, 1)
                         ELSE ROUND((65 + RANDOM() * 10)::NUMERIC, 1) END,
        CASE WHEN is_op THEN ROUND((65 + RANDOM() * 20)::NUMERIC, 1)
                         ELSE ROUND((45 + RANDOM() * 15)::NUMERIC, 1) END,
        ROUND((25 + RANDOM() * 70)::NUMERIC, 0),
        CASE WHEN is_op THEN ROUND((40 + RANDOM() * 80)::NUMERIC, 0)
                         ELSE ROUND((25 + RANDOM() * 30)::NUMERIC, 0) END
      );
    END LOOP;
  END LOOP;
END $$;

-- ── Operator Assignments for current shift ──────────────────
INSERT INTO operations.operator_assignment (operator_id, equipment_id, shift_id, start_time, status)
SELECT
  o.operator_id,
  e.equipment_id,
  '5a000001-0000-0000-0000-000000000001',
  DATE_TRUNC('day', NOW()) + INTERVAL '6 hours',
  'ACTIVE'
FROM core.equipment e
JOIN core.operator o ON e.current_operator_id = o.operator_id
WHERE e.current_operator_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ── Additional Fuel Transactions for trend data ─────────────
-- Generate 30 days of daily fuel transactions
DO $$
DECLARE
  truck RECORD;
  d INT;
  tx_time TIMESTAMPTZ;
BEGIN
  FOR d IN REVERSE 30..1 LOOP
    FOR truck IN
      SELECT e.equipment_id, e.current_operator_id
      FROM core.equipment e
      JOIN core.equipment_type et ON e.type_id = et.type_id
      WHERE et.category = 'TRUCK' AND e.active = TRUE
      LIMIT 8
    LOOP
      tx_time := DATE_TRUNC('day', NOW()) - (d || ' days')::INTERVAL
                 + ((6 + (RANDOM() * 10)::INT) || ' hours')::INTERVAL;

      INSERT INTO fuel.fuel_transaction
        (equipment_id, operator_id, station_id, shift_id, transaction_time,
         quantity_liters, unit_cost, total_cost, engine_hours)
      SELECT
        truck.equipment_id,
        truck.current_operator_id,
        fs.station_id,
        '5a000001-0000-0000-0000-000000000001',
        tx_time,
        ROUND((800 + RANDOM() * 400)::NUMERIC, 0),
        ROUND((1.42 + RANDOM() * 0.08)::NUMERIC, 4),
        ROUND((800 + RANDOM() * 400) * (1.42 + RANDOM() * 0.08)::NUMERIC, 2),
        ROUND((e.current_hours - d * 10 + RANDOM() * 5)::NUMERIC, 0)
      FROM fuel.fuel_station fs
      CROSS JOIN core.equipment e
      WHERE fs.site_id = 'a1b2c3d4-0001-0001-0001-000000000001'
        AND e.equipment_id = truck.equipment_id
      LIMIT 1;
    END LOOP;
  END LOOP;
END $$;
