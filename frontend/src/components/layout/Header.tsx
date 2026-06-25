import { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useRealtimeStore } from '../../store';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { kpiApi } from '../../lib/api';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Alarm } from '../../types';
import { IconBell, IconCheck } from '../ui/Icons';

const TITLES: Record<string, string> = {
  '/dashboard':   'Tableau de Bord',
  '/map':         'Carte de la Mine',
  '/dispatch':    'Console de Dispatch',
  '/shifts':      'Gestion des Postes',
  '/equipment':   'Gestion des Équipements',
  '/operators':   'Gestion des Opérateurs',
  '/maintenance': 'Maintenance',
  '/tyres':       'Gestion des Pneus',
  '/telemetry':   'Télémétrie',
  '/fuel':        'Gestion du Carburant',
  '/reports':     'Rapports & KPI',
};

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL:  'text-red-400 border-l-red-500',
  EMERGENCY: 'text-red-300 border-l-red-400',
  WARNING:   'text-yellow-400 border-l-yellow-500',
  INFO:      'text-blue-400 border-l-blue-500',
};

export default function Header() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { fleetStatus, activeAlarms } = useRealtimeStore();
  const [showAlarms, setShowAlarms] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close panel on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowAlarms(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const ackMutation = useMutation({
    mutationFn: (id: string) => kpiApi.acknowledgeAlarm(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alarms'] }),
  });

  const totalEquip = Object.values(fleetStatus).reduce((s, c) => s + c, 0);
  const productive = (fleetStatus['HAULING'] || 0) + (fleetStatus['LOADING'] || 0) +
                     (fleetStatus['DUMPING'] || 0) + (fleetStatus['RETURNING'] || 0) +
                     (fleetStatus['OPERATING'] || 0);

  const unackAlarms = activeAlarms.filter((a: Alarm) => !a.acknowledged);
  const criticalCount = unackAlarms.filter((a: Alarm) => a.severity === 'CRITICAL' || a.severity === 'EMERGENCY').length;

  // Live clock tick
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <header className="h-14 bg-mine-panel border-b border-mine-border flex items-center justify-between px-6 relative z-30">
      <h1 className="text-lg font-semibold text-white">
        {TITLES[pathname] || 'FMS Mining'}
      </h1>

      <div className="flex items-center gap-5">
        {/* Live fleet counters */}
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block"></span>
            <span className="text-mine-muted">En prod</span>
            <span className="font-mono font-bold text-blue-400">{productive}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block"></span>
            <span className="text-mine-muted">Panne</span>
            <span className="font-mono font-bold text-red-400">{fleetStatus['DOWN'] || 0}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-mine-muted">Total</span>
            <span className="font-mono font-bold">{totalEquip}</span>
          </div>
        </div>

        {/* Alarm Bell */}
        <div className="relative" ref={panelRef}>
          <button
            onClick={() => setShowAlarms((v) => !v)}
            className={`relative flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${
              criticalCount > 0
                ? 'bg-red-900/40 hover:bg-red-900/60 text-red-400'
                : unackAlarms.length > 0
                ? 'bg-yellow-900/30 hover:bg-yellow-900/50 text-yellow-400'
                : 'text-mine-muted hover:text-white hover:bg-mine-border'
            }`}
          >
            <IconBell size={15} />
            {unackAlarms.length > 0 && (
              <span className={`absolute -top-1 -right-1 text-xs font-bold min-w-[16px] h-4 rounded-full flex items-center justify-center px-1 ${
                criticalCount > 0 ? 'bg-red-500 text-white' : 'bg-yellow-500 text-black'
              }`}>
                {unackAlarms.length > 9 ? '9+' : unackAlarms.length}
              </span>
            )}
          </button>

          {/* Alarm dropdown panel */}
          {showAlarms && (
            <div className="absolute right-0 top-11 w-96 bg-mine-panel border border-mine-border rounded-xl shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-mine-border">
                <div className="text-sm font-semibold">
                  Alarmes actives
                  {unackAlarms.length > 0 && (
                    <span className="ml-2 text-xs text-mine-muted">({unackAlarms.length} non acquittées)</span>
                  )}
                </div>
                <button
                  onClick={() => { navigate('/dashboard'); setShowAlarms(false); }}
                  className="text-xs text-mine-highlight hover:underline"
                >
                  Voir tout
                </button>
              </div>
              <div className="max-h-80 overflow-y-auto divide-y divide-mine-border">
                {unackAlarms.length === 0 ? (
                  <div className="px-4 py-6 text-center text-mine-muted text-sm">
                    Aucune alarme active
                  </div>
                ) : unackAlarms.slice(0, 12).map((alarm: Alarm) => (
                  <div
                    key={alarm.alarm_id}
                    className={`px-4 py-3 flex items-start gap-3 border-l-2 hover:bg-mine-bg transition-colors ${
                      SEVERITY_COLORS[alarm.severity] || ''
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold">{alarm.fleet_number || 'Site'}</span>
                        <span className="text-xs text-mine-muted font-mono">{alarm.alarm_code}</span>
                        <span className={`text-xs ml-auto ${SEVERITY_COLORS[alarm.severity]?.split(' ')[0] || 'text-mine-muted'}`}>
                          {alarm.severity}
                        </span>
                      </div>
                      {alarm.message && (
                        <div className="text-xs text-mine-muted mt-0.5 truncate">{alarm.message}</div>
                      )}
                      <div className="text-xs text-mine-muted mt-1">
                        {formatDistanceToNow(parseISO(alarm.event_time), { addSuffix: true, locale: fr })}
                      </div>
                    </div>
                    <button
                      onClick={() => ackMutation.mutate(alarm.alarm_id)}
                      disabled={ackMutation.isPending}
                      className="flex items-center text-mine-muted hover:text-green-400 shrink-0 transition-colors p-0.5"
                      title="Acquitter"
                    >
                      <IconCheck size={13} />
                    </button>
                  </div>
                ))}
              </div>
              {unackAlarms.length > 12 && (
                <div className="px-4 py-2 text-xs text-mine-muted text-center border-t border-mine-border">
                  +{unackAlarms.length - 12} alarmes supplémentaires
                </div>
              )}
            </div>
          )}
        </div>

        {/* Clock */}
        <div className="text-xs font-mono text-mine-muted tabular-nums">
          {format(now, 'dd MMM · HH:mm:ss', { locale: fr })}
        </div>

        {/* Live indicator */}
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400"></span>
          </span>
          <span className="text-xs text-green-400 font-medium">LIVE</span>
        </div>
      </div>
    </header>
  );
}
