import type { ReactNode } from 'react';

type IconProps = { className?: string; size?: number };
const I = ({ d, size = 16, className = '' }: { d: string } & IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
    className={className}>
    <path d={d} />
  </svg>
);
const Ic = ({ children, size = 16, className = '' }: { children: ReactNode } & IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
    className={className}>
    {children}
  </svg>
);

export const IconDashboard  = (p: IconProps) => <Ic {...p}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></Ic>;
export const IconMap        = (p: IconProps) => <Ic {...p}><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></Ic>;
export const IconDispatch   = (p: IconProps) => <Ic {...p}><circle cx="12" cy="5" r="2"/><path d="M12 7v5"/><path d="M8 17l4-5 4 5"/><path d="M5 21h14"/><path d="M2 9l4-4 4 4"/><path d="M18 9l4-4-4-4"/></Ic>;
export const IconShift      = (p: IconProps) => <Ic {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M9 16l2 2 4-4"/></Ic>;
export const IconTruck      = (p: IconProps) => <Ic {...p}><path d="M1 3h15v13H1z"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></Ic>;
export const IconOperator   = (p: IconProps) => <Ic {...p}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></Ic>;
export const IconWrench     = (p: IconProps) => <Ic {...p}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></Ic>;
export const IconTyre       = (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="3" x2="12" y2="9"/><line x1="12" y1="15" x2="12" y2="21"/><line x1="3" y1="12" x2="9" y2="12"/><line x1="15" y1="12" x2="21" y2="12"/></Ic>;
export const IconTelemetry  = (p: IconProps) => <Ic {...p}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></Ic>;
export const IconFuel       = (p: IconProps) => <Ic {...p}><path d="M3 22V8l5-5h8v19"/><path d="M3 9h14"/><path d="M14 14h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2 2 2 0 0 0 2-2V10l-3-3"/><line x1="9" y1="14" x2="9" y2="18"/></Ic>;
export const IconProduction = (p: IconProps) => <Ic {...p}><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></Ic>;
export const IconRoads      = (p: IconProps) => <Ic {...p}><path d="M3 17l3-9 3 4 3-8 3 6 3-3"/><path d="M3 20h18"/></Ic>;
export const IconReports    = (p: IconProps) => <Ic {...p}><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></Ic>;
export const IconSettings   = (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></Ic>;
export const IconLogout     = (p: IconProps) => <Ic {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></Ic>;
export const IconBell       = (p: IconProps) => <Ic {...p}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></Ic>;
export const IconPlus       = (p: IconProps) => <I {...p} d="M12 5v14M5 12h14"/>;
export const IconEdit       = (p: IconProps) => <Ic {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></Ic>;
export const IconTrash      = (p: IconProps) => <Ic {...p}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></Ic>;
export const IconCheck      = (p: IconProps) => <I {...p} d="M20 6L9 17l-5-5"/>;
export const IconX          = (p: IconProps) => <Ic {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></Ic>;
export const IconSearch     = (p: IconProps) => <Ic {...p}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></Ic>;
export const IconFilter     = (p: IconProps) => <Ic {...p}><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></Ic>;
export const IconChevronDown= (p: IconProps) => <I {...p} d="M6 9l6 6 6-6"/>;
export const IconChevronRight=(p: IconProps) => <I {...p} d="M9 18l6-6-6-6"/>;
export const IconAlert      = (p: IconProps) => <Ic {...p}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></Ic>;
export const IconActivity   = (p: IconProps) => <I {...p} d="M22 12h-4l-3 9L9 3l-3 9H2"/>;
export const IconGps        = (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="3"/><path d="M19.94 11a8 8 0 1 1-15.88 0"/><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83"/></Ic>;
export const IconUser       = (p: IconProps) => <Ic {...p}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></Ic>;
export const IconLock       = (p: IconProps) => <Ic {...p}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></Ic>;
export const IconShield     = (p: IconProps) => <Ic {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></Ic>;
export const IconClock      = (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></Ic>;
export const IconRefresh    = (p: IconProps) => <Ic {...p}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></Ic>;
export const IconEye        = (p: IconProps) => <Ic {...p}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></Ic>;
export const IconDownload   = (p: IconProps) => <Ic {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></Ic>;
export const IconTag        = (p: IconProps) => <Ic {...p}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></Ic>;
export const IconPackage    = (p: IconProps) => <Ic {...p}><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></Ic>;
export const IconSave       = (p: IconProps) => <Ic {...p}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></Ic>;
export const IconCalendar   = (p: IconProps) => <Ic {...p}><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></Ic>;
export const IconToggleOff  = (p: IconProps) => <Ic {...p}><rect x="1" y="5" width="22" height="14" rx="7" ry="7"/><circle cx="8" cy="12" r="3"/></Ic>;
export const IconToggleOn   = (p: IconProps) => <Ic {...p}><rect x="1" y="5" width="22" height="14" rx="7" ry="7"/><circle cx="16" cy="12" r="3"/></Ic>;
// Nouveaux icônes — Modules IA / Simulation / Capteurs
export const IconSimulation = (p: IconProps) => <Ic {...p}><polygon points="5 3 19 12 5 21 5 3"/></Ic>;
export const IconAI         = (p: IconProps) => <Ic {...p}><rect x="2" y="2" width="20" height="20" rx="3"/><path d="M8 12h8M12 8v8"/><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="16" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="8" cy="16" r="1.5" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1.5" fill="currentColor" stroke="none"/></Ic>;
export const IconSensor     = (p: IconProps) => <Ic {...p}><path d="M12 18v4M8 20h8"/><path d="M6.34 15.66a8 8 0 0 1 0-11.31"/><path d="M17.66 15.66a8 8 0 0 0 0-11.31"/><path d="M9.17 12.83a4 4 0 0 1 0-5.66"/><path d="M14.83 12.83a4 4 0 0 0 0-5.66"/><circle cx="12" cy="10" r="1.5" fill="currentColor" stroke="none"/></Ic>;

// IconProduction2 — graphique en barres montantes
export const IconProduction2 = (p: IconProps) => <Ic {...p}><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></Ic>;

// IconMaterial — minerai / cube
export const IconMaterial = (p: IconProps) => <Ic {...p}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></Ic>;

// IconDelay — horloge avec pause
export const IconDelay = (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></Ic>;

// IconSpeed — compteur vitesse
export const IconSpeed = (p: IconProps) => <Ic {...p}><path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 12l4-4"/></Ic>;

// IconReport — document avec lignes
export const IconReport = (p: IconProps) => <Ic {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></Ic>;

// IconTKPH — pneu / cercle avec vitesse
export const IconTKPH = (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/></Ic>;
