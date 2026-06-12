#!/bin/bash
# Fix admin user for an existing PocketBase database
# Usage: ./scripts/fix-admin-user.sh <domain> <email> <password> [container-name]

set -e

DOMAIN="${1:-api.db.oceannet.dev}"
EMAIL="${2:-hello@oceannet.dev}"
PASSWORD="${3:-CHANGE_ME}"
CONTAINER="${4:-}"

# If container not provided, infer from domain
if [ -z "$CONTAINER" ]; then
  # Extract subdomain from domain (e.g., "api" from "api.db.oceannet.dev")
  SUBDOMAIN=$(echo "$DOMAIN" | cut -d'.' -f1)
  CONTAINER="pocketbase-${SUBDOMAIN}"
fi

echo "🔧 Fixing admin user for database: $DOMAIN"
echo "   Container: $CONTAINER"
echo "   Email: $EMAIL"
echo ""

# Check if container exists
if ! docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "❌ Container '$CONTAINER' not found!"
  echo ""
  echo "Available containers:"
  docker ps -a --format '  {{.Names}}' | grep pocketbase || echo "  (none found)"
  exit 1
fi

# Check if container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "⚠️  Container is not running. Starting it..."
  docker start "$CONTAINER"
  echo "   Waiting for PocketBase to start..."
  sleep 5
fi

echo "📝 Creating admin user..."
docker exec "$CONTAINER" /usr/local/bin/pocketbase superuser upsert "$EMAIL" "$PASSWORD"

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Admin user created successfully!"
  echo ""
  echo "   Email:    $EMAIL"
  echo "   Domain:   $DOMAIN"
  echo "   Admin:    https://$DOMAIN/_/"
  echo ""
  echo "You can now login to the admin panel with these credentials."
else
  echo ""
  echo "❌ Failed to create admin user"
  exit 1
fi
