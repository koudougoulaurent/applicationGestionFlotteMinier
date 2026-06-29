/**
 * DriverApp — Interface chauffeur ultra-simple (mobile first)
 *
 * Accessible via /driver?truck=TK-007&token=...
 * Aucun login requis — l'URL précontient le token et le numéro de camion.
 * Utilise navigator.geolocation.watchPosition pour envoyer la position
 * toutes les 5 secondes au serveur FMS.
 *
 * Pensé pour être ouvert sur un téléphone Android dans la cabine.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';

const SEND_INTERVAL_MS = 5000;

interface TrameResult {
  inferredPhase: string;
  ok: boolean;
}

const PHASE_FR: Record<string, string> = {
  IDLE:'En attente', MOVING_TO_SOURCE:'En route vers pelle',
  QUEUING_AT_SOURCE:'File d\'attente pelle', LOADING:'Chargement en cours',
  HAULING:'Transport chargé', QUEUING_AT_DEST:'File d\'attente dump',
  DUMPING:'Déversement', RETURNING:'Retour à vide',
  REFUELING:'Ravitaillement carburant', DOWN:'En panne',
};

const PHASE_COLOR: Record<string, string> = {
  IDLE:'#64748b', MOVING_TO_SOURCE:'#3b82f6', QUEUING_AT_SOURCE:'#eab308',
  LOADING:'#f97316', HAULING:'#22c55e', QUEUING_AT_DEST:'#facc15',
  DUMPING:'#a855f7', RETURNING:'#06b6d4', REFUELING:'#ec4899', DOWN:'#ef4444',
};

export default function DriverApp() {
  // Lire les params URL
  const params      = new URLSearchParams(window.location.search);
  const fleetNumber = params.get('truck') ?? '';
  const authToken   = params.get('token') ?? '';
  const baseUrl     = `${window.location.protocol}//${window.location.host}`;

  const [tracking,     setTracking]     = useState(false);
  const [phase,        setPhase]        = useState('IDLE');
  const [lastSent,     setLastSent]     = useState<Date | null>(null);
  const [error,        setError]        = useState<string | null>(null);
  const [gpsOk,        setGpsOk]        = useState(false);
  const [coords,       setCoords]       = useState<GeolocationCoordinates | null>(null);
  const [payload_kg,   setPayload_kg]   = useState(0);
  const [fuel_pct,     setFuel_pct]     = useState(80);
  const [sendCount,    setSendCount]    = useState(0);

  const watchId   = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const coordsRef = useRef<GeolocationCoordinates | null>(null);

  coordsRef.current = coords;

  const sendTrame = useCallback(async (c: GeolocationCoordinates) => {
    if (!authToken || !fleetNumber) return;
    try {
      const res = await axios.post<TrameResult>(
        `${baseUrl}/api/v1/telemetry/live`,
        {
          fleetNumber,
          lat:           c.latitude,
          lon:           c.longitude,
          speed_kmh:     c.speed != null ? Math.round(c.speed * 3.6) : 0,
          heading:       c.heading ?? 0,
          payload_kg,
          fuelLevel_pct: fuel_pct,
          engineRunning: true,
        },
        { headers: { Authorization: `Bearer ${authToken}` } }
      );
      setPhase(res.data.inferredPhase ?? 'IDLE');
      setLastSent(new Date());
      setError(null);
      setSendCount(n => n + 1);
    } catch {
      setError('Erreur réseau — vérifiez la connexion WiFi/4G');
    }
  }, [authToken, fleetNumber, payload_kg, fuel_pct, baseUrl]);

  const startTracking = () => {
    if (!navigator.geolocation) { setError('GPS non disponible sur cet appareil'); return; }
    setTracking(true);
    setError(null);

    watchId.current = navigator.geolocation.watchPosition(
      pos => { setCoords(pos.coords); setGpsOk(true); setError(null); },
      err => { setError(`GPS : ${err.message}`); setGpsOk(false); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 2000 }
    );

    intervalRef.current = setInterval(() => {
      if (coordsRef.current) sendTrame(coordsRef.current);
    }, SEND_INTERVAL_MS);
  };

  const stopTracking = () => {
    setTracking(false);
    if (watchId.current != null)   navigator.geolocation.clearWatch(watchId.current);
    if (intervalRef.current != null) clearInterval(intervalRef.current);
    watchId.current = null; intervalRef.current = null;
  };

  useEffect(() => () => stopTracking(), []);

  // Envoyer immédiatement quand le GPS est prêt et qu'on vient de démarrer
  useEffect(() => {
    if (tracking && coords && sendCount === 0) sendTrame(coords);
  }, [tracking, coords, sendCount, sendTrame]);

  if (!fleetNumber) {
    return (
      <div style={{ minHeight:'100vh', background:'#0b1929', display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
        <div style={{ color:'#f87171', fontFamily:'monospace', fontSize:14, textAlign:'center' }}>
          <div style={{ fontSize:32, marginBottom:12 }}>⚠</div>
          Lien invalide — numéro de camion manquant.<br />
          <span style={{ color:'#64748b', fontSize:11 }}>Demandez un nouveau lien au dispatcher.</span>
        </div>
      </div>
    );
  }

  const phaseColor  = PHASE_COLOR[phase] ?? '#888';
  const phaseLabel  = PHASE_FR[phase] ?? phase;

  return (
    <div style={{ minHeight:'100vh', background:'#0b1929', fontFamily:'system-ui,sans-serif', padding:0 }}>

      {/* ── Header ── */}
      <div style={{ background:'#0d1520', borderBottom:'1px solid #1a2740', padding:'14px 20px', display:'flex', alignItems:'center', gap:12 }}>
        <div style={{ width:36, height:36, background:'#b45309', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>🚛</div>
        <div>
          <div style={{ fontSize:18, fontWeight:800, color:'#f59e0b', fontFamily:'monospace', letterSpacing:'0.05em' }}>{fleetNumber}</div>
          <div style={{ fontSize:11, color:'#64748b' }}>FMS Mining · App Chauffeur</div>
        </div>
        {tracking && gpsOk && (
          <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:6, background:'rgba(34,197,94,0.1)', border:'1px solid rgba(34,197,94,0.25)', borderRadius:20, padding:'4px 10px' }}>
            <span style={{ width:7, height:7, borderRadius:'50%', background:'#22c55e', display:'inline-block', boxShadow:'0 0 6px #22c55e' }} />
            <span style={{ fontSize:11, color:'#22c55e', fontWeight:700 }}>EN DIRECT</span>
          </div>
        )}
      </div>

      <div style={{ padding:'20px 20px 40px', maxWidth:480, margin:'0 auto' }}>

        {/* ── Phase actuelle ── */}
        {tracking && (
          <div style={{ background:'#0d1520', border:`2px solid ${phaseColor}40`, borderRadius:16, padding:20, marginBottom:16, textAlign:'center' }}>
            <div style={{ fontSize:11, color:'#64748b', marginBottom:8, textTransform:'uppercase', letterSpacing:'0.1em' }}>Votre activité détectée</div>
            <div style={{ width:14, height:14, borderRadius:'50%', background:phaseColor, margin:'0 auto 10px', boxShadow:`0 0 10px ${phaseColor}` }} />
            <div style={{ fontSize:22, fontWeight:800, color:phaseColor, marginBottom:6 }}>{phaseLabel}</div>
            {lastSent && (
              <div style={{ fontSize:10, color:'#475569', fontFamily:'monospace' }}>
                Dernière trame : {lastSent.toLocaleTimeString()} · {sendCount} envois
              </div>
            )}
          </div>
        )}

        {/* ── GPS status ── */}
        {tracking && (
          <div style={{ background:'#0d1520', border:'1px solid #1a2740', borderRadius:12, padding:16, marginBottom:16 }}>
            <div style={{ fontSize:11, color:'#64748b', marginBottom:10, fontWeight:700 }}>Position GPS</div>
            {gpsOk && coords ? (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                {[
                  { l:'Latitude',  v:coords.latitude.toFixed(6) },
                  { l:'Longitude', v:coords.longitude.toFixed(6) },
                  { l:'Vitesse',   v:`${coords.speed != null ? Math.round(coords.speed * 3.6) : '—'} km/h` },
                  { l:'Précision', v:`±${Math.round(coords.accuracy ?? 0)} m` },
                ].map(({ l, v }) => (
                  <div key={l} style={{ background:'#0a1220', borderRadius:8, padding:'8px 10px' }}>
                    <div style={{ fontSize:9, color:'#475569', marginBottom:2 }}>{l}</div>
                    <div style={{ fontSize:12, color:'#e2e8f0', fontFamily:'monospace', fontWeight:700 }}>{v}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color:'#eab308', fontSize:11, display:'flex', alignItems:'center', gap:6 }}>
                <span>⏳</span> Acquisition GPS…
              </div>
            )}
          </div>
        )}

        {/* ── Saisies chauffeur ── */}
        <div style={{ background:'#0d1520', border:'1px solid #1a2740', borderRadius:12, padding:16, marginBottom:20 }}>
          <div style={{ fontSize:11, color:'#64748b', marginBottom:12, fontWeight:700 }}>Informations à saisir</div>

          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:10, color:'#94a3b8', display:'block', marginBottom:4 }}>Charge actuelle (tonnes)</label>
            <input
              type="range" min="0" max="220" step="5"
              value={Math.round(payload_kg / 1000)}
              onChange={e => setPayload_kg(Number(e.target.value) * 1000)}
              style={{ width:'100%', accentColor:'#f59e0b' }}
            />
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'#475569', marginTop:2 }}>
              <span>Vide (0 t)</span>
              <span style={{ color:'#f59e0b', fontWeight:700 }}>{Math.round(payload_kg / 1000)} t</span>
              <span>Plein (220 t)</span>
            </div>
          </div>

          <div>
            <label style={{ fontSize:10, color:'#94a3b8', display:'block', marginBottom:4 }}>Niveau carburant</label>
            <input
              type="range" min="0" max="100" step="5"
              value={fuel_pct}
              onChange={e => setFuel_pct(Number(e.target.value))}
              style={{ width:'100%', accentColor: fuel_pct < 20 ? '#ef4444' : '#22c55e' }}
            />
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'#475569', marginTop:2 }}>
              <span>0%</span>
              <span style={{ color: fuel_pct < 20 ? '#ef4444' : '#22c55e', fontWeight:700 }}>{fuel_pct}%</span>
              <span>100%</span>
            </div>
          </div>
        </div>

        {/* ── Erreur ── */}
        {error && (
          <div style={{ background:'#1a0505', border:'1px solid #ef4444', borderRadius:10, padding:'10px 14px', marginBottom:16, fontSize:12, color:'#fca5a5' }}>
            ⚠ {error}
          </div>
        )}

        {/* ── Bouton principal ── */}
        {!tracking ? (
          <button onClick={startTracking}
            style={{ width:'100%', padding:'18px', background:'#16a34a', border:'none', borderRadius:14, color:'white', fontSize:17, fontWeight:800, cursor:'pointer', letterSpacing:'0.03em', boxShadow:'0 4px 20px rgba(22,163,74,0.4)' }}>
            ▶  Démarrer le tracking GPS
          </button>
        ) : (
          <button onClick={stopTracking}
            style={{ width:'100%', padding:'18px', background:'#7f1d1d', border:'2px solid #ef4444', borderRadius:14, color:'#fca5a5', fontSize:17, fontWeight:800, cursor:'pointer' }}>
            ■  Arrêter le tracking
          </button>
        )}

        {/* ── Info bas ── */}
        <div style={{ marginTop:20, fontSize:10, color:'#374151', textAlign:'center', lineHeight:1.6 }}>
          Position envoyée toutes les {SEND_INTERVAL_MS / 1000}s au serveur FMS<br />
          Le dispatcher voit votre position en temps réel sur la carte 3D
        </div>
      </div>
    </div>
  );
}
