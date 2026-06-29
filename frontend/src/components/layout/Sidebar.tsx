import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore, useRealtimeStore } from '../../store';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import {
  IconDashboard, IconMap, IconTruck, IconProduction, IconDispatch,
  IconReports, IconSettings, IconLogout, IconAlert, IconSimulation, IconAI,
  IconSpeed, IconGps,
} from '../ui/Icons';
import api from '../../lib/api';

/**
 * Sidebar simplifiée : 8 entrées essentielles.
 * Les pages secondaires restent accessibles par URL (liens depuis les pages).
 *
 * Sections :
 *  Contrôle   → Command Center, Carte Mine, Simulation
 *  Opérations → Flotte, Production, Sécurité
 *  Analyse → Optimisation, Rapports
 */

interface NavItem {
  to:    string;
  icon:  React.FC<{ size?: number; className?: string }>;
  label: string;
  badge?: number;
}

interface NavSection {
  type:  'section';
  label: string;
}

const NAV: (NavItem | NavSection)[] = [
  { type: 'section', label: 'Contrôle' },
  { to: '/dashboard',      icon: IconDashboard,  label: 'Command Center' },
  { to: '/map',            icon: IconMap,         label: 'Carte Mine' },
  { to: '/simulation',     icon: IconSimulation,  label: 'Simulation' },

  { type: 'section', label: 'Opérations' },
  { to: '/dispatch-console', icon: IconDispatch,    label: 'Dispatch' },
  { to: '/equipment',        icon: IconTruck,       label: 'Flotte' },
  { to: '/production',       icon: IconProduction,  label: 'Production' },
  { to: '/speed',            icon: IconSpeed,       label: 'Sécurité' },

  { type: 'section', label: 'Analyse' },
  { to: '/ai-predictions', icon: IconAI,          label: 'Optimisation' },
  { to: '/reports',        icon: IconReports,     label: 'Rapports' },
  { to: '/integration',    icon: IconGps,         label: 'Intégration GPS' },
];

export default function Sidebar() {
  const { user, logout } = useAuthStore();
  const { activeAlarms } = useRealtimeStore();
  const navigate = useNavigate();
  const [liveCount, setLiveCount] = useState(0);

  // Nombre d'engins GPS réels connectés — polling léger toutes les 10s
  useEffect(() => {
    const fetch = () =>
      api.get('/telemetry/live/status').then(({ data }) => {
        setLiveCount(data.liveCount ?? data.count ?? 0);
      }).catch(() => {});
    fetch();
    const id = setInterval(fetch, 10_000);
    return () => clearInterval(id);
  }, []);

  // Injecter le badge live sur l'entrée Intégration GPS
  const NAV_WITH_LIVE: typeof NAV = NAV.map(item =>
    'to' in item && item.to === '/integration' && liveCount > 0
      ? { ...item, badge: liveCount }
      : item
  );

  const criticalAlarms = activeAlarms.filter(
    a => a.severity === 'CRITICAL' || a.severity === 'EMERGENCY'
  ).length;

  return (
    <aside className="w-52 min-h-screen bg-[#0d1520] border-r border-[#1a2740] flex flex-col select-none">

      {/* Brand */}
      <div className="px-4 py-4 border-b border-[#1a2740]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-amber-500 flex items-center justify-center rounded flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5" strokeLinecap="round">
              <path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v3"/>
              <rect x="9" y="11" width="14" height="10" rx="2"/>
              <circle cx="12" cy="16" r="1"/>
            </svg>
          </div>
          <div>
            <div className="text-[13px] font-bold text-white leading-tight tracking-wide">FMS MINING</div>
            <div className="text-[10px] text-slate-500 tracking-widest uppercase">Fleet Mgmt</div>
          </div>
        </div>
      </div>

      {/* Site info */}
      <div className="px-4 py-2.5 border-b border-[#1a2740]">
        <div className="text-[9px] text-slate-500 uppercase tracking-widest mb-0.5">Site actif</div>
        <div className="text-xs font-semibold text-amber-400">Nchanga Open-Pit</div>
        <div className="flex items-center gap-1.5 mt-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
          <span className="text-[10px] text-emerald-400">Poste Jour · 06:00–18:00</span>
        </div>
      </div>

      {/* Alerte critique */}
      {criticalAlarms > 0 && (
        <div className="mx-3 mt-2 px-3 py-2 bg-red-950/60 border border-red-700/40 rounded flex items-center gap-2">
          <IconAlert size={13} className="text-red-400 flex-shrink-0" />
          <span className="text-[11px] text-red-400 font-semibold">
            {criticalAlarms} alarme{criticalAlarms > 1 ? 's' : ''} critique{criticalAlarms > 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 px-2 py-2 overflow-y-auto">
        {NAV_WITH_LIVE.map((item, i) => {
          if ('type' in item) {
            return (
              <div key={`sec-${i}`} className="px-3 pt-3 pb-1">
                <span className="text-[9px] font-bold tracking-widest uppercase text-slate-600">
                  {item.label}
                </span>
              </div>
            );
          }
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-2.5 px-3 py-2 rounded text-[12px] transition-colors group mb-0.5 border-l-2',
                  isActive
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500'
                    : 'text-slate-400 hover:bg-[#1a2740] hover:text-slate-200 border-transparent'
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={13} className={isActive ? 'text-amber-400' : 'text-slate-500 group-hover:text-slate-300'} />
                  <span className="truncate font-medium">{item.label}</span>
                  {item.badge != null && item.badge > 0 && (
                    <span className={clsx(
                      'ml-auto text-[9px] rounded-full px-1.5 py-0.5 font-bold',
                      item.to === '/integration'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-red-600 text-white'
                    )}>
                      {item.badge}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Liens rapides secondaires (accès direct sans surcharger la nav) */}
      <div className="px-3 py-2 border-t border-[#1a2740]">
        <p className="text-[9px] text-slate-600 uppercase tracking-wider mb-1.5">Accès rapide</p>
        <div className="flex flex-wrap gap-1">
          {[
            { to: '/dispatch',    label: 'Dispatch' },
            { to: '/maintenance', label: 'Maint.' },
            { to: '/delays',      label: 'Délais' },
            { to: '/material',    label: 'Matière' },
            { to: '/shift-reports', label: 'Rapports P.' },
            { to: '/fuel',        label: 'Carburant' },
          ].map(l => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                clsx('text-[9px] px-1.5 py-0.5 rounded transition-colors',
                  isActive ? 'bg-amber-500/20 text-amber-400' : 'text-slate-600 hover:text-slate-400 hover:bg-[#1a2740]')
              }
            >
              {l.label}
            </NavLink>
          ))}
        </div>
      </div>

      {/* Profil utilisateur */}
      <div className="border-t border-[#1a2740] p-3">
        <div className="flex items-center gap-2.5 mb-2">
          <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-[11px] font-bold text-slate-200 flex-shrink-0">
            {user?.firstName?.[0]}{user?.lastName?.[0]}
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-slate-200 truncate">{user?.firstName} {user?.lastName}</div>
            <div className="text-[9px] text-slate-500 font-mono">{user?.role}</div>
          </div>
        </div>
        <div className="flex gap-1">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              clsx('flex items-center gap-1 flex-1 px-2 py-1.5 rounded text-[10px] transition-colors',
                isActive ? 'text-amber-400 bg-amber-500/10' : 'text-slate-500 hover:text-slate-300 hover:bg-[#1a2740]')
            }
          >
            <IconSettings size={11} /> Paramètres
          </NavLink>
          <button
            onClick={() => { logout(); navigate('/login'); }}
            className="flex items-center gap-1 px-2 py-1.5 rounded text-[10px] text-slate-500 hover:text-red-400 hover:bg-red-950/40 transition-colors"
          >
            <IconLogout size={11} /> Quitter
          </button>
        </div>
      </div>
    </aside>
  );
}
