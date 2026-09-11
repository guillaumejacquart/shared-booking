#!/bin/sh
# Déploie shared-booking sur le VPS : copie le compose puis (re)lance la stack.
#   ./deploy/deploy.sh
set -e

HOST="${VPS_HOST:-vps.guillaumejacquart.com}"
USER="${VPS_USER:-ubuntu}"
REMOTE_FILE="/home/ubuntu/docker/services/shared-booking.yml"
COMPOSE_DIR="/home/ubuntu/docker"

# Chemin du compose local, indépendant du dossier d'appel.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCAL_FILE="$SCRIPT_DIR/../docker-compose.yml"

echo "→ Copie de docker-compose.yml vers $USER@$HOST:$REMOTE_FILE"
scp "$LOCAL_FILE" "$USER@$HOST:$REMOTE_FILE"

echo "→ ./compose.sh pull shared-booking"
ssh "$USER@$HOST" "cd $COMPOSE_DIR && ./compose.sh pull shared-booking"

echo "→ ./compose.sh up -d dans $COMPOSE_DIR"
ssh "$USER@$HOST" "cd $COMPOSE_DIR && ./compose.sh up -d shared-booking"

echo "✓ Déploiement terminé."
