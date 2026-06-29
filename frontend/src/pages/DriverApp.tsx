/**
 * DriverApp — Interface chauffeur ultra-simple (mobile first)
 *
 * Sécurité :
 *  - Le token JWT n'est JAMAIS stocké dans l'URL visible en prod.
 *    Le premier chargement (?token=...) le stocke en sessionStorage puis
 *    redirige vers /driver?truck=TK-007 (URL propre, token invisible).
 *  - Chaque trame est validée côté serveur (Zod + vérification DB).
 *
 * Ergonomie :
 *  - Wake Lock API : écran allumé en permanence pendant le tracking
 *  - Offline queue : les trames en attente sont renvoyées au retour réseau
 *  - Phase affichée avec couleur + icône
 *  - Slider charge + carburant mis à jour à chaque envoi
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';

const SEND_INTERVAL_MS = 5000;
const SESSION_TOKEN_KEY = 'fms_driver_token';
const SESSION_TRUCK_KEY = 'fms_driver_truck';

// ── Sécurité : extraire et nettoyer le token de l'URL ──────────────────────
function extractAndCleanToken(): { truck: string; token: string } {
  const params = new URLSearchParams(window.location.search);
  const truck  = params.get('truck') ?? sessionStorage.getItem(SESSION_TRUCK_KEY) ?? '';
  const token  = params.get('token') ?? sessionStorage.getItem(SESSION_TOKEN_KEY) ?? '';

  if (params.get('token')) {
    // Stocker en sessionStorage puis nettoyer l'URL
    sessionStorage.setItem(SESSION_TOKEN_KEY, token);
    sessionStorage.setItem(SESSION_TRUCK_KEY, truck);
    const clean = new URL(window.location.href);
    clean.searchParams.delete('token');
    window.history.replaceState({}, '', clean.toString());
  }
  return { truck, token };
}

interface TrameResult { inferredPhase: string; ok: boolean }

const PHASE_FR: Record<string, string> = {
  IDLE:'En attente',           MOVING_TO_SOURCE:'En route vers pelle',
  QUEUING_AT_SOURCE:'File pelle', LOADING:'Chargement',
  HAULING:'Transport chargé',  QUEUING_AT_DEST:'File dump',
  DUMPING:'Déversement',       RETURNING:'Retour à vide',
  REFUELING:'Ravitaillement',  DOWN:'En panne',
};

const PHASE_ICON: Record<string, string> = {
  IDLE:'⏸', MOVING_TO_SOURCE:'➡', QUEUING_AT_SOURCE:'⏳', LOADING:'🔄',
  HAULING:'🚛', QUEUING_AT_DEST:'⏳', DUMPING:'⬇', RETURNING:'↩',
  REFUELING:'⛽', DOWN:'🔴',
};

const PHASE_COLOR: Record<string, string> = {
  IDLE:'#64748b', MOVING_TO_SOURCE:'#3b82f6', QUEUING_AT_SOURCE:'#eab308',
  LOADING:'#f97316', HAULING:'#22c55e', QUEUING_AT_DEST:'#facc15',
  DUMPING:'#a855f7', RETURNING:'#06b6d4', REFUELING:'#ec4899', DOWN:'#ef4444',
};

export default function DriverApp() {
  const { truck: fleetNumber, token: authToken } = extractAndCleanToken();
  const baseUrl = `${window.location.protocol}//${window.location.host}`;

  const [tracking,   setTracking]   = useState(false);
  const [phase,      setPhase]      = useState('IDLE');
  const [lastSent,   setLastSent]   = useState<Date | null>(null);
  const [error,      setError]      = useState<string | null>(null);
  const [gpsOk,      setGpsOk]      = useState(false);
  const [gpsAccuracy,setGpsAcc]     = useState<number | null>(null);
  const [coords,     setCoords]     = useState<GeolocationCoordinates | null>(null);
  const [payload_kg, setPayload_kg] = useState(0);
  const [fuel_pct,   setFuel_pct]   = useState(80);
  const [sendCount,  setSendCount]  = useState(0);
  const [offline,    setOffline]    = useState(!navigator.onLine);
  const [queueSize,  setQueueSize]  = useState(0);

  const watchId     = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const coordsRef   = useRef<GeolocationCoordinates | null>(null);
  const wakeLock    = useRef<WakeLockSentinel | null>(null);
  const offlineQ    = useRef<object[]>([]);

  coordsRef.current = coords;

  // ── Wake Lock : garde l'écran allumé ──────────────────────────────────────
  const acquireWakeLock = async () => {
    if (!('wakeLock' in navigator)) return;
    try {
      wakeLock.current = await (navigator as Navigator & { wakeLock: { request: (t: string) => Promise<WakeLockSentinel> } }).wakeLock.request('screen');
    } catch { /* non supporté sur cet appareil */ }
  };
  const releaseWakeLock = () => { wakeLock.current?.release(); wakeLock.current = null; };

  // ── Offline queue ──────────────────────────────────────────────────────────
  useEffect(() => {
    const onOnline  = async () => {
      setOffline(false);
      // Vider la queue offline
      const q = [...offlineQ.current]; offlineQ.current = [];
      setQueueSize(0);
      for (const trame of q) {
        await axios.post(`${baseUrl}/api/v1/telemetry/live`, trame,
          { headers: { Authorization: `Bearer ${authToken}` } }).catch(() => {});
      }
    };
    const onOffline = () => setOffline(true);
    window.addEventListener('online',  onOnline);
    window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, [authToken, baseUrl]);

  // ── Envoi d'une trame ──────────────────────────────────────────────────────
  const sendTrame = useCallback(async (c: GeolocationCoordinates) => {
    if (!authToken || !fleetNumber) return;

    const body = {
      fleetNumber,
      lat:           c.latitude,
      lon:           c.longitude,
      speed_kmh:     c.speed != null ? Math.round(c.speed * 3.6) : 0,
      heading:       c.heading != null && c.heading >= 0 ? Math.round(c.heading) : 0,
      payload_kg,
      fuelLevel_pct: fuel_pct,
      engineRunning: true,
    };

    if (offline) {
      offlineQ.current.push(body);
      setQueueSize(offlineQ.current.length);
      return;
    }

    try {
      const res = await axios.post<TrameResult>(
        `${baseUrl}/api/v1/telemetry/live`, body,
        { headers: { Authorization: `Bearer ${authToken}` }, timeout: 4000 }
      );
      setPhase(res.data.inferredPhase ?? 'IDLE');
      setLastSent(new Date());
      setError(null);
      setSendCount(n => n + 1);
    } catch (err) {
      const msg = axios.isAxiosError(err) && err.response?.data?.error
        ? err.response.data.error
        : 'Erreur réseau — mode hors ligne';
      setError(msg);
    }
  }, [authToken, fleetNumber, payload_kg, fuel_pct, offline, baseUrl]);

  // ── Démarrer le tracking ───────────────────────────────────────────────────
  const startTracking = async () => {
    if (!navigator.geolocation) { setError('GPS non disponible sur cet appareil'); return; }
    setTracking(true); setError(null);
    await acquireWakeLock();

    watchId.current = navigator.geolocation.watchPosition(
      pos => { setCoords(pos.coords); setGpsOk(true); setGpsAcc(pos.coords.accuracy); setError(null); },
      err => { setError(`GPS : ${err.message}`); setGpsOk(false); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 2000 }
    );

    intervalRef.current = setInterval(() => {
      if (coordsRef.current) sendTrame(coordsRef.current);
    }, SEND_INTERVAL_MS);
  };

  const stopTracking = () => {
    setTracking(false);
    if (watchId.current != null)     navigator.geolocation.clearWatch(watchId.current);
    if (intervalRef.current != null) clearInterval(intervalRef.current);
    watchId.current = null; intervalRef.current = null;
    releaseWakeLock();
  };

  useEffect(() => () => stopTracking(), []);

  // Premier envoi dès que GPS prêt
  useEffect(() => {
    if (tracking && coords && sendCount === 0) sendTrame(coords);
  }, [tracking, coords, sendCount, sendTrame]);

  // ── Page invalide ──────────────────────────────────────────────────────────
  if (!fleetNumber || !authToken) {
    return (
      <div style={{ minHeight:'100vh', background:'#0b1929', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:24, gap:16 }}>
        <div style={{ fontSize:48 }}>⚠️</div>
        <div style={{ color:'#f87171', fontFamily:'monospace', fontSize:14, textAlign:'center' }}>
          Lien invalide ou expiré.
        </div>
        <div style={{ color:'#64748b', fontSize:11, textAlign:'center' }}>
          Demandez un nouveau lien au dispatcher FMS.
        </div>
      </div>
    );
  }

  const phaseColor = PHASE_COLOR[phase] ?? '#888';
  const phaseLabel = PHASE_FR[phase] ?? phase;
  const phaseIcon  = PHASE_ICON[phase] ?? '?';

  return (
    <div style={{ minHeight:'100vh', background:'#0b1929', fontFamily:'system-ui,sans-serif' }}>

      {/* ── Header ── */}
      <div style={{ background:'#0d1520', borderBottom:'2px solid #1a2740', padding:'14px 20px', display:'flex', alignItems:'center', gap:12, position:'sticky', top:0, zIndex:10 }}>
        <div style={{ width:40, height:40, background:'#b45309', borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, flexShrink:0 }}>
          🚛
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:20, fontWeight:800, color:'#f59e0b', fontFamily:'monospace' }}>{fleetNumber}</div>
          <div style={{ fontSize:11, color:'#64748b' }}>FMS Mining · App Chauffeur</div>
        </div>
        <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4 }}>
          {tracking && gpsOk && (
            <div style={{ display:'flex', alignItems:'center', gap:5, background:'rgba(34,197,94,0.12)', border:'1px solid rgba(34,197,94,0.3)', borderRadius:20, padding:'3px 10px' }}>
              <span style={{ width:7, height:7, borderRadius:'50%', background:'#22c55e', display:'inline-block', boxShadow:'0 0 6px #22c55e' }} />
              <span style={{ fontSize:11, color:'#22c55e', fontWeight:700 }}>EN DIRECT</span>
            </div>
          )}
          {offline && (
            <div style={{ fontSize:10, color:'#f59e0b', background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:20, padding:'2px 8px' }}>
              ⚠ Hors ligne {queueSize > 0 && `· ${queueSize} en attente`}
            </div>
          )}
        </div>
      </div>

      <div style={{ padding:'16px 16px 40px', maxWidth:480, margin:'0 auto' }}>

        {/* ── Phase actuelle ── */}
        <div style={{ background:'#0d1520', border:`2px solid ${phaseColor}50`, borderRadius:16, padding:'20px 16px', marginBottom:14, textAlign:'center', transition:'border-color 0.5s' }}>
          <div style={{ fontSize:11, color:'#64748b', marginBottom:10, textTransform:'uppercase', letterSpacing:'0.12em' }}>Activité détectée par le FMS</div>
          <div style={{ fontSize:48, marginBottom:8 }}>{phaseIcon}</div>
          <div style={{ fontSize:20, fontWeight:800, color:phaseColor, marginBottom:6, transition:'color 0.5s' }}>{phaseLabel}</div>
          {lastSent && (
            <div style={{ fontSize:10, color:'#475569', fontFamily:'monospace' }}>
              {lastSent.toLocaleTimeString()} · {sendCount} trames envoyées
            </div>
          )}
        </div>

        {/* ── GPS ── */}
        <div style={{ background:'#0d1520', border:'1px solid #1a2740', borderRadius:12, padding:14, marginBottom:14 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
            <div style={{ fontSize:11, color:'#64748b', fontWeight:700 }}>GPS</div>
            {gpsAccuracy != null && (
              <div style={{ fontSize:10, color: gpsAccuracy < 15 ? '#22c55e' : gpsAccuracy < 50 ? '#eab308' : '#ef4444', fontFamily:'monospace' }}>
                ±{Math.round(gpsAccuracy)}m {gpsAccuracy < 15 ? '✓ précis' : gpsAccuracy < 50 ? '~ moyen' : '⚠ faible'}
              </div>
            )}
          </div>
          {gpsOk && coords ? (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
              {[
                { l:'Latitude',  v:coords.latitude.toFixed(6) },
                { l:'Longitude', v:coords.longitude.toFixed(6) },
                { l:'Vitesse',   v:`${coords.speed != null ? Math.round(coords.speed * 3.6) : 0} km/h` },
                { l:'Cap',       v:`${coords.heading != null && coords.heading >= 0 ? Math.round(coords.heading) : '—'}°` },
              ].map(({ l, v }) => (
                <div key={l} style={{ background:'#0a1220', borderRadius:8, padding:'8px 10px' }}>
                  <div style={{ fontSize:9, color:'#475569', marginBottom:2 }}>{l}</div>
                  <div style={{ fontSize:13, color:'#e2e8f0', fontFamily:'monospace', fontWeight:700 }}>{v}</div>
                </div>
              ))}
            </div>
          ) : tracking ? (
            <div style={{ color:'#eab308', fontSize:12, display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ display:'inline-block', animation:'spin 1s linear infinite' }}>⏳</span>
              Acquisition du signal GPS…
            </div>
          ) : (
            <div style={{ color:'#475569', fontSize:11 }}>Le GPS se lancera au démarrage du tracking.</div>
          )}
        </div>

        {/* ── Saisies ── */}
        <div style={{ background:'#0d1520', border:'1px solid #1a2740', borderRadius:12, padding:16, marginBottom:16 }}>
          <div style={{ fontSize:11, color:'#64748b', fontWeight:700, marginBottom:14 }}>Informations à saisir</div>

          <div style={{ marginBottom:16 }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
              <label style={{ fontSize:10, color:'#94a3b8' }}>Charge actuelle</label>
              <span style={{ fontSize:12, fontWeight:700, color: payload_kg > 0 ? '#f97316' : '#64748b', fontFamily:'monospace' }}>
                {Math.round(payload_kg / 1000)} t
              </span>
            </div>
            <input type="range" min="0" max="220" step="5"
              value={Math.round(payload_kg / 1000)}
              onChange={e => setPayload_kg(Number(e.target.value) * 1000)}
              style={{ width:'100%', accentColor: payload_kg > 0 ? '#f97316' : '#64748b', cursor:'pointer' }}
            />
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:9, color:'#374151', marginTop:2 }}>
              <span>Vide</span>
              <span>Mi-charge (110 t)</span>
              <span>Plein (220 t)</span>
            </div>
          </div>

          <div>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
              <label style={{ fontSize:10, color:'#94a3b8' }}>Carburant</label>
              <span style={{ fontSize:12, fontWeight:700, fontFamily:'monospace',
                color: fuel_pct < 15 ? '#ef4444' : fuel_pct < 30 ? '#f59e0b' : '#22c55e' }}>
                {fuel_pct}%
                {fuel_pct < 15 && <span style={{ fontSize:9, marginLeft:4 }}>⚠ FAIBLE</span>}
              </span>
            </div>
            <input type="range" min="0" max="100" step="5"
              value={fuel_pct}
              onChange={e => setFuel_pct(Number(e.target.value))}
              style={{ width:'100%', accentColor: fuel_pct < 15 ? '#ef4444' : fuel_pct < 30 ? '#f59e0b' : '#22c55e', cursor:'pointer' }}
            />
          </div>
        </div>

        {/* ── Erreur ── */}
        {error && (
          <div style={{ background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.3)', borderRadius:10, padding:'10px 14px', marginBottom:14, fontSize:12, color:'#fca5a5', display:'flex', gap:8 }}>
            <span>⚠</span><span>{error}</span>
          </div>
        )}

        {/* ── Bouton principal ── */}
        {!tracking ? (
          <button onClick={startTracking}
            style={{ width:'100%', padding:'18px', background:'linear-gradient(135deg,#16a34a,#15803d)', border:'none', borderRadius:14, color:'white', fontSize:17, fontWeight:800, cursor:'pointer', letterSpacing:'0.03em', boxShadow:'0 4px 24px rgba(22,163,74,0.35)', marginBottom:8 }}>
            ▶  Démarrer le tracking GPS
          </button>
        ) : (
          <button onClick={stopTracking}
            style={{ width:'100%', padding:'18px', background:'#1a0505', border:'2px solid #ef4444', borderRadius:14, color:'#fca5a5', fontSize:17, fontWeight:800, cursor:'pointer', marginBottom:8 }}>
            ■  Arrêter le tracking
          </button>
        )}

        {/* ── Note sécurité ── */}
        <div style={{ marginTop:16, padding:'10px 14px', background:'rgba(15,23,42,0.6)', border:'1px solid #1e293b', borderRadius:10 }}>
          <div style={{ fontSize:10, color:'#334155', lineHeight:1.7 }}>
            🔒 Connexion chiffrée · Position envoyée toutes les {SEND_INTERVAL_MS/1000}s au serveur FMS uniquement<br />
            📡 Visible uniquement par le dispatcher · {offline ? '⚠ Mode hors ligne' : '✓ En ligne'}
          </div>
        </div>
      </div>
    </div>
  );
}
