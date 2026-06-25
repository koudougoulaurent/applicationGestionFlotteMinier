-- ============================================================
-- FMS MINING - INDEXES FOR PERFORMANCE
-- ============================================================

-- Equipment
CREATE INDEX idx_equipment_site ON core.equipment(site_id);
CREATE INDEX idx_equipment_type ON core.equipment(type_id);
CREATE INDEX idx_equipment_status ON core.equipment(status);
CREATE INDEX idx_equipment_fleet_no ON core.equipment(fleet_number);
CREATE INDEX idx_equipment_location ON core.equipment(current_location_id);

-- Equipment Status Timeline
CREATE INDEX idx_est_equipment ON operations.equipment_status_timeline(equipment_id);
CREATE INDEX idx_est_status ON operations.equipment_status_timeline(status_code);
CREATE INDEX idx_est_start ON operations.equipment_status_timeline(start_time DESC);
CREATE INDEX idx_est_shift ON operations.equipment_status_timeline(shift_id);

-- GPS Positions
CREATE INDEX idx_pos_equipment ON operations.equipment_position(equipment_id);
CREATE INDEX idx_pos_time ON operations.equipment_position(position_time DESC);
CREATE INDEX idx_pos_geom ON operations.equipment_position USING GIST(geom);

-- Haul Cycles
CREATE INDEX idx_hc_truck ON operations.haul_cycle(truck_id);
CREATE INDEX idx_hc_loader ON operations.haul_cycle(loader_id);
CREATE INDEX idx_hc_shift ON operations.haul_cycle(shift_id);
CREATE INDEX idx_hc_start ON operations.haul_cycle(cycle_start DESC);
CREATE INDEX idx_hc_source ON operations.haul_cycle(source_location_id);
CREATE INDEX idx_hc_dest ON operations.haul_cycle(dest_location_id);

-- Haul Cycle Phases
CREATE INDEX idx_hcp_cycle ON operations.haul_cycle_phase(cycle_id);
CREATE INDEX idx_hcp_phase ON operations.haul_cycle_phase(phase);

-- Dispatch Assignments
CREATE INDEX idx_da_truck ON operations.dispatch_assignment(truck_id);
CREATE INDEX idx_da_loader ON operations.dispatch_assignment(loader_id);
CREATE INDEX idx_da_status ON operations.dispatch_assignment(status);
CREATE INDEX idx_da_shift ON operations.dispatch_assignment(shift_id);

-- Alarms
CREATE INDEX idx_alarm_equipment ON operations.alarm(equipment_id);
CREATE INDEX idx_alarm_severity ON operations.alarm(severity);
CREATE INDEX idx_alarm_time ON operations.alarm(event_time DESC);
CREATE INDEX idx_alarm_ack ON operations.alarm(acknowledged);

-- Telemetry
CREATE INDEX idx_tel_equipment ON operations.telemetry_event(equipment_id);
CREATE INDEX idx_tel_time ON operations.telemetry_event(event_time DESC);

-- Maintenance
CREATE INDEX idx_wo_equipment ON maintenance.work_order(equipment_id);
CREATE INDEX idx_wo_status ON maintenance.work_order(status);
CREATE INDEX idx_wo_priority ON maintenance.work_order(priority);
CREATE INDEX idx_breakdown_equipment ON maintenance.breakdown(equipment_id);

-- Fuel
CREATE INDEX idx_fuel_equipment ON fuel.fuel_transaction(equipment_id);
CREATE INDEX idx_fuel_time ON fuel.fuel_transaction(transaction_time DESC);
CREATE INDEX idx_fuel_station ON fuel.fuel_transaction(station_id);

-- Tyre
CREATE INDEX idx_tyre_equipment ON core.tyre_installation(equipment_id);
CREATE INDEX idx_tyre_active ON core.tyre_installation(equipment_id) WHERE removal_date IS NULL;

-- Operator
CREATE INDEX idx_op_assignment ON operations.operator_assignment(operator_id);
CREATE INDEX idx_op_assign_equip ON operations.operator_assignment(equipment_id);
CREATE INDEX idx_op_assign_shift ON operations.operator_assignment(shift_id);

-- Locations
CREATE INDEX idx_location_site ON core.location(site_id);
CREATE INDEX idx_location_type ON core.location(location_type);
CREATE INDEX idx_geofence_location ON core.geofence(location_id);

-- Geofence events
CREATE INDEX idx_gfe_equipment ON operations.geofence_event(equipment_id);
CREATE INDEX idx_gfe_time ON operations.geofence_event(event_time DESC);
