#!/bin/bash

# Setup Remote Development Environment
# This script configures your local machine to manage production databases

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PROD_HOST="13.135.181.201"
PROD_USER="ec2-user"
SSH_KEY="$HOME/.ssh/bettermap-key.pem"

echo "🚀 PocketBase Manager - Remote Development Setup"
echo "================================================="
echo ""

# Check prerequisites
echo "📋 Checking prerequisites..."

if [ ! -f "$SSH_KEY" ]; then
    echo "❌ SSH key not found: $SSH_KEY"
    echo "   Please ensure your SSH key is in the correct location"
    exit 1
fi

# Check key permissions
KEY_PERMS=$(stat -f "%Lp" "$SSH_KEY" 2>/dev/null || stat -c "%a" "$SSH_KEY" 2>/dev/null)
if [ "$KEY_PERMS" != "400" ]; then
    echo "⚠️  Fixing SSH key permissions..."
    chmod 400 "$SSH_KEY"
fi

echo "✅ SSH key found and configured"

# Test SSH connection
echo ""
echo "🔌 Testing SSH connection to production..."
if ssh -i "$SSH_KEY" -o ConnectTimeout=5 -o StrictHostKeyChecking=no "$PROD_USER@$PROD_HOST" 'exit' 2>/dev/null; then
    echo "✅ SSH connection successful"
else
    echo "❌ Cannot connect to production via SSH"
    echo "   Host: $PROD_HOST"
    echo "   User: $PROD_USER"
    echo "   Key: $SSH_KEY"
    exit 1
fi

# Test Docker connection
echo ""
echo "🐳 Testing Docker connection..."
if ssh -i "$SSH_KEY" "$PROD_USER@$PROD_HOST" 'docker ps' > /dev/null 2>&1; then
    echo "✅ Docker is accessible"
    
    echo ""
    echo "📦 Production containers:"
    ssh -i "$SSH_KEY" "$PROD_USER@$PROD_HOST" 'docker ps --format "  - {{.Names}} ({{.Status}})"'
else
    echo "❌ Cannot access Docker on production"
    exit 1
fi

# Configure SSH config
echo ""
echo "⚙️  Configuring SSH..."

SSH_CONFIG="$HOME/.ssh/config"
if ! grep -q "Host pocketbase-prod" "$SSH_CONFIG" 2>/dev/null; then
    echo "Adding SSH config entry..."
    cat >> "$SSH_CONFIG" << EOF

# PocketBase Production Server
Host pocketbase-prod
  HostName $PROD_HOST
  User $PROD_USER
  IdentityFile $SSH_KEY
  StrictHostKeyChecking no
EOF
    echo "✅ SSH config updated"
else
    echo "✅ SSH config already configured"
fi

# Create .env file
echo ""
echo "📝 Creating .env configuration..."

ENV_FILE="$PROJECT_ROOT/.env"

if [ -f "$ENV_FILE" ]; then
    echo "⚠️  .env file already exists"
    read -p "   Backup and replace with remote config? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        mv "$ENV_FILE" "$ENV_FILE.backup.$(date +%s)"
        echo "   Backed up to: $ENV_FILE.backup.*"
    else
        echo "   Skipping .env creation"
        ENV_FILE=""
    fi
fi

if [ -n "$ENV_FILE" ]; then
    cat > "$ENV_FILE" << 'EOF'
# PocketBase Multi-Project Server - Remote Configuration
# Connected to production AWS instance

# Server settings (local)
PORT=3002
HOST=0.0.0.0
NODE_ENV=development

# Docker - REMOTE via SSH
DOCKER_HOST=ssh://ec2-user@13.135.181.201
DOCKER_SOCKET=/var/run/docker.sock
POCKETBASE_IMAGE=ghcr.io/muchobien/pocketbase:latest
POCKETBASE_NETWORK=pocketbase-network

# Storage - REMOTE PATHS (on AWS instance)
DATA_DIR=/app/data
BACKUPS_DIR=/app/backups

# Domain - PRODUCTION
BASE_DOMAIN=db.oceannet.dev
USE_HTTPS=true

# Security - PRODUCTION CREDENTIALS
API_KEY=dev-api-key
ADMIN_EMAIL=hello@oceannet.dev
ADMIN_PASSWORD=CHANGE_ME
JWT_SECRET=supersecretjwtkey

# AWS
AWS_REGION=eu-west-2

# Traefik
TRAEFIK_DASHBOARD_ENABLED=true
TRAEFIK_DASHBOARD_PORT=8080
ACME_EMAIL=hello@oceannet.dev

# Resource limits
DEFAULT_MEMORY_LIMIT=256m
DEFAULT_CPU_LIMIT=0.5
EOF
    echo "✅ .env file created"
fi

# Sync admin store
echo ""
echo "👤 Syncing admin credentials..."

ADMIN_STORE="$PROJECT_ROOT/data/admin-store.json"
if [ -f "$ADMIN_STORE" ]; then
    echo "⚠️  Local admin store exists"
    read -p "   Replace with production credentials? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm "$ADMIN_STORE"
        echo "   Removed local admin store (will be recreated from .env)"
    fi
else
    echo "✅ No local admin store (will be created from .env)"
fi

# Test Docker connection with new config
echo ""
echo "🧪 Testing Docker connection with new configuration..."

export DOCKER_HOST="ssh://$PROD_USER@$PROD_HOST"
if docker ps > /dev/null 2>&1; then
    echo "✅ Docker connection successful!"
    echo ""
    echo "📦 Available containers:"
    docker ps --format "  - {{.Names}} ({{.Image}}) - {{.Status}}"
else
    echo "❌ Docker connection failed"
    echo "   You may need to configure SSH agent or Docker context"
fi

# Final instructions
echo ""
echo "════════════════════════════════════════════════════════"
echo "✅ Setup complete!"
echo "════════════════════════════════════════════════════════"
echo ""
echo "🚀 Start your local development server:"
echo "   cd $PROJECT_ROOT"
echo "   PORT=3002 npm run dev"
echo ""
echo "🌐 Then open: http://localhost:3002/dashboard"
echo ""
echo "🔑 Login with:"
echo "   Email: hello@oceannet.dev"
echo "   Password: CHANGE_ME"
echo ""
echo "⚠️  IMPORTANT:"
echo "   - You're now managing PRODUCTION databases"
echo "   - Changes you make will affect live data"
echo "   - Be careful when creating/deleting databases"
echo ""
echo "📚 For more info, see: LOCAL_REMOTE_SETUP.md"
echo ""

