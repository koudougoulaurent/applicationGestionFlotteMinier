-- ============================================================
-- FMS MINING - SCHEMA ALTERATIONS v07
-- Corrections des décalages contrôleur/schéma
-- ============================================================

-- ── core.road_condition : colonnes manquantes ─────────────────
ALTER TABLE core.road_condition
  ADD COLUMN IF NOT EXISTS condition_type  VARCHAR(50),
  ADD COLUMN IF NOT EXISTS severity        VARCHAR(20) DEFAULT 'LOW',
  ADD COLUMN IF NOT EXISTS description     TEXT,
  ADD COLUMN IF NOT EXISTS speed_reduction_kmh NUMERIC(5,1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS closed          BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS valid_until     TIMESTAMP;

-- Migrer les données existantes (condition → condition_type)
UPDATE core.road_condition
SET condition_type = condition
WHERE condition_type IS NULL AND condition IS NOT NULL;

-- ── operations.production_plan : colonne notes + contrainte UNIQUE ──
ALTER TABLE operations.production_plan
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Contrainte UNIQUE sur shift_id pour ON CONFLICT dans upsertProductionPlan
-- Supprimer d'abord les éventuels doublons (garder le plus récent)
DELETE FROM operations.production_plan pp1
USING operations.production_plan pp2
WHERE pp1.shift_id = pp2.shift_id
  AND pp1.created_at < pp2.created_at;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'production_plan_shift_unique'
  ) THEN
    ALTER TABLE operations.production_plan
      ADD CONSTRAINT production_plan_shift_unique UNIQUE (shift_id);
  END IF;
END $$;

-- ── Index sur valid_until pour les requêtes roads ─────────────
CREATE INDEX IF NOT EXISTS idx_road_condition_valid
  ON core.road_condition (road_id, valid_until NULLS LAST);

-- ── Index sur current_hours pour les requêtes PM ─────────────
CREATE INDEX IF NOT EXISTS idx_equipment_hours
  ON core.equipment (current_hours, site_id)
  WHERE active = TRUE;

-- ── Vue : files d'attente temps réel par zone ─────────────────
CREATE OR REPLACE VIEW reporting.v_queue_realtime AS
SELECT
  da.source_location_id AS location_id,
  ls.name               AS location_name,
  ls.location_type,
  'QUEUE_AT_SHOVEL'      AS queue_type,
  COUNT(*)              AS truck_count,
  ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - da.assigned_time))/60), 1) AS avg_wait_min,
  MAX(EXTRACT(EPOCH FROM (NOW() - da.assigned_time))/60)::INT AS max_wait_min
FROM operations.dispatch_assignment da
JOIN core.location ls ON da.source_location_id = ls.location_id
WHERE da.status IN ('PENDING', 'ACKNOWLEDGED')
GROUP BY da.source_location_id, ls.name, ls.location_type

UNION ALL

SELECT
  da.dest_location_id   AS location_id,
  ld.name               AS location_name,
  ld.location_type,
  'QUEUE_AT_DUMP'        AS queue_type,
  COUNT(*)              AS truck_count,
  ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - da.assigned_time))/60), 1) AS avg_wait_min,
  MAX(EXTRACT(EPOCH FROM (NOW() - da.assigned_time))/60)::INT AS max_wait_min
FROM operations.dispatch_assignment da
JOIN core.location ld ON da.dest_location_id = ld.location_id
WHERE da.status = 'IN_PROGRESS'
GROUP BY da.dest_location_id, ld.name, ld.location_type;

-- ── Vue : productivité par camion/poste (pour rapports) ───────
CREATE OR REPLACE VIEW reporting.v_truck_shift_kpi AS
SELECT
  hc.shift_id,
  hc.truck_id,
  e.fleet_number,
  et.category,
  COUNT(*)                                       AS cycles,
  ROUND(SUM(hc.payload_tonnes), 0)               AS total_tonnes,
  ROUND(AVG(hc.payload_tonnes), 1)               AS avg_payload,
  ROUND(AVG(hc.payload_factor)*100, 1)           AS avg_payload_factor_pct,
  ROUND(AVG(hc.total_duration_s)/60.0, 1)        AS avg_cycle_min,
  ROUND(AVG(hc.queue_duration_s)/60.0, 1)        AS avg_queue_min,
  ROUND(AVG(hc.loading_duration_s)/60.0, 1)      AS avg_load_min,
  ROUND(AVG(hc.haul_duration_s)/60.0, 1)         AS avg_haul_min,
  ROUND(AVG(hc.dump_duration_s)/60.0, 1)         AS avg_dump_min,
  ROUND(AVG(hc.return_duration_s)/60.0, 1)       AS avg_return_min,
  COUNT(*) FILTER (WHERE hc.overloaded)          AS overloaded_count,
  ROUND(
    SUM(hc.payload_tonnes) /
    NULLIF(EXTRACT(EPOCH FROM (MAX(hc.cycle_end) - MIN(hc.cycle_start)))/3600.0, 0)
  , 1)                                            AS tonnes_per_hour
FROM operations.haul_cycle hc
JOIN core.equipment e ON hc.truck_id = e.equipment_id
JOIN core.equipment_type et ON e.type_id = et.type_id
WHERE hc.cycle_end IS NOT NULL
GROUP BY hc.shift_id, hc.truck_id, e.fleet_number, et.category;
