import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import * as schemas from '../schemas';

import { login, me, verifyMfaLogin, setupMfa, enableMfa, disableMfa, getMfaStatus } from '../controllers/auth.controller';
import { listEquipment, getEquipment, updateStatus, getStatusTimeline, getEquipmentKpi, listEquipmentTypes, createEquipment, updateEquipment, deactivateEquipment } from '../controllers/equipment.controller';
import { listDispatches, createDispatch, updateDispatch, suggestAssignments } from '../controllers/dispatch.controller';
import { listCycles, createCycle, completeCycle, getCyclePhases, getProductionSummary } from '../controllers/haulCycle.controller';
import { listWorkOrders, createWorkOrder, closeWorkOrder, listBreakdowns, getMaintenanceDue, getEquipmentHealth } from '../controllers/maintenance.controller';
import { listTransactions, createTransaction, getFuelSummary, getStationLevels } from '../controllers/fuel.controller';
import { getDashboardKpis, getAvailabilityReport, getCycleTimeKpi, getAlarms, acknowledgeAlarm } from '../controllers/kpi.controller';
import { getLatestPositions, recordPosition, getEquipmentTrail, getLocations } from '../controllers/gps.controller';
import { listOperators, getOperatorStats, createOperator, updateOperator, deactivateOperator } from '../controllers/operator.controller';
import { listTyres, getTyresByEquipment, getTyreHistory, createTyre, installTyre, removeTyre, getTyreSummary } from '../controllers/tyre.controller';
import { listShifts, getCurrentShift, createShift, closeShift, getShiftReport, assignOperatorToShift } from '../controllers/shift.controller';
import { getLatestTelemetry, getTelemetryHistory, ingestTelemetry, getFleetTelemetrySummary, getWeather, recordWeather } from '../controllers/telemetry.controller';
import { getDailyReconciliation, getShiftReconciliation, getMaterialBreakdown, getTruckPerformance, upsertProductionPlan, listRoadConditions, recordRoadCondition, clearRoadCondition, listMaterials } from '../controllers/production.controller';
import {
  startSimulation, stopSimulation, pauseSimulation, resumeSimulation,
  setSimSpeed, getSimStatus, listScenarios, getSimEvents,
  getBNRSummary, generateBNRReadings, getBNRHistory,
} from '../controllers/simulation.controller';
import {
  optimizeRoute, rebuildRouteGraph, getGraphStats,
  optimizeDispatch, applyDispatchRecommendation, getDispatchHistory,
  predictMaintenance, predictMaintenanceForEquipment,
  getMaintenancePredictionHistory, getAIDashboard,
} from '../controllers/ai.controller';

import { getOverview } from '../controllers/overview.controller';
import {
  getMessages, sendMessage, ackMessage, markRead, getUnreadCount, manualAssign,
} from '../controllers/messages.controller';

// ── MODULE 6 : Modules avancés ────────────────────────────────────────────────
import {
  getShiftProductionKPI, getHourlyBreakdown,
  getLoaderBreakdown, getTruckRanking,
} from '../controllers/production_advanced.controller';
import {
  getMaterialBreakdown as getMaterialBreakdownAdv, getMaterialFlow,
  getMisdirectedLoads, recordLoad, getGradeTrend,
} from '../controllers/material.controller';
import {
  getOpenDelays, getShiftDelays, getDelaySummary,
  openDelay, closeDelay, getDelayCategories, autoDetectIdleTrucks,
} from '../controllers/delay.controller';
import {
  getViolations, getViolationSummary,
  getRoadSpeedLimits, checkSpeed,
} from '../controllers/speed.controller';
import {
  listReports, getReport, generateReport,
} from '../controllers/shift_report.controller';
import {
  getTKPHStatus, getOverloadedTyres, calculateForSite,
} from '../controllers/tkph.controller';

const router = Router();
// Convenience: roles that can write
const ADMIN = ['ADMIN'];
const ADMIN_OR_DISPATCHER = ['ADMIN', 'DISPATCHER'];

// ── Auth (public) ──────────────────────────────────────────────────────────────
router.post('/auth/login',            validateBody(schemas.loginSchema), login);
router.post('/auth/mfa/verify',       validateBody(schemas.mfaVerifySchema), verifyMfaLogin);

// ── Auth (protected) ──────────────────────────────────────────────────────────
router.get('/auth/me',                authenticate, me);
router.get('/auth/mfa/status',        authenticate, getMfaStatus);
router.get('/auth/mfa/setup',         authenticate, setupMfa);
router.post('/auth/mfa/enable',       authenticate, validateBody(schemas.mfaOtpSchema), enableMfa);
router.delete('/auth/mfa/disable',    authenticate, validateBody(schemas.mfaOtpSchema), disableMfa);

// ── Equipment ─────────────────────────────────────────────────────────────────
router.get('/equipment',              authenticate, listEquipment);
router.get('/equipment/types',        authenticate, listEquipmentTypes);
router.get('/equipment/:id',          authenticate, getEquipment);
router.get('/equipment/:id/timeline', authenticate, getStatusTimeline);
router.get('/equipment/:id/kpi',      authenticate, getEquipmentKpi);
router.post('/equipment',             authenticate, authorize(...ADMIN), validateBody(schemas.createEquipmentSchema), createEquipment);
router.put('/equipment/:id',          authenticate, authorize(...ADMIN), validateBody(schemas.updateEquipmentSchema), updateEquipment);
router.patch('/equipment/:id/status', authenticate, authorize(...ADMIN_OR_DISPATCHER), validateBody(schemas.updateStatusSchema), updateStatus);
router.delete('/equipment/:id',       authenticate, authorize(...ADMIN), deactivateEquipment);

// ── Dispatch ──────────────────────────────────────────────────────────────────
router.get('/dispatch',               authenticate, listDispatches);
router.get('/dispatch/suggest',       authenticate, authorize(...ADMIN_OR_DISPATCHER), suggestAssignments);
// ADMIN or DISPATCHER can create/update dispatches
router.post('/dispatch',              authenticate, authorize(...ADMIN_OR_DISPATCHER), validateBody(schemas.createDispatchSchema), createDispatch);
router.patch('/dispatch/:id',         authenticate, authorize(...ADMIN_OR_DISPATCHER), validateBody(schemas.updateDispatchSchema), updateDispatch);

// ── Haul Cycles ───────────────────────────────────────────────────────────────
router.get('/cycles',                 authenticate, listCycles);
router.get('/cycles/:id/phases',      authenticate, getCyclePhases);
router.get('/production/summary',     authenticate, getProductionSummary);
router.post('/cycles',                authenticate, authorize(...ADMIN_OR_DISPATCHER), validateBody(schemas.createCycleSchema), createCycle);
router.patch('/cycles/:id/complete',  authenticate, authorize(...ADMIN_OR_DISPATCHER), validateBody(schemas.completeCycleSchema), completeCycle);

// ── Maintenance ───────────────────────────────────────────────────────────────
router.get('/maintenance/work-orders',          authenticate, listWorkOrders);
router.get('/maintenance/breakdowns',           authenticate, listBreakdowns);
router.get('/maintenance/due',                  authenticate, getMaintenanceDue);
router.get('/maintenance/health',               authenticate, getEquipmentHealth);
router.post('/maintenance/work-orders',         authenticate, authorize(...ADMIN), validateBody(schemas.createWorkOrderSchema), createWorkOrder);
router.patch('/maintenance/work-orders/:id/close', authenticate, authorize(...ADMIN), validateBody(schemas.closeWorkOrderSchema), closeWorkOrder);

// ── Fuel ──────────────────────────────────────────────────────────────────────
router.get('/fuel/transactions',      authenticate, listTransactions);
router.get('/fuel/summary',           authenticate, getFuelSummary);
router.get('/fuel/stations',          authenticate, getStationLevels);
router.post('/fuel/transactions',     authenticate, authorize(...ADMIN), validateBody(schemas.createFuelTransactionSchema), createTransaction);

// ── KPI & Alarms ──────────────────────────────────────────────────────────────
router.get('/kpi/dashboard',          authenticate, getDashboardKpis);
router.get('/kpi/availability',       authenticate, getAvailabilityReport);
router.get('/kpi/cycle-time',         authenticate, getCycleTimeKpi);
router.get('/kpi/alarms',             authenticate, getAlarms);
// Dispatchers can acknowledge alarms
router.patch('/kpi/alarms/:id/acknowledge', authenticate, authorize(...ADMIN_OR_DISPATCHER), acknowledgeAlarm);

// ── GPS & Locations ───────────────────────────────────────────────────────────
router.get('/gps/positions',          authenticate, getLatestPositions);
router.get('/gps/trail/:id',          authenticate, getEquipmentTrail);
router.get('/locations',              authenticate, getLocations);
router.post('/gps/positions',         authenticate, authorize(...ADMIN), validateBody(schemas.recordPositionSchema), recordPosition);

// ── Operators ─────────────────────────────────────────────────────────────────
router.get('/operators',              authenticate, listOperators);
router.get('/operators/:id/stats',    authenticate, getOperatorStats);
router.post('/operators',             authenticate, authorize(...ADMIN), validateBody(schemas.createOperatorSchema), createOperator);
router.put('/operators/:id',          authenticate, authorize(...ADMIN), validateBody(schemas.updateOperatorSchema), updateOperator);
router.delete('/operators/:id',       authenticate, authorize(...ADMIN), deactivateOperator);

// ── Tyres ─────────────────────────────────────────────────────────────────────
router.get('/tyres',                  authenticate, listTyres);
router.get('/tyres/summary',          authenticate, getTyreSummary);
router.get('/tyres/equipment/:id',    authenticate, getTyresByEquipment);
router.get('/tyres/:id/history',      authenticate, getTyreHistory);
router.post('/tyres',                 authenticate, authorize(...ADMIN), validateBody(schemas.createTyreSchema), createTyre);
router.post('/tyres/install',         authenticate, authorize(...ADMIN), validateBody(schemas.installTyreSchema), installTyre);
router.patch('/tyres/installation/:id/remove', authenticate, authorize(...ADMIN), validateBody(schemas.removeTyreSchema), removeTyre);

// ── Shifts ────────────────────────────────────────────────────────────────────
router.get('/shifts',                 authenticate, listShifts);
router.get('/shifts/current',         authenticate, getCurrentShift);
router.get('/shifts/:id/report',      authenticate, getShiftReport);
router.post('/shifts',                authenticate, authorize(...ADMIN), validateBody(schemas.createShiftSchema), createShift);
router.patch('/shifts/:id/close',     authenticate, authorize(...ADMIN), closeShift);
router.post('/shifts/assign-operator', authenticate, authorize(...ADMIN_OR_DISPATCHER), validateBody(schemas.assignOperatorSchema), assignOperatorToShift);

// ── Telemetry & Weather ───────────────────────────────────────────────────────
router.get('/telemetry/fleet',                 authenticate, getFleetTelemetrySummary);
router.get('/telemetry/:equipmentId',          authenticate, getLatestTelemetry);
router.get('/telemetry/:equipmentId/history',  authenticate, getTelemetryHistory);
router.get('/weather',                         authenticate, getWeather);
router.post('/telemetry/:equipmentId',         authenticate, authorize(...ADMIN), validateBody(schemas.ingestTelemetrySchema), ingestTelemetry);
router.post('/weather',                        authenticate, authorize(...ADMIN), validateBody(schemas.recordWeatherSchema), recordWeather);

// ── Référentiels ──────────────────────────────────────────────────────────────
router.get('/materials',                         authenticate, listMaterials);

// ── Production Planning & Reconciliation ──────────────────────────────────────
router.get('/production/reconciliation/daily',   authenticate, getDailyReconciliation);
router.get('/production/reconciliation/shifts',  authenticate, getShiftReconciliation);
router.get('/production/materials',              authenticate, getMaterialBreakdown);
router.get('/production/trucks',                 authenticate, getTruckPerformance);
router.post('/production/plan',                  authenticate, authorize(...ADMIN), validateBody(schemas.productionPlanSchema), upsertProductionPlan);

// ── Road Conditions ───────────────────────────────────────────────────────────
router.get('/roads',                    authenticate, listRoadConditions);
router.post('/roads/condition',         authenticate, authorize(...ADMIN_OR_DISPATCHER), validateBody(schemas.roadConditionSchema), recordRoadCondition);
router.patch('/roads/condition/:id/clear', authenticate, authorize(...ADMIN_OR_DISPATCHER), clearRoadCondition);

// ── MODULE 5 : Simulation ─────────────────────────────────────────────────────
// Contrôle du moteur de simulation (Admin et Dispatcher uniquement)
router.post  ('/simulation/start',           authenticate, authorize(...ADMIN_OR_DISPATCHER), startSimulation);
router.post  ('/simulation/stop',            authenticate, authorize(...ADMIN_OR_DISPATCHER), stopSimulation);
router.post  ('/simulation/pause',           authenticate, authorize(...ADMIN_OR_DISPATCHER), pauseSimulation);
router.post  ('/simulation/resume',          authenticate, authorize(...ADMIN_OR_DISPATCHER), resumeSimulation);
router.patch ('/simulation/speed',           authenticate, authorize(...ADMIN_OR_DISPATCHER), setSimSpeed);
router.get   ('/simulation/status',          authenticate, getSimStatus);
router.get   ('/simulation/scenarios',       authenticate, listScenarios);
router.get   ('/simulation/events',          authenticate, getSimEvents);

// ── MODULE 1 : Capteurs BNR ───────────────────────────────────────────────────
router.get   ('/simulation/sensors/bnr',               authenticate, getBNRSummary);
router.post  ('/simulation/sensors/bnr/generate',      authenticate, authorize(...ADMIN_OR_DISPATCHER), generateBNRReadings);
router.get   ('/simulation/sensors/bnr/:stationId/history', authenticate, getBNRHistory);

// ── MODULE 2 : Optimisation routes ───────────────────────────────────────────
router.post  ('/ai/route-optimize',           authenticate, optimizeRoute);
router.post  ('/ai/route-graph/rebuild',      authenticate, authorize(...ADMIN), rebuildRouteGraph);
router.get   ('/ai/route-graph/stats',        authenticate, getGraphStats);

// ── MODULE 3 : Dispatch intelligent ──────────────────────────────────────────
router.get   ('/ai/dispatch-optimize',        authenticate, authorize(...ADMIN_OR_DISPATCHER), optimizeDispatch);
router.post  ('/ai/dispatch-apply',           authenticate, authorize(...ADMIN_OR_DISPATCHER), applyDispatchRecommendation);
router.get   ('/ai/dispatch-history',         authenticate, getDispatchHistory);

// ── MODULE 4 : Maintenance prédictive ────────────────────────────────────────
router.get   ('/ai/maintenance-predict',              authenticate, predictMaintenance);
router.get   ('/ai/maintenance-predict/:equipmentId', authenticate, predictMaintenanceForEquipment);
router.get   ('/ai/maintenance-history/:equipmentId', authenticate, getMaintenancePredictionHistory);

// ── Tableau de bord IA global ─────────────────────────────────────────────────
router.get   ('/ai/dashboard',                authenticate, getAIDashboard);
// Endpoint unifié : toutes les données critiques en un seul appel
router.get   ('/overview',                    authenticate, getOverview);

// ── Messagerie dispatcher ↔ chauffeur ────────────────────────────────────────
router.get   ('/messages',                    authenticate, getMessages);
router.get   ('/messages/unread-count',       authenticate, getUnreadCount);
router.post  ('/messages',                    authenticate, sendMessage);
router.patch ('/messages/:id/ack',            authenticate, ackMessage);
router.patch ('/messages/:id/read',           authenticate, markRead);
// Assignation manuelle (dispatcher override)
router.post  ('/dispatch/manual-assign',      authenticate, authorize(...ADMIN_OR_DISPATCHER), manualAssign);

// ── MODULE 6A : Production avancée ───────────────────────────────────────────
router.get('/production/kpi',     authenticate, getShiftProductionKPI);
router.get('/production/hourly',  authenticate, getHourlyBreakdown);
router.get('/production/loaders', authenticate, getLoaderBreakdown);
router.get('/production/trucks',  authenticate, getTruckRanking);

// ── MODULE 6B : Suivi matière ────────────────────────────────────────────────
router.get ('/material/breakdown',   authenticate, getMaterialBreakdownAdv);
router.get ('/material/flow',        authenticate, getMaterialFlow);
router.get ('/material/misdirected', authenticate, getMisdirectedLoads);
router.get ('/material/grade-trend', authenticate, getGradeTrend);
router.post('/material/record',      authenticate, authorize(...ADMIN_OR_DISPATCHER), recordLoad);

// ── MODULE 6C : Délais ────────────────────────────────────────────────────────
router.get  ('/delays/active',          authenticate, getOpenDelays);
router.get  ('/delays/shift',           authenticate, getShiftDelays);
router.get  ('/delays/summary',         authenticate, getDelaySummary);
router.get  ('/delays/categories',      authenticate, getDelayCategories);
router.post ('/delays/open',            authenticate, authorize(...ADMIN_OR_DISPATCHER), openDelay);
router.post ('/delays/close/:eventId',  authenticate, authorize(...ADMIN_OR_DISPATCHER), closeDelay);
router.post ('/delays/auto-detect',     authenticate, authorize(...ADMIN_OR_DISPATCHER), autoDetectIdleTrucks);

// ── MODULE 6D : Vitesse ───────────────────────────────────────────────────────
router.get ('/speed/violations', authenticate, getViolations);
router.get ('/speed/summary',    authenticate, getViolationSummary);
router.get ('/speed/limits',     authenticate, getRoadSpeedLimits);
router.post('/speed/check',      authenticate, authorize(...ADMIN_OR_DISPATCHER), checkSpeed);

// ── MODULE 6E : Rapports de poste ────────────────────────────────────────────
router.get ('/shift-reports',          authenticate, listReports);
router.get ('/shift-reports/:shiftId', authenticate, getReport);
router.post('/shift-reports/generate', authenticate, authorize(...ADMIN_OR_DISPATCHER), generateReport);

// ── MODULE 6F : TKPH Pneus ───────────────────────────────────────────────────
router.get ('/tyres/tkph',        authenticate, getTKPHStatus);
router.get ('/tyres/overloaded',  authenticate, getOverloadedTyres);
router.post('/tyres/calculate',   authenticate, authorize(...ADMIN_OR_DISPATCHER), calculateForSite);

export default router;
