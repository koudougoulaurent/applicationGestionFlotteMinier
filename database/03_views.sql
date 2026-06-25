-- ============================================================
-- FMS MINING - VIEWS FOR KPI & REPORTING
-- ============================================================

-- Current Equipment Status View
CREATE OR REPLACE VIEW reporting.v_equipment_current AS
SELECT
    e.equipment_id,
    e.fleet_number,
    e.model,
    et.category,
    et.name AS type_name,
    e.status,
    sc.color AS status_color,
    sc.category AS status_category,
    sc.counts_as_operating,
    e.latitude,
    e.longitude,
    e.current_hours,
    e.health_score,
    e.payload_capacity,
    e.fuel_capacity,
    o.first_name || ' ' || o.last_name AS operator_name,
    o.operator_id,
    l.name AS location_name,
    l.location_type,
    e.active,
    e.site_id
FROM core.equipment e
LEFT JOIN core.equipment_type et ON e.type_id = et.type_id
LEFT JOIN core.status_code sc ON e.status = sc.status_code
LEFT JOIN core.operator o ON e.current_operator_id = o.operator_id
LEFT JOIN core.location l ON e.current_location_id = l.location_id;

-- Fleet KPI Summary (current shift)
CREATE OR REPLACE VIEW reporting.v_fleet_kpi_realtime AS
SELECT
    e.site_id,
    COUNT(*) FILTER (WHERE et.category = 'TRUCK') AS total_trucks,
    COUNT(*) FILTER (WHERE et.category = 'TRUCK' AND e.status IN ('LOADING','HAULING','DUMPING','RETURNING')) AS active_trucks,
    COUNT(*) FILTER (WHERE et.category = 'TRUCK' AND e.status = 'DOWN') AS down_trucks,
    COUNT(*) FILTER (WHERE et.category = 'TRUCK' AND e.status = 'MAINTENANCE') AS maint_trucks,
    COUNT(*) FILTER (WHERE et.category = 'EXCAVATOR') AS total_excavators,
    COUNT(*) FILTER (WHERE et.category = 'EXCAVATOR' AND e.status = 'OPERATING') AS active_excavators,
    COUNT(*) FILTER (WHERE sc.category = 'PRODUCTIVE') AS productive_fleet,
    COUNT(*) FILTER (WHERE sc.category = 'DOWN') AS down_fleet,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE sc.counts_as_operating) / NULLIF(COUNT(*), 0), 2
    ) AS fleet_utilization_pct
FROM core.equipment e
LEFT JOIN core.equipment_type et ON e.type_id = et.type_id
LEFT JOIN core.status_code sc ON e.status = sc.status_code
WHERE e.active = TRUE
GROUP BY e.site_id;

-- Cycle Time Analysis
CREATE OR REPLACE VIEW reporting.v_cycle_time_analysis AS
SELECT
    hc.shift_id,
    hc.truck_id,
    e.fleet_number,
    hc.loader_id,
    el.fleet_number AS loader_number,
    hc.source_location_id,
    ls.name AS source_name,
    hc.dest_location_id,
    ld.name AS dest_name,
    COUNT(*) AS cycle_count,
    ROUND(AVG(hc.total_duration_s)/60.0, 2) AS avg_cycle_min,
    ROUND(AVG(hc.queue_duration_s)/60.0, 2) AS avg_queue_min,
    ROUND(AVG(hc.loading_duration_s)/60.0, 2) AS avg_load_min,
    ROUND(AVG(hc.haul_duration_s)/60.0, 2) AS avg_haul_min,
    ROUND(AVG(hc.dump_duration_s)/60.0, 2) AS avg_dump_min,
    ROUND(AVG(hc.return_duration_s)/60.0, 2) AS avg_return_min,
    ROUND(AVG(hc.payload_tonnes), 2) AS avg_payload_t,
    ROUND(SUM(hc.payload_tonnes), 2) AS total_tonnes,
    ROUND(AVG(hc.payload_factor) * 100, 1) AS avg_payload_factor_pct
FROM operations.haul_cycle hc
JOIN core.equipment e ON hc.truck_id = e.equipment_id
LEFT JOIN core.equipment el ON hc.loader_id = el.equipment_id
LEFT JOIN core.location ls ON hc.source_location_id = ls.location_id
LEFT JOIN core.location ld ON hc.dest_location_id = ld.location_id
WHERE hc.cycle_end IS NOT NULL
GROUP BY hc.shift_id, hc.truck_id, e.fleet_number,
         hc.loader_id, el.fleet_number,
         hc.source_location_id, ls.name,
         hc.dest_location_id, ld.name;

-- Equipment Availability by Shift
CREATE OR REPLACE VIEW reporting.v_availability_by_shift AS
SELECT
    est.equipment_id,
    est.shift_id,
    e.fleet_number,
    et.category,
    SUM(est.duration_seconds) FILTER (WHERE sc.counts_as_operating) AS operating_seconds,
    SUM(est.duration_seconds) FILTER (WHERE sc.category = 'DOWN') AS downtime_seconds,
    SUM(est.duration_seconds) FILTER (WHERE sc.category = 'IDLE') AS idle_seconds,
    SUM(est.duration_seconds) FILTER (WHERE sc.category = 'STANDBY') AS standby_seconds,
    SUM(est.duration_seconds) AS total_seconds,
    ROUND(
        100.0 * SUM(est.duration_seconds) FILTER (WHERE sc.counts_as_operating)
        / NULLIF(SUM(est.duration_seconds) FILTER (WHERE sc.category != 'DOWN'), 0),
        2
    ) AS utilization_pct,
    ROUND(
        100.0 * (SUM(est.duration_seconds) - SUM(est.duration_seconds) FILTER (WHERE sc.category = 'DOWN'))
        / NULLIF(SUM(est.duration_seconds), 0),
        2
    ) AS availability_pct
FROM operations.equipment_status_timeline est
JOIN core.equipment e ON est.equipment_id = e.equipment_id
JOIN core.equipment_type et ON e.type_id = et.type_id
JOIN core.status_code sc ON est.status_code = sc.status_code
WHERE est.duration_seconds IS NOT NULL
GROUP BY est.equipment_id, est.shift_id, e.fleet_number, et.category;

-- Daily Production Summary
CREATE OR REPLACE VIEW reporting.v_daily_production AS
SELECT
    hc.site_id,
    DATE(hc.cycle_start) AS production_date,
    hc.material_id,
    m.name AS material_name,
    hc.source_location_id,
    ls.name AS source_name,
    hc.dest_location_id,
    ld.name AS dest_name,
    COUNT(*) AS total_cycles,
    ROUND(SUM(hc.payload_tonnes), 2) AS total_tonnes,
    ROUND(AVG(hc.payload_tonnes), 2) AS avg_payload_t,
    ROUND(AVG(hc.total_duration_s)/60.0, 2) AS avg_cycle_min,
    COUNT(DISTINCT hc.truck_id) AS trucks_worked,
    COUNT(DISTINCT hc.loader_id) AS loaders_worked
FROM operations.haul_cycle hc
LEFT JOIN core.material m ON hc.material_id = m.material_id
LEFT JOIN core.location ls ON hc.source_location_id = ls.location_id
LEFT JOIN core.location ld ON hc.dest_location_id = ld.location_id
WHERE hc.cycle_end IS NOT NULL
GROUP BY hc.site_id, DATE(hc.cycle_start), hc.material_id, m.name,
         hc.source_location_id, ls.name, hc.dest_location_id, ld.name;

-- Fuel Consumption Analysis
CREATE OR REPLACE VIEW reporting.v_fuel_analysis AS
SELECT
    ft.equipment_id,
    e.fleet_number,
    et.category,
    DATE(ft.transaction_time) AS fuel_date,
    COUNT(*) AS fill_count,
    SUM(ft.quantity_liters) AS total_liters,
    ROUND(AVG(ft.quantity_liters), 2) AS avg_fill_liters,
    SUM(ft.total_cost) AS total_cost
FROM fuel.fuel_transaction ft
JOIN core.equipment e ON ft.equipment_id = e.equipment_id
JOIN core.equipment_type et ON e.type_id = et.type_id
GROUP BY ft.equipment_id, e.fleet_number, et.category, DATE(ft.transaction_time);

-- Active Alarms
CREATE OR REPLACE VIEW reporting.v_active_alarms AS
SELECT
    a.alarm_id,
    a.equipment_id,
    e.fleet_number,
    et.category,
    a.alarm_code,
    a.alarm_type,
    a.severity,
    a.event_time,
    a.message,
    a.acknowledged,
    l.name AS location_name,
    EXTRACT(EPOCH FROM (NOW() - a.event_time))/60 AS age_minutes
FROM operations.alarm a
JOIN core.equipment e ON a.equipment_id = e.equipment_id
JOIN core.equipment_type et ON e.type_id = et.type_id
LEFT JOIN core.location l ON a.location_id = l.location_id
WHERE a.cleared_time IS NULL
ORDER BY
    CASE a.severity
        WHEN 'EMERGENCY' THEN 1
        WHEN 'CRITICAL'  THEN 2
        WHEN 'WARNING'   THEN 3
        ELSE 4
    END,
    a.event_time DESC;

-- Maintenance Due
CREATE OR REPLACE VIEW reporting.v_maintenance_due AS
SELECT
    e.equipment_id,
    e.fleet_number,
    e.model,
    e.current_hours,
    ms.maintenance_type,
    ms.description,
    ms.next_due_hours,
    ms.next_due_date,
    ROUND(ms.next_due_hours - e.current_hours, 2) AS hours_remaining,
    ms.next_due_date - CURRENT_DATE AS days_remaining,
    CASE
        WHEN e.current_hours >= ms.next_due_hours
             OR ms.next_due_date <= CURRENT_DATE THEN 'OVERDUE'
        WHEN e.current_hours >= ms.next_due_hours - 50
             OR ms.next_due_date <= CURRENT_DATE + 7 THEN 'DUE_SOON'
        ELSE 'OK'
    END AS urgency
FROM maintenance.maintenance_schedule ms
JOIN core.equipment e ON ms.equipment_id = e.equipment_id
WHERE ms.active = TRUE AND e.active = TRUE
ORDER BY hours_remaining ASC;

-- Shift Production vs Plan
CREATE OR REPLACE VIEW reporting.v_shift_vs_plan AS
SELECT
    pp.plan_id,
    pp.shift_id,
    pp.target_tonnes,
    pp.target_loads,
    COALESCE(SUM(hc.payload_tonnes), 0) AS actual_tonnes,
    COALESCE(COUNT(hc.cycle_id), 0) AS actual_loads,
    ROUND(
        100.0 * COALESCE(SUM(hc.payload_tonnes), 0) / NULLIF(pp.target_tonnes, 0),
        2
    ) AS achievement_pct
FROM operations.production_plan pp
LEFT JOIN operations.haul_cycle hc
    ON hc.shift_id = pp.shift_id
    AND hc.source_location_id = pp.source_location_id
    AND hc.dest_location_id = pp.dest_location_id
    AND hc.cycle_end IS NOT NULL
GROUP BY pp.plan_id, pp.shift_id, pp.target_tonnes, pp.target_loads;
