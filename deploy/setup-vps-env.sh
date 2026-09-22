#!/bin/sh
# Crée/met à jour le .env prod sur le VPS, sans commiter de secrets.
# Usage:
#   BETTER_AUTH_SECRET=$(openssl rand -base64 48) \
#   SMTP_USER=xxx SMTP_PASS=yyy \
#   STRIPE_SECRET_KEY=sk_live_... STRIPE_WEBHOOK_SECRET=whsec_... \
#   R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
#   ./deploy/setup-vps-env.sh
set -e

HOST="${VPS_HOST:-vps.guillaumejacquart.com}"
USER="${VPS_USER:-ubuntu}"
REMOTE_ENV="/home/ubuntu/docker/services/shared-booking.env"

# Génère un secret si absent (auth sessions).
if [ -z "$BETTER_AUTH_SECRET" ]; then
  BETTER_AUTH_SECRET="$(openssl rand -base64 48)"
  echo "→ BETTER_AUTH_SECRET généré (pense à le garder dans ton vault)"
fi

# Valeurs non-secrètes avec défauts prod.
: "${BETTER_AUTH_URL:=https://shared-booking.guillaumejacquart.com}"
: "${SMTP_HOST:=in-v3.mailjet.com}"
: "${SMTP_PORT:=587}"
: "${EMAIL_FROM:=dev@guillaumejacquart.com}"
: "${R2_BUCKET:=shared-booking-backups}"
: "${R2_PREFIX:=sqlite}"
: "${BACKUP_SCHEDULE:=0 3 * * *}"
: "${BACKUP_TIMEZONE:=Europe/Paris}"
: "${BACKUP_KEEP_LOCAL:=7}"
: "${BACKUP_ON_STARTUP:=false}"
: "${BACKUP_ENABLED:=true}"

# Champs requis : SMTP + secret auth. Stripe/R2 peuvent rester vides (désactivés).
missing=""
[ -z "$SMTP_USER" ] && missing="$missing SMTP_USER"
[ -z "$SMTP_PASS" ] && missing="$missing SMTP_PASS"
if [ -n "$missing" ]; then
  echo "✗ Variables manquantes:$missing"
  echo "  Exemple: SMTP_USER=xxx SMTP_PASS=yyy ./deploy/setup-vps-env.sh"
  exit 1
fi

echo "→ Envoi du .env vers $USER@$HOST:$REMOTE_ENV"
{
  echo "BETTER_AUTH_SECRET=$BETTER_AUTH_SECRET"
  echo "BETTER_AUTH_URL=$BETTER_AUTH_URL"
  echo "SMTP_HOST=$SMTP_HOST"
  echo "SMTP_PORT=$SMTP_PORT"
  echo "SMTP_USER=$SMTP_USER"
  echo "SMTP_PASS=$SMTP_PASS"
  echo "EMAIL_FROM=$EMAIL_FROM"
  echo "STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY:-}"
  echo "STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET:-}"
  echo "R2_ENDPOINT=${R2_ENDPOINT:-}"
  echo "R2_ACCESS_KEY_ID=${R2_ACCESS_KEY_ID:-}"
  echo "R2_SECRET_ACCESS_KEY=${R2_SECRET_ACCESS_KEY:-}"
  echo "R2_BUCKET=$R2_BUCKET"
  echo "R2_PREFIX=$R2_PREFIX"
  echo "BACKUP_SCHEDULE=$BACKUP_SCHEDULE"
  echo "BACKUP_TIMEZONE=$BACKUP_TIMEZONE"
  echo "BACKUP_KEEP_LOCAL=$BACKUP_KEEP_LOCAL"
  echo "BACKUP_ON_STARTUP=$BACKUP_ON_STARTUP"
  echo "BACKUP_ENABLED=$BACKUP_ENABLED"
} | ssh "$USER@$HOST" "cat > $REMOTE_ENV && chmod 600 $REMOTE_ENV"

echo "✓ .env VPS à jour (600). Prochaine étape: npm run deploy"
