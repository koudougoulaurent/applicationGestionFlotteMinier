/**
 * DispatchConsole.tsx
 *
 * Poste de travail du DISPATCHER — inspiré de Modular Mining DISPATCH.
 *
 * Fonctions :
 *  - Carte 3D temps réel (tous les engins avec lat/lon/heading)
 *  - Liste flotte avec statut et phase de chaque camion
 *  - Assignation manuelle : dispatcher choisit camion → pelle → destination
 *  - Messagerie directe dispatcher ↔ chauffeur
 *  - Journal des événements récents
 *  - Refresh automatique toutes les 3 secondes
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../lib/api';
import { simulationApi } from '../lib/api';
import Mine3DView, { TruckAction } from '../components/mining/Mine3DView';
import { useAuthStore } from '../store';

// ── Types ─────────────────────────────────────────────────────────────────────
interface TruckState {
  equipmentId:  string;
  fleetNumber:  string;
  phase:        string;
  status:       string;
  lat:          number;
  lon:          number;
  heading:      number;
  speed_kmh:    number;
  fuelLevel_pct:number;
  healthScore:  number;
  payloadTonnes:number;
  phaseProgress:number;
  phaseDuration_s: number;
  cyclesThisShift: number;
  tonnesThisShift: number;
  loaderId:     string | null;
  destId:       string | null;
}

interface SimStatus {
  status:          string;
  speedMultiplier: number;
  uptime_s:        number;
  totalCycles:     number;
  totalTonnes:     number;
  trucks:          TruckState[];
}

interface Equipment {
  equipment_id: string;
  fleet_number: string;
  model:        string;
  type_name:    string;
  category:     string;
  status:       string;
  health_score: number;
}

interface MineLocation {
  location_id:   string;
  code:          string;
  name:          string;
  type:          string;
}

interface DispatchMessage {
  messageId:   string;
  senderRole:  string;
  senderName:  string;
  fleetNumber: string | null;
  direction:   string;
  message:     string;
  priority:    string;
  sentAt:      string;
  readAt:      string | null;
  ackAt:       string | null;
  isUnread:    boolean;
}

// ── Constantes ────────────────────────────────────────────────────────────────
const PHASE_LABELS: Record<string, string> = {
  IDLE:              'En attente',
  MOVING_TO_SOURCE:  '→ Pelle',
  QUEUING_AT_SOURCE: 'File pelle',
  LOADING:           'Chargement',
  HAULING:           '→ Décharg.',
  QUEUING_AT_DEST:   'File dump',
  DUMPING:           'Déversement',
  RETURNING:         '← Retour',
  REFUELING:         'Carburant',
  DOWN:              'En panne',
};

const PHASE_DOT: Record<string, string> = {
  IDLE:              'bg-slate-500',
  MOVING_TO_SOURCE:  'bg-blue-500',
  QUEUING_AT_SOURCE: 'bg-yellow-500',
  LOADING:           'bg-orange-500',
  HAULING:           'bg-emerald-500',
  QUEUING_AT_DEST:   'bg-yellow-400',
  DUMPING:           'bg-purple-500',
  RETURNING:         'bg-cyan-500',
  REFUELING:         'bg-pink-500',
  DOWN:              'bg-red-600 animate-pulse',
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function uptimeLabel(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

function timeAgo(dateStr: string) {
  const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  return `${Math.floor(s / 3600)}h`;
}

// ── Composant Dispatch Console ─────────────────────────────────────────────────
export default function DispatchConsole() {
  const { user }             = useAuthStore();
  const siteId               = user?.siteId ?? '';
  const isDispatcher         = ['ADMIN','DISPATCHER'].includes(user?.role ?? '');

  const [sim,            setSim]            = useState<SimStatus | null>(null);
  const [equipment,      setEquipment]      = useState<Equipment[]>([]);
  const [locations,      setLocations]      = useState<MineLocation[]>([]);
  const [messages,       setMessages]       = useState<DispatchMessage[]>([]);
  const [selectedTruck,  setSelectedTruck]  = useState<string | null>(null);
  const [assignLoader,   setAssignLoader]   = useState('');
  const [assignDest,     setAssignDest]     = useState('');
  const [msgText,        setMsgText]        = useState('');
  const [msgTarget,      setMsgTarget]      = useState('');
  const [msgPriority,    setMsgPriority]    = useState<'NORMAL'|'URGENT'>('NORMAL');
  const [sendingMsg,     setSendingMsg]     = useState(false);
  const [assigning,      setAssigning]      = useState(false);
  const [simStarting,    setSimStarting]    = useState(false);
  const [feedback,       setFeedback]       = useState('');
  const [activeAction,   setActiveAction]   = useState<TruckAction['type'] | null>(null);
  const [stopConfirm,    setStopConfirm]    = useState<string | null>(null);

  const pollRef      = useRef<ReturnType<typeof setInterval>|null>(null);
  const msgEndRef    = useRef<HTMLDivElement|null>(null);
  const msgInputRef  = useRef<HTMLInputElement|null>(null);
  const assignRef    = useRef<HTMLDivElement|null>(null);

  // ── Chargement données ───────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const [simRes, eqRes, locRes, msgRes] = await Promise.all([
        api.get<SimStatus>('/simulation/status'),
        api.get<Equipment[]>(`/equipment?siteId=${siteId}`),
        api.get<MineLocation[]>(`/locations?siteId=${siteId}`),
        api.get<DispatchMessage[]>(`/messages?siteId=${siteId}&limit=40`),
      ]);
      setSim(simRes.data);
      setEquipment(eqRes.data);
      setLocations(locRes.data ?? []);
      setMessages(msgRes.data.reverse());
    } catch { /* silencieux */ }
  }, [siteId]);

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const sendMsg = async () => {
    if (!msgText.trim()) return;
    setSendingMsg(true);
    try {
      await api.post('/messages', {
        siteId,
        fleetNumber: msgTarget || selectedTruck || undefined,
        message:     msgText.trim(),
        priority:    msgPriority,
        direction:   'TO_TRUCK',
      });
      setMsgText('');
      await load();
      setFeedback('Message envoyé');
      setTimeout(() => setFeedback(''), 2000);
    } catch { setFeedback('Erreur envoi'); }
    finally { setSendingMsg(false); }
  };

  // ── Handler actions depuis le panel 3D ──────────────────────────────────
  const handle3DAction = useCallback((action: TruckAction) => {
    setSelectedTruck(action.fleetNumber);
    setActiveAction(action.type);

    switch (action.type) {
      case 'assign':
        // Sélectionne le camion et défile vers le panneau d'assignation
        setTimeout(() => assignRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
        break;
      case 'redirect':
        // Ouvre panel d'assignation avec focus sur la destination
        setTimeout(() => assignRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
        break;
      case 'message':
        // Pré-sélectionne la cible et focus le champ message
        setMsgTarget(action.fleetNumber);
        setTimeout(() => msgInputRef.current?.focus(), 150);
        break;
      case 'stop':
        // Demande confirmation avant arrêt d'urgence
        setStopConfirm(action.fleetNumber);
        break;
    }
    // Reset après 4 secondes
    setTimeout(() => setActiveAction(null), 4000);
  }, []);

  const startSim = async () => {
    setSimStarting(true);
    try {
      await simulationApi.start({ siteId, speedMultiplier: 5 });
      setFeedback('Simulation démarrée ×5');
      setTimeout(() => { setFeedback(''); load(); }, 1500);
    } catch { setFeedback('Erreur démarrage'); }
    finally { setSimStarting(false); }
  };

  const confirmStop = async () => {
    if (!stopConfirm) return;
    setSendingMsg(true);
    try {
      await api.post('/messages', {
        siteId,
        fleetNumber: stopConfirm,
        message:     '🛑 ARRÊT D\'URGENCE — Immobilisez-vous immédiatement. Dispatcher.',
        priority:    'URGENT',
        direction:   'TO_TRUCK',
      });
      setFeedback(`Arrêt urgence envoyé → ${stopConfirm}`);
      setStopConfirm(null);
      await load();
      setTimeout(() => setFeedback(''), 4000);
    } catch { setFeedback('Erreur envoi'); }
    finally { setSendingMsg(false); }
  };

  const doAssign = async () => {
    if (!selectedTruck || !assignLoader) return;
    setAssigning(true);
    try {
      const res = await api.post('/dispatch/manual-assign', {
        siteId,
        truckFleet:  selectedTruck,
        loaderFleet: assignLoader,
        destination: assignDest,
      });
      setFeedback((res.data as {message:string}).message ?? 'Assigné');
      setAssignLoader('');
      setAssignDest('');
      await load();
      setTimeout(() => setFeedback(''), 3000);
    } catch { setFeedback('Erreur assignation'); }
    finally { setAssigning(false); }
  };

  // ── Données dérivées ─────────────────────────────────────────────────────
  const trucks   = sim?.trucks ?? [];
  // Pelles/chargeurs disponibles (depuis DB, statut non DOWN)
  const loaders  = equipment.filter(e =>
    ['EXCAVATOR','LOADER'].includes(e.category) && e.status !== 'DOWN'
  );
  // Destinations de déversement disponibles (depuis DB)
  const dests    = locations.filter(l =>
    ['CRUSHER','DUMP','STOCKPILE'].includes(l.type)
  );
  const selected = trucks.find(t => t.fleetNumber === selectedTruck);
  const unreadCount = messages.filter(m => m.isUnread).length;

  return (
    // -m-6 compense le padding p-6 du Layout, h = plein écran - header (56px)
    <div className="-m-6 flex overflow-hidden bg-[#0d1520]" style={{ height: 'calc(100vh - 56px)' }}>

      {/* ══ COLONNE GAUCHE : carte 3D + contrôles simulation ══════════════════ */}
      <div className="flex flex-col flex-1 min-w-0 border-r border-[#1a2740]">

        {/* En-tête */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1a2740] bg-[#0f1e30] flex-shrink-0">
          <div>
            <h1 className="text-sm font-bold text-white">Console Dispatcher</h1>
            <p className="text-[10px] text-slate-500">
              {sim ? `${sim.status} · ×${sim.speedMultiplier} · ${uptimeLabel(sim.uptime_s)}` : 'Chargement…'}
              {' · '}
              <span className="text-amber-400">{trucks.length} engins</span>
              {' · '}
              <span className="text-emerald-400">{sim?.totalCycles ?? 0} cycles · {sim?.totalTonnes?.toLocaleString() ?? 0} t</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            {feedback && (
              <span className="text-[10px] text-emerald-400 bg-emerald-900/30 border border-emerald-700/30 px-2 py-1 rounded">
                {feedback}
              </span>
            )}
            <span className="text-[10px] text-slate-500">⟳ 3s</span>
          </div>
        </div>

        {/* Carte 3D plein espace — height="fill" pour occuper tout le flex-1 */}
        <div className="flex-1 min-h-0 p-1" style={{ position: 'relative', minHeight: 0 }}>
          <Mine3DView
            trucks={trucks}
            selectedTruck={selectedTruck}
            onSelectTruck={setSelectedTruck}
            onAction={handle3DAction}
            height="fill"
            siteId={siteId}
          />

          {/* ── Modal confirmation arrêt urgence ─────────────────────── */}
          {stopConfirm && (
            <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:30 }}
              onClick={() => setStopConfirm(null)}>
              <div style={{ background:'#1a0505', border:'2px solid #ef4444', borderRadius:12, padding:'20px 24px', maxWidth:320, textAlign:'center' }}
                onClick={e => e.stopPropagation()}>
                <div style={{ fontSize:28, marginBottom:8 }}>🛑</div>
                <div style={{ fontSize:14, fontWeight:800, color:'#fca5a5', marginBottom:6 }}>Arrêt d'urgence</div>
                <div style={{ fontSize:11, color:'#f87171', marginBottom:14 }}>
                  Confirmer l'arrêt immédiat de <strong style={{ color:'#fff' }}>{stopConfirm}</strong> ?<br />
                  Le chauffeur sera notifié URGENT.
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  <button onClick={() => setStopConfirm(null)}
                    style={{ flex:1, padding:'7px 0', background:'#1a2740', border:'1px solid #334155', borderRadius:6, color:'#94a3b8', fontSize:11, cursor:'pointer' }}>
                    Annuler
                  </button>
                  <button onClick={confirmStop}
                    style={{ flex:1, padding:'7px 0', background:'#991b1b', border:'1px solid #ef4444', borderRadius:6, color:'#fff', fontSize:11, fontWeight:700, cursor:'pointer' }}>
                    Confirmer arrêt
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ══ COLONNE DROITE : liste flotte + assignation + messages ══════════════ */}
      <div className="w-80 flex flex-col flex-shrink-0 overflow-hidden">

        {/* ── Flotte (liste compacte) ───────────────────────────────────────── */}
        <div className="flex-1 min-h-0 overflow-y-auto border-b border-[#1a2740]">
          <div className="sticky top-0 bg-[#0f1e30] px-3 py-2 border-b border-[#1a2740] flex items-center justify-between z-10">
            <span className="text-[11px] font-bold text-white uppercase tracking-wider">Flotte</span>
            <span className="text-[10px] text-slate-500">{trucks.filter(t=>t.phase!=='DOWN').length}/{trucks.length} actifs</span>
          </div>

          {trucks.length === 0 ? (
            <div className="p-5 text-center space-y-3">
              <div className="text-slate-500 text-[11px]">Simulation arrêtée</div>
              <button
                onClick={startSim}
                disabled={simStarting}
                className="w-full py-2 text-xs font-bold rounded bg-emerald-800 hover:bg-emerald-700 text-emerald-200 disabled:opacity-50 border border-emerald-700/40 transition-colors"
              >
                {simStarting ? 'Démarrage…' : '▶ Démarrer la simulation'}
              </button>
              <p className="text-[9px] text-slate-600">Démarre à ×5 — ajustez depuis Command Center</p>
            </div>
          ) : (
            trucks.map(t => {
              const isSelected = t.fleetNumber === selectedTruck;
              return (
                <button
                  key={t.fleetNumber}
                  onClick={() => setSelectedTruck(isSelected ? null : t.fleetNumber)}
                  className={`w-full text-left px-3 py-2 border-b border-[#1a2740] transition-colors ${
                    isSelected ? 'bg-amber-500/10 border-l-2 border-l-amber-500' : 'hover:bg-[#1a2740]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${PHASE_DOT[t.phase] ?? 'bg-slate-500'}`} />
                    <span className={`text-[11px] font-bold font-mono flex-shrink-0 w-14 ${isSelected ? 'text-amber-400' : 'text-white'}`}>
                      {t.fleetNumber}
                    </span>
                    <span className="text-[10px] text-slate-400 flex-1 truncate">{PHASE_LABELS[t.phase] ?? t.phase}</span>
                    <span className={`text-[10px] font-mono flex-shrink-0 ${t.fuelLevel_pct < 20 ? 'text-red-400' : t.fuelLevel_pct < 40 ? 'text-yellow-400' : 'text-slate-500'}`}>
                      ⛽{t.fuelLevel_pct.toFixed(0)}%
                    </span>
                  </div>

                  {/* Mini barre de progression de phase */}
                  <div className="mt-1 ml-4 h-0.5 bg-[#1a2740] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        t.phase === 'DOWN' ? 'bg-red-600' :
                        t.phase === 'HAULING' ? 'bg-emerald-500' :
                        t.phase === 'LOADING' ? 'bg-orange-500' : 'bg-blue-500'
                      }`}
                      style={{ width: `${Math.min(100, t.phaseProgress)}%` }}
                    />
                  </div>

                  {/* Infos cycles si pertinent */}
                  {t.cyclesThisShift > 0 && (
                    <div className="ml-4 mt-0.5 text-[9px] text-slate-600">
                      {t.cyclesThisShift} cycles · {t.tonnesThisShift.toFixed(0)} t
                      {t.payloadTonnes > 0 ? ` · 📦 ${t.payloadTonnes.toFixed(0)} t` : ''}
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* ── Panneau camion sélectionné : assignation + infos ─────────────── */}
        {selected && (
          <div className="flex-shrink-0 border-b border-[#1a2740] bg-[#0a1628]">
            <div className="px-3 py-2 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between">
              <span className="text-xs font-bold text-amber-400">{selected.fleetNumber} — {PHASE_LABELS[selected.phase]}</span>
              <button onClick={() => setSelectedTruck(null)} className="text-slate-500 hover:text-white text-xs">✕</button>
            </div>

            {/* Stats compactes */}
            <div className="grid grid-cols-3 gap-0 border-b border-[#1a2740]">
              {[
                { l: 'Vitesse', v: `${selected.speed_kmh} km/h` },
                { l: 'Charge', v: `${selected.payloadTonnes.toFixed(0)} t` },
                { l: 'Santé', v: `${selected.healthScore}%` },
                { l: 'Carburant', v: `${selected.fuelLevel_pct.toFixed(0)}%` },
                { l: 'Cycles', v: `${selected.cyclesThisShift}` },
                { l: 'Tonnes', v: `${selected.tonnesThisShift.toFixed(0)} t` },
              ].map(({ l, v }) => (
                <div key={l} className="px-2 py-1.5 border-r border-b border-[#1a2740] last:border-r-0">
                  <div className="text-[9px] text-slate-500">{l}</div>
                  <div className="text-[11px] font-bold text-white">{v}</div>
                </div>
              ))}
            </div>

            {/* Assignation manuelle (dispatcher uniquement) */}
            {isDispatcher && (
              <div ref={assignRef} className={`px-3 py-2 space-y-2 transition-colors ${activeAction === 'assign' || activeAction === 'redirect' ? 'bg-amber-500/5 border border-amber-500/20 rounded-lg mx-1 my-1' : ''}`}>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  {activeAction === 'assign' && <span className="text-amber-400 animate-pulse">▶</span>}
                  {activeAction === 'redirect' ? 'Changer destination :' : 'Assigner à :'}
                </p>

                <select
                  value={assignLoader}
                  onChange={e => setAssignLoader(e.target.value)}
                  className="w-full text-[10px] bg-[#0f1e30] border border-[#1a2740] rounded px-2 py-1.5 text-white"
                >
                  <option value="">— Choisir une pelle/chargeur —</option>
                  {loaders.length === 0 && (
                    <option disabled value="">Aucune pelle disponible</option>
                  )}
                  {loaders.map(l => (
                    <option key={l.equipment_id} value={l.fleet_number}>
                      {l.fleet_number} — {l.type_name} [{l.status}]
                    </option>
                  ))}
                </select>

                <select
                  value={assignDest}
                  onChange={e => setAssignDest(e.target.value)}
                  className="w-full text-[10px] bg-[#0f1e30] border border-[#1a2740] rounded px-2 py-1.5 text-white"
                >
                  <option value="">— Destination (optionnel) —</option>
                  {dests.map(d => (
                    <option key={d.location_id} value={d.code}>{d.code} — {d.name}</option>
                  ))}
                </select>

                <button
                  onClick={doAssign}
                  disabled={!assignLoader || assigning}
                  className="w-full py-1.5 text-xs font-bold rounded bg-amber-600 hover:bg-amber-500 text-black disabled:opacity-40 transition-colors"
                >
                  {assigning
                    ? 'Assignation…'
                    : `Assigner ${selectedTruck} → ${assignLoader || '?'}`}
                </button>
              </div>
            )}

            {/* Message rapide au camion sélectionné */}
            <div className="px-3 py-2 border-t border-[#1a2740]">
              <p className="text-[10px] font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                Message → {selected.fleetNumber}
              </p>
              <div className="flex gap-1">
                <input
                  ref={msgInputRef}
                  value={msgText}
                  onChange={e => setMsgText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { setMsgTarget(selected.fleetNumber); sendMsg(); } }}
                  placeholder="Instruction au chauffeur…"
                  className={`flex-1 text-[10px] bg-[#0f1e30] border rounded px-2 py-1.5 text-white placeholder-slate-600 transition-colors ${activeAction === 'message' ? 'border-blue-500 ring-1 ring-blue-500/30' : 'border-[#1a2740]'}`}
                />
                <button
                  onClick={() => { setMsgTarget(selected.fleetNumber); sendMsg(); }}
                  disabled={!msgText.trim() || sendingMsg}
                  className="px-2 py-1.5 text-[11px] rounded bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-40"
                >
                  ➤
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Messagerie complète ──────────────────────────────────────────── */}
        <div className="flex flex-col flex-shrink-0" style={{ height: selected ? '220px' : '260px' }}>
          <div className="px-3 py-2 border-b border-[#1a2740] bg-[#0f1e30] flex items-center justify-between flex-shrink-0">
            <span className="text-[11px] font-bold text-white uppercase tracking-wider">
              Radio Dispatcher
              {unreadCount > 0 && (
                <span className="ml-2 text-[9px] bg-red-600 text-white rounded-full px-1.5 py-0.5 font-bold">
                  {unreadCount}
                </span>
              )}
            </span>
          </div>

          {/* Historique des messages */}
          <div className="flex-1 overflow-y-auto px-2 py-1 space-y-1">
            {messages.length === 0 ? (
              <p className="text-center text-[10px] text-slate-600 mt-4">Aucun message</p>
            ) : (
              messages.map(m => {
                const isFromTruck = m.direction === 'FROM_TRUCK';
                const isUrgent    = m.priority === 'URGENT';
                return (
                  <div key={m.messageId} className={`flex ${isFromTruck ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[85%] px-2 py-1.5 rounded-lg text-[10px] leading-tight ${
                      isFromTruck
                        ? `bg-[#1a2740] text-slate-200 ${isUrgent ? 'border border-red-500/60' : ''}`
                        : 'bg-blue-800/60 text-blue-100'
                    }`}>
                      <div className="flex items-center gap-1 mb-0.5">
                        <span className={`font-bold ${isUrgent ? 'text-red-400' : isFromTruck ? 'text-amber-400' : 'text-blue-300'}`}>
                          {isUrgent && '🚨 '}
                          {m.fleetNumber ?? (isFromTruck ? '?' : 'Dispatch')}
                        </span>
                        <span className="text-[8px] text-slate-500 ml-auto">{timeAgo(m.sentAt)}</span>
                        {m.ackAt && <span className="text-[8px] text-emerald-500">✓✓</span>}
                        {!m.ackAt && m.readAt && <span className="text-[8px] text-slate-500">✓</span>}
                      </div>
                      <p>{m.message}</p>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={msgEndRef} />
          </div>

          {/* Composer un message (broadcast ou ciblé) */}
          <div className="px-2 py-2 border-t border-[#1a2740] flex-shrink-0 space-y-1.5">
            <div className="flex gap-1">
              <select
                value={msgTarget}
                onChange={e => setMsgTarget(e.target.value)}
                className="text-[10px] bg-[#0f1e30] border border-[#1a2740] rounded px-1.5 py-1 text-white w-24 flex-shrink-0"
              >
                <option value="">Tous</option>
                {trucks.map(t => <option key={t.fleetNumber} value={t.fleetNumber}>{t.fleetNumber}</option>)}
              </select>
              <select
                value={msgPriority}
                onChange={e => setMsgPriority(e.target.value as 'NORMAL'|'URGENT')}
                className="text-[10px] bg-[#0f1e30] border border-[#1a2740] rounded px-1.5 py-1 text-white w-20 flex-shrink-0"
              >
                <option value="NORMAL">Normal</option>
                <option value="URGENT">Urgent</option>
              </select>
            </div>
            <div className="flex gap-1">
              <input
                value={msgText}
                onChange={e => setMsgText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) sendMsg(); }}
                placeholder={msgTarget ? `Message → ${msgTarget}` : 'Message à toute la flotte…'}
                className="flex-1 text-[10px] bg-[#0f1e30] border border-[#1a2740] rounded px-2 py-1.5 text-white placeholder-slate-600 min-w-0"
              />
              <button
                onClick={sendMsg}
                disabled={!msgText.trim() || sendingMsg}
                className={`px-2.5 py-1.5 text-xs font-bold rounded disabled:opacity-40 transition-colors ${
                  msgPriority === 'URGENT'
                    ? 'bg-red-700 hover:bg-red-600 text-white'
                    : 'bg-blue-700 hover:bg-blue-600 text-white'
                }`}
              >
                {sendingMsg ? '…' : '➤'}
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
