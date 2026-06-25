import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { query } from '../config/database';

interface EquipmentPosition {
  equipment_id: string;
  fleet_number: string;
  latitude: number;
  longitude: number;
  status: string;
  category: string;
  speed_kmh: number;
  heading: number;
}

// Simulated GPS movement for demo mode
const MINE_CENTER = { lat: -12.500, lon: 27.855 };
const equipmentMovement: Record<string, { lat: number; lon: number; speed: number; heading: number }> = {};

function simulateMovement(
  current: { lat: number; lon: number; heading: number },
  status: string
): { lat: number; lon: number; speed: number; heading: number } {
  let speed = 0;
  let headingDelta = (Math.random() - 0.5) * 20;

  switch (status) {
    case 'HAULING':   speed = 25 + Math.random() * 20; break;
    case 'RETURNING': speed = 35 + Math.random() * 15; break;
    case 'LOADING':
    case 'DUMPING':   speed = 2 + Math.random() * 3;   break;
    case 'OPERATING': speed = 5 + Math.random() * 8;   break;
    default:          speed = 0; headingDelta = 0;
  }

  const heading = ((current.heading + headingDelta) + 360) % 360;
  const latDelta = (Math.cos((heading * Math.PI) / 180) * speed * 0.00001);
  const lonDelta = (Math.sin((heading * Math.PI) / 180) * speed * 0.00001);

  let lat = current.lat + latDelta;
  let lon = current.lon + lonDelta;

  // Bound within mine area
  if (Math.abs(lat - MINE_CENTER.lat) > 0.05) lat = current.lat - latDelta;
  if (Math.abs(lon - MINE_CENTER.lon) > 0.05) lon = current.lon - lonDelta;

  return { lat, lon, speed, heading };
}

export function initRealtime(httpServer: HttpServer): SocketServer {
  const io = new SocketServer(httpServer, {
    cors: {
      origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173', 'http://localhost:4000'],
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on('join:site', (siteId: string) => {
      socket.join(`site:${siteId}`);
      console.log(`Socket ${socket.id} joined site ${siteId}`);
    });

    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);
    });
  });

  // Real-time GPS broadcast (every 5 seconds)
  if (process.env.ENABLE_GPS_SIMULATION === 'true') {
    setInterval(async () => {
      try {
        const equipment = await query(
          `SELECT e.equipment_id, e.fleet_number, e.latitude, e.longitude,
                  e.status, e.site_id, et.category
           FROM core.equipment e
           JOIN core.equipment_type et ON e.type_id = et.type_id
           WHERE e.active = TRUE AND e.latitude IS NOT NULL`
        );

        const updates: EquipmentPosition[] = [];

        for (const eq of equipment.rows) {
          if (!equipmentMovement[eq.equipment_id]) {
            equipmentMovement[eq.equipment_id] = {
              lat: parseFloat(eq.latitude),
              lon: parseFloat(eq.longitude),
              speed: 0,
              heading: Math.random() * 360,
            };
          }

          const movement = simulateMovement(
            {
              lat: equipmentMovement[eq.equipment_id].lat,
              lon: equipmentMovement[eq.equipment_id].lon,
              heading: equipmentMovement[eq.equipment_id].heading,
            },
            eq.status
          );

          equipmentMovement[eq.equipment_id] = movement;

          // Update DB
          await query(
            `UPDATE core.equipment SET latitude = $1, longitude = $2 WHERE equipment_id = $3`,
            [movement.lat, movement.lon, eq.equipment_id]
          );

          updates.push({
            equipment_id: eq.equipment_id,
            fleet_number: eq.fleet_number,
            latitude:     movement.lat,
            longitude:    movement.lon,
            status:       eq.status,
            category:     eq.category,
            speed_kmh:    movement.speed,
            heading:      movement.heading,
          });
        }

        // Broadcast to all site rooms
        const sites = [...new Set(equipment.rows.map((e: { site_id: string }) => e.site_id))];
        for (const siteId of sites) {
          const siteUpdates = updates.filter((u) => {
            const eq = equipment.rows.find((e: { equipment_id: string }) => e.equipment_id === u.equipment_id);
            return eq?.site_id === siteId;
          });
          io.to(`site:${siteId}`).emit('gps:update', siteUpdates);
        }
      } catch (err) {
        console.error('GPS simulation error:', err);
      }
    }, parseInt(process.env.GPS_UPDATE_INTERVAL_MS || '5000'));
  }

  // Alarm broadcast (every 15 seconds — reduced from 30s)
  setInterval(async () => {
    try {
      const alarms = await query(
        `SELECT a.alarm_id, a.equipment_id, a.severity, a.alarm_code, a.message,
                a.event_time, a.acknowledged, e.fleet_number, a.site_id,
                et.category,
                EXTRACT(EPOCH FROM (NOW() - a.event_time)) / 60 AS age_minutes
         FROM operations.alarm a
         JOIN core.equipment e ON a.equipment_id = e.equipment_id
         JOIN core.equipment_type et ON e.type_id = et.type_id
         WHERE a.cleared_time IS NULL AND a.acknowledged = FALSE
         ORDER BY a.event_time DESC LIMIT 30`
      );

      const sites = [...new Set(alarms.rows.map((a: { site_id: string }) => a.site_id))];
      for (const siteId of sites) {
        const siteAlarms = alarms.rows.filter((a: { site_id: string }) => a.site_id === siteId);
        io.to(`site:${siteId}`).emit('alarms:update', siteAlarms);
      }
    } catch (err) {
      console.error('Alarm broadcast error:', err);
    }
  }, 15000);

  // Production / shift KPIs (every 60 seconds)
  setInterval(async () => {
    try {
      const shiftProd = await query(`
        SELECT
          s.shift_id, s.site_id,
          COUNT(hc.cycle_id)                              AS cycles_count,
          COALESCE(SUM(hc.payload_tonnes), 0)             AS actual_tonnes,
          COALESCE(AVG(hc.payload_tonnes), 0)             AS avg_payload,
          COALESCE(SUM(hc.fuel_consumed_l), 0)            AS fuel_consumed_l,
          COALESCE(AVG(hc.total_duration_s / 60.0), 0)   AS avg_cycle_min,
          pp.target_tonnes
        FROM core.shift s
        LEFT JOIN operations.haul_cycle hc ON hc.shift_id = s.shift_id
        LEFT JOIN operations.production_plan pp ON pp.shift_id = s.shift_id
        WHERE s.status = 'ACTIVE'
        GROUP BY s.shift_id, s.site_id, pp.target_tonnes
      `);

      for (const row of shiftProd.rows) {
        const actual   = parseFloat(row.actual_tonnes) || 0;
        const target   = row.target_tonnes ? parseFloat(row.target_tonnes) : null;
        const achievePct = target && target > 0 ? Math.round((actual / target) * 100) : null;

        io.to(`site:${row.site_id}`).emit('production:shift', {
          shift_id:       row.shift_id,
          cycles_count:   parseInt(row.cycles_count) || 0,
          actual_tonnes:  actual,
          avg_payload:    parseFloat(row.avg_payload) || 0,
          fuel_consumed_l:parseFloat(row.fuel_consumed_l) || 0,
          avg_cycle_min:  parseFloat(row.avg_cycle_min) || 0,
          target_tonnes:  target,
          achievement_pct:achievePct,
          updated_at:     new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error('Production shift broadcast error:', err);
    }
  }, 60000);

  // Telemetry threshold alerts (every 30 seconds)
  setInterval(async () => {
    try {
      const alerts = await query(`
        SELECT DISTINCT ON (te.equipment_id)
          te.equipment_id, te.event_time,
          te.engine_temp_c, te.oil_pressure, te.fuel_level_pct,
          te.hydraulic_temp_c, te.engine_rpm,
          e.fleet_number, e.site_id, et.category
        FROM operations.telemetry_event te
        JOIN core.equipment e ON te.equipment_id = e.equipment_id
        JOIN core.equipment_type et ON e.type_id = et.type_id
        WHERE te.event_time > NOW() - INTERVAL '35 seconds'
          AND (
            te.engine_temp_c > 105
            OR te.oil_pressure < 2.0
            OR te.fuel_level_pct < 15
            OR te.hydraulic_temp_c > 90
          )
        ORDER BY te.equipment_id, te.event_time DESC
      `);

      for (const row of alerts.rows) {
        const triggered: { type: string; label: string; value: number; threshold: number; unit: string; high: boolean }[] = [];
        if (row.engine_temp_c > 105)   triggered.push({ type: 'engine_temp',    label: 'Temp. moteur',    value: row.engine_temp_c,    threshold: 105,  unit: '°C',  high: true });
        if (row.oil_pressure < 2.0)    triggered.push({ type: 'oil_pressure',   label: 'Pression huile',  value: row.oil_pressure,     threshold: 2.0,  unit: 'bar', high: false });
        if (row.fuel_level_pct < 15)   triggered.push({ type: 'fuel_level',     label: 'Niveau carburant',value: row.fuel_level_pct,   threshold: 15,   unit: '%',   high: false });
        if (row.hydraulic_temp_c > 90) triggered.push({ type: 'hydraulic_temp', label: 'Temp. hydraulique',value: row.hydraulic_temp_c, threshold: 90,   unit: '°C',  high: true });

        if (triggered.length > 0) {
          io.to(`site:${row.site_id}`).emit('telemetry:alert', {
            equipment_id: row.equipment_id,
            fleet_number: row.fleet_number,
            category:     row.category,
            alerts:       triggered,
            timestamp:    row.event_time,
          });
        }
      }
    } catch (err) {
      console.error('Telemetry alert check error:', err);
    }
  }, 30000);

  // Fleet status summary (every 10 seconds)
  setInterval(async () => {
    try {
      const stats = await query(
        `SELECT site_id, status, COUNT(*) AS count
         FROM core.equipment
         WHERE active = TRUE
         GROUP BY site_id, status`
      );

      const bySite: Record<string, Record<string, number>> = {};
      for (const row of stats.rows) {
        if (!bySite[row.site_id]) bySite[row.site_id] = {};
        bySite[row.site_id][row.status] = parseInt(row.count);
      }

      for (const [siteId, statusMap] of Object.entries(bySite)) {
        io.to(`site:${siteId}`).emit('fleet:status', statusMap);
      }
    } catch (err) {
      console.error('Fleet status broadcast error:', err);
    }
  }, 10000);

  // Queue management — files d'attente par zone (every 20 seconds)
  setInterval(async () => {
    try {
      const queues = await query(`SELECT * FROM reporting.v_queue_realtime`);
      const bySite: Record<string, typeof queues.rows> = {};

      // Need site_id — join dispatch back
      const queueFull = await query(`
        SELECT
          q.*,
          hr.site_id
        FROM reporting.v_queue_realtime q
        JOIN core.location l ON q.location_id = l.location_id
        LEFT JOIN core.mine_site hr ON l.site_id = hr.site_id
      `).catch(() => ({ rows: [] as typeof queues.rows }));

      // Fallback: use site from location table directly
      const queueWithSite = await query(`
        SELECT
          da.source_location_id AS location_id,
          ls.name               AS location_name,
          ls.location_type,
          'QUEUE_AT_SHOVEL'      AS queue_type,
          ls.site_id,
          COUNT(*)              AS truck_count,
          ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - da.assigned_time))/60), 1) AS avg_wait_min
        FROM operations.dispatch_assignment da
        JOIN core.location ls ON da.source_location_id = ls.location_id
        WHERE da.status IN ('PENDING', 'ACKNOWLEDGED')
        GROUP BY da.source_location_id, ls.name, ls.location_type, ls.site_id
        UNION ALL
        SELECT
          da.dest_location_id   AS location_id,
          ld.name               AS location_name,
          ld.location_type,
          'QUEUE_AT_DUMP'        AS queue_type,
          ld.site_id,
          COUNT(*)              AS truck_count,
          ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - da.assigned_time))/60), 1) AS avg_wait_min
        FROM operations.dispatch_assignment da
        JOIN core.location ld ON da.dest_location_id = ld.location_id
        WHERE da.status = 'IN_PROGRESS'
        GROUP BY da.dest_location_id, ld.name, ld.location_type, ld.site_id
      `);

      for (const row of queueWithSite.rows) {
        if (!bySite[row.site_id]) bySite[row.site_id] = [];
        bySite[row.site_id].push(row);
      }

      for (const [siteId, zones] of Object.entries(bySite)) {
        io.to(`site:${siteId}`).emit('queue:status', zones);
      }
      void queueFull;
      void queues;
    } catch (err) {
      console.error('Queue status broadcast error:', err);
    }
  }, 20000);

  // PM auto-check (every 30 minutes) — créer WO si PM dépassée sans WO ouvert
  setInterval(async () => {
    try {
      const overdue = await query(`
        SELECT
          e.equipment_id, e.fleet_number, e.site_id, e.current_hours,
          ms.schedule_id, ms.maintenance_type, ms.description, ms.next_due_hours
        FROM reporting.v_maintenance_due v
        JOIN core.equipment e ON e.fleet_number = v.fleet_number
        JOIN maintenance.maintenance_schedule ms ON ms.equipment_id = e.equipment_id
          AND ms.maintenance_type = v.maintenance_type AND ms.active = TRUE
        WHERE v.urgency = 'OVERDUE'
          AND NOT EXISTS (
            SELECT 1 FROM maintenance.work_order wo
            WHERE wo.equipment_id = e.equipment_id
              AND wo.schedule_id = ms.schedule_id
              AND wo.status NOT IN ('COMPLETED','CANCELLED')
          )
      `);

      for (const pm of overdue.rows) {
        const woCount = await query('SELECT COUNT(*) FROM maintenance.work_order');
        const woNo = `PM-${new Date().getFullYear()}-${String(parseInt(woCount.rows[0].count) + 1).padStart(4, '0')}`;
        await query(
          `INSERT INTO maintenance.work_order
             (equipment_id, work_order_no, wo_type, priority, title, description, status, schedule_id)
           VALUES ($1, $2, 'PREVENTIVE', 'URGENT',
                   $3 || ' — DÉPASSÉ ' || $4,
                   'Créé automatiquement — heures actuelles: ' || ROUND($5) || 'h / dû à: ' || ROUND($6) || 'h',
                   'OPEN', $7)`,
          [pm.equipment_id, woNo, pm.maintenance_type, pm.fleet_number,
           pm.current_hours, pm.next_due_hours, pm.schedule_id]
        );
        await query(
          `INSERT INTO operations.alarm
             (equipment_id, site_id, alarm_code, alarm_type, severity, message)
           VALUES ($1, $2, 'PM_OVERDUE', 'OPERATIONAL', 'CRITICAL', $3)`,
          [pm.equipment_id, pm.site_id,
           `PM DÉPASSÉE — ${pm.fleet_number} : ${pm.maintenance_type} (${Math.round(pm.next_due_hours)}h requis, actuel: ${Math.round(pm.current_hours)}h)`]
        );
        const siteRow = await query('SELECT site_id FROM core.equipment WHERE equipment_id = $1', [pm.equipment_id]);
        if (siteRow.rows[0]) {
          io.to(`site:${siteRow.rows[0].site_id}`).emit('pm:overdue', {
            equipment_id:     pm.equipment_id,
            fleet_number:     pm.fleet_number,
            maintenance_type: pm.maintenance_type,
            next_due_hours:   pm.next_due_hours,
            current_hours:    pm.current_hours,
            work_order_no:    woNo,
          });
        }
      }
    } catch (err) {
      console.error('PM auto-check error:', err);
    }
  }, 30 * 60 * 1000);

  // Telemetry simulation (every 20 seconds) — generates realistic sensor data
  if (process.env.ENABLE_GPS_SIMULATION === 'true') {
    setInterval(async () => {
      try {
        const equipment = await query(
          `SELECT e.equipment_id, e.status, et.category
           FROM core.equipment e
           JOIN core.equipment_type et ON e.type_id = et.type_id
           WHERE e.active = TRUE AND et.category IN ('TRUCK', 'EXCAVATOR', 'LOADER')`
        );

        for (const eq of equipment.rows) {
          const isOperating = ['OPERATING', 'HAULING', 'LOADING', 'DUMPING', 'RETURNING'].includes(eq.status);
          const baseRpm   = isOperating ? 1600 + Math.random() * 600 : 800 + Math.random() * 200;
          const baseTemp  = isOperating ? 82 + Math.random() * 15 : 60 + Math.random() * 10;
          const oilPress  = isOperating ? 4.5 + Math.random() * 2 : 3.5 + Math.random() * 1;
          const fuelLevel = 20 + Math.random() * 75;

          // 1-in-50 chance of critical event (for demo)
          const faultSim  = Math.random() < 0.02;
          const tempMod   = faultSim ? 20 : 0;

          await query(
            `INSERT INTO operations.telemetry_event
               (equipment_id, event_time, engine_rpm, engine_temp_c, oil_pressure,
                coolant_temp_c, hydraulic_temp_c, fuel_level_pct, brake_temp_c)
             VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8)`,
            [
              eq.equipment_id,
              Math.round(baseRpm),
              Math.round(baseTemp + tempMod),
              parseFloat(oilPress.toFixed(1)),
              Math.round(baseTemp + 5 + tempMod),
              Math.round(65 + Math.random() * 20),
              Math.round(fuelLevel),
              Math.round(40 + Math.random() * 60),
            ]
          );
        }
      } catch (err) {
        console.error('Telemetry simulation error:', err);
      }
    }, 20000);
  }

  return io;
}
