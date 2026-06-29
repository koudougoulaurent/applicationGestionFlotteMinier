import { z } from 'zod';

// ── Common helpers ─────────────────────────────────────────────────────────────
const uuid       = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid UUID format');
const safeStr    = (max = 200) => z.string().max(max).transform(s => s.trim());
const safeText   = () => safeStr(5000);
const isoDate    = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const isoDatetime = z.string().datetime({ message: 'Expected ISO 8601 datetime' });
const positiveNum = z.number().min(0);

// ── Auth ───────────────────────────────────────────────────────────────────────
export const loginSchema = z.object({
  username: z.string()
    .min(1, 'Username required')
    .max(50)
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Username contains invalid characters'),
  password: z.string().min(1, 'Password required').max(100),
});

export const mfaVerifySchema = z.object({
  mfa_session: z.string().min(1, 'MFA session required'),
  otp: z.string().length(6).regex(/^\d{6}$/, 'OTP must be exactly 6 digits'),
});

export const mfaOtpSchema = z.object({
  otp: z.string().length(6).regex(/^\d{6}$/, 'OTP must be exactly 6 digits'),
});

// ── Equipment ─────────────────────────────────────────────────────────────────
export const createEquipmentSchema = z.object({
  siteId:           uuid,
  typeId:           uuid,
  fleetNumber:      safeStr(20),
  serialNumber:     safeStr(50).optional(),
  model:            safeStr(100),
  yearManufactured: z.number().int().min(1990).max(2030).optional(),
  payloadCapacity:  positiveNum.optional(),
  fuelCapacity:     positiveNum.optional(),
  currentHours:     positiveNum.optional(),
  currentKm:        positiveNum.optional(),
  status:           z.enum(['AVAILABLE','DOWN','MAINTENANCE','IDLE']).optional(),
  latitude:         z.number().min(-90).max(90).optional(),
  longitude:        z.number().min(-180).max(180).optional(),
});

export const updateEquipmentSchema = z.object({
  typeId:           uuid.optional(),
  fleetNumber:      safeStr(20).optional(),
  serialNumber:     safeStr(50).optional(),
  model:            safeStr(100).optional(),
  yearManufactured: z.number().int().min(1990).max(2030).optional(),
  payloadCapacity:  positiveNum.optional(),
  fuelCapacity:     positiveNum.optional(),
  currentHours:     positiveNum.optional(),
  currentKm:        positiveNum.optional(),
  status:           z.enum(['AVAILABLE','LOADING','HAULING','DUMPING','RETURNING','QUEUING','IDLE','DOWN','MAINTENANCE','REFUELING','SHIFT_CHANGE','BLASTING','INSPECTION','STANDBY']).optional(),
  latitude:         z.number().min(-90).max(90).optional(),
  longitude:        z.number().min(-180).max(180).optional(),
  operatorId:       uuid.optional(),
  locationId:       uuid.optional(),
  active:           z.boolean().optional(),
});

export const updateStatusSchema = z.object({
  status: z.enum([
    'AVAILABLE', 'LOADING', 'HAULING', 'DUMPING', 'RETURNING',
    'QUEUING', 'IDLE', 'DOWN', 'MAINTENANCE', 'REFUELING', 'SHIFT_CHANGE', 'BLASTING',
  ]),
  reason:     safeStr(200).optional(),
  locationId: uuid.optional(),
  operatorId: uuid.optional(),
});

// ── Dispatch ──────────────────────────────────────────────────────────────────
export const createDispatchSchema = z.object({
  truckId:          uuid,
  loaderId:         uuid.optional(),
  sourceLocationId: uuid,
  destLocationId:   uuid,
  materialId:       uuid.optional(),
  priority:         z.number().int().min(1).max(2).optional(),
  shiftId:          uuid.optional(),
});

export const updateDispatchSchema = z.object({
  status: z.enum(['ACKNOWLEDGED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
});

// ── Haul Cycles ───────────────────────────────────────────────────────────────
export const createCycleSchema = z.object({
  truckId:          uuid,
  loaderId:         uuid.optional(),
  operatorId:       uuid.optional(),
  materialId:       uuid.optional(),
  sourceLocationId: uuid,
  destLocationId:   uuid.optional(),
  shiftId:          uuid.optional(),
  payload_tonnes:   positiveNum.optional(),
  dispatchId:       uuid.optional(),
});

export const completeCycleSchema = z.object({
  payload_tonnes: positiveNum.max(9999).optional(),
  dumpTime:       isoDatetime.optional(),
  loadStart:      isoDatetime.optional(),
  loadEnd:        isoDatetime.optional(),
  haulStart:      isoDatetime.optional(),
  dumpStart:      isoDatetime.optional(),
  returnStart:    isoDatetime.optional(),
  fuelConsumed:   positiveNum.optional(),
  distanceKm:     positiveNum.optional(),
});

// ── Maintenance ───────────────────────────────────────────────────────────────
export const createWorkOrderSchema = z.object({
  equipmentId:    uuid,
  woType:         z.enum(['PREVENTIVE', 'CORRECTIVE', 'BREAKDOWN', 'PREDICTIVE', 'INSPECTION']),
  priority:       z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT', 'EMERGENCY']).optional(),
  title:          safeStr(200),
  description:    safeText().optional(),
  estimatedHours: positiveNum.max(9999).optional(),
  scheduledStart: isoDatetime.optional(),
});

export const closeWorkOrderSchema = z.object({
  actualHours: positiveNum.max(9999).optional(),
  laborCost:   positiveNum.optional(),
  partsCost:   positiveNum.optional(),
});

// ── Fuel ──────────────────────────────────────────────────────────────────────
export const createFuelTransactionSchema = z.object({
  equipmentId:    uuid,
  stationId:      uuid.optional(),
  operatorId:     uuid.optional(),
  quantityLiters: z.number().min(0.1).max(99999),
  unitCost:       positiveNum.optional(),
  odometerKm:     positiveNum.optional(),
  engineHours:    positiveNum.optional(),
  shiftId:        uuid.optional(),
});

// ── GPS ───────────────────────────────────────────────────────────────────────
export const recordPositionSchema = z.object({
  equipmentId:   uuid,
  latitude:      z.number().min(-90).max(90),
  longitude:     z.number().min(-180).max(180),
  speed:         z.number().min(0).max(300).optional(),
  heading:       z.number().min(0).max(360).optional(),
  altitude:      z.number().min(-500).max(9000).optional(),
  engineOn:      z.boolean().optional(),
  payloadTonnes: positiveNum.optional(),
});

// ── Shifts ────────────────────────────────────────────────────────────────────
export const createShiftSchema = z.object({
  shiftDefId: uuid,
  shiftDate:  isoDate,
  notes:      safeStr(500).optional(),
});

export const assignOperatorSchema = z.object({
  shiftId:     uuid,
  operatorId:  uuid,
  equipmentId: uuid.optional(),
  role:        safeStr(50).optional(),
});

// ── Tyres ─────────────────────────────────────────────────────────────────────
export const createTyreSchema = z.object({
  serialNumber: z.string().max(50).regex(/^[A-Za-z0-9\-_]+$/, 'Invalid serial number format'),
  manufacturer: safeStr(50),
  model:        safeStr(100),
  size:         z.string().max(30).regex(/^[A-Za-z0-9/\-_]+$/, 'Invalid size format'),
  status:       z.enum(['NEW', 'INSTALLED', 'RETREADED', 'SCRAPPED']).optional(),
});

export const installTyreSchema = z.object({
  tyreId:       uuid,
  equipmentId:  uuid,
  positionCode: z.string().max(5).regex(/^[A-Z0-9]+$/, 'Invalid position code'),
  installDate:  isoDate,
});

export const removeTyreSchema = z.object({
  removalDate:  isoDate,
  removalReason: safeStr(200).optional(),
});

// ── Live GPS telemetry (mode hybride) ────────────────────────────────────────
// Coordonnées contraintes à la région mine Nchanga + buffer 50km
const MINE_LAT = -12.50, MINE_LON = 27.85, MAX_DIST_DEG = 0.5;
export const liveTelemetrySchema = z.object({
  fleetNumber:   z.string().min(1).max(20).regex(/^[A-Z0-9_-]+$/i, 'Format invalide'),
  lat:           z.number()
    .min(MINE_LAT - MAX_DIST_DEG, 'Latitude hors zone mine')
    .max(MINE_LAT + MAX_DIST_DEG, 'Latitude hors zone mine'),
  lon:           z.number()
    .min(MINE_LON - MAX_DIST_DEG, 'Longitude hors zone mine')
    .max(MINE_LON + MAX_DIST_DEG, 'Longitude hors zone mine'),
  speed_kmh:     z.number().min(0).max(120).default(0),
  heading:       z.number().min(0).max(360).default(0),
  payload_kg:    z.number().min(0).max(300_000).default(0),
  fuelLevel_pct: z.number().min(0).max(100).default(100),
  healthScore:   z.number().min(0).max(100).optional(),
  engineRunning: z.boolean().default(true),
  timestamp:     z.string().datetime().optional(),
  equipmentId:   z.string().uuid().optional(),
});

// ── Telemetry ─────────────────────────────────────────────────────────────────
export const ingestTelemetrySchema = z.object({
  engineTemp:    z.number().min(-50).max(500).optional(),
  oilPressure:   z.number().min(0).max(1000).optional(),
  hydraulicTemp: z.number().min(-50).max(300).optional(),
  fuelLevel:     z.number().min(0).max(100).optional(),
  engineHours:   positiveNum.optional(),
  rpm:           z.number().min(0).max(10000).optional(),
  voltage:       z.number().min(0).max(100).optional(),
  payload:       positiveNum.optional(),
  speedKmh:      z.number().min(0).max(300).optional(),
  latitude:      z.number().min(-90).max(90).optional(),
  longitude:     z.number().min(-180).max(180).optional(),
}).passthrough();

// ── Weather ───────────────────────────────────────────────────────────────────
export const recordWeatherSchema = z.object({
  tempCelsius:  z.number().min(-60).max(80).optional(),
  humidity:     z.number().min(0).max(100).optional(),
  windSpeed:    positiveNum.optional(),
  windDirection: z.number().min(0).max(360).optional(),
  precipitation: positiveNum.optional(),
  visibility:   positiveNum.optional(),
  conditions:   z.enum(['CLEAR', 'CLOUDY', 'RAIN', 'HEAVY_RAIN', 'FOG', 'DUST_STORM', 'THUNDERSTORM']).optional(),
});

// ── Production ────────────────────────────────────────────────────────────────
export const productionPlanSchema = z.object({
  shiftId:       uuid,
  materialId:    uuid.optional(),
  targetTonnes:  positiveNum,
  targetCycles:  z.number().int().min(0).optional(),
});

// ── Operators ─────────────────────────────────────────────────────────────────
export const createOperatorSchema = z.object({
  siteId:             uuid,
  employeeNo:         safeStr(20),
  firstName:          safeStr(50),
  lastName:           safeStr(50),
  phone:              safeStr(20).optional(),
  email:              z.string().email().max(100).optional(),
  certificationLevel: z.enum(['TRAINEE','OPERATOR','SENIOR','SUPERVISOR']).optional(),
  licenseExpiry:      isoDate.optional(),
  medicalExpiry:      isoDate.optional(),
  certifications:     z.array(z.string().max(50)).optional(),
  hireDate:           isoDate.optional(),
});

export const updateOperatorSchema = z.object({
  employeeNo:         safeStr(20).optional(),
  firstName:          safeStr(50).optional(),
  lastName:           safeStr(50).optional(),
  phone:              safeStr(20).optional(),
  email:              z.string().email().max(100).optional(),
  certificationLevel: z.enum(['TRAINEE','OPERATOR','SENIOR','SUPERVISOR']).optional(),
  licenseExpiry:      isoDate.optional(),
  medicalExpiry:      isoDate.optional(),
  certifications:     z.array(z.string().max(50)).optional(),
  hireDate:           isoDate.optional(),
  active:             z.boolean().optional(),
});

// ── Road conditions ───────────────────────────────────────────────────────────
export const roadConditionSchema = z.object({
  roadId:              uuid,
  conditionType:       z.enum(['POTHOLE', 'FLOOD', 'SLIP', 'DUST', 'DEBRIS', 'DAMAGE', 'CLOSED', 'RESTRICTED']),
  severity:            z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  description:         safeStr(500).optional(),
  speedReductionKmh:   z.number().min(0).max(100).optional(),
});
