// ============================================================
// FMS Mining – TypeScript Types
// ============================================================

export interface Equipment {
  equipment_id: string;
  type_id?: string;
  fleet_number: string;
  model: string;
  serial_number?: string;
  year_manufactured?: number;
  payload_capacity: number;
  fuel_capacity: number;
  current_hours: number;
  current_km: number;
  status: EquipmentStatus;
  health_score: number;
  latitude?: number;
  longitude?: number;
  category: EquipmentCategory;
  type_name: string;
  manufacturer?: string;
  icon?: string;
  status_color: string;
  status_category: string;
  operator_name?: string;
  operator_id?: string;
  employee_no?: string;
  location_name?: string;
  location_type?: string;
  active: boolean;
  site_id: string;
}

export type EquipmentStatus =
  | 'AVAILABLE' | 'OPERATING' | 'LOADING' | 'HAULING' | 'DUMPING'
  | 'RETURNING' | 'QUEUING' | 'IDLE' | 'DOWN' | 'MAINTENANCE'
  | 'REFUELING' | 'SHIFT_CHANGE' | 'STANDBY' | 'BLASTING' | 'INSPECTION';

export type EquipmentCategory =
  | 'TRUCK' | 'EXCAVATOR' | 'LOADER' | 'DOZER'
  | 'DRILL' | 'GRADER' | 'WATER_TRUCK' | 'SERVICE';

export interface Location {
  location_id: string;
  site_id: string;
  code: string;
  name: string;
  location_type: LocationType;
  latitude: number;
  longitude: number;
  elevation?: number;
  radius_m?: number;
  active: boolean;
}

export type LocationType =
  | 'PIT' | 'DUMP' | 'STOCKPILE' | 'CRUSHER'
  | 'WORKSHOP' | 'FUEL_STATION' | 'PARKING' | 'BLAST_ZONE';

export interface HaulCycle {
  cycle_id: string;
  truck_id: string;
  truck_number: string;
  loader_id?: string;
  loader_number?: string;
  operator_name?: string;
  source_name: string;
  dest_name: string;
  material_name?: string;
  material_color?: string;
  cycle_start: string;
  cycle_end?: string;
  total_duration_s?: number;
  queue_duration_s?: number;
  loading_duration_s?: number;
  haul_duration_s?: number;
  dump_duration_s?: number;
  return_duration_s?: number;
  payload_tonnes?: number;
  payload_factor?: number;
  overloaded?: boolean;
  distance_km?: number;
}

export interface DispatchAssignment {
  assignment_id: string;
  truck_id: string;
  truck_number: string;
  loader_id?: string;
  loader_number?: string;
  source_location_id: string;
  dest_location_id: string;
  source_name: string;
  source_type: string;
  dest_name: string;
  dest_type: string;
  material_name?: string;
  material_color?: string;
  assigned_time: string;
  status: 'PENDING' | 'ACKNOWLEDGED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  priority: number;
  distance_km?: number;
}

export interface WorkOrder {
  work_order_id: string;
  work_order_no: string;
  fleet_number: string;
  category: string;
  wo_type: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' | 'EMERGENCY';
  title: string;
  description?: string;
  status: string;
  opened_at: string;
  closed_at?: string;
  estimated_hours?: number;
  actual_hours?: number;
  total_cost?: number;
  task_count: number;
  tasks_done: number;
}

export interface Breakdown {
  breakdown_id: string;
  equipment_id: string;
  fleet_number: string;
  category: string;
  detected_time: string;
  repaired_time?: string;
  system?: string;
  component?: string;
  severity: string;
  description?: string;
  downtime_hours?: number;
}

export interface FuelTransaction {
  transaction_id: string;
  fleet_number: string;
  category: string;
  operator_name?: string;
  station_name?: string;
  transaction_time: string;
  quantity_liters: number;
  unit_cost?: number;
  total_cost?: number;
  engine_hours?: number;
}

export interface Alarm {
  alarm_id: string;
  equipment_id: string;
  fleet_number: string;
  category: string;
  alarm_code: string;
  alarm_type?: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL' | 'EMERGENCY';
  event_time: string;
  message?: string;
  acknowledged: boolean;
  location_name?: string;
  age_minutes: number;
}

export interface DashboardKpi {
  fleet: {
    total_trucks: number;
    active_trucks: number;
    down_trucks: number;
    maint_trucks: number;
    total_excavators: number;
    active_excavators: number;
    productive_fleet: number;
    down_fleet: number;
    fleet_utilization_pct: number;
  };
  production: {
    tonnes_today: number;
    cycles_today: number;
    avg_payload: number;
    avg_cycle_min: number;
  };
  plan?: {
    target_tonnes: number;
    actual_tonnes: number;
    achievement_pct: number;
  };
  alarms: { severity: string; count: number }[];
  hourlyTrend: { hour: string; tonnes: number; cycles: number }[];
  statusDist: { status: string; color: string; status_category: string; count: number }[];
  maintenance: { open_wos: number; urgent_wos: number; active_breakdowns: number };
  fuel: { liters_today: number; cost_today: number };
  kpi: { oee: number; availability: number; utilization: number; payloadFactor: number };
}

export interface Operator {
  operator_id: string;
  employee_no: string;
  first_name: string;
  last_name: string;
  certification_level: string;
  certifications?: string[];
  phone?: string;
  license_expiry?: string;
  medical_expiry?: string;
  assigned_equipment?: string;
  equipment_category?: string;
  active: boolean;
}

export interface AuthUser {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  role: string;
  siteId: string;
}

export interface GpsPosition {
  equipment_id: string;
  fleet_number: string;
  latitude: number;
  longitude: number;
  status: EquipmentStatus;
  category: EquipmentCategory;
  speed_kmh: number;
  heading: number;
  status_color?: string;
  operator_name?: string;
}

// ── Tyres ─────────────────────────────────────
export interface Tyre {
  tyre_id: string;
  serial_number: string;
  manufacturer: string;
  model?: string;
  size?: string;
  ply_rating?: number;
  purchase_date?: string;
  purchase_cost?: number;
  total_hours: number;
  status: 'NEW' | 'INSTALLED' | 'SCRAPPED';
  // joined fields
  equipment_id?: string;
  fleet_number?: string;
  position_code?: string;
  install_date?: string;
  hours_since_install?: number;
}

export interface TyreInstallation {
  installation_id: string;
  tyre_id: string;
  equipment_id: string;
  position_code: string;
  install_date: string;
  install_hours: number;
  removal_date?: string;
  removal_reason?: string;
  serial_number: string;
  manufacturer: string;
  model?: string;
  size?: string;
  hours_on_wheel_current?: number;
}

// ── Shifts ─────────────────────────────────────
export interface ShiftDefinition {
  shift_def_id: string;
  site_id: string;
  shift_name: string;
  start_hour: number;
  duration_hours: number;
  color: string;
}

export interface Shift {
  shift_id: string;
  site_id: string;
  shift_def_id: string;
  shift_date: string;
  start_time: string;
  end_time?: string;
  status: 'ACTIVE' | 'CLOSED' | 'PLANNED';
  supervisor_id?: string;
  // joined
  shift_name: string;
  color: string;
  supervisor_name?: string;
  operator_count?: number;
  cycle_count?: number;
  total_tonnes?: number;
  target_tonnes?: number;
  achievement_pct?: number;
}

// ── Telemetry ─────────────────────────────────────
export interface TelemetryReading {
  event_id: string;
  equipment_id: string;
  fleet_number: string;
  category: EquipmentCategory;
  event_time: string;
  engine_rpm?: number;
  engine_temp_c?: number;
  oil_pressure?: number;
  coolant_temp_c?: number;
  battery_v?: number;
  hydraulic_temp_c?: number;
  fuel_level_pct?: number;
  load_payload_t?: number;
  brake_temp_c?: number;
  tire_pressure_fl?: number;
  tire_pressure_fr?: number;
  fault_codes?: Record<string, string>;
  health_status: 'OK' | 'WARNING' | 'CRITICAL';
}

export interface WeatherReading {
  reading_id?: string;
  station_name?: string;
  recorded_at: string;
  temperature_c?: number;
  humidity_pct?: number;
  wind_speed_ms?: number;
  wind_dir_deg?: number;
  rainfall_mm?: number;
  visibility_m?: number;
  dust_index?: number;
}

