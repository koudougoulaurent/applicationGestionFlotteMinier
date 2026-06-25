/**
 * Mine3DView.tsx — Visualisation 3D haute fidélité de la mine en temps réel.
 *
 * Modèles 3D procéduraux :
 *  - Camions benne CAT 793 (châssis + cabine + capot + benne basculante + roues)
 *  - Pelles hydrauliques sur les zones PIT
 *  - Concasseur, décharges, station carburant
 *
 * Interactions :
 *  - Clic sur un engin → sélection avec glow + panel d'actions HTML
 *  - Actions : Assigner / Rediriger / Contacter / Arrêt urgence / Détails
 *  - Double-clic → caméra suit l'engin
 *  - Drag → orbite caméra / Scroll → zoom
 */

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import * as THREE from 'three';
import api from '../../lib/api';

// ── Géographie de la mine Nchanga ─────────────────────────────────────────────
const LAT_C = -12.5, LON_C = 27.855;
const LAT_KM = 110.54, LON_KM = 108.685;

function geo2scene(lat: number, lon: number) {
  return { x: (lon - LON_C) * LON_KM, z: -(lat - LAT_C) * LAT_KM };
}

interface MineLocation { code: string; name: string; type: string; lat: number; lon: number; elevKm: number; }
const LOCATIONS: MineLocation[] = [
  { code:'PIT-1',  name:'Fosse Nord',       type:'PIT',        lat:-12.490, lon:27.840, elevKm:-0.08 },
  { code:'PIT-2',  name:'Fosse Sud',         type:'PIT',        lat:-12.510, lon:27.850, elevKm:-0.10 },
  { code:'PIT-3',  name:'Fosse Est',         type:'PIT',        lat:-12.500, lon:27.870, elevKm:-0.09 },
  { code:'CRUSH-1',name:'Concasseur',        type:'CRUSHER',    lat:-12.525, lon:27.840, elevKm: 0.000 },
  { code:'DUMP-1', name:'Décharge Nord',     type:'DUMP',       lat:-12.470, lon:27.830, elevKm: 0.015 },
  { code:'DUMP-2', name:'Décharge Est',      type:'DUMP',       lat:-12.490, lon:27.890, elevKm: 0.010 },
  { code:'FUEL-1', name:'Carburant',         type:'FUEL_STATION',lat:-12.505, lon:27.855, elevKm: 0.005 },
  { code:'PARK-1', name:'Parking',           type:'PARKING',    lat:-12.503, lon:27.852, elevKm: 0.004 },
  { code:'STCK-1', name:'Stockpile',         type:'STOCKPILE',  lat:-12.520, lon:27.835, elevKm: 0.008 },
  { code:'SHOP-1', name:'Atelier',           type:'WORKSHOP',   lat:-12.508, lon:27.858, elevKm: 0.006 },
];

// ── Types ─────────────────────────────────────────────────────────────────────
export interface TruckData {
  equipmentId:   string;
  fleetNumber:   string;
  phase:         string;
  lat:           number;
  lon:           number;
  heading:       number;
  speed_kmh:     number;
  fuelLevel_pct: number;
  healthScore:   number;
  payloadTonnes: number;
  phaseProgress: number;
  cyclesThisShift: number;
  tonnesThisShift: number;
}

export interface TruckAction {
  type: 'assign' | 'redirect' | 'message' | 'stop' | 'details';
  fleetNumber: string;
}

interface Mine3DViewProps {
  trucks:        TruckData[];
  selectedTruck: string | null;
  onSelectTruck: (fn: string | null) => void;
  onAction?:     (action: TruckAction) => void;
  height?:       number | 'fill';
  siteId?:       string;
}

// ── Palettes ──────────────────────────────────────────────────────────────────
const PHASE_HEX: Record<string, number> = {
  IDLE:0x64748b, MOVING_TO_SOURCE:0x3b82f6, QUEUING_AT_SOURCE:0xeab308,
  LOADING:0xf97316, HAULING:0x22c55e, QUEUING_AT_DEST:0xfacc15,
  DUMPING:0xa855f7, RETURNING:0x06b6d4, REFUELING:0xec4899, DOWN:0xef4444,
};
const PHASE_FR: Record<string, string> = {
  IDLE:'En attente', MOVING_TO_SOURCE:'→ Pelle', QUEUING_AT_SOURCE:'File pelle',
  LOADING:'Chargement', HAULING:'Transport', QUEUING_AT_DEST:'File dump',
  DUMPING:'Déversement', RETURNING:'← Retour', REFUELING:'Ravitaillement', DOWN:'En panne',
};
const CAT_YELLOW = 0xFFAA00;
const DARK_GRAY  = 0x2a2a2a;
const MID_GRAY   = 0x555555;
const STEEL_BLUE = 0x88aacc;

// ── Constructeur de camion 3D (CAT 793 procédural) ───────────────────────────
function createTruckModel(): THREE.Group {
  const group = new THREE.Group();
  const catMat  = new THREE.MeshLambertMaterial({ color: CAT_YELLOW });
  const darkMat = new THREE.MeshLambertMaterial({ color: DARK_GRAY });
  const midMat  = new THREE.MeshLambertMaterial({ color: MID_GRAY });
  const glassMat= new THREE.MeshLambertMaterial({ color: STEEL_BLUE, transparent: true, opacity: 0.55 });
  const chromeMat = new THREE.MeshLambertMaterial({ color: 0xdddddd });

  // — Châssis principal —
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.014, 0.052), darkMat);
  chassis.position.y = 0.022; chassis.castShadow = true; group.add(chassis);

  // — Capot moteur (avant) —
  const hood = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.022, 0.048), catMat);
  hood.position.set(-0.043, 0.033, 0); hood.castShadow = true; group.add(hood);

  // — Cabine opérateur —
  const cabBase = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.026, 0.042), catMat);
  cabBase.position.set(-0.023, 0.051, 0); cabBase.castShadow = true; group.add(cabBase);

  // — Toit cabine (légèrement plus petit) —
  const cabRoof = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.005, 0.040), catMat);
  cabRoof.position.set(-0.023, 0.067, 0); group.add(cabRoof);

  // — Pare-brise avant —
  const windF = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.020, 0.038), glassMat);
  windF.position.set(-0.010, 0.054, 0); group.add(windF);

  // — Vitre latérale gauche / droite —
  [-1, 1].forEach(side => {
    const winSide = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.018, 0.002), glassMat);
    winSide.position.set(-0.023, 0.054, side * 0.022); group.add(winSide);
  });

  // — Benne basculante (Open dump bed) —
  const bedPivot = new THREE.Group();
  bedPivot.position.set(0.015, 0.030, 0);
  group.userData.bedPivot = bedPivot;

  const bedFloor = new THREE.Mesh(new THREE.BoxGeometry(0.070, 0.004, 0.050), midMat);
  bedFloor.position.y = 0; bedFloor.castShadow = true; bedPivot.add(bedFloor);

  const bedFront = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.022, 0.050), midMat);
  bedFront.position.set(-0.037, 0.011, 0); bedPivot.add(bedFront);

  [-1, 1].forEach(s => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.070, 0.020, 0.004), midMat);
    wall.position.set(0, 0.010, s * 0.027); bedPivot.add(wall);
  });

  // — Vérin hydraulique (visible) —
  const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.040, 6), chromeMat);
  cylinder.rotation.z = Math.PI / 4;
  cylinder.position.set(-0.010, 0.025, 0); group.add(cylinder);

  group.add(bedPivot);

  // — Matière dans la benne (minerai / stérile) — initialement invisible
  const payloadMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.060, 0.014, 0.044),
    new THREE.MeshLambertMaterial({ color: 0x8B5E3C })
  );
  payloadMesh.position.set(0.015, 0.042, 0);
  payloadMesh.visible = false;
  payloadMesh.name = 'payload';
  group.add(payloadMesh);
  group.userData.payloadMesh = payloadMesh;

  // — Roues (6 grandes roues) —
  const wheelGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.010, 14);
  // Jante (détail visuel)
  const rimGeo   = new THREE.CylinderGeometry(0.008, 0.008, 0.011, 8);
  const rimMat   = new THREE.MeshLambertMaterial({ color: 0x888888 });

  const wheelPositions: [number, number, number][] = [
    // Avant
    [-0.045, 0.014, -0.030], [-0.045, 0.014,  0.030],
    // Arrière intérieur
    [ 0.020, 0.014, -0.032], [ 0.020, 0.014,  0.032],
    // Arrière extérieur
    [ 0.038, 0.014, -0.032], [ 0.038, 0.014,  0.032],
  ];
  const wheels: THREE.Mesh[] = [];
  wheelPositions.forEach(([wx, wy, wz]) => {
    const w = new THREE.Mesh(wheelGeo, darkMat);
    w.rotation.z = Math.PI / 2; w.position.set(wx, wy, wz); w.castShadow = true;
    group.add(w); wheels.push(w);
    // Jante
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.z = Math.PI / 2; rim.position.set(wx, wy, wz); group.add(rim);
  });
  group.userData.wheels = wheels;

  // — Feux de travail (phares) —
  const lightGeo = new THREE.SphereGeometry(0.003, 6, 4);
  const lightMat = new THREE.MeshLambertMaterial({ color: 0xffffcc, emissive: 0xffffcc, emissiveIntensity: 1.0 });
  [[-0.060, 0.035, -0.018], [-0.060, 0.035, 0.018]].forEach(([lx, ly, lz]) => {
    const light = new THREE.Mesh(lightGeo, lightMat);
    light.position.set(lx, ly, lz); group.add(light);
  });
  // Feux de recul (arrière, rouge)
  const revMat = new THREE.MeshLambertMaterial({ color: 0xff2200, emissive: 0xff2200, emissiveIntensity: 0.8 });
  [[0.062, 0.030, -0.018], [0.062, 0.030, 0.018]].forEach(([lx, ly, lz]) => {
    const r = new THREE.Mesh(lightGeo, revMat); r.position.set(lx, ly, lz); group.add(r);
  });

  // — Gyrophare (flasher orange sur le toit) —
  const flashGeo = new THREE.SphereGeometry(0.004, 8, 5);
  const flashMat = new THREE.MeshLambertMaterial({ color: 0xff6600, emissive: 0xff6600, emissiveIntensity: 0.6 });
  const flasher  = new THREE.Mesh(flashGeo, flashMat);
  flasher.position.set(-0.020, 0.075, 0);
  flasher.name = 'flasher';
  group.add(flasher);

  return group;
}

// ── Excavatrice simple sur les zones PIT ──────────────────────────────────────
function createExcavator(): THREE.Group {
  const g = new THREE.Group();
  const catMat = new THREE.MeshLambertMaterial({ color: 0xFF8800 });
  const darkMat= new THREE.MeshLambertMaterial({ color: 0x333333 });

  // Corps
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.04), catMat);
  body.position.y = 0.04; body.castShadow = true; g.add(body);
  // Chenilles
  [-1,1].forEach(s => {
    const track = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.012, 0.008), darkMat);
    track.position.set(0, 0.006, s * 0.026); g.add(track);
  });
  // Boom (bras)
  const boom = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.06, 0.004), catMat);
  boom.position.set(0.018, 0.075, 0); boom.rotation.z = -0.4; g.add(boom);
  // Godet
  const bucket = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.010, 0.014), darkMat);
  bucket.position.set(0.042, 0.058, 0); g.add(bucket);
  return g;
}

// ── Composant principal ───────────────────────────────────────────────────────
export default function Mine3DView({
  trucks, selectedTruck, onSelectTruck, onAction, height = 520, siteId = '',
}: Mine3DViewProps) {
  const resolvedH = height === 'fill' ? '100%' : height;

  const mountRef    = useRef<HTMLDivElement>(null);
  const sceneRef    = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef   = useRef<THREE.PerspectiveCamera | null>(null);
  const truckGroups = useRef<Map<string, THREE.Group>>(new Map());
  const truckTargets= useRef<Map<string, THREE.Vector3>>(new Map());
  const labelMap    = useRef<Map<string, HTMLDivElement>>(new Map());
  const animRef     = useRef<number>(0);
  const clockRef    = useRef(new THREE.Clock());

  // Caméra orbitale
  const camTheta    = useRef(Math.PI * 0.18);
  const camPhi      = useRef(Math.PI * 0.30);
  const camRadius   = useRef(10);
  const camTarget   = useRef(new THREE.Vector3(0, 0, 0));
  const isDragging  = useRef(false);
  const lastMouse   = useRef({ x: 0, y: 0 });
  const followTruck = useRef<string | null>(null);

  // Panel d'action fixe dans le coin — indépendant de la caméra
  const [actionPanel, setActionPanel] = useState<{ fleetNumber: string; truck: TruckData } | null>(null);

  // Sous-formulaires inline dans le panel
  type SubAction = 'assign' | 'message' | 'stop' | null;
  const [subAction,    setSubAction]    = useState<SubAction>(null);
  const [formLoader,   setFormLoader]   = useState('');
  const [formDest,     setFormDest]     = useState('');
  const [formMsg,      setFormMsg]      = useState('');
  const [formPriority, setFormPriority] = useState<'NORMAL'|'URGENT'>('NORMAL');
  const [submitting,   setSubmitting]   = useState(false);
  const [feedback,     setFeedback]     = useState('');

  // Pelles et destinations chargées depuis l'API
  interface LoaderOption  { fleetNumber: string; label: string }
  interface DestOption    { code: string; name: string }
  const [loaderOptions, setLoaderOptions] = useState<LoaderOption[]>([]);
  const [destOptions,   setDestOptions]   = useState<DestOption[]>([]);

  // Destinations statiques issues du réseau routier
  const staticDests = useMemo<DestOption[]>(() =>
    LOCATIONS
      .filter(l => ['CRUSHER','DUMP','STOCKPILE'].includes(l.type))
      .map(l => ({ code: l.code, name: l.name })),
  []);

  // Charger les pelles disponibles depuis l'API
  useEffect(() => {
    const sid = siteId;
    api.get('/equipment', { params: { siteId: sid } })
      .then(({ data }) => {
        const list = (Array.isArray(data) ? data : data.data ?? []) as Record<string, string>[];
        const loaders = list
          .filter(e => ['EXCAVATOR','LOADER'].includes(e.category) && e.status !== 'DOWN')
          .map(e => ({
            fleetNumber: e.fleet_number,
            label: `${e.fleet_number} — ${e.type_name ?? e.model ?? 'Pelle'} [${e.status}]`,
          }));
        setLoaderOptions(loaders);
        setDestOptions(staticDests);
      })
      .catch(() => setDestOptions(staticDests));
  }, [siteId, staticDests]);

  const raycaster = useRef(new THREE.Raycaster());
  const mouse2d   = useRef(new THREE.Vector2());

  // ── updateCamera ─────────────────────────────────────────────────────────
  const updateCamera = useCallback(() => {
    const cam = cameraRef.current; if (!cam) return;
    const r = camRadius.current;
    const t = camTarget.current;
    const phi = Math.max(0.15, Math.min(1.45, camPhi.current));
    cam.position.set(
      t.x + r * Math.sin(camTheta.current) * Math.sin(phi),
      t.y + r * Math.cos(phi),
      t.z + r * Math.cos(camTheta.current) * Math.sin(phi),
    );
    cam.lookAt(t);
  }, []);

  // ── Init Three.js ─────────────────────────────────────────────────────────
  useEffect(() => {
    const el = mountRef.current; if (!el) return;
    const W = el.clientWidth;
    const H = el.clientHeight || (typeof height === 'number' ? height : 520);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x0b1929);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    el.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Scène
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0b1929, 0.028);
    sceneRef.current = scene;

    // Caméra
    const camera = new THREE.PerspectiveCamera(45, W / H, 0.01, 200);
    cameraRef.current = camera;
    updateCamera();

    // — Éclairage —
    scene.add(new THREE.AmbientLight(0x334466, 1.0));
    const sun = new THREE.DirectionalLight(0xfff0c0, 2.0);
    sun.position.set(8, 15, 5); sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 60;
    sun.shadow.camera.left = -15; sun.shadow.camera.right = 15;
    sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -12;
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x6688bb, 0.6);
    fill.position.set(-5, 3, -5); scene.add(fill);

    // — Terrain —
    buildScene(scene);

    // — Boucle animation —
    let last = performance.now();
    function animate() {
      animRef.current = requestAnimationFrame(animate);
      const now = performance.now();
      const dt  = Math.min((now - last) / 1000, 0.1); last = now;
      const t   = clockRef.current.getElapsedTime();

      // Lerp truck positions + animations
      truckGroups.current.forEach((group, fn) => {
        const tgt = truckTargets.current.get(fn);
        if (tgt) group.position.lerp(tgt, 1 - Math.pow(0.01, dt));

        // Rotation des roues
        const wheels = group.userData.wheels as THREE.Mesh[] | undefined;
        const truck  = trucks.find(tt => tt.fleetNumber === fn);
        if (wheels && truck) {
          const spd = truck.speed_kmh / 3600; // km/s
          const angVel = spd / (0.014 * 2 * Math.PI) * 10; // radians/s (amplifié)
          wheels.forEach(w => { w.rotation.y += angVel * dt; });
        }

        // Benne basculante
        const bedPivot = group.userData.bedPivot as THREE.Group | undefined;
        if (bedPivot && truck) {
          const targetAngle = truck.phase === 'DUMPING' ? -0.70 : 0;
          bedPivot.rotation.x += (targetAngle - bedPivot.rotation.x) * 3 * dt;
        }

        // Payload visible
        const payload = group.userData.payloadMesh as THREE.Mesh | undefined;
        if (payload && truck) {
          payload.visible = ['LOADING','HAULING','QUEUING_AT_DEST','DUMPING'].includes(truck.phase);
          if (payload.visible && truck.phase === 'DUMPING') {
            (payload.material as THREE.MeshLambertMaterial).color.setHex(0x8B5E3C);
            payload.position.x += (0.08 - payload.position.x) * 5 * dt;
          }
        }

        // Gyrophare clignotant
        const flasher = group.getObjectByName('flasher') as THREE.Mesh | undefined;
        if (flasher) {
          const isDown = truck?.phase === 'DOWN';
          const blink  = isDown ? (Math.sin(t * 6) > 0 ? 1.5 : 0.1) : 0.4;
          (flasher.material as THREE.MeshLambertMaterial).emissiveIntensity = blink;
        }

        // Anneau de sélection pulsant (scale animée)
        const ring = group.getObjectByName('selring') as THREE.Mesh | undefined;
        if (ring && (ring.material as THREE.MeshBasicMaterial).opacity > 0) {
          const pulse = 1 + Math.sin(t * 4) * 0.08;
          ring.scale.setScalar(pulse);
        }
      });

      // Suivi caméra sur camion sélectionné
      if (followTruck.current) {
        const g = truckGroups.current.get(followTruck.current);
        if (g) {
          camTarget.current.lerp(g.position, 1 - Math.pow(0.001, dt));
          camRadius.current += (4 - camRadius.current) * 2 * dt;
          updateCamera();
        }
      }

      updateHtmlLabels();
      renderer.render(scene, camera);
    }
    animate();

    // — Resize —
    const obs = new ResizeObserver(() => {
      if (!el) return;
      const nW = el.clientWidth, nH = el.clientHeight || H;
      renderer.setSize(nW, nH);
      camera.aspect = nW / nH;
      camera.updateProjectionMatrix();
    });
    obs.observe(el);

    return () => {
      cancelAnimationFrame(animRef.current);
      obs.disconnect();
      renderer.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
      labelMap.current.forEach(l => l.remove());
      labelMap.current.clear();
    };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Construction de la scène ──────────────────────────────────────────────
  function buildScene(scene: THREE.Scene) {
    const el = mountRef.current;

    // Sol principal
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 24, 1, 1),
      new THREE.MeshLambertMaterial({ color: 0x7a4e2a })
    );
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

    // Strate de surface (légèrement plus claire)
    const surface = new THREE.Mesh(
      new THREE.PlaneGeometry(26, 20, 1, 1),
      new THREE.MeshLambertMaterial({ color: 0x9a6835 })
    );
    surface.rotation.x = -Math.PI / 2; surface.position.y = 0.001; surface.receiveShadow = true; scene.add(surface);

    // Fosses (terrasses concentriques)
    LOCATIONS.filter(l => l.type === 'PIT').forEach(pit => {
      const sc = geo2scene(pit.lat, pit.lon);
      for (let i = 0; i < 4; i++) {
        const r = 0.55 + i * 0.28;
        const geo = new THREE.CylinderGeometry(r, r + 0.15, 0.10 + i * 0.04, 20);
        const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(0.07, 0.6, 0.18 + i * 0.04) });
        const m   = new THREE.Mesh(geo, mat);
        m.position.set(sc.x, pit.elevKm - 0.05 - i * 0.05, sc.z);
        m.receiveShadow = true; m.castShadow = true; scene.add(m);
      }
      // Fond de fosse (roche sombre)
      const floor = new THREE.Mesh(
        new THREE.CylinderGeometry(0.45, 0.45, 0.04, 20),
        new THREE.MeshLambertMaterial({ color: 0x1a0e06 })
      );
      floor.position.set(sc.x, pit.elevKm - 0.22, sc.z); scene.add(floor);

      // Pelle hydraulique
      const excavator = createExcavator();
      excavator.position.set(sc.x + 0.08, pit.elevKm - 0.06, sc.z + 0.05);
      excavator.rotation.y = Math.random() * Math.PI * 2;
      scene.add(excavator);
    });

    // Routes (tubeGeometry pour courbes 3D visibles)
    buildRoads(scene);

    // Bâtiments et installations
    LOCATIONS.filter(l => l.type !== 'PIT').forEach(loc => {
      buildFacility(scene, loc, el);
    });

    // Grille de repère (discret)
    const grid = new THREE.GridHelper(28, 28, 0x152030, 0x152030);
    grid.position.y = 0.002; scene.add(grid);
  }

  function buildRoads(scene: THREE.Scene) {
    // Route principale haul (chargée) : beige plus foncé, plus large
    const haulMat    = new THREE.MeshLambertMaterial({ color: 0xb8904a, side: THREE.DoubleSide });
    // Route de retour/service : plus claire, plus étroite
    const serviceMat = new THREE.MeshLambertMaterial({ color: 0xd4a96a, side: THREE.DoubleSide });

    // Réseau routier révisé : routes droites (LineCurve3) qui correspondent
    // exactement aux interpolations GPS de la simulation.
    // Chaque route est [from, to, isHaul, waypoints_optionnels?]
    const ROADS: [string, string, boolean, string?][] = [
      // Grandes routes de haul (chargées PIT → évacuation)
      ['PIT-1', 'CRUSH-1',  true],
      ['PIT-2', 'CRUSH-1',  true],
      ['PIT-3', 'DUMP-2',   true],
      ['PIT-1', 'DUMP-1',   true],
      // Routes de retour (vides CRUSH/DUMP → parking)
      ['CRUSH-1', 'PARK-1', false],
      ['DUMP-1',  'PARK-1', false],
      ['DUMP-2',  'PARK-1', false],
      // Routes d'accès aux fosses
      ['PARK-1', 'PIT-1',   false],
      ['PARK-1', 'PIT-2',   false],
      ['PARK-1', 'PIT-3',   false],
      // Services
      ['FUEL-1', 'PARK-1',  false],
      ['CRUSH-1', 'STCK-1', false],
    ];

    const lm = new Map(LOCATIONS.map(l => [l.code, l]));

    ROADS.forEach(([a, b, isHaul]) => {
      const la = lm.get(a), lb = lm.get(b); if (!la || !lb) return;
      const sa = geo2scene(la.lat, la.lon), sb = geo2scene(lb.lat, lb.lon);

      // Route droite (LineCurve3) → camions suivent exactement la route
      const curve = new THREE.LineCurve3(
        new THREE.Vector3(sa.x, 0.012, sa.z),
        new THREE.Vector3(sb.x, 0.012, sb.z),
      );
      const width = isHaul ? 0.110 : 0.075;
      const tube  = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 1, width, 8, false),
        isHaul ? haulMat : serviceMat,
      );
      tube.receiveShadow = true; scene.add(tube);

      // Ligne de séparation centrale blanche (voies distinctes)
      if (isHaul) {
        const center = new THREE.LineCurve3(
          new THREE.Vector3(sa.x, 0.013, sa.z),
          new THREE.Vector3(sb.x, 0.013, sb.z),
        );
        const divider = new THREE.Mesh(
          new THREE.TubeGeometry(center, 1, 0.006, 4, false),
          new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x888888, emissiveIntensity: 0.1 }),
        );
        scene.add(divider);
      }
    });
  }

  function buildFacility(scene: THREE.Scene, loc: MineLocation, container: HTMLDivElement | null) {
    const sc = geo2scene(loc.lat, loc.lon);
    const y  = loc.elevKm;

    const colors: Record<string, number> = {
      CRUSHER:0xe07020, DUMP:0x7a7060, FUEL_STATION:0x228844,
      PARKING:0x224488, STOCKPILE:0xcc8822, WORKSHOP:0x445566,
    };
    const c = colors[loc.type] ?? 0x777777;
    const mat = new THREE.MeshLambertMaterial({ color: c });

    let mainMesh: THREE.Mesh;
    switch (loc.type) {
      case 'CRUSHER': {
        // Structure industrielle
        mainMesh = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.22), mat);
        mainMesh.position.set(sc.x, y + 0.14, sc.z); mainMesh.castShadow = true; scene.add(mainMesh);
        // Cheminée
        const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.22, 8), new THREE.MeshLambertMaterial({ color: 0x333333 }));
        ch.position.set(sc.x + 0.1, y + 0.39, sc.z); scene.add(ch);
        // Tapis roulant
        const belt = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.20), new THREE.MeshLambertMaterial({ color: 0x555555 }));
        belt.position.set(sc.x - 0.18, y + 0.03, sc.z); scene.add(belt);
        break;
      }
      case 'DUMP': {
        // Tas de stérile
        mainMesh = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.22, 10), mat);
        mainMesh.position.set(sc.x, y + 0.11, sc.z); mainMesh.castShadow = true; scene.add(mainMesh);
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.52, 0.06, 10), mat);
        base.position.set(sc.x, y + 0.03, sc.z); scene.add(base);
        break;
      }
      case 'FUEL_STATION': {
        mainMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 0.20, 10), mat);
        mainMesh.position.set(sc.x, y + 0.10, sc.z); mainMesh.castShadow = true; scene.add(mainMesh);
        // Auvent
        const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.02, 0.22), new THREE.MeshLambertMaterial({ color: 0x33aa55 }));
        canopy.position.set(sc.x, y + 0.22, sc.z); scene.add(canopy);
        break;
      }
      case 'STOCKPILE': {
        mainMesh = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat);
        mainMesh.position.set(sc.x, y, sc.z); mainMesh.castShadow = true; scene.add(mainMesh);
        break;
      }
      default: {
        mainMesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.16), mat);
        mainMesh.position.set(sc.x, y + 0.06, sc.z); mainMesh.castShadow = true; scene.add(mainMesh);
      }
    }

    // Label HTML flottant
    if (container) {
      const lbl = document.createElement('div');
      lbl.dataset.lat = String(loc.lat); lbl.dataset.lon = String(loc.lon);
      lbl.dataset.elev = String(y + 0.45);
      lbl.style.cssText = 'position:absolute;pointer-events:none;font-size:8px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#f59e0b;background:rgba(10,22,40,0.88);border:1px solid rgba(245,158,11,0.25);border-radius:3px;padding:1px 4px;white-space:nowrap;transform:translate(-50%,-100%);font-family:monospace;';
      lbl.textContent = loc.code;
      container.appendChild(lbl);
      labelMap.current.set('loc_' + loc.code, lbl);
    }
  }

  // ── Mise à jour des camions ───────────────────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    const el    = mountRef.current;
    if (!scene || !el) return;

    trucks.forEach(truck => {
      const sc = geo2scene(truck.lat, truck.lon);

      // Élévation estimée selon phase
      const isPit  = ['MOVING_TO_SOURCE','QUEUING_AT_SOURCE','LOADING'].includes(truck.phase);
      const isSurf = ['QUEUING_AT_DEST','DUMPING','REFUELING'].includes(truck.phase);
      let y = 0.024;
      if (isPit)      y = -0.06 * (truck.phaseProgress / 100) + 0.024;
      else if (isSurf)y = 0.024;
      else if (truck.phase === 'HAULING')   y = -0.06 + 0.06 * (truck.phaseProgress / 100) + 0.024;
      else if (truck.phase === 'RETURNING') y = 0.024 - 0.06 * (truck.phaseProgress / 100) * 0.5;
      y = Math.max(-0.08, y);

      // Offset de voie de circulation (séparation des sens de circulation)
      // Perpendiculaire droite au heading : rightX = cos(H_rad), rightZ = sin(H_rad)
      // H=0°(N): right=(1,0)=Est | H=90°(E): right=(0,1)=Sud | H=180°(S): right=(-1,0)=Ouest
      const H_rad  = truck.heading * Math.PI / 180;
      const LANE   = 0.028; // 28m offset perpendiculaire (espace scène = km)
      const laneX  = Math.cos(H_rad) * LANE;
      const laneZ  = Math.sin(H_rad) * LANE;

      const targetPos = new THREE.Vector3(sc.x + laneX, y, sc.z + laneZ);
      truckTargets.current.set(truck.fleetNumber, targetPos);

      let group = truckGroups.current.get(truck.fleetNumber);

      if (!group) {
        group = createTruckModel();
        group.position.copy(targetPos);
        group.userData.fleetNumber = truck.fleetNumber;

        // Sphère transparente invisible — grande hitbox pour clic facile
        const hitSphere = new THREE.Mesh(
          new THREE.SphereGeometry(0.12, 8, 6),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
        );
        hitSphere.name = 'hitbox';
        group.add(hitSphere);

        // Anneau de sélection au sol (masqué par défaut)
        const ringGeo = new THREE.RingGeometry(0.13, 0.16, 20);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, side: THREE.DoubleSide, transparent: true, opacity: 0 });
        const ring    = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = -0.022;
        ring.name = 'selring';
        group.add(ring);

        scene.add(group);
        truckGroups.current.set(truck.fleetNumber, group);

        // Label HTML
        const lbl = document.createElement('div');
        lbl.style.cssText = 'position:absolute;pointer-events:none;font-size:9px;font-weight:700;font-family:monospace;color:#fff;background:rgba(10,22,40,0.92);border:1px solid #334155;border-radius:3px;padding:1px 4px;white-space:nowrap;transform:translate(-50%,-130%);';
        lbl.textContent = truck.fleetNumber;
        el.appendChild(lbl);
        labelMap.current.set(truck.fleetNumber, lbl);
      }

      // Glow sélection : emissive ambre + anneau visible
      const isSelected = truck.fleetNumber === selectedTruck;
      group.children.forEach(child => {
        if (child instanceof THREE.Mesh) {
          if (child.name === 'selring') {
            // Anneau visible si sélectionné, animation pulsante dans la boucle
            (child.material as THREE.MeshBasicMaterial).opacity = isSelected ? 0.85 : 0;
          } else if (child.name !== 'payload' && child.name !== 'hitbox') {
            const m = child.material as THREE.MeshLambertMaterial;
            m.emissive?.setHex(isSelected ? 0x4a2e00 : 0x000000);
            m.emissiveIntensity = isSelected ? 1.2 : 0;
          }
        }
      });

      // Label style
      const lbl = labelMap.current.get(truck.fleetNumber);
      if (lbl) {
        lbl.textContent = `${truck.fleetNumber} · ${truck.speed_kmh}km/h`;
        lbl.style.borderColor = isSelected ? '#f59e0b' : '#334155';
        lbl.style.color        = isSelected ? '#f59e0b' : '#e2e8f0';
        lbl.style.background   = isSelected ? 'rgba(30,20,0,0.96)' : 'rgba(10,22,40,0.92)';
        lbl.style.fontSize     = isSelected ? '10px' : '9px';
      }

      // HEADING CORRIGÉ : rotation.y = -(heading + 90)° convertit GPS north=0° vers Three.js
      // Proof: H=0°(N) → rotation.y=-π/2 → truck face -z (nord) ✓
      //        H=90°(E) → rotation.y=-π → truck face +x (est) ✓
      //        H=180°(S)→ rotation.y=-3π/2=π/2 → truck face +z (sud) ✓
      group.rotation.y = -(truck.heading + 90) * Math.PI / 180;
    });

    // Nettoyer les camions disparus
    truckGroups.current.forEach((group, fn) => {
      if (!trucks.find(t => t.fleetNumber === fn)) {
        scene.remove(group);
        truckGroups.current.delete(fn);
        labelMap.current.get(fn)?.remove();
        labelMap.current.delete(fn);
      }
    });
    // Synchroniser le panel d'action avec les données live (télémétrie toujours fraîche)
    setActionPanel(prev => {
      if (!prev) return null;
      const live = trucks.find(t => t.fleetNumber === prev.fleetNumber);
      return live ? { ...prev, truck: live } : null;
    });
  }, [trucks, selectedTruck]);

  // ── Mise à jour des labels HTML ───────────────────────────────────────────
  function updateHtmlLabels() {
    const cam = cameraRef.current;
    const rdr = rendererRef.current;
    const el  = mountRef.current;
    if (!cam || !rdr || !el) return;
    const W = el.clientWidth, H = el.clientHeight || 520;

    const project = (pos: THREE.Vector3) => {
      const ndc = pos.clone().project(cam);
      return { x: (ndc.x + 1) / 2 * W, y: (-ndc.y + 1) / 2 * H, inFront: ndc.z < 1 };
    };

    labelMap.current.forEach((lbl, key) => {
      let p3: THREE.Vector3;
      if (key.startsWith('loc_')) {
        const la = parseFloat(lbl.dataset.lat ?? '0');
        const lo = parseFloat(lbl.dataset.lon ?? '0');
        const el2= parseFloat(lbl.dataset.elev ?? '0');
        const sc = geo2scene(la, lo);
        p3 = new THREE.Vector3(sc.x, el2, sc.z);
      } else {
        const g = truckGroups.current.get(key);
        if (!g) { lbl.style.display = 'none'; return; }
        p3 = g.position.clone().add(new THREE.Vector3(0, 0.18, 0));
      }
      const { x, y, inFront } = project(p3);
      lbl.style.display = inFront ? 'block' : 'none';
      lbl.style.left = x + 'px'; lbl.style.top = y + 'px';
    });
  }

  // Remonte la hiérarchie d'un Mesh jusqu'au groupe camion (qui possède userData.fleetNumber)
  const findTruckGroup = (obj: THREE.Object3D): THREE.Group | null => {
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      if (cur instanceof THREE.Group && cur.userData.fleetNumber) return cur as THREE.Group;
      cur = cur.parent;
    }
    return null;
  };

  // Raycaster sur TOUS les descendants des groupes camion (hitbox incluse)
  const raycastTrucks = (e: React.MouseEvent): THREE.Group | null => {
    const rdr = rendererRef.current, cam = cameraRef.current;
    if (!rdr || !cam || !mountRef.current) return null;
    const rect = rdr.domElement.getBoundingClientRect();
    mouse2d.current.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.current.setFromCamera(mouse2d.current, cam);
    const groups = Array.from(truckGroups.current.values());
    const hits   = raycaster.current.intersectObjects(groups, true); // recursive=true
    if (hits.length === 0) return null;
    return findTruckGroup(hits[0].object);
  };

  // ── Clic sur un camion ────────────────────────────────────────────────────
  const handleClick = useCallback((e: React.MouseEvent) => {
    const group = raycastTrucks(e);
    if (group) {
      const fn = group.userData.fleetNumber as string;
      const isAlreadySelected = fn === selectedTruck;
      onSelectTruck(isAlreadySelected ? null : fn);
      if (!isAlreadySelected) {
        const td = trucks.find(t => t.fleetNumber === fn);
        // Panel fixe dans le coin — pas de coordonnées écran → reste valide après rotation caméra
        if (td) setActionPanel({ fleetNumber: fn, truck: td });
        else     setActionPanel(null);
      } else {
        setActionPanel(null);
      }
      return;
    }
    onSelectTruck(null);
    setActionPanel(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTruck, trucks, onSelectTruck]);

  // Double-clic → caméra suit le camion
  const handleDblClick = useCallback((e: React.MouseEvent) => {
    const group = raycastTrucks(e);
    if (group) {
      const fn = group.userData.fleetNumber as string;
      if (fn) followTruck.current = followTruck.current === fn ? null : fn;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Contrôles souris ──────────────────────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    followTruck.current = null; // désactive le suivi auto
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    camTheta.current += dx * 0.004;
    camPhi.current    = Math.max(0.15, Math.min(1.4, camPhi.current + dy * 0.004));
    updateCamera();
  }, [updateCamera]);

  const onMouseUp   = useCallback(() => { isDragging.current = false; }, []);
  const onWheel     = useCallback((e: React.WheelEvent) => {
    camRadius.current = Math.max(1.5, Math.min(22, camRadius.current + e.deltaY * 0.008));
    updateCamera();
  }, [updateCamera]);

  // Réinitialise le sous-formulaire et ferme le panel si besoin
  const resetSub = () => {
    setSubAction(null); setFormLoader(''); setFormDest('');
    setFormMsg(''); setFormPriority('NORMAL'); setFeedback('');
  };

  const closePanel = () => { resetSub(); setActionPanel(null); onSelectTruck(null); };

  // ── Soumettre une assignation ─────────────────────────────────────────────
  const submitAssign = async () => {
    if (!actionPanel || !formLoader) return;
    setSubmitting(true);
    try {
      const res = await api.post('/dispatch/manual-assign', {
        siteId,
        truckFleet:  actionPanel.fleetNumber,
        loaderFleet: formLoader,
        destination: formDest,
      });
      setFeedback((res.data as { message: string }).message ?? 'Assigné');
      setTimeout(closePanel, 1800);
    } catch { setFeedback('Erreur — réessayez'); }
    finally   { setSubmitting(false); }
  };

  // ── Envoyer un message au chauffeur ───────────────────────────────────────
  const submitMessage = async () => {
    if (!actionPanel || !formMsg.trim()) return;
    setSubmitting(true);
    try {
      await api.post('/messages', {
        siteId,
        fleetNumber: actionPanel.fleetNumber,
        message:     formMsg.trim(),
        priority:    formPriority,
        direction:   'TO_TRUCK',
      });
      setFeedback('Message envoyé');
      setTimeout(closePanel, 1400);
    } catch { setFeedback('Erreur envoi'); }
    finally   { setSubmitting(false); }
  };

  // ── Confirmer arrêt d'urgence ─────────────────────────────────────────────
  const submitStop = async () => {
    if (!actionPanel) return;
    setSubmitting(true);
    try {
      await api.post('/messages', {
        siteId,
        fleetNumber: actionPanel.fleetNumber,
        message:     'ARRET URGENCE — Immobilisez-vous immediatement. Dispatcher.',
        priority:    'URGENT',
        direction:   'TO_TRUCK',
      });
      setFeedback('Arrêt d\'urgence envoyé');
      setTimeout(closePanel, 1800);
    } catch { setFeedback('Erreur'); }
    finally   { setSubmitting(false); }
  };

  // ── Action depuis le panel ────────────────────────────────────────────────
  const handleAction = (type: TruckAction['type']) => {
    if (!actionPanel) return;
    onAction?.({ type, fleetNumber: actionPanel.fleetNumber });
    // Ouvrir le sous-formulaire inline au lieu de déléguer à la page parente
    if (type === 'assign' || type === 'redirect') { resetSub(); setSubAction('assign'); return; }
    if (type === 'message')                        { resetSub(); setSubAction('message'); return; }
    if (type === 'stop')                           { resetSub(); setSubAction('stop'); return; }
  };

  const isRunning = trucks.some(t => t.phase !== 'IDLE' && t.phase !== 'DOWN');

  return (
    <div
      ref={mountRef}
      onMouseDown={onMouseDown} onMouseMove={onMouseMove}
      onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
      onWheel={onWheel} onClick={handleClick} onDoubleClick={handleDblClick}
      style={{ height: resolvedH, position: 'relative', overflow: 'hidden',
               cursor: isDragging.current ? 'grabbing' : 'crosshair', background: '#0b1929', borderRadius: 8 }}
    >
      {/* ── Panel d'action fixe coin bas-droit ── stable même après rotation caméra ── */}
      {actionPanel && (
        <div
          style={{ position: 'absolute', right: 8, top: 8, zIndex: 20, pointerEvents: 'auto', width: 195 }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ background: 'rgba(10,22,40,0.97)', border: '1.5px solid #f59e0b', borderRadius: 10, padding: '10px 12px', boxShadow: '0 8px 32px rgba(0,0,0,0.7)' }}>
            {/* En-tête */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#f59e0b', fontFamily: 'monospace', letterSpacing: '0.04em' }}>
                  {actionPanel.fleetNumber}
                </div>
                <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>
                  <span style={{ display:'inline-block', width:7, height:7, borderRadius:'50%', background:'#' + (PHASE_HEX[actionPanel.truck.phase] ?? 0x888888).toString(16).padStart(6,'0'), marginRight:4, verticalAlign:'middle' }} />
                  {PHASE_FR[actionPanel.truck.phase] ?? actionPanel.truck.phase}
                </div>
              </div>
              <button
                onClick={() => { setActionPanel(null); onSelectTruck(null); }}
                style={{ color: '#64748b', background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', padding: 2, lineHeight:1 }}
              >✕</button>
            </div>

            {/* Télémétrie live (mise à jour à chaque cycle simulation) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 8px', marginBottom: 10, borderTop: '1px solid #1e2d4a', paddingTop: 7 }}>
              {[
                { l: 'Carburant', v: `${actionPanel.truck.fuelLevel_pct.toFixed(0)}%`, warn: actionPanel.truck.fuelLevel_pct < 20 },
                { l: 'Sante',     v: `${actionPanel.truck.healthScore}%`,              warn: actionPanel.truck.healthScore < 70 },
                { l: 'Vitesse',   v: `${actionPanel.truck.speed_kmh}km/h`,             warn: false },
                { l: 'Charge',    v: `${actionPanel.truck.payloadTonnes.toFixed(0)}t`, warn: false },
                { l: 'Cycles',    v: `${actionPanel.truck.cyclesThisShift}`,           warn: false },
                { l: 'Tonnes',    v: `${actionPanel.truck.tonnesThisShift.toFixed(0)}t`, warn: false },
              ].map(({ l, v, warn }) => (
                <div key={l}>
                  <div style={{ fontSize: 8, color: '#475569', marginBottom: 1 }}>{l}</div>
                  <div style={{ fontSize: 10, color: warn ? '#f87171' : '#e2e8f0', fontWeight: 700, fontFamily: 'monospace' }}>{v}</div>
                </div>
              ))}
            </div>

            {/* Barre de progression phase */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 8, color: '#475569', marginBottom: 3 }}>Progression phase</div>
              <div style={{ height: 4, background: '#1e2d4a', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${actionPanel.truck.phaseProgress}%`, background: '#f59e0b', borderRadius: 2, transition: 'width 0.5s' }} />
              </div>
              <div style={{ fontSize: 8, color: '#64748b', fontFamily: 'monospace', marginTop: 2 }}>
                {actionPanel.truck.phaseProgress.toFixed(0)}% · Cap {actionPanel.truck.heading}°
              </div>
            </div>

            {/* Retour feedback */}
            {feedback && (
              <div style={{ marginBottom: 8, padding: '5px 8px', background: feedback.startsWith('Erreur') ? '#3b0a0a' : '#0a2e1a', border: `1px solid ${feedback.startsWith('Erreur') ? '#ef4444' : '#22c55e'}`, borderRadius: 6, fontSize: 10, color: feedback.startsWith('Erreur') ? '#fca5a5' : '#86efac', fontWeight: 700 }}>
                {feedback}
              </div>
            )}

            {/* ── Sous-formulaire : Assignation ── */}
            {subAction === 'assign' && (
              <div style={{ border: '1px solid #3b82f6', borderRadius: 8, padding: '8px 8px 6px', background: '#0d1f3c', marginBottom: 4 }}>
                <div style={{ fontSize: 10, color: '#93c5fd', fontWeight: 700, marginBottom: 6 }}>Assigner / Rediriger</div>
                <div style={{ fontSize: 8, color: '#64748b', marginBottom: 2 }}>Pelle chargeur</div>
                <select value={formLoader} onChange={e => setFormLoader(e.target.value)}
                  style={{ width: '100%', background: '#0a1628', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 4, padding: '4px 6px', fontSize: 10, marginBottom: 6, cursor: 'pointer' }}>
                  <option value="">-- Choisir une pelle --</option>
                  {loaderOptions.map(l => <option key={l.fleetNumber} value={l.fleetNumber}>{l.label}</option>)}
                </select>
                <div style={{ fontSize: 8, color: '#64748b', marginBottom: 2 }}>Destination (optionnel)</div>
                <select value={formDest} onChange={e => setFormDest(e.target.value)}
                  style={{ width: '100%', background: '#0a1628', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 4, padding: '4px 6px', fontSize: 10, marginBottom: 8, cursor: 'pointer' }}>
                  <option value="">-- Aucune destination --</option>
                  {destOptions.map(d => <option key={d.code} value={d.code}>{d.code} — {d.name}</option>)}
                </select>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={submitAssign} disabled={!formLoader || submitting}
                    style={{ flex: 1, padding: '5px 6px', background: formLoader ? '#1e3a5f' : '#111', border: '1px solid #3b82f6', borderRadius: 5, color: '#93c5fd', fontSize: 10, fontWeight: 700, cursor: formLoader ? 'pointer' : 'not-allowed' }}>
                    {submitting ? 'Envoi…' : 'Confirmer'}
                  </button>
                  <button onClick={resetSub} style={{ padding: '5px 8px', background: '#1a2035', border: '1px solid #334155', borderRadius: 5, color: '#64748b', fontSize: 10, cursor: 'pointer' }}>Annuler</button>
                </div>
              </div>
            )}

            {/* ── Sous-formulaire : Message ── */}
            {subAction === 'message' && (
              <div style={{ border: '1px solid #6366f1', borderRadius: 8, padding: '8px 8px 6px', background: '#0d1230', marginBottom: 4 }}>
                <div style={{ fontSize: 10, color: '#a5b4fc', fontWeight: 700, marginBottom: 6 }}>Message au chauffeur</div>
                <textarea value={formMsg} onChange={e => setFormMsg(e.target.value)}
                  rows={3} placeholder="Votre message…"
                  style={{ width: '100%', boxSizing: 'border-box', background: '#0a1628', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 4, padding: '5px 6px', fontSize: 10, resize: 'none', marginBottom: 6 }} />
                <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                  {(['NORMAL','URGENT'] as const).map(p => (
                    <button key={p} onClick={() => setFormPriority(p)}
                      style={{ flex: 1, padding: '3px 4px', fontSize: 9, fontWeight: 700, borderRadius: 4, cursor: 'pointer', background: formPriority === p ? (p === 'URGENT' ? '#7f1d1d' : '#1e3a5f') : '#1a2035', border: `1px solid ${formPriority === p ? (p === 'URGENT' ? '#ef4444' : '#6366f1') : '#334155'}`, color: formPriority === p ? (p === 'URGENT' ? '#fca5a5' : '#a5b4fc') : '#64748b' }}>
                      {p === 'URGENT' ? 'URGENT' : 'Normal'}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={submitMessage} disabled={!formMsg.trim() || submitting}
                    style={{ flex: 1, padding: '5px 6px', background: formMsg.trim() ? '#1e2a40' : '#111', border: '1px solid #6366f1', borderRadius: 5, color: '#a5b4fc', fontSize: 10, fontWeight: 700, cursor: formMsg.trim() ? 'pointer' : 'not-allowed' }}>
                    {submitting ? 'Envoi…' : 'Envoyer'}
                  </button>
                  <button onClick={resetSub} style={{ padding: '5px 8px', background: '#1a2035', border: '1px solid #334155', borderRadius: 5, color: '#64748b', fontSize: 10, cursor: 'pointer' }}>Annuler</button>
                </div>
              </div>
            )}

            {/* ── Sous-formulaire : Arrêt urgence ── */}
            {subAction === 'stop' && (
              <div style={{ border: '1px solid #ef4444', borderRadius: 8, padding: '8px 8px 6px', background: '#1a0505', marginBottom: 4 }}>
                <div style={{ fontSize: 10, color: '#fca5a5', fontWeight: 700, marginBottom: 4 }}>Arrêt d'urgence</div>
                <div style={{ fontSize: 9, color: '#94a3b8', marginBottom: 8 }}>
                  Envoyer ordre d'arrêt immédiat à <b style={{ color: '#fbbf24' }}>{actionPanel.fleetNumber}</b> ?
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={submitStop} disabled={submitting}
                    style={{ flex: 1, padding: '5px 6px', background: '#7f1d1d', border: '1px solid #ef4444', borderRadius: 5, color: '#fca5a5', fontSize: 10, fontWeight: 800, cursor: 'pointer' }}>
                    {submitting ? 'Envoi…' : 'CONFIRMER ARRET'}
                  </button>
                  <button onClick={resetSub} style={{ padding: '5px 8px', background: '#1a2035', border: '1px solid #334155', borderRadius: 5, color: '#64748b', fontSize: 10, cursor: 'pointer' }}>Annuler</button>
                </div>
              </div>
            )}

            {/* Boutons d'action principaux (masqués si sous-formulaire actif) */}
            {!subAction && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button onClick={() => handleAction('assign')}
                  style={{ padding: '5px 8px', background: '#1e3a5f', border: '1px solid #3b82f6', borderRadius: 6, color: '#93c5fd', fontSize: 10, fontWeight: 700, cursor: 'pointer', textAlign: 'left', width: '100%' }}>
                  Assigner / Rediriger
                </button>
                <button onClick={() => handleAction('message')}
                  style={{ padding: '5px 8px', background: '#1e2a40', border: '1px solid #6366f1', borderRadius: 6, color: '#a5b4fc', fontSize: 10, fontWeight: 700, cursor: 'pointer', textAlign: 'left', width: '100%' }}>
                  Contacter le chauffeur
                </button>
                <button onClick={() => handleAction('stop')}
                  style={{ padding: '5px 8px', background: '#3b0a0a', border: '1px solid #ef4444', borderRadius: 6, color: '#fca5a5', fontSize: 10, fontWeight: 700, cursor: 'pointer', textAlign: 'left', width: '100%' }}>
                  Arret d'urgence
                </button>
              </div>
            )}

            {/* GPS bas du panel */}
            <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid #1e2d4a', fontSize: 8, color: '#374151', fontFamily: 'monospace' }}>
              {actionPanel.truck.lat.toFixed(5)}, {actionPanel.truck.lon.toFixed(5)}
            </div>
          </div>
        </div>
      )}

      {/* ── Légende phases ────────────────────────────────────────────── */}
      <div style={{ position:'absolute', bottom:8, left:8, display:'flex', flexWrap:'wrap', gap:3, pointerEvents:'none', maxWidth:260 }}>
        {Object.entries(PHASE_FR).slice(0, 8).map(([key, label]) => (
          <span key={key} style={{ fontSize:8, fontFamily:'monospace', color:'#94a3b8', background:'rgba(10,22,40,0.85)', borderRadius:2, padding:'1px 4px', display:'flex', alignItems:'center', gap:3 }}>
            <span style={{ width:6, height:6, borderRadius:'50%', background:'#' + (PHASE_HEX[key] ?? 0x888888).toString(16).padStart(6,'0'), display:'inline-block' }} />
            {label}
          </span>
        ))}
      </div>

      {/* ── Indicateurs top-right ──────────────────────────────────────── */}
      <div style={{ position:'absolute', top:8, right:8, display:'flex', flexDirection:'column', gap:4, pointerEvents:'none' }}>
        <div style={{ fontSize:8, color:'#475569', fontFamily:'monospace', background:'rgba(10,22,40,0.78)', padding:'3px 6px', borderRadius:3 }}>
          ⟳ Drag · ⊕ Zoom · ↖ Clic · ↗↗ Follow
        </div>
        {isRunning && (
          <div style={{ fontSize:9, color:'#22c55e', fontFamily:'monospace', background:'rgba(10,22,40,0.85)', padding:'3px 6px', borderRadius:3, border:'1px solid rgba(34,197,94,0.2)', display:'flex', alignItems:'center', gap:4 }}>
            <span style={{ width:6, height:6, borderRadius:'50%', background:'#22c55e', animation:'pulse 1s infinite', display:'inline-block' }} />
            {trucks.filter(t => t.phase !== 'DOWN').length} engins actifs
          </div>
        )}
      </div>
    </div>
  );
}
