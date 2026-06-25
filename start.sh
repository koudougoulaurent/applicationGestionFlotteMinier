#!/usr/bin/env bash
# ============================================================
# FMS Mining — Script de démarrage
# Déploiement : LAN local (Option A)
#
# Usage:
#   ./start.sh              → lance le serveur en production
#   ./start.sh dev          → lance en mode développement (hot-reload)
#   ./start.sh build        → build backend + frontend
#   ./start.sh db           → initialise la base de données
#   ./start.sh db reset     → RESET complet de la base (données perdues)
#   ./start.sh status       → état des services
#   ./start.sh stop         → arrête le backend
# ============================================================
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

BACKEND_DIR="$(cd "$(dirname "$0")/backend" && pwd)"
FRONTEND_DIR="$(cd "$(dirname "$0")/frontend" && pwd)"
DB_DIR="$(cd "$(dirname "$0")/database" && pwd)"
PID_FILE="/tmp/fms_mining_backend.pid"
LOG_FILE="/tmp/fms_mining.log"

header() {
  echo -e "${BLUE}"
  echo "  ███████╗███╗   ███╗███████╗    ███╗   ███╗██╗███╗   ██╗██╗███╗   ██╗  ██████╗ "
  echo "  ██╔════╝████╗ ████║██╔════╝    ████╗ ████║██║████╗  ██║██║████╗  ██║ ██╔════╝ "
  echo "  █████╗  ██╔████╔██║███████╗    ██╔████╔██║██║██╔██╗ ██║██║██╔██╗ ██║ ██║  ███╗"
  echo "  ██╔══╝  ██║╚██╔╝██║╚════██║    ██║╚██╔╝██║██║██║╚██╗██║██║██║╚██╗██║ ██║   ██║"
  echo "  ██║     ██║ ╚═╝ ██║███████║    ██║ ╚═╝ ██║██║██║ ╚████║██║██║ ╚████║ ╚██████╔╝"
  echo "  ╚═╝     ╚═╝     ╚═╝╚══════╝    ╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚═╝╚═╝  ╚═══╝  ╚═════╝ "
  echo -e "${NC}"
  echo -e "${YELLOW}  Fleet Management System — Mine à Ciel Ouvert${NC}"
  echo ""
}

check_postgres() {
  if ! command -v psql &>/dev/null; then
    echo -e "${RED}✗ PostgreSQL introuvable. Installez PostgreSQL 14+.${NC}"
    exit 1
  fi
  if ! PGPASSWORD=fms_secure_pass_2024 psql -h localhost -U fms_user -d fms_mining -c "SELECT 1" &>/dev/null; then
    echo -e "${RED}✗ Connexion PostgreSQL échouée.${NC}"
    echo "  Vérifiez que PostgreSQL est démarré et que la base fms_mining existe."
    echo "  → ./start.sh db    pour initialiser la base"
    exit 1
  fi
  echo -e "${GREEN}  ✓ PostgreSQL connecté${NC}"
}

check_node() {
  if ! command -v node &>/dev/null; then
    echo -e "${RED}✗ Node.js introuvable. Installez Node.js 18+.${NC}"
    exit 1
  fi
  NODE_VER=$(node -e "process.stdout.write(process.versions.node)")
  echo -e "${GREEN}  ✓ Node.js ${NODE_VER}${NC}"
}

get_lan_ip() {
  # macOS
  if command -v ipconfig &>/dev/null; then
    ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "localhost"
    return
  fi
  # Linux
  hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost"
}

MODE=${1:-local}

header

# ── MODE LOCAL (production LAN) ───────────────────────────────────────────────
if [ "$MODE" = "local" ]; then
  echo -e "${BLUE}▶ Démarrage en mode production LAN...${NC}"
  echo ""

  check_node
  check_postgres

  # Vérifier que le build existe
  if [ ! -f "$BACKEND_DIR/dist/server.js" ]; then
    echo -e "${YELLOW}  Build backend manquant — compilation...${NC}"
    cd "$BACKEND_DIR" && npm run build
    echo ""
  fi

  if [ ! -d "$FRONTEND_DIR/dist" ]; then
    echo -e "${YELLOW}  Build frontend manquant — compilation...${NC}"
    cd "$FRONTEND_DIR" && npm run build
    echo ""
  fi

  # Vérifier si déjà en cours
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo -e "${YELLOW}  Backend déjà en cours (PID $(cat "$PID_FILE"))${NC}"
    echo "  → ./start.sh stop    pour arrêter"
    echo "  → ./start.sh status  pour l'état"
    exit 0
  fi

  # Démarrer le backend
  cd "$BACKEND_DIR"
  NODE_ENV=production node dist/server.js > "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  sleep 2

  # Vérifier que le serveur a démarré
  if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo -e "${RED}✗ Le serveur n'a pas démarré. Vérifiez les logs :${NC}"
    echo "  cat $LOG_FILE"
    exit 1
  fi

  LAN_IP=$(get_lan_ip)

  echo ""
  echo -e "${GREEN}✅ FMS Mining démarré !${NC}"
  echo ""
  echo "  ┌─────────────────────────────────────────────────┐"
  echo "  │  Accès local :  http://localhost:4000           │"
  echo "  │  Accès LAN   :  http://${LAN_IP}:4000          │"
  echo "  │                                                 │"
  echo "  │  Login : admin / Admin@Mine2024                 │"
  echo "  │  Login : dispatcher / Dispatch@2024             │"
  echo "  └─────────────────────────────────────────────────┘"
  echo ""
  echo "  Logs : tail -f $LOG_FILE"
  echo "  Stop : ./start.sh stop"
  echo ""
  echo "  Note : pour servir le frontend, configurez nginx"
  echo "  avec le fichier frontend/nginx.conf"

# ── MODE DEV ──────────────────────────────────────────────────────────────────
elif [ "$MODE" = "dev" ]; then
  echo -e "${BLUE}▶ Démarrage en mode développement...${NC}"
  echo ""

  check_node
  check_postgres

  # Installer les dépendances si nécessaire
  [ ! -d "$BACKEND_DIR/node_modules" ]  && (cd "$BACKEND_DIR"  && npm install)
  [ ! -d "$FRONTEND_DIR/node_modules" ] && (cd "$FRONTEND_DIR" && npm install)

  LAN_IP=$(get_lan_ip)

  echo ""
  echo -e "${GREEN}▶ Lancement backend + frontend...${NC}"
  echo ""

  cd "$BACKEND_DIR" && npm run dev > "$LOG_FILE" 2>&1 &
  BACKEND_PID=$!

  cd "$FRONTEND_DIR" && npm run dev &
  FRONTEND_PID=$!

  sleep 3

  echo -e "${GREEN}✅ Serveurs de développement démarrés !${NC}"
  echo ""
  echo "  Frontend :  http://localhost:5173  (hot-reload React)"
  echo "  LAN      :  http://${LAN_IP}:5173"
  echo "  Backend  :  http://localhost:4000"
  echo ""
  echo "  Login : admin / Admin@Mine2024"
  echo ""
  echo "  Ctrl+C pour arrêter"

  trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; echo ''; echo 'Serveurs arrêtés.'" EXIT INT
  wait

# ── MODE BUILD ────────────────────────────────────────────────────────────────
elif [ "$MODE" = "build" ]; then
  echo -e "${BLUE}▶ Compilation backend + frontend...${NC}"
  echo ""

  check_node

  echo "  Compilation backend TypeScript..."
  cd "$BACKEND_DIR" && npm run build
  echo -e "${GREEN}  ✓ Backend compilé → backend/dist/${NC}"

  echo "  Compilation frontend React..."
  cd "$FRONTEND_DIR" && npm run build
  echo -e "${GREEN}  ✓ Frontend compilé → frontend/dist/${NC}"

  echo ""
  echo -e "${GREEN}✅ Build terminé. Lancez avec : ./start.sh local${NC}"

# ── MODE DB ───────────────────────────────────────────────────────────────────
elif [ "$MODE" = "db" ]; then
  SUBMODE=${2:-init}

  if [ "$SUBMODE" = "reset" ]; then
    echo -e "${RED}⚠ RESET COMPLET de la base de données !${NC}"
    echo -e "${RED}  Toutes les données seront supprimées.${NC}"
    echo ""
    read -p "  Confirmer ? (oui/non) : " CONFIRM
    if [ "$CONFIRM" != "oui" ]; then
      echo "  Annulé."
      exit 0
    fi
    echo ""
    echo -e "${BLUE}▶ Suppression et recréation de la base...${NC}"
    PGPASSWORD=fms_secure_pass_2024 psql -h localhost -U fms_user -d postgres -c "
      DROP DATABASE IF EXISTS fms_mining;
      CREATE DATABASE fms_mining OWNER fms_user;
    "
    echo -e "${GREEN}  ✓ Base recréée${NC}"
  fi

  echo -e "${BLUE}▶ Chargement du schéma et des données...${NC}"

  for SQL_FILE in \
    "$DB_DIR/01_schema.sql" \
    "$DB_DIR/02_indexes.sql" \
    "$DB_DIR/03_views.sql" \
    "$DB_DIR/04_seed.sql" \
    "$DB_DIR/05_security.sql" \
    "$DB_DIR/06_security.sql" \
    "$DB_DIR/07_alterations.sql"
  do
    if [ -f "$SQL_FILE" ]; then
      echo "  → $(basename "$SQL_FILE")"
      PGPASSWORD=fms_secure_pass_2024 psql -h localhost -U fms_user -d fms_mining \
        -f "$SQL_FILE" -q
    fi
  done

  echo ""
  echo -e "${GREEN}✅ Base de données prête !${NC}"
  echo ""
  echo "  Comptes disponibles :"
  echo "    admin      / Admin@Mine2024"
  echo "    dispatcher / Dispatch@2024"

# ── MODE STATUS ───────────────────────────────────────────────────────────────
elif [ "$MODE" = "status" ]; then
  echo -e "${BLUE}▶ État des services${NC}"
  echo ""

  # PostgreSQL
  if PGPASSWORD=fms_secure_pass_2024 psql -h localhost -U fms_user -d fms_mining -c "SELECT 1" &>/dev/null; then
    EQUIP_COUNT=$(PGPASSWORD=fms_secure_pass_2024 psql -h localhost -U fms_user -d fms_mining -tAc "SELECT COUNT(*) FROM core.equipment WHERE active = TRUE")
    echo -e "  PostgreSQL   ${GREEN}✓ connecté${NC} — ${EQUIP_COUNT} équipements actifs"
  else
    echo -e "  PostgreSQL   ${RED}✗ non connecté${NC}"
  fi

  # Backend
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    PID=$(cat "$PID_FILE")
    echo -e "  Backend      ${GREEN}✓ en cours${NC} (PID ${PID})"
    # Test rapide de l'API
    if curl -s --max-time 2 http://localhost:4000/health &>/dev/null; then
      echo -e "  API Health   ${GREEN}✓ répond${NC}"
    else
      echo -e "  API Health   ${YELLOW}⚠ ne répond pas encore${NC}"
    fi
  else
    echo -e "  Backend      ${RED}✗ arrêté${NC}"
  fi

  # Frontend build
  if [ -d "$FRONTEND_DIR/dist" ]; then
    BUILD_DATE=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M" "$FRONTEND_DIR/dist/index.html" 2>/dev/null || \
                 stat -c "%y" "$FRONTEND_DIR/dist/index.html" 2>/dev/null | cut -c1-16)
    echo -e "  Frontend     ${GREEN}✓ buildé${NC} (${BUILD_DATE})"
  else
    echo -e "  Frontend     ${YELLOW}⚠ pas de build${NC} — ./start.sh build"
  fi

  echo ""
  LAN_IP=$(get_lan_ip)
  echo "  Accès : http://${LAN_IP}:4000"

# ── MODE STOP ─────────────────────────────────────────────────────────────────
elif [ "$MODE" = "stop" ]; then
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    PID=$(cat "$PID_FILE")
    kill "$PID"
    rm -f "$PID_FILE"
    echo -e "${GREEN}✓ Backend arrêté (PID ${PID})${NC}"
  else
    echo -e "${YELLOW}Backend non en cours.${NC}"
    # Fallback : tuer par nom
    pkill -f "node dist/server.js" 2>/dev/null && echo -e "${GREEN}✓ Processus arrêté.${NC}" || true
  fi

else
  echo "Usage : ./start.sh [commande]"
  echo ""
  echo "  (aucune)    Démarrer en production LAN"
  echo "  dev         Démarrer en développement (hot-reload)"
  echo "  build       Compiler backend + frontend"
  echo "  db          Initialiser la base de données"
  echo "  db reset    Reset complet de la base (⚠ données supprimées)"
  echo "  status      État des services"
  echo "  stop        Arrêter le backend"
fi
