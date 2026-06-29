/**
 * IntegrationHub — Centre de connexion des appareils physiques
 *
 * Permet à l'admin/dispatcher de :
 *  - Voir quels engins sont connectés en GPS réel vs simulés
 *  - Générer les liens d'accès pour les chauffeurs (app mobile)
 *  - Voir le guide de connexion pour traceurs GPS 4G (Teltonika, etc.)
 *  - Monitorer les trames entrantes en temps réel
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../lib/api';
import { useAuthStore } from '../store';

interface LiveDevice {
  fleetNumber: string;
  phase:       string;
  lastSeen_s:  number;
}

interface LiveStatus {
  total:  number;
  alive:  number;
  trucks: LiveDevice[];
}

interface Equipment {
  fleet_number: string;
  model:        string;
  type_name:    string;
  status:       string;
}

const PHASE_FR: Record<string, string> = {
  IDLE:'En attente', MOVING_TO_SOURCE:'→ Pelle', QUEUING_AT_SOURCE:'File pelle',
  LOADING:'Chargement', HAULING:'Transport', QUEUING_AT_DEST:'File dump',
  DUMPING:'Déversement', RETURNING:'← Retour', REFUELING:'Ravitaillement', DOWN:'En panne',
};

const PHASE_COLOR: Record<string, string> = {
  IDLE:'#64748b', MOVING_TO_SOURCE:'#3b82f6', QUEUING_AT_SOURCE:'#eab308',
  LOADING:'#f97316', HAULING:'#22c55e', QUEUING_AT_DEST:'#facc15',
  DUMPING:'#a855f7', RETURNING:'#06b6d4', REFUELING:'#ec4899', DOWN:'#ef4444',
};

export default function IntegrationHub() {
  const { user, token } = useAuthStore();
  const siteId          = user?.siteId ?? '';
  const isAdmin         = ['ADMIN','DISPATCHER'].includes(user?.role ?? '');

  const [liveStatus,  setLiveStatus]  = useState<LiveStatus | null>(null);
  const [equipment,   setEquipment]   = useState<Equipment[]>([]);
  const [activeTab,   setActiveTab]   = useState<'devices'|'driver'|'hardware'>('devices');
  const [copied,      setCopied]      = useState<string|null>(null);
  const [testFn,      setTestFn]      = useState('');
  const [testResult,  setTestResult]  = useState<string|null>(null);
  const [testing,     setTesting]     = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval>|null>(null);

  const baseUrl = window.location.origin;

  const load = useCallback(async () => {
    const [liveRes, eqRes] = await Promise.all([
      api.get('/telemetry/live/status').catch(() => ({ data: { total:0, alive:0, trucks:[] } })),
      api.get('/equipment', { params: { siteId } }).catch(() => ({ data: [] })),
    ]);
    setLiveStatus(liveRes.data as LiveStatus);
    const list = (Array.isArray(eqRes.data) ? eqRes.data : eqRes.data.data ?? []) as Equipment[];
    setEquipment(list.filter(e => e.type_name?.toLowerCase().includes('camion') || e.type_name?.toLowerCase().includes('truck') || e.type_name?.toLowerCase().includes('benne')));
  }, [siteId]);

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key); setTimeout(() => setCopied(null), 2000);
  };

  const sendTestTrame = async () => {
    if (!testFn) return;
    setTesting(true); setTestResult(null);
    try {
      const res = await api.post('/telemetry/live', {
        fleetNumber:   testFn,
        lat:           -12.4901 + (Math.random() - 0.5) * 0.01,
        lon:           27.8412  + (Math.random() - 0.5) * 0.01,
        speed_kmh:     Math.round(20 + Math.random() * 60),
        heading:       Math.round(Math.random() * 360),
        payload_kg:    Math.round(Math.random() * 220000),
        fuelLevel_pct: Math.round(40 + Math.random() * 60),
        engineRunning: true,
      });
      setTestResult(`OK — phase déduite : ${(res.data as {inferredPhase:string}).inferredPhase}`);
    } catch (e: unknown) {
      setTestResult(`Erreur : ${e instanceof Error ? e.message : 'inconnu'}`);
    }
    setTesting(false);
  };

  const driverUrl = (fn: string) => `${baseUrl}/driver?truck=${encodeURIComponent(fn)}&token=${encodeURIComponent(token ?? '')}`;

  const curlExample = (fn: string) => `curl -X POST ${baseUrl}/api/v1/telemetry/live \\
  -H "Authorization: Bearer ${token ?? '<TOKEN>'}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "fleetNumber": "${fn}",
    "lat": -12.4901, "lon": 27.8412,
    "speed_kmh": 32, "heading": 145,
    "payload_kg": 0, "fuelLevel_pct": 80,
    "engineRunning": true
  }'`;

  const teltonikaCfg = `# Configuration Teltonika FMB920 / FMB130
# (FOTA Web ou Teltonika Configurator)

[GPRS Settings]
Server IP/Domain : ${window.location.hostname}
Server Port      : 4000
Protocol         : TCP / HTTP

[HTTP Settings]
URL     : http://${window.location.hostname}:4000/api/v1/telemetry/live
Method  : POST
Header  : Authorization: Bearer ${token ?? '<TOKEN>'}
Content-Type: application/json

[AVL Parameters → HTTP Body Template]
{
  "fleetNumber": "<IMEI_SUFFIX_4>",
  "lat": <LAT>, "lon": <LNG>,
  "speed_kmh": <SPEED>,
  "heading": <ANGLE>,
  "payload_kg": 0,
  "fuelLevel_pct": <IO_FUEL_LEVEL_PCT>,
  "engineRunning": <IO_IGNITION>
}`;

  const liveDevices   = liveStatus?.trucks ?? [];
  const connectedFns  = new Set(liveDevices.map(d => d.fleetNumber));

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4">
      {/* ── En-tête ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white tracking-wide">Centre d'intégration</h1>
          <p className="text-xs text-slate-500 mt-0.5">Connexion des appareils GPS temps réel · Mode hybride</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${(liveStatus?.alive ?? 0) > 0 ? 'bg-emerald-400 shadow-[0_0_6px_#22c55e]' : 'bg-slate-600'}`} />
          <span className="text-xs text-slate-400 font-mono">
            {liveStatus?.alive ?? 0} appareil{(liveStatus?.alive ?? 0) !== 1 ? 's' : ''} connecté{(liveStatus?.alive ?? 0) !== 1 ? 's' : ''} en direct
          </span>
        </div>
      </div>

      {/* ── Onglets ── */}
      <div className="flex gap-1 border-b border-[#1a2740]">
        {([
          { id: 'devices', label: 'Engins & statut' },
          { id: 'driver',  label: 'App chauffeur' },
          { id: 'hardware',label: 'Traceurs GPS / Hardware' },
        ] as const).map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-xs font-semibold rounded-t transition-colors ${
              activeTab === tab.id
                ? 'bg-[#1a2740] text-amber-400 border-b-2 border-amber-500'
                : 'text-slate-500 hover:text-slate-300'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ══ TAB : Engins & statut ══════════════════════════════════════════════ */}
      {activeTab === 'devices' && (
        <div className="space-y-3">
          {/* Test rapide */}
          {isAdmin && (
            <div className="bg-[#0d1520] border border-[#1a2740] rounded-xl p-4">
              <div className="text-xs font-bold text-slate-300 mb-3">Test rapide — simuler une trame GPS</div>
              <div className="flex gap-2 items-center">
                <select value={testFn} onChange={e => setTestFn(e.target.value)}
                  className="flex-1 bg-[#0a1628] border border-[#334155] text-slate-200 text-xs rounded px-3 py-2">
                  <option value="">-- Choisir un camion --</option>
                  {equipment.map(e => (
                    <option key={e.fleet_number} value={e.fleet_number}>
                      {e.fleet_number} — {e.type_name}
                    </option>
                  ))}
                </select>
                <button onClick={sendTestTrame} disabled={!testFn || testing}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-black text-xs font-bold rounded disabled:opacity-40 transition-colors">
                  {testing ? 'Envoi…' : 'Envoyer trame test'}
                </button>
              </div>
              {testResult && (
                <div className={`mt-2 text-xs px-3 py-1.5 rounded font-mono ${
                  testResult.startsWith('OK') ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                  : 'bg-red-950 text-red-400 border border-red-800'
                }`}>{testResult}</div>
              )}
            </div>
          )}

          {/* Tableau des engins */}
          <div className="bg-[#0d1520] border border-[#1a2740] rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#1a2740] flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300">Flotte — état de connexion</span>
              <span className="text-xs text-slate-600 font-mono">Rafraîchi toutes les 5s</span>
            </div>
            <div className="divide-y divide-[#1a2740]">
              {equipment.length === 0 && (
                <div className="px-4 py-6 text-xs text-slate-600 text-center">Aucun camion enregistré dans la base</div>
              )}
              {equipment.map(eq => {
                const live = liveDevices.find(d => d.fleetNumber === eq.fleet_number);
                const isLive = connectedFns.has(eq.fleet_number);
                return (
                  <div key={eq.fleet_number} className="px-4 py-3 flex items-center gap-4 hover:bg-[#0a1220] transition-colors">
                    {/* Statut */}
                    <div className="flex-shrink-0">
                      {isLive
                        ? <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#22c55e] block" />
                        : <span className="w-2.5 h-2.5 rounded-full bg-slate-700 block" />
                      }
                    </div>

                    {/* Fleet number */}
                    <div className="w-24 flex-shrink-0">
                      <div className="text-sm font-bold font-mono text-slate-200">{eq.fleet_number}</div>
                      <div className="text-[10px] text-slate-600">{eq.type_name}</div>
                    </div>

                    {/* Badge */}
                    <div className="w-16 flex-shrink-0">
                      {isLive
                        ? <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950 border border-emerald-800 rounded px-2 py-0.5">LIVE</span>
                        : <span className="text-[10px] font-bold text-slate-500 bg-slate-900 border border-slate-800 rounded px-2 py-0.5">SIM</span>
                      }
                    </div>

                    {/* Phase */}
                    <div className="flex-1 min-w-0">
                      {isLive && live ? (
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ background: PHASE_COLOR[live.phase] ?? '#888' }} />
                          <span className="text-xs text-slate-300">{PHASE_FR[live.phase] ?? live.phase}</span>
                          <span className="text-[10px] text-slate-600 font-mono">· {live.lastSeen_s}s</span>
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-600">En attente de connexion GPS</span>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 flex-shrink-0">
                      <button onClick={() => copy(driverUrl(eq.fleet_number), `url_${eq.fleet_number}`)}
                        className="px-2.5 py-1 text-[10px] bg-[#1a2740] hover:bg-[#243450] border border-[#334155] text-slate-400 hover:text-slate-200 rounded transition-colors">
                        {copied === `url_${eq.fleet_number}` ? '✓ Copié' : 'Lien chauffeur'}
                      </button>
                      <a href={driverUrl(eq.fleet_number)} target="_blank" rel="noreferrer"
                        className="px-2.5 py-1 text-[10px] bg-amber-600/10 hover:bg-amber-600/20 border border-amber-700/30 text-amber-400 rounded transition-colors">
                        Ouvrir →
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ══ TAB : App chauffeur ════════════════════════════════════════════════ */}
      {activeTab === 'driver' && (
        <div className="space-y-3">
          <div className="bg-[#0d1520] border border-[#1a2740] rounded-xl p-5">
            <div className="text-xs font-bold text-slate-300 mb-1">App chauffeur — accès mobile</div>
            <p className="text-xs text-slate-500 mb-4 leading-relaxed">
              Chaque chauffeur ouvre ce lien sur son téléphone ou tablette dans la cabine.
              L'application utilise le GPS du téléphone et envoie automatiquement la position
              toutes les 5 secondes. Aucune installation requise.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {equipment.map(eq => (
                <div key={eq.fleet_number} className="bg-[#0a1220] border border-[#1a2740] rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="text-sm font-bold font-mono text-amber-400">{eq.fleet_number}</div>
                      <div className="text-[10px] text-slate-600">{eq.type_name} — {eq.model}</div>
                    </div>
                    {connectedFns.has(eq.fleet_number)
                      ? <span className="text-[10px] font-bold text-emerald-400 border border-emerald-800 rounded px-2 py-0.5 bg-emerald-950">LIVE</span>
                      : <span className="text-[10px] text-slate-600 border border-slate-800 rounded px-2 py-0.5">Déconnecté</span>
                    }
                  </div>
                  <div className="font-mono text-[9px] text-slate-500 bg-black/30 rounded p-2 mb-3 break-all leading-relaxed">
                    {driverUrl(eq.fleet_number)}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => copy(driverUrl(eq.fleet_number), `drv_${eq.fleet_number}`)}
                      className="flex-1 py-1.5 text-[10px] bg-[#1a2740] border border-[#334155] text-slate-400 hover:text-slate-200 rounded transition-colors">
                      {copied === `drv_${eq.fleet_number}` ? '✓ Copié !' : 'Copier le lien'}
                    </button>
                    <a href={driverUrl(eq.fleet_number)} target="_blank" rel="noreferrer"
                      className="flex-1 py-1.5 text-[10px] bg-amber-600/10 border border-amber-700/30 text-amber-400 hover:bg-amber-600/20 rounded text-center transition-colors">
                      Ouvrir →
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Instructions */}
          <div className="bg-[#0d1520] border border-[#1a2740] rounded-xl p-4">
            <div className="text-xs font-bold text-slate-300 mb-3">Comment déployer</div>
            <div className="space-y-2">
              {[
                { n:1, text:"Le dispatcher copie le lien du camion et l'envoie au chauffeur (WhatsApp, SMS, QR code affiché en salle de contrôle)" },
                { n:2, text:'Le chauffeur ouvre le lien sur son téléphone dans la cabine et appuie sur "Démarrer le tracking"' },
                { n:3, text:"Le téléphone demande l'autorisation GPS — le chauffeur accepte" },
                { n:4, text:"La position apparaît en vert LIVE sur la carte 3D du dispatcher dans les 5 secondes" },
                { n:5, text:"Si le signal est perdu > 30s, l'engin repasse automatiquement en mode simulé le temps de la reconnexion" },
              ].map(({ n, text }) => (
                <div key={n} className="flex gap-3 text-xs text-slate-400">
                  <span className="w-5 h-5 rounded-full bg-amber-600/20 text-amber-400 flex-shrink-0 flex items-center justify-center font-bold text-[10px]">{n}</span>
                  <span className="leading-relaxed">{text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══ TAB : Traceurs GPS hardware ════════════════════════════════════════ */}
      {activeTab === 'hardware' && (
        <div className="space-y-3">
          {/* Endpoint info */}
          <div className="bg-[#0d1520] border border-amber-700/20 rounded-xl p-4">
            <div className="text-xs font-bold text-amber-400 mb-3">Endpoint d'ingestion GPS</div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              {[
                { label:'URL',     value:`${baseUrl}/api/v1/telemetry/live` },
                { label:'Méthode', value:'POST' },
                { label:'Auth',    value:`Bearer ${token ? token.slice(0,20) + '...' : '...'}` },
                { label:'Format',  value:'JSON' },
              ].map(({ label, value }) => (
                <div key={label} className="bg-black/30 rounded p-2">
                  <div className="text-[9px] text-slate-600 mb-1">{label}</div>
                  <div className="text-[10px] font-mono text-slate-300 break-all">{value}</div>
                </div>
              ))}
            </div>
            <div className="font-mono text-[9px] text-slate-400 bg-black/40 rounded p-3 leading-relaxed">
              {`{\n  "fleetNumber": "TK-007",      // identifiant camion\n  "lat": -12.4901,              // latitude GPS\n  "lon": 27.8412,               // longitude GPS\n  "speed_kmh": 32,              // vitesse\n  "heading": 145,               // cap 0-359°\n  "payload_kg": 185000,         // charge (0 = vide)\n  "fuelLevel_pct": 74,          // carburant %\n  "engineRunning": true         // moteur\n}`}
            </div>
          </div>

          {/* Teltonika */}
          <div className="bg-[#0d1520] border border-[#1a2740] rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#1a2740] flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-slate-300">Teltonika FMB920 / FMB130 / FMC130</div>
                <div className="text-[10px] text-slate-600">Traceur 4G industriel — ~80$/unité, résistant aux vibrations mines</div>
              </div>
              <button onClick={() => copy(teltonikaCfg, 'teltonika')}
                className="px-3 py-1.5 text-[10px] bg-[#1a2740] border border-[#334155] text-slate-400 hover:text-slate-200 rounded transition-colors">
                {copied === 'teltonika' ? '✓ Copié' : 'Copier config'}
              </button>
            </div>
            <pre className="p-4 text-[9px] font-mono text-slate-500 overflow-x-auto leading-relaxed">{teltonikaCfg}</pre>
          </div>

          {/* curl test */}
          <div className="bg-[#0d1520] border border-[#1a2740] rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#1a2740] flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-slate-300">Test curl — n'importe quel appareil Linux/Android</div>
                <div className="text-[10px] text-slate-600">Script shell à déposer sur le calculateur embarqué ou Raspberry Pi</div>
              </div>
              <select onChange={e => setTestFn(e.target.value)} value={testFn}
                className="text-[10px] bg-[#0a1628] border border-[#334155] text-slate-400 rounded px-2 py-1">
                <option value="">Choisir camion</option>
                {equipment.map(e => <option key={e.fleet_number} value={e.fleet_number}>{e.fleet_number}</option>)}
              </select>
            </div>
            <div className="relative">
              <pre className="p-4 text-[9px] font-mono text-slate-500 overflow-x-auto leading-relaxed">
                {curlExample(testFn || 'TK-007')}
              </pre>
              <button onClick={() => copy(curlExample(testFn || 'TK-007'), 'curl')}
                className="absolute top-3 right-3 px-2.5 py-1 text-[10px] bg-[#1a2740] border border-[#334155] text-slate-400 hover:text-slate-200 rounded transition-colors">
                {copied === 'curl' ? '✓' : 'Copier'}
              </button>
            </div>
          </div>

          {/* Autres options */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { title:'Tablette Android cabine', desc:'Chrome ou Firefox, ouvrir /driver?truck=TK-XXX · GPS intégré · 0€ matériel supplémentaire', color:'#3b82f6' },
              { title:'GPS NMEA via adaptateur', desc:'Récepteur NMEA 0183 → script Python lit /dev/ttyUSB0 et POST vers /telemetry/live toutes les 2s', color:'#22c55e' },
              { title:'Intégration CANbus OBD', desc:'Dongle ELM327 WiFi sur prise OBD-II → lit payload suspension + RPM + vitesse via can-utils', color:'#f97316' },
            ].map(opt => (
              <div key={opt.title} className="bg-[#0d1520] border border-[#1a2740] rounded-xl p-4">
                <div className="w-2 h-2 rounded-full mb-3" style={{ background: opt.color }} />
                <div className="text-xs font-bold text-slate-300 mb-2">{opt.title}</div>
                <div className="text-[10px] text-slate-500 leading-relaxed">{opt.desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
