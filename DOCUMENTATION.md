# FMS Mining — Documentation Technique Complète
## Fleet Management System — Open Pit Mining

> **Version** : 1.2.0 | **Dernière mise à jour** : 2026-06-29  
> **Stack** : Node.js · TypeScript · PostgreSQL · React · Socket.io · Tailwind CSS · Three.js

---

## Table des matières

1. [Introduction & vision du projet](#1-introduction--vision-du-projet)
2. [Architecture globale](#2-architecture-globale)
3. [Prérequis & installation](#3-prérequis--installation)
4. [Structure du projet](#4-structure-du-projet)
5. [Base de données](#5-base-de-données)
6. [Backend — API REST](#6-backend--api-rest)
7. [Modules IA — détail technique](#7-modules-ia--détail-technique)
8. [Frontend — interface utilisateur](#8-frontend--interface-utilisateur)
9. [Temps réel — Socket.io](#9-temps-réel--socketio)
10. [Sécurité](#10-sécurité)
11. [Mode Hybride sim+réel — GPS en production](#11-mode-hybride-simréel--gps-en-production)
12. [IntegrationHub & DriverApp — intégration physique](#12-integrationhub--driverapp--intégration-physique)
13. [Vue 3D Mine — fonctionnement technique](#13-vue-3d-mine--fonctionnement-technique)
14. [Déploiement réseau LAN](#14-déploiement-réseau-lan)
15. [Guide de mise à jour et évolution](#15-guide-de-mise-à-jour-et-évolution)
16. [Glossaire minier](#16-glossaire-minier)

---

## 1. Introduction & vision du projet

### Pourquoi ce système ?

Dans une mine à ciel ouvert (open-pit), une flotte de 10 à 50 camions géants (CAT 793, 220 tonnes) circule en permanence entre les pelles, les décharges et les stations de carburant. Sans outil de gestion, les dispatchers travaillent à l'instinct : mauvaises affectations, camions en attente inutile, pannes non anticipées.

**FMS Mining** remplace ce processus manuel par :

- **Vision temps réel** de chaque équipement (GPS, statut, télémétrie)
- **Dispatch optimisé** par algorithme mathématique (algorithme hongrois)
- **Routes optimisées** par graphe pondéré (Dijkstra)
- **Maintenance prédictive** par scoring ML sur la télémétrie
- **Simulation complète** avant tout déploiement de matériel réel

### Principe fondamental : simuler avant de déployer

Le module de simulation (Module 5) permet de **tester l'ensemble du système en conditions réelles** — cycles complets, pannes, capteurs géophysiques — sans connecter un seul équipement physique. Les données produites sont identiques à celles du terrain : elles remplissent les mêmes tables PostgreSQL, déclenchent les mêmes événements Socket.io, alimentent les mêmes KPIs.

Quand vous branchez le vrai matériel, vous n'avez qu'à **pointer les GPS/PLC vers les mêmes endpoints API**.

---

## 2. Architecture globale

```
┌─────────────────────────────────────────────────────────────┐
│                      RÉSEAU LAN MINE                        │
│                                                             │
│  ┌──────────────┐    HTTP/WS    ┌──────────────────────┐   │
│  │   Navigateur  │◄────────────►│   Backend Node.js    │   │
│  │  (React SPA)  │              │   Port 4000          │   │
│  └──────────────┘              │                      │   │
│                                │  ┌────────────────┐  │   │
│  ┌──────────────┐    REST API   │  │  Controllers   │  │   │
│  │  GPS embarqué │─────────────►│  │  (Express)     │  │   │
│  │  (camions)    │              │  └────────┬───────┘  │   │
│  └──────────────┘              │           │           │   │
│                                │  ┌────────▼───────┐  │   │
│  ┌──────────────┐    REST API   │  │   Services IA  │  │   │
│  │  PLC/SCADA   │─────────────►│  │  Dijkstra      │  │   │
│  │  (télémétrie)│              │  │  Hongrois      │  │   │
│  └──────────────┘              │  │  ML scoring    │  │   │
│                                │  └────────┬───────┘  │   │
│  ┌──────────────┐              │           │           │   │
│  │  Capteurs BNR│─────────────►│  ┌────────▼───────┐  │   │
│  │  (géophysique│              │  │  PostgreSQL     │  │   │
│  └──────────────┘              │  └────────────────┘  │   │
│                                └──────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Flux de données

```
Équipement (GPS + capteurs)
        │
        ▼  POST /api/v1/gps/positions
Backend Express (valide → sanitise → stocke)
        │
        ├──► PostgreSQL (persistance)
        │
        └──► Socket.io (broadcast)
                    │
                    ▼
            Tous les navigateurs connectés
            (mise à jour en temps réel)
```

### Technologies choisies et pourquoi

| Technologie | Rôle | Pourquoi ce choix |
|---|---|---|
| **Node.js + TypeScript** | Backend | Typage fort, même langage front/back, excellent écosystème temps réel |
| **Express** | Framework HTTP | Léger, grande communauté, middleware simple à chaîner |
| **PostgreSQL** | Base de données | ACID, partitionnement par date, vues matérialisées, robustesse |
| **Socket.io** | Temps réel | Reconnexion automatique, rooms par site, WebSocket + long-polling |
| **React 18** | Interface | Composants réutilisables, hooks, performances avec Concurrent Mode |
| **Zustand** | État global | Simple, sans boilerplate Redux, persist middleware intégré |
| **Tailwind CSS** | Styles | Utility-first, rapide à prototyper, cohérence visuelle garantie |
| **Vite** | Build | HMR ultra-rapide en dev, tree-shaking optimisé pour prod |
| **Zod** | Validation | Types TypeScript natifs depuis les schémas — pas de double déclaration |

---

## 3. Prérequis & installation

### Logiciels nécessaires

```bash
# Vérifier les versions installées :
node --version    # >= 18.0.0
npm --version     # >= 9.0.0
psql --version    # PostgreSQL >= 14
```

**Installation (macOS) :**
```bash
# Node.js via nvm (recommandé — permet plusieurs versions)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 20
nvm use 20

# PostgreSQL
brew install postgresql@16
brew services start postgresql@16
```

**Installation (Ubuntu/Debian — serveur LAN en production) :**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo apt-get install -y postgresql postgresql-contrib
sudo systemctl enable postgresql && sudo systemctl start postgresql
```

### Installation du projet

```bash
# 1. Base de données
sudo -u postgres psql <<'SQL'
CREATE USER fms_user WITH PASSWORD 'VotreMotDePasseSecurisé';
CREATE DATABASE fms_mining OWNER fms_user;
GRANT ALL PRIVILEGES ON DATABASE fms_mining TO fms_user;
SQL

# Appliquer les migrations dans l'ordre strict :
psql -U fms_user -d fms_mining -f database/01_schema.sql
psql -U fms_user -d fms_mining -f database/02_indexes.sql
psql -U fms_user -d fms_mining -f database/03_views.sql
psql -U fms_user -d fms_mining -f database/04_seed.sql
psql -U fms_user -d fms_mining -f database/05_seed_v2.sql
psql -U fms_user -d fms_mining -f database/06_security.sql
psql -U fms_user -d fms_mining -f database/07_alterations.sql
psql -U fms_user -d fms_mining -f database/08_simulation_ai.sql

# 2. Backend
cd mining/backend
cp .env.example .env
# Éditer .env : DB_PASSWORD, JWT_SECRET (openssl rand -hex 64)
npm install
npm run dev
# → API disponible sur http://localhost:4000/api/v1

# 3. Frontend (nouveau terminal)
cd mining/frontend
npm install
npm run dev
# → Interface disponible sur http://localhost:5173
```

**Compte administrateur par défaut (créé par seed) :**
```
Login    : admin
Password : Admin@Mine2024
⚠️  CHANGER IMMÉDIATEMENT en production
```

### Variables d'environnement (backend/.env)

```ini
NODE_ENV=development          # ou production

PORT=4000                     # port du serveur API

# Connexion PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=fms_mining
DB_USER=fms_user
DB_PASSWORD=VOTRE_MOT_DE_PASSE   # Ne jamais versionner ce fichier !
DB_POOL_MIN=2                 # Connexions min dans le pool
DB_POOL_MAX=20                # Connexions max (ajuster selon RAM serveur)

# JWT — générer avec : openssl rand -hex 64
JWT_SECRET=UNE_CHAINE_DE_64_CARACTERES_MINIMUM
JWT_EXPIRES_IN=8h             # Durée d'un token = durée d'un poste de travail

# CORS — IPs autorisées à appeler l'API
ALLOWED_ORIGINS=http://localhost:5173,http://192.168.1.100

# Simulation BNR automatique (optionnel)
AUTO_BNR=false                # true = génère des lectures BNR toutes les 5 min
DEFAULT_SITE_ID=              # UUID du site par défaut pour AUTO_BNR

# GPS Simulation — false en production avec équipement réel
ENABLE_GPS_SIMULATION=false
```

---

## 4. Structure du projet

```
mining/
├── database/                    ← Migrations SQL (ordre strict : 01 → 08)
│   ├── 01_schema.sql            ← Schémas + toutes les tables principales
│   ├── 02_indexes.sql           ← Index de performance (colonnes de recherche)
│   ├── 03_views.sql             ← Vues pour les rapports (fleet_summary, etc.)
│   ├── 04_seed.sql              ← Données de base (site, admin, équipements démo)
│   ├── 05_seed_v2.sql           ← Données enrichies (opérateurs, tournées, etc.)
│   ├── 06_security.sql          ← Permissions PostgreSQL (Row Level Security)
│   ├── 07_alterations.sql       ← Colonnes ajoutées après v1
│   └── 08_simulation_ai.sql     ← Schémas simulation + sensors + ai (Modules 1-5)
│
├── backend/
│   ├── src/
│   │   ├── server.ts            ← Point d'entrée : HTTP server + Socket.io + init
│   │   ├── app.ts               ← Express app : middleware globaux + routes
│   │   ├── config/
│   │   │   └── database.ts      ← Pool PostgreSQL (pg), fonction query()
│   │   ├── middleware/
│   │   │   ├── auth.ts          ← JWT authenticate + authorize (RBAC)
│   │   │   ├── validate.ts      ← Validation Zod des corps de requête
│   │   │   ├── sanitize.ts      ← Protection XSS + injection SQL
│   │   │   └── errorHandler.ts  ← Gestion centralisée des erreurs Express
│   │   ├── schemas/
│   │   │   └── index.ts         ← Schémas Zod pour tous les endpoints
│   │   ├── routes/
│   │   │   └── index.ts         ← 98 routes Express (auth, équip., IA, sim.)
│   │   ├── controllers/         ← Logique HTTP : parse req → appelle service → res
│   │   │   ├── auth.controller.ts
│   │   │   ├── equipment.controller.ts
│   │   │   ├── dispatch.controller.ts
│   │   │   ├── haulCycle.controller.ts
│   │   │   ├── maintenance.controller.ts
│   │   │   ├── fuel.controller.ts
│   │   │   ├── kpi.controller.ts
│   │   │   ├── gps.controller.ts
│   │   │   ├── operator.controller.ts
│   │   │   ├── tyre.controller.ts
│   │   │   ├── shift.controller.ts
│   │   │   ├── telemetry.controller.ts
│   │   │   ├── production.controller.ts
│   │   │   ├── simulation.controller.ts  ← Modules 1 + 5
│   │   │   └── ai.controller.ts          ← Modules 2 + 3 + 4
│   │   └── services/            ← Logique métier (pas de HTTP ici)
│   │       ├── realtime.service.ts       ← Socket.io : rooms, broadcasts
│   │       ├── simulation/
│   │       │   └── SimulationEngine.ts   ← Module 5 : machine à états camions
│   │       ├── sensors/
│   │       │   └── BNRSensor.ts          ← Module 1 : capteurs géophysiques
│   │       └── ai/
│   │           ├── RouteOptimizer.ts     ← Module 2 : algorithme Dijkstra
│   │           ├── DispatchOptimizer.ts  ← Module 3 : algorithme hongrois
│   │           ├── PredictiveMaintenance.ts ← Module 4 : scoring ML + RUL
│   │           └── utils.ts              ← Haversine, tendance linéaire, clamp
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
│
├── frontend/
│   ├── src/
│   │   ├── main.tsx             ← Point d'entrée React
│   │   ├── App.tsx              ← Routeur React + routes protégées
│   │   ├── store/
│   │   │   └── index.ts         ← Zustand : auth + positions GPS + alarmes live
│   │   ├── lib/
│   │   │   ├── api.ts           ← Axios instance + helpers typés par module
│   │   │   └── socket.ts        ← Socket.io client + types des événements
│   │   ├── hooks/
│   │   │   ├── useRealtime.ts   ← Abonnement Socket.io dans les composants
│   │   │   ├── useRole.ts       ← Vérification du rôle utilisateur
│   │   │   └── useAlarmNotifications.ts
│   │   ├── types/
│   │   │   └── index.ts         ← Types TypeScript partagés (front)
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── Layout.tsx   ← Shell : Sidebar + Header + contenu
│   │   │   │   ├── Sidebar.tsx  ← Navigation principale (15 entrées + 2 modules IA)
│   │   │   │   └── Header.tsx   ← Barre du haut : alarmes + utilisateur
│   │   │   ├── live/
│   │   │   │   ├── LiveFeed.tsx ← Fil d'événements temps réel
│   │   │   │   └── LiveMetricsBar.tsx ← Barre métriques shift live
│   │   │   └── ui/
│   │   │       └── Icons.tsx    ← Tous les icônes SVG du système
│   │   └── pages/               ← Une page = une route React
│   │       ├── Login.tsx
│   │       ├── Dashboard.tsx    ← KPIs + carte + événements live
│   │       ├── Equipment.tsx    ← Flotte complète
│   │       ├── Dispatch.tsx     ← Affectations camions/pelles
│   │       ├── MineMap.tsx      ← Carte Leaflet temps réel
│   │       ├── Maintenance.tsx  ← Ordres de travail + pannes
│   │       ├── Fuel.tsx         ← Transactions carburant
│   │       ├── Reports.tsx      ← Rapports & KPIs exportables CSV
│   │       ├── Operators.tsx    ← Conducteurs + stats
│   │       ├── Tyres.tsx        ← Inventaire pneus + TKPH
│   │       ├── Shifts.tsx       ← Postes de travail
│   │       ├── Telemetry.tsx    ← Graphes moteur temps réel
│   │       ├── Production.tsx   ← Réconciliation tonnes réelles vs plan
│   │       ├── Roads.tsx        ← État des pistes
│   │       ├── Simulation.tsx   ← MODULE 5 : console de simulation
│   │       ├── AIPredictions.tsx ← MODULES 2+3+4 : IA & prédictions
│   │       └── Settings.tsx     ← Profil + activation MFA TOTP
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
│
└── DOCUMENTATION.md             ← Ce fichier
```

---

## 5. Base de données

### Organisation en schémas PostgreSQL

La base est divisée en **8 schémas** pour isoler les domaines métier :

```
core          Référentiels stables : site, équipements, pistes, locations, utilisateurs
operations    Données opérationnelles : cycles, dispatch, alarmes, positions GPS
maintenance   Ordres de travail, pannes, pneus
fuel          Stations, transactions carburant
reporting     Vues agrégées, plans de production, réconciliation
simulation    État de simulation, scénarios, journal d'événements
sensors       Stations BNR, lectures géophysiques, zones de tir
ai            Cache routes Dijkstra, recommandations dispatch, prédictions ML
```

### Tables principales

#### Schéma `core`

| Table | Description | Colonnes clés |
|---|---|---|
| `mine_site` | Le site minier | site_id, name, country, lat, lon, timezone |
| `equipment_type` | Types d'engin (TRUCK, EXCAVATOR…) | type_id, category, model, max_payload_t |
| `equipment` | Chaque engin physique | equipment_id, fleet_number, status, current_hours |
| `location` | Points nommés sur la mine | location_id, location_type (PIT/DUMP/FUEL…), lat, lon |
| `haul_road` | Segments de piste | road_id, from_id, to_id, distance_m, gradient_pct, condition |
| `user_account` | Comptes utilisateurs | user_id, role (ADMIN/DISPATCHER/VIEWER/OPERATOR) |

#### Schéma `operations`

| Table | Description | Colonnes clés |
|---|---|---|
| `haul_cycle` | Cycle complet camion | cycle_id, payload_tonnes, duration_s, phases JSON |
| `dispatch_assignment` | Affectation camion→pelle | assignment_id, truck_id, loader_id, status |
| `equipment_position` | Position GPS horodatée | lat, lon, speed_kmh, heading — *partitionné par trimestre* |
| `telemetry_event` | Données capteurs moteur | temp_c, oil_pres, vibration — *partitionné par trimestre* |
| `shift` | Poste de travail (8h) | shift_id, type (DAY/NIGHT), start_at, end_at |
| `alarm` | Alarmes générées | severity (INFO/WARNING/CRITICAL/EMERGENCY), acknowledged |

#### Schéma `simulation` (Module 5)

| Table | Description |
|---|---|
| `scenario` | Scénarios prédéfinis (5 camions légers, 10 camions standard…) |
| `state` | État courant : RUNNING/PAUSED/STOPPED, vitesse, totaux — UNIQUE par site |
| `event_log` | Journal chronologique : PHASE_CHANGE, CYCLE_COMPLETE, BREAKDOWN… |

#### Schéma `sensors` (Module 1)

| Table | Description |
|---|---|
| `bnr_station` | Position physique d'un capteur BNR sur le terrain |
| `bnr_reading` | Lecture : stabilité, vibration, déformation, humidité, séisme — *partitionné par année* |
| `blast_zone` | Zone de tir explosive (CLEAR/PREPARATION/ACTIVE/POST_BLAST) |

#### Schéma `ai` (Modules 2-3-4)

| Table | Description |
|---|---|
| `route_cache` | Routes Dijkstra mises en cache (invalidation par hash des conditions routières) |
| `dispatch_recommendation` | Résultats algorithme hongrois avec matrice de coût JSON |
| `maintenance_prediction` | Scores ML, RUL heures, probabilités de panne 24h/72h/7j |
| `failure_training_data` | Instantanés télémétrie avant panne confirmée (futur entraînement ML) |

### Partitionnement (performance à grande échelle)

Les tables qui grossissent vite sont partitionnées par période :

```sql
-- equipment_position : partitionné par trimestre
-- Raisonnement : 1 million de positions/jour × 10 camions = 3.6 milliards/an
-- Avec partition : une requête "dernière heure" ne scanne que Q2_2026

operations.equipment_position_2026_q2  -- Avr-Jun 2026 (actif)
operations.equipment_position_2026_q3  -- Juil-Sep 2026 (créé à l'avance)

-- sensors.bnr_reading : partitionné par année
sensors.bnr_reading_2026
sensors.bnr_reading_2027
```

---

## 6. Backend — API REST

### Middleware (ordre d'exécution)

```
Requête entrante
    │
    ├─ 1. Helmet          → Headers sécurité HTTP (X-Frame-Options, CSP, HSTS)
    ├─ 2. CORS            → Filtre origines non autorisées (whitelist IPs LAN)
    ├─ 3. Compression     → gzip automatique des réponses > 1 ko
    ├─ 4. Morgan          → Log HTTP : méthode, URL, durée, code réponse
    ├─ 5. Sanitize        → Supprime < > ' " ; -- des inputs (XSS + SQLi)
    ├─ 6. authenticate    → Vérifie le token JWT (header Authorization: Bearer)
    ├─ 7. authorize       → Vérifie le rôle requis (ADMIN/DISPATCHER/VIEWER)
    ├─ 8. validateBody    → Zod valide le corps JSON (types, longueurs, formats)
    ├─ 9. Controller      → Logique métier : query SQL + Socket.io si besoin
    └─ 10. errorHandler   → Formate toute erreur non capturée en JSON propre
```

### Endpoints disponibles

#### Authentification
```
POST   /api/v1/auth/login          Connexion (username + password)
POST   /api/v1/auth/mfa/verify     Code TOTP 6 chiffres (si MFA activé)
GET    /api/v1/auth/me             Infos utilisateur connecté
GET    /api/v1/auth/mfa/setup      QR code pour app authenticator
POST   /api/v1/auth/mfa/enable     Active le MFA TOTP
DELETE /api/v1/auth/mfa/disable    Désactive le MFA (avec code de confirmation)
```

#### Module 5 — Simulation
```
POST   /api/v1/simulation/start    Démarre (body: siteId, speedMultiplier)
POST   /api/v1/simulation/stop     Arrête et remet tous les camions en AVAILABLE
POST   /api/v1/simulation/pause    Suspend sans perdre l'état des camions
POST   /api/v1/simulation/resume   Reprend depuis l'état sauvegardé
PATCH  /api/v1/simulation/speed    Change la vitesse en cours (0.5× à 20×)
GET    /api/v1/simulation/status   État complet + tableau de tous les camions
GET    /api/v1/simulation/scenarios Liste des scénarios disponibles
GET    /api/v1/simulation/events   Journal filtrable (type, camion, pagination)
```

#### Module 1 — Capteurs BNR
```
GET  /api/v1/simulation/sensors/bnr                Résumé : statuts par station
POST /api/v1/simulation/sensors/bnr/generate        Génère lectures (profil donné)
GET  /api/v1/simulation/sensors/bnr/:id/history     Historique pour graphes tendance
```

#### Modules IA
```
POST /api/v1/ai/route-optimize              Route optimale Dijkstra entre 2 points
POST /api/v1/ai/route-graph/rebuild         Reconstruit le graphe en mémoire
GET  /api/v1/ai/route-graph/stats           Stats : nœuds, arêtes, dernière mise à jour
GET  /api/v1/ai/dispatch-optimize           Affectations optimales (algorithme hongrois)
POST /api/v1/ai/dispatch-apply              Applique les affectations en base de données
GET  /api/v1/ai/dispatch-history            Historique des recommandations IA
GET  /api/v1/ai/maintenance-predict         Prédictions pour tout le site
GET  /api/v1/ai/maintenance-predict/:id     Prédiction détaillée pour un équipement
GET  /api/v1/ai/maintenance-history/:id     Historique des prédictions
GET  /api/v1/ai/dashboard                   Tableau de bord IA global (3 modules)
```

### Rôles et permissions

```
ADMIN       Tout : créer, modifier, supprimer, simuler, contrôler l'IA
DISPATCHER  Opérationnel : dispatch, simulation, alarmes, cycles
VIEWER      Lecture seule : tous les GET
OPERATOR    Lecture + saisie GPS et télémétrie (son propre équipement)
```

### Format de réponse d'erreur

```json
{
  "error": "Description humaine du problème",
  "code": "VALIDATION_ERROR",
  "details": [
    { "field": "speedMultiplier", "message": "Must be between 0.5 and 20" }
  ]
}
```

---

## 7. Modules IA — détail technique

### Module 1 — Capteurs BNR géophysiques

**Fichier** : `backend/src/services/sensors/BNRSensor.ts`

Les capteurs BNR (Borehole Nuclear Resistivity) mesurent la stabilité du terrain en profondeur. En simulation, ils génèrent des données réalistes selon 5 profils :

| Profil | Quand l'utiliser | Stabilité index | Vibration |
|---|---|---|---|
| `STABLE` | Conditions normales, exploitation courante | 85–90/100 | 0.2–0.5 mm/s |
| `HUMID` | Après fortes pluies, sol gorgé d'eau | 70–75/100 | 0.5–1.0 mm/s |
| `PRE_BLAST` | Avant un tir de mine (foreuse active) | 75–80/100 | 1.0–1.5 mm/s |
| `POST_BLAST` | Après le tir, ondes sismiques résiduelles | 45–55/100 | 5–8 mm/s |
| `CRITICAL` | Instabilité terrain, risque effondrement | 20–30/100 | 7–10 mm/s |

**Seuils d'alerte (déclenchent une alarme automatique) :**

```
Stabilité :
  < 60  → WARNING   (surveiller — restreindre éventuellement)
  < 40  → CRITICAL  (restreindre accès à la zone)
  < 25  → ALERT     (évacuation immédiate !)

Vibration :
  > 2 mm/s  → WARNING
  > 5 mm/s  → CRITICAL
  > 10 mm/s → ALERT (équipements sensibles à arrêter)
```

Quand un seuil CRITICAL ou ALERT est atteint, une alarme est automatiquement insérée dans `operations.alarm` et broadcastée via Socket.io à tous les dispatchers connectés.

---

### Module 2 — Optimisation des routes (Dijkstra)

**Fichier** : `backend/src/services/ai/RouteOptimizer.ts`

**Principe de l'algorithme de Dijkstra :**

```
1. Charger le graphe en mémoire :
   - Chaque location (PIT, DUMP, JUNCTION…) = un nœud
   - Chaque haul_road = une arête bidirectionnelle

2. Calculer le coût de chaque arête :
   coût = distance_km × 1.0
         + gradient_pct × (chargé ? 0.15 : 0.05)   ← pente pèse plus chargé
         × facteur_état (GOOD=1.0, FAIR=1.2, POOR=1.6, CLOSED=∞)
         + camions_présents × 0.05                   ← congestion

3. File de priorité : toujours explorer le nœud de coût minimal

4. Quand on atteint la destination :
   → remonter les prédécesseurs pour reconstruire le chemin
   → calculer distance totale et temps estimé

Complexité : O((V + E) × log V) — rapide même pour 100 nœuds, 300 arêtes
```

**Exemple de résultat :**
```
Origine   : PIT_NORTH
Destination : DUMP_1
Camion    : CHARGÉ

Route optimale  : PIT_NORTH → JUNCTION_3 → DUMP_1
Distance        : 3.2 km
Temps estimé    : 6.4 min (à 30 km/h)
Coût Dijkstra   : 4.87

Alternative 1   : PIT_NORTH → ROAD_Y → DUMP_1
Distance        : 4.1 km, 8.2 min — état FAIR (×1.2)
Coût            : 6.23  ← plus coûteux, donc alternative
```

---

### Module 3 — Dispatch intelligent (algorithme hongrois)

**Fichier** : `backend/src/services/ai/DispatchOptimizer.ts`

**Problème résolu** : Affecter N camions disponibles aux M pelles de manière à minimiser le temps d'attente total de la flotte.

**Construction de la matrice de coût :**

```
             Pelle-1   Pelle-2   Pelle-3
CAT-001  [    8.3       15.2       22.1  ]
CAT-002  [   12.7        9.1       18.4  ]
CAT-003  [   19.5       11.3        7.8  ]

Coût(camion i, pelle j) =
    distKm / 30 × 60         ← temps de trajet (minutes à 30 km/h)
  + queueLength × 4          ← attente file : 4 min par camion déjà en queue
  + (100 - health) × 0.05   ← pénalité si camion en mauvais état
  + (fuel < 20% ? 5 : 0)    ← pénalité si carburant bas (risque d'interruption)
```

**Étapes de l'algorithme hongrois :**

```
1. Réduction des lignes : 
   soustraire le minimum de chaque ligne
   → crée au moins un zéro par ligne

2. Réduction des colonnes :
   soustraire le minimum de chaque colonne
   → crée au moins un zéro par colonne

3. Affectation des zéros :
   trouver des zéros sans conflit (un seul par ligne et par colonne)

4. Vérification :
   Si n affectations trouvées → solution optimale !
   Sinon → trouver la couverture minimale et itérer

Garantie : solution GLOBALEMENT optimale en O(n³)
           Même avec 15 camions × 5 pelles (matrice 15×5 = 75 cellules)
```

---

### Module 4 — Maintenance prédictive

**Fichier** : `backend/src/services/ai/PredictiveMaintenance.ts`

**Calcul du score de santé par composant :**

```
Score(composant) = 100 − Σ(pénalités)

Exemple pour le MOTEUR (poids 40% du score global) :
  Lecture télémétrie :  temp_c=98°C, oil_pressure=3.8 bar
  Seuil temp WARNING  : 95°C → dépassé → −15 points
  Seuil temp CRITICAL : 105°C → non atteint
  Tendance temp       : +0.8°C/h → pénalité tendance −4 points
  Oil pression OK     : 3.8 > 3.0 → 0 pénalité
  Score MOTEUR = 100 − 15 − 4 = 81

Score global = MOTEUR×40% + HYDRAULIQUE×25% + FREINS×15% + CARBURANT×10% + ELECTRIQUE×10%
```

**Remaining Useful Life (RUL) — durée de vie utile restante :**

```
tendance = pente de régression linéaire (moindres carrés) sur 48 lectures
           = vitesse de dégradation en points/heure

RUL = (score_actuel − seuil_critique) / |tendance|
    = nombre d'heures avant d'atteindre le seuil critique

Exemple : score=75, seuil_critique=40, tendance=−0.8 pts/h
          RUL = (75 − 40) / 0.8 = 43.75 heures
```

**Probabilité de panne — modèle logistique :**

```
P(panne dans horizon H heures) = 1 / (1 + e^(−k × (H − RUL × 0.7)))

k = 0.05  (paramètre de la courbe, calibrable sur données terrain)

P(24h)  : H = 24  → probabilité de panne dans les prochaines 24h
P(72h)  : H = 72  → probabilité dans les 3 prochains jours
P(7j)   : H = 168 → probabilité dans la semaine
```

**Actions recommandées selon le score global :**

| Score | Action | Sens opérationnel |
|---|---|---|
| > 80 | MONITOR | Surveillance normale, aucune action immédiate |
| 65–80 | INSPECT_SOON | Inspecter à la prochaine opportunité (shift suivant) |
| 50–65 | PLAN_MAINTENANCE | Planifier dans la semaine — ne pas attendre |
| 30–50 | URGENT | Maintenance avant la prochaine rotation — éviter les longues missions |
| < 30 | IMMEDIATE | **Arrêt immédiat** — ne pas remettre en service sans réparation |

---

### Module 5 — Moteur de simulation

**Fichier** : `backend/src/services/simulation/SimulationEngine.ts`

**Machine à états d'un camion (10 phases) :**

```
IDLE ──dispatch()──► MOVING_TO_SOURCE (300s) ──► QUEUING_AT_SOURCE (120s)
                                                          │
                                                     LOADING (210s)
                                                          │
                                                     HAULING (480s)
                                                          │
                                                 QUEUING_AT_DEST (60s)
                                                          │
                                                     DUMPING (90s)
                                                          │
                                                    RETURNING (360s)
                                                          │
                                    fuel < 15% ?─────────►│
                                         │                 │
                                    REFUELING (420s)   ◄───┘
                                         │
                    panne aléatoire? ─► DOWN (1800s) → réparation → IDLE
```

**Consommation carburant simulée (CAT 793 réel) :**

| Phase | Litres/heure | Explication |
|---|---|---|
| IDLE | 8 L/h | Moteur au ralenti |
| MOVING_TO_SOURCE | 55 L/h | En route à vide, terrain variable |
| LOADING | 35 L/h | Moteur stable, pelle qui travaille |
| HAULING | 85 L/h | En charge maximale, montées fréquentes |
| RETURNING | 50 L/h | Retour à vide, vitesse plus rapide |

**Réservoir CAT 793 : 4 732 litres** → autonomie réelle ~8h à plein régime.

**Multiplicateur de vitesse :**

```
simElapsed = realElapsed × speedMultiplier

0.5× → temps simulé = temps réel / 2  (ralenti, pour observer)
1×   → temps réel (1:1)
5×   → 1 heure simulée en 12 minutes
10×  → 1 poste de 8h simulé en 48 minutes réelles ← recommandé pour tester les KPIs
20×  → 1 poste de 8h en 24 minutes ← test rapide de scénarios extrêmes
```

---

## 8. Frontend — interface utilisateur

### Gestion d'état global (Zustand)

```
Trois stores distincts dans store/index.ts :

useAuthStore       Token JWT + infos utilisateur connecté
                   Persisté dans localStorage → survit à un rechargement de page

useRealtimeStore   Positions GPS temps réel + métriques shift + alarmes actives
                   Mis à jour par Socket.io → pas de polling

useLiveMetrics     Compteurs de session : cycles, tonnes, pannes, dispatches
                   Remis à zéro au rechargement
```

### Pages et leur rôle

| Route | Page | Contenu principal |
|---|---|---|
| `/dashboard` | Dashboard | KPIs : disponibilité mécanique, cycles/h, tonnes, alarmes |
| `/map` | MineMap | Carte Leaflet avec camions animés en temps réel |
| `/dispatch` | Dispatch | Liste des affectations + bouton "Suggestion IA" |
| `/shifts` | Shifts | Postes actifs, ouverture/fermeture, rapport de fin de poste |
| `/equipment` | Equipment | Flotte complète, historique de statuts, KPIs par engin |
| `/operators` | Operators | Conducteurs, stats de performance, assignation aux postes |
| `/maintenance` | Maintenance | Ordres de travail, pannes, calendrier de maintenance |
| `/tyres` | Tyres | Inventaire pneus, installations, suivi TKPH et usure |
| `/telemetry` | Telemetry | Graphes en temps réel : température, pression, vibrations |
| `/fuel` | Fuel | Transactions carburant, niveaux des stations |
| `/production` | Production | Réconciliation tonnes réelles vs plan, graphes Recharts |
| `/roads` | Roads | État des pistes, signalement conditions dégradées |
| `/reports` | Reports | Rapports exportables en CSV, KPIs historiques |
| `/simulation` | **Simulation** | Console Module 5 : contrôles + grille camions + BNR |
| `/ai-predictions` | **AIPredictions** | Tableau de bord Modules 2+3+4 : routes, dispatch, ML |
| `/settings` | Settings | Profil utilisateur + activation MFA TOTP |

### Appels API depuis le frontend

```typescript
// lib/api.ts : instance Axios avec JWT auto-attaché

// L'intercepteur injecte le token sur TOUTES les requêtes :
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('fms_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Helpers typés disponibles (exemple d'utilisation) :
import { simulationApi, aiApi, equipmentApi } from '../lib/api';

// Dans un composant React :
const handleStart = async () => {
  const { data } = await simulationApi.start({
    siteId: 'uuid-du-site',
    speedMultiplier: 5,
  });
  setSimStatus(data); // TypeScript connaît le type exact
};
```

---

## 9. Temps réel — Socket.io

### Architecture des rooms

```
Chaque site minier a sa propre room : "site:{site_id}"

io.to(`site:${siteId}`).emit('gps:update', { trucks: [...] });
                                  ^
                                  Tous les navigateurs abonnés
                                  à ce site reçoivent cet événement
```

Les clients s'abonnent automatiquement à leur room au moment de la connexion (via le hook `useRealtime.ts`).

### Événements émis par le serveur

| Événement | Déclenché quand | Données |
|---|---|---|
| `gps:update` | Chaque tick simulation (1s) | `{ trucks: TruckSimState[] }` |
| `truck:phase_change` | Transition de phase | `{ fleet_number, from, to, duration_s }` |
| `production:cycle_complete` | Fin d'un cycle haul | `{ fleet_number, payload_tonnes, duration_s }` |
| `truck:breakdown` | Panne simulée | `{ fleet_number, health_score, estimated_down_min }` |
| `dispatch:assigned` | Application d'une affectation | `{ truck_number, loader_number, source_name, ai_recommended }` |
| `equipment:status_change` | Changement de statut manuel | `{ fleet_number, old_status, new_status }` |
| `alarm:triggered` | Nouvelle alarme BNR ou système | `{ severity, message, equipment_id }` |
| `fuel:low` | Carburant < 15% | `{ fleet_number, fuel_level_pct }` |
| `production:shift` | Mise à jour métriques shift | `{ totalTonnes, totalCycles, activeEquipment }` |

### Abonnement depuis un composant React

```typescript
// Exemple dans un composant de carte en temps réel :
useEffect(() => {
  socket.on('gps:update', ({ trucks }) => {
    // Met à jour le store Zustand → re-render automatique de la carte
    useRealtimeStore.getState().setPositions(trucks);
  });

  socket.on('truck:breakdown', (payload) => {
    // Ajoute une notification dans le fil d'événements live
    addLiveEvent({ type: 'BREAKDOWN', ...payload });
  });

  // Nettoyage à la destruction du composant
  return () => {
    socket.off('gps:update');
    socket.off('truck:breakdown');
  };
}, []);
```

---

## 10. Sécurité

### Couches de sécurité implémentées

```
1.  Transport        HTTPS obligatoire en production (Nginx reverse proxy)
2.  Authentification JWT RS256, durée 8h (= durée d'un poste de travail)
3.  MFA TOTP         Code 6 chiffres via Google Authenticator / Authy
4.  Autorisation     RBAC à 4 niveaux : ADMIN / DISPATCHER / VIEWER / OPERATOR
5.  Validation       Zod sur TOUS les corps de requête (types, longueurs, formats)
6.  Sanitisation     Suppression < > ' " ; -- avant tout traitement (XSS + SQLi)
7.  Rate limiting    3 niveaux : auth (20/15min), live GPS (720/min/IP:fleet), général (2000/15min)
8.  Headers HTTP     Helmet : X-Frame-Options DENY, CSP, HSTS, noSniff
9.  CORS             Whitelist explicite des IPs LAN autorisées
10. SQL              Requêtes TOUJOURS paramétrées ($1, $2…) — jamais de concaténation
11. Token URL        Token JWT jamais exposé en URL : déplacé en sessionStorage côté DriverApp
12. Anti-spoofing    fleetNumber vérifié en DB avant d'accepter une trame (sauf rôle ADMIN)
13. Géofence         Coordonnées GPS validées dans la zone mine ±0.5° (≈55km de rayon)
```

### Rate limiting — 3 niveaux

| Limiter | Route | Fenêtre | Max | Clé |
|---|---|---|---|---|
| `authLimiter` | `/auth/login`, `/auth/mfa/verify` | 15 min | 20 | IP |
| `liveLimiter` | `/telemetry/live` | 1 min | 720 | IP:fleetNumber |
| `simLimiter` | `/simulation/*` | 1 min | 300 | IP |
| `apiLimiter` | `/api/*` (général) | 15 min | 2000 | IP |

### Flux d'authentification complet

```
Étape 1 : POST /auth/login { username, password }
  → bcrypt.compare(password, hash_stocké)
  → Si MFA activé → retourne { mfa_session: "token_temp", requires_mfa: true }
  → Si MFA désactivé → retourne { token: "JWT", user: {...} }

Étape 2 (si MFA) : POST /auth/mfa/verify { mfa_session, otp }
  → speakeasy.totp.verify(secret_utilisateur, otp, window: 1)
     window: 1 = accepte le code du tick précédent/suivant (décalage horloge)
  → retourne { token: "JWT", user: {...} }

Toutes les requêtes suivantes :
  Header: Authorization: Bearer eyJhbGciOiJ...
```

### Générer un JWT_SECRET sécurisé

```bash
# Dans le terminal du serveur :
openssl rand -hex 64
# Exemple de sortie : a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5...
# → coller dans backend/.env → JWT_SECRET=a3f8b2c1d4e5...
```

---

## 11. Mode Hybride sim+réel — GPS en production

### Principe fondamental : continuité sans rupture

Le mode hybride permet de **connecter les premiers engins physiques sans arrêter la simulation des autres**. Chaque engin réel prend le dessus sur son jumeau simulé ; ceux qui n'ont pas encore de GPS continuent de fonctionner en simulation. Il n'y a pas de "bascule" à une date précise — la transition est progressive, engin par engin.

```
┌─────────────────────────────────────────────────────────┐
│                  /api/v1/simulation/status               │
│                                                          │
│  TK-001  [SIM]   → SimulationEngine (fictif)            │
│  TK-002  [SIM]   → SimulationEngine (fictif)            │
│  TK-007  [LIVE]  → LiveTelemetryService (GPS réel) ✓   │
│  TK-008  [SIM]   → SimulationEngine (fictif)            │
│  TK-012  [LIVE]  → LiveTelemetryService (GPS réel) ✓   │
└─────────────────────────────────────────────────────────┘
                         │
              même format JSON pour les deux
                         │
                  frontend Mine3DView
                    Badge ◌ SIM / ● LIVE
```

### Architecture — LiveTelemetryService

```
backend/src/services/telemetry/LiveTelemetryService.ts
```

Singleton en mémoire Node.js avec un Map `fleetNumber → LiveTruck` :

```typescript
interface LiveTruck {
  fleetNumber:   string;
  lat:           number;
  lon:           number;
  speed_kmh:     number;
  heading:       number;
  payload_kg:    number;
  fuelLevel_pct: number;
  phase:         string;  // inféré par machine à états
  lastSeen_ms:   number;  // Date.now() — pour TTL 30s
  equipmentId?:  string;
  isReal:        true;
}
```

**Purge automatique** : `setInterval(() => liveTelemetry.purgeStale(), 5 * 60_000)` retire les engins silencieux depuis plus de 30 secondes.

### Inférence de phase par géofencing

Au lieu de demander aux engins de déclarer leur activité (risque de mauvaise saisie), le service **déduit automatiquement la phase opérationnelle** à partir de la position GPS et de la charge :

| Zone géofence | Charge | Mouvement | Phase inférée |
|---|---|---|---|
| PIT-* | Vide, statique | Non | QUEUING_AT_SOURCE |
| PIT-* | Delta charge > 2t | — | LOADING |
| PIT-* | Chargé, mobile | Oui | HAULING |
| CRUSHER / DUMP | Chargé, statique | Non | QUEUING_AT_DEST |
| CRUSHER / DUMP | Delta charge < -5t | — | DUMPING |
| CRUSHER / DUMP | Vide | — | RETURNING |
| FUEL_STATION | Tout | Tout | REFUELING |
| PARKING | Tout | Statique | IDLE |
| Hors zone | Chargé | Mobile | HAULING |
| Hors zone | Vide | Mobile | RETURNING |

**Paramètres des géofences (site Nchanga Open-Pit) :**

| Code | Type | Coordonnées | Rayon |
|---|---|---|---|
| PIT-1 | PIT | -12.490, 27.840 | 350m |
| PIT-2 | PIT | -12.500, 27.830 | 350m |
| PIT-3 | PIT | -12.485, 27.860 | 350m |
| CRUSH-1 | CRUSHER | -12.510, 27.855 | 200m |
| DUMP-1 | DUMP | -12.525, 27.840 | 250m |
| DUMP-2 | DUMP | -12.475, 27.870 | 250m |
| STCK-1 | STOCKPILE | -12.515, 27.862 | 200m |
| PARK-1 | PARKING | -12.505, 27.848 | 150m |
| FUEL-1 | FUEL_STATION | -12.508, 27.842 | 100m |
| SCALE-1 | SCALE | -12.507, 27.850 | 100m |

### Endpoint d'ingestion

```http
POST /api/v1/telemetry/live
Authorization: Bearer <JWT_utilisateur>
Content-Type: application/json

{
  "fleetNumber":   "TK-007",
  "lat":           -12.4923,
  "lon":           27.8412,
  "speed_kmh":     34.5,
  "heading":       127,
  "payload_kg":    195000,
  "fuelLevel_pct": 68,
  "engineRunning": true
}
```

**Réponse :**
```json
{
  "ok": true,
  "fleetNumber": "TK-007",
  "inferredPhase": "HAULING",
  "isNew": false,
  "ts": "2026-06-29T09:14:32.000Z"
}
```

**Validations appliquées (Zod + backend) :**
- `fleetNumber` : alphanumérique avec tirets, max 20 cars
- `lat` / `lon` : restreints à la zone mine ±0.5° (≈ 55 km)
- `speed_kmh` : 0–120 (CAT 793 max 67 km/h en descente)
- `payload_kg` : 0–300 000 (CAT 793 max 227 t)
- `fleetNumber` doit exister en DB (anti-spoofing, sauf ADMIN)

**Rate limiting dédié :** 720 requêtes/min par paire `IP:fleetNumber` (≈ 50 engins × 1 trame/5s × 1.2 tolérance)

### Endpoint de statut

```http
GET /api/v1/telemetry/live/status
Authorization: Bearer <JWT>
```

```json
{
  "liveCount": 3,
  "trucks": [
    { "fleetNumber": "TK-007", "phase": "HAULING", "lastSeen_s": 3, "lat": -12.4923, "lon": 27.8412 },
    { "fleetNumber": "TK-012", "phase": "LOADING", "lastSeen_s": 1, "lat": -12.490,  "lon": 27.840  },
    { "fleetNumber": "TK-003", "phase": "IDLE",    "lastSeen_s": 8, "lat": -12.505,  "lon": 27.848  }
  ]
}
```

### Anciennes méthodes d'intégration (maintenues pour GPS boîtiers)

#### GPS boîtier embarqué — toutes les 5 secondes (méthode classique)
```http
POST /api/v1/gps/positions
Authorization: Bearer <token_du_camion>
Content-Type: application/json
{
  "equipment_id": "uuid-du-camion",
  "latitude": -12.5023, "longitude": 27.8549,
  "speed_kmh": 32.5, "heading": 127,
  "altitude_m": 1240, "accuracy_m": 2.1, "source": "GPS"
}
```

#### Télémétrie moteur PLC/SCADA — toutes les 30 secondes
```http
POST /api/v1/telemetry/{equipment_id}
Authorization: Bearer <token_du_camion>
{ "engine_temp_c": 87.3, "engine_rpm": 1850, "fuel_level_pct": 68.4, ... }
```

> Pour Modbus TCP ou OPC-UA : script passerelle Python/Node.js qui lit le bus et poste à l'API. Moins de 80 lignes.

### Checklist d'intégration progressive

```
□ Phase 1 — Simulation seule (état initial)
  □ Simulation démarrée sur la page /simulation
  □ Tous les KPIs visibles en temps réel

□ Phase 2 — Premiers engins physiques (mode hybride)
  □ Compte utilisateur créé pour le chauffeur (OPERATOR)
  □ Lien DriverApp généré dans IntegrationHub → onglet Chauffeurs
  □ Lien ouvert sur le téléphone du chauffeur
  □ Badge ● LIVE visible sur l'engin dans la vue 3D
  □ Sidebar : badge vert sur "Intégration GPS"

□ Phase 3 — Passage complet au terrain
  □ Tous les engins connectés (DriverApp ou boîtier GPS)
  □ Simulation arrêtée (Page Simulation → Arrêter)
  □ ALLOWED_ORIGINS mis à jour avec l'IP réseau OT
  □ Sauvegardes automatiques configurées (voir Section 14)
```

---

## 12. IntegrationHub & DriverApp — intégration physique

### Vue d'ensemble

L'intégration physique ne requiert **aucune installation matérielle initiale**. Un smartphone Android ou iOS dans la cabine du camion suffit pour démarrer la phase hybride. Le matériel spécialisé (boîtier GPS Teltonika, OBD-II...) peut être ajouté progressivement.

```
Chemin minimal : Téléphone chauffeur → navigateur → /driver → GPS navigateur → API FMS
Chemin optimal : Boîtier GPS Teltonika FMB920 → SIM 4G → POST /telemetry/live → API FMS
```

### Page IntegrationHub (`/integration`)

Accessible via la sidebar "Intégration GPS" (icône GPS, badge vert si des engins sont en direct). Rôles autorisés : **ADMIN**, **DISPATCHER**.

#### Onglet 1 — Engins & statut

Tableau de tous les engins du site avec :
- **Badge ● LIVE / ◌ SIM** par engin
- Dernière trame reçue (il y a Xs)
- Coordonnées GPS actuelles
- Bouton "Trame test" : envoie une trame fictive pour valider la connexion
- Lien "Ouvrir l'app chauffeur" par engin

#### Onglet 2 — App chauffeur

Pour chaque camion :
- **URL unique** à envoyer au chauffeur (format `/driver?truck=TK-007`)
- Bouton copier (va dans le presse-papiers)
- Bouton ouvrir dans un nouvel onglet (pour tester)

**Guide de déploiement en 5 étapes affiché dans l'interface :**
1. Copier le lien du camion
2. Envoyer par WhatsApp/SMS au chauffeur
3. Le chauffeur ouvre le lien dans Chrome
4. Appuyer sur "Démarrer le tracking GPS"
5. L'engin passe de ◌ SIM à ● LIVE dans la vue 3D

#### Onglet 3 — Hardware

Documentation technique pour les équipes IT :
- Endpoint et format JSON complet
- Configuration Teltonika FMB920 (codec, APN, période d'envoi)
- Comparatif des 3 options matérielles (téléphone, OBD-II, boîtier GPS)
- Exemple curl pour test depuis terminal

### Page DriverApp (`/driver`)

Route publique (pas de login requis) — accessible directement par le chauffeur.

**Sécurité du token :**
- Le JWT reçu en paramètre `?token=...` est immédiatement déplacé dans `sessionStorage` et l'URL est nettoyée (token retiré de l'historique navigateur et des logs serveur)
- Le token n'apparaît jamais dans les logs Nginx ou Apache
- Validité limitée à la session navigateur

**Fonctionnalités :**

| Fonctionnalité | Détail |
|---|---|
| **GPS précis** | `navigator.geolocation.watchPosition` — haute précision |
| **Wake Lock** | Écran allumé en permanence (API Wake Lock) |
| **Offline queue** | Trames accumulées hors réseau, renvoyées au retour 4G |
| **Indicateur précision** | ±Xm — vert < 15m, orange < 50m, rouge > 50m |
| **Charge / carburant** | Sliders mis à jour par le chauffeur |
| **Phase affichée** | Retour visuel immédiat de l'activité détectée par le FMS |
| **Sécurité visuelle** | "Données visibles uniquement par le dispatcher" |

**Fréquence d'envoi :** 1 trame GPS toutes les 5 secondes.

**URL de la page :** `http://[IP_SERVEUR]:5173/driver?truck=TK-007`  
*(le token est ajouté automatiquement par IntegrationHub lors de la génération du lien)*

---

## 13. Vue 3D Mine — fonctionnement technique

### Architecture du rendu (Mine3DView)

```
frontend/src/components/mining/Mine3DView.tsx
```

Rendu Three.js (WebGL) intégré dans une `<div>` React via `useRef`. La caméra est une `PerspectiveCamera` en vue isométrique inclinée, contrôlée par drag-souris.

### Modèle 3D CAT 793 (procédural)

Chaque engin est construit programmatiquement (pas de fichier .gltf) :

```
Groupe principal (groupe.userData.fleetNumber)
├── Châssis (BoxGeometry)
├── Moteur-capot (BoxGeometry)
├── Cabine (BoxGeometry + fenêtres)
├── Benne (bedPivot → BoxGeometry animable)
├── 6 roues (CylinderGeometry × 6)
├── Gyrophare (SphereGeometry + animation clignotant)
├── Hitbox invisible (SphereGeometry r=0.12 — zone de clic)
└── Anneau de sélection (RingGeometry — visible si sélectionné)
```

### Orientation heading

Formule validée mathématiquement :
```
group.rotation.y = -(heading + 90) * π / 180
```

| Heading | Rotation Y | Direction |
|---|---|---|
| 0° (Nord) | -π/2 | ← Nord ✓ |
| 90° (Est) | -π | ↑ Est ✓ |
| 180° (Sud) | -3π/2 = π/2 | → Sud ✓ |
| 270° (Ouest) | -2π = 0 | ↓ Ouest ✓ |

### Séparation en voies (lane offset)

Les camions circulant dans les deux sens sont décalés de 28m à droite de leur trajectoire :

```typescript
const H_rad = truck.heading * Math.PI / 180;
const LANE  = 0.028; // 28m en unités scène (1 unit = 1 km)
const laneX = Math.cos(H_rad) * LANE;
const laneZ = Math.sin(H_rad) * LANE;
```

### Interaction (panneau d'action)

**Raycasting récursif :** `raycaster.intersectObjects(groups, true)` — remonte au groupe parent via `userData.fleetNumber`.

**Panneau d'action** : positionné en `position: absolute; right: 8; top: 8` — jamais de coordonnées écran (évite le gel après rotation caméra).

**Sous-formulaires inline :**
- `assign` → `POST /dispatch/manual-assign` (choix pelle + destination)
- `message` → `POST /messages` (message texte + priorité)
- `stop` → `POST /messages` (message URGENT "ARRÊT IMMÉDIAT")

### Réseau routier

Routes droites (`LineCurve3`) — largeur haul = 0.110, service = 0.075. Lignes blanches centrales sur les voies de transport. Réseau non-hub pour éviter les croisements parasites à PARK-1.

---

## 14. Déploiement réseau LAN

### Topologie recommandée

```
Réseau LAN mine (192.168.1.0/24)
                                                              
  Serveur FMS           Poste dispatch         GPS camions
  192.168.1.10          192.168.1.20–30        192.168.1.100–150
  ┌────────────┐         ┌──────────────┐       ┌──────────────┐
  │ Node.js    │◄───────►│ Navigateur   │       │ Boîtier GPS  │
  │ Port 4000  │         │ Chrome/Edge  │       │ (REST client)│──►
  │ PostgreSQL │         └──────────────┘       └──────────────┘
  └────────────┘
  
  Salle de contrôle     Terrain               PLC/SCADA
  (dispatchers)         (géologues → BNR)     (moteurs)
```

### Configuration Nginx (reverse proxy de production)

```nginx
# /etc/nginx/sites-available/fms-mining
server {
    listen 80;
    server_name 192.168.1.10;

    # Frontend React (build statique)
    location / {
        root /var/www/fms-mining/frontend/dist;
        try_files $uri $uri/ /index.html;
        # Cache les assets buildés (hash dans le nom de fichier)
        location ~* \.(js|css|png|jpg|svg|ico)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }

    # API REST Backend
    location /api/ {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # WebSocket Socket.io (upgrade HTTP → WS)
    location /socket.io/ {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
    }
}
```

### Démarrage production avec PM2

```bash
# Build frontend (une fois, puis à chaque mise à jour)
cd mining/frontend
npm run build                    # génère frontend/dist/

# Build backend
cd mining/backend
npm run build                    # génère backend/dist/server.js

# Démarrer avec PM2
npm install -g pm2
pm2 start backend/dist/server.js \
    --name "fms-mining-api" \
    --env production \
    --max-memory-restart 512M    # redémarrage si fuite mémoire

pm2 startup    # démarrage automatique au reboot serveur
pm2 save       # sauvegarde la configuration PM2

# Vérifier
pm2 status
pm2 logs fms-mining-api --lines 50
```

### Sauvegardes PostgreSQL automatiques

```bash
# Éditer la crontab : crontab -e

# Sauvegarde quotidienne à 2h du matin
0 2 * * * pg_dump -U fms_user fms_mining | \
          gzip > /backups/fms_$(date +\%Y\%m\%d).sql.gz

# Nettoyer les sauvegardes de plus de 30 jours
0 3 * * * find /backups/ -name "fms_*.sql.gz" -mtime +30 -delete

# Restauration (si besoin) :
# gunzip -c /backups/fms_20260624.sql.gz | psql -U fms_user fms_mining
```

---

## 15. Guide de mise à jour et évolution

### Ajouter un nouveau type de capteur physique

```
1. database/     → Nouvelle table dans 08_ ou créer 09_nouveaucapteur.sql
2. services/     → Nouveau fichier backend/src/services/sensors/NouveauCapteur.ts
                   (copier BNRSensor.ts comme base — même pattern singleton)
3. controllers/  → Nouveaux endpoints dans simulation.controller.ts
                   (ou nouveau controller si le scope est large)
4. routes/       → Câbler dans backend/src/routes/index.ts
5. lib/api.ts    → Ajouter helpers dans le frontend
6. pages/        → Enrichir Simulation.tsx ou créer une nouvelle page
```

### Ajouter un équipement physique

```sql
-- 1. Vérifier que le type d'équipement existe
SELECT type_id, category, model FROM core.equipment_type;

-- 2. Insérer l'équipement
INSERT INTO core.equipment
  (site_id, type_id, fleet_number, serial_number, status, purchase_date)
VALUES
  ('uuid-site', 'uuid-type', 'DRILL-01', 'SN-CAT-MD6310-001', 'AVAILABLE', '2024-03-15');

-- 3. Créer les localisations nécessaires (si nouvelles positions)
INSERT INTO core.location (site_id, name, location_type, lat, lon)
VALUES ('uuid-site', 'Forage Zone Nord', 'DRILLING', -12.498, 27.862);
```

### Modifier les seuils de maintenance prédictive

Fichier `backend/src/services/ai/PredictiveMaintenance.ts` :

```typescript
// Section THRESHOLDS (vers le début du fichier)
const THRESHOLDS = {
  ENGINE: {
    temp_c:   { warning: 95,  critical: 105 },  // ← ajuster selon modèle moteur
    oil_pres: { warning: 3.0, critical: 2.0, invert: true },
  },
  HYDRAULICS: {
    temp_c:   { warning: 75,  critical: 90 },
  },
  BRAKES: {
    temp_c:   { warning: 150, critical: 250 },  // ← ajuster selon type de freins
  },
};
```

Puis : `pm2 restart fms-mining-api` (redémarrage à chaud, < 2 secondes)

### Ajouter un nouveau rôle utilisateur

```
1. database/     → Modifier la contrainte CHECK sur core.user_account.role
   ALTER TABLE core.user_account DROP CONSTRAINT ...;
   ALTER TABLE core.user_account ADD CONSTRAINT ...
     CHECK (role IN ('ADMIN','DISPATCHER','VIEWER','OPERATOR','SAFETY_OFFICER'));

2. middleware/auth.ts → Ajouter le rôle dans les commentaires (optionnel)

3. routes/index.ts   → Ajouter le nouveau rôle aux routes concernées :
   const SAFETY = ['ADMIN', 'SAFETY_OFFICER'];
   router.get('/sensors/bnr', authenticate, authorize(...SAFETY), getBNRSummary);

4. hooks/useRole.ts  → Ajouter les vérifications côté frontend
```

### Convention de mise à jour de cette documentation

```
# En-tête à ajouter pour chaque mise à jour majeure :
> **Mis à jour le** : YYYY-MM-DD — Description concise du changement

# Numérotation des nouvelles sections :
Section 15, 16, 17… (ne pas renuméroter les sections existantes)

# Nouveau module IA :
Ajouter une sous-section 7.6, 7.7… dans la Section 7

# Nouveau déploiement ou infrastructure :
Mettre à jour la Section 12 en place
```

---

## 16. Glossaire minier

| Terme | Définition dans le contexte FMS Mining |
|---|---|
| **Open-pit** | Mine à ciel ouvert, exploitation en gradins de haut en bas |
| **Haul truck** | Camion de transport minier (CAT 793 = 220 t de charge utile) |
| **Loader / Excavator** | Pelle mécanique ou chargeuse qui remplit les camions |
| **Haul cycle** | Cycle complet : chargement → transport chargé → déversement → retour à vide |
| **Payload** | Charge nette transportée par le camion (en tonnes métriques) |
| **Dump** | Zone de déversement du matériau extrait (stérile ou minerai) |
| **Dispatcher** | Contrôleur de flotte qui affecte les camions aux pelles en temps réel |
| **MA** | Mechanical Availability — heures opérationnelles / heures total (%) |
| **PA** | Physical Availability — (total − maintenance) / total (%) |
| **TKPH** | Tonnes-Kilomètres Par Heure — indicateur d'effort des pneus miniers |
| **BNR** | Borehole Nuclear Resistivity — sonde géophysique en fond de forage |
| **Blast zone** | Zone de tir à l'explosif — évacuation obligatoire des camions |
| **RUL** | Remaining Useful Life — durée de vie utile restante d'un composant |
| **OBD** | On-Board Diagnostics — port de diagnostic embarqué sur l'équipement |
| **PLC** | Programmable Logic Controller — automate industriel lisant les capteurs |
| **SCADA** | Supervisory Control And Data Acquisition — supervision industrielle |
| **OPC-UA** | Protocole standard industrie 4.0 (communication SCADA ↔ logiciel) |
| **Modbus TCP** | Protocole industriel pour capteurs BNR, PLC (couche réseau TCP) |
| **LAN OT** | Réseau local Operational Technology — réseau des équipements de terrain |
| **Singleton** | Patron de conception : une seule instance du service en mémoire Node.js |
| **Partitionnement** | Découpage PostgreSQL d'une grande table en sous-tables par période |
| **RBAC** | Role-Based Access Control — permissions par rôle utilisateur |
| **TOTP** | Time-based One-Time Password — code MFA à 6 chiffres renouvelé toutes les 30s |

---

## 17. Historique des corrections (Changelog)

### v1.2.0 — 2026-06-29 : Mode hybride GPS + sécurité + ergonomie 3D

#### Nouvelles fonctionnalités
- **LiveTelemetryService** : ingestion GPS temps réel avec inférence de phase par géofencing (10 zones, machine à états)
- **Endpoint `/telemetry/live`** : endpoint unifié avec validation Zod + géofence + anti-spoofing
- **IntegrationHub** (`/integration`) : interface d'intégration matérielle en 3 onglets (statut flotte, liens chauffeurs, hardware)
- **DriverApp** (`/driver`) : application mobile chauffeur (GPS navigateur, Wake Lock, offline queue)
- **Mode hybride** : `getSimStatus` fusionne engins réels (TTL 30s) et simulés — badge ● LIVE / ◌ SIM
- **Sidebar badge** : compteur d'engins LIVE en temps réel sur l'entrée "Intégration GPS"

#### Correctifs 3D (Mine3DView)
- Heading corrigé (+90° au lieu de -90°) — trucks face maintenant le bon cap
- Hitbox invisible (SphereGeometry r=0.12) — zone de clic ×8 plus grande
- Panneau d'action fixe (top-right) — plus de gel après rotation caméra
- Offset de voie (28m) — séparation aller/retour sur chaque route
- Routes droites (LineCurve3) — suppression des croisements parasites à PARK-1

#### Sécurité
- Token JWT retiré de l'URL (DriverApp) — stocké en `sessionStorage`, URL nettoyée
- Rate limiter dédié `/telemetry/live` (720/min par IP:fleetNumber)
- Validation Zod complète du body live + vérification fleetNumber en DB
- Restriction coordonnées GPS à la zone mine (±0.5°)

#### Ergonomie
- `IconGps` dans sidebar (remplace `IconSettings` ambigu)
- Indicateur précision GPS (±Xm) dans DriverApp
- Affichage phase avec icône + couleur dans DriverApp
- File offline : trames accumulées offline renvoyées au retour réseau
- Rate limit simulation : 300 req/min (polling haute fréquence OK)

---

### v1.0.1 — 2026-06-24 : Correctifs modules 2, 3 et 5

#### Module 2 — Route Dijkstra (distance = 0)
**Cause** : le contrôleur retournait directement la réponse du service (`totalDistanceKm`, `estimatedMinutes`) sans la normaliser vers le format du frontend (`distanceKm`, `travelMin`).  
**Fix** : `ai.controller.ts` — fonction `normalize()` qui adapte les champs + fonction `buildSegments()` pour les détails de route.

**Cause 2** : le formul frontend utilisait `/locations` (toutes les 10 locations du site) au lieu des nœuds du graphe routier (seulement 6 locations connectées par des routes).  
**Fix** : `AIPredictions.tsx` — `loadLocations()` charge désormais `/ai/route-graph/stats?siteId=…` et utilise `nodeList`. `RouteOptimizer.getGraphStats()` expose maintenant `nodeList`.

**Cause 3** : `/ai/route-graph/stats` ne construisait pas le graphe si vide.  
**Fix** : `ai.controller.ts:getGraphStats()` — auto-build si `nodes === 0`.

#### Module 3 — Dispatch hongrois (0 affectations)
**Cause** : `DT-201` (seul camion AVAILABLE) avait `active = FALSE` dans les données initiales.  
**Fix** : `UPDATE core.equipment SET active = TRUE WHERE fleet_number = 'DT-201'`.

#### Module 5 — Simulation (1 seul camion chargé)
**Cause** : le moteur de simulation ne chargeait que les camions avec `status IN ('AVAILABLE', 'IDLE', 'STANDBY')`. Après démarrage, les données initiales placent les camions en statuts opérationnels (HAULING, LOADING, etc.).  
**Fix** : `SimulationEngine.loadSiteData()` — exécute un `UPDATE` pour remettre les camions opérationnels en AVAILABLE avant de les charger (les camions DOWN et MAINTENANCE sont préservés).  
**Résultat** : 9 camions chargés au lieu de 1 (DT-107 DOWN et DT-108 MAINTENANCE exclus correctement).

---

## Compteurs du projet

| Métrique | v1.0.1 | v1.2.0 |
|---|---|---|
| Lignes SQL (schémas + migrations) | ~2 065 | ~2 065 |
| Lignes TypeScript backend | ~7 934 | ~8 250 |
| Lignes TypeScript frontend | ~8 127 | ~8 900 |
| **Total lignes de code** | **~18 126** | **~19 215** |
| Endpoints API REST | 98 | 100 |
| Événements Socket.io | 12 | 12 |
| Tables PostgreSQL | 34 | 34 |
| Vues PostgreSQL | 8 | 8 |
| Pages React | 16 | 18 |
| Services backend | 7 | 8 |
| Modules IA | 5 | 5 |

---

*Document vivant — à maintenir au fil des évolutions.*  
*Pour toute question technique : référencer le numéro de section et le fichier concerné.*
