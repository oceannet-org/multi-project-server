#!/bin/bash

# Start Remote Development Mode
# This script creates an SSH tunnel to production and starts the local server

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PROD_HOST="pocketbase-prod"
LOCAL_PORT=2375
TUNNEL_PID_FILE="/tmp/pocketbase-ssh-tunnel.pid"

echo "🚀 Starting Remote Development Mode"
echo "===================================="
echo ""

# Check if tunnel is already running
if [ -f "$TUNNEL_PID_FILE" ]; then
    OLD_PID=$(cat "$TUNNEL_PID_FILE")
    if ps -p "$OLD_PID" > /dev/null 2>&1; then
        echo "⚠️  SSH tunnel already running (PID: $OLD_PID)"
        read -p "Kill and restart? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            kill "$OLD_PID" 2>/dev/null || true
            rm "$TUNNEL_PID_FILE"
            sleep 1
        else
            echo "Using existing tunnel..."
        fi
    else
        rm "$TUNNEL_PID_FILE"
    fi
fi

# Start SSH tunnel if not running
if [ ! -f "$TUNNEL_PID_FILE" ]; then
    echo "🔌 Creating SSH tunnel to production..."
    echo "   Local TCP: localhost:$LOCAL_PORT"
    echo "   Remote: Docker socket on $PROD_HOST"
    
    # Create the SSH tunnel in background
    # Forward local TCP port to remote Docker socket
    ssh -i ~/.ssh/bettermap-key.pem \
        -N \
        -L ${LOCAL_PORT}:/var/run/docker.sock \
        ec2-user@13.135.181.201 &
    
    TUNNEL_PID=$!
    echo $TUNNEL_PID > "$TUNNEL_PID_FILE"
    
    echo "✅ SSH tunnel started (PID: $TUNNEL_PID)"
    sleep 2
fi

# Test tunnel
echo ""
echo "🧪 Testing Docker connection through tunnel..."
if DOCKER_HOST=tcp://localhost:${LOCAL_PORT} docker ps > /dev/null 2>&1; then
    echo "✅ Docker connection successful!"
    echo ""
    echo "📦 Production containers:"
    DOCKER_HOST=tcp://localhost:${LOCAL_PORT} docker ps --format "  - {{.Names}} ({{.Status}})"
else
    echo "❌ Docker connection failed!"
    kill $(cat "$TUNNEL_PID_FILE") 2>/dev/null || true
    rm "$TUNNEL_PID_FILE"
    exit 1
fi

# Update .env to use the tunnel
echo ""
echo "⚙️  Updating .env configuration..."
cd "$PROJECT_ROOT"

# Backup current .env
cp .env .env.backup.$(date +%s)

# Create a temporary .env for remote development
cat > .env.remote-active << EOF
# Remote Development Configuration (Auto-generated)
# Using SSH tunnel to production

PORT=3002
HOST=0.0.0.0
NODE_ENV=development

# Docker via SSH tunnel
DOCKER_SOCKET=tcp://localhost:${LOCAL_PORT}

POCKETBASE_IMAGE=ghcr.io/muchobien/pocketbase:latest
POCKETBASE_NETWORK=pocketbase-network

# Remote paths
DATA_DIR=/app/data
BACKUPS_DIR=/app/backups

# Production domain
BASE_DOMAIN=db.oceannet.dev
USE_HTTPS=true

# Production credentials
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

# Limits
DEFAULT_MEMORY_LIMIT=256m
DEFAULT_CPU_LIMIT=0.5
EOF

# Use the remote config
cp .env.remote-active .env

echo "✅ Configuration updated for remote development"

# Start the server
echo ""
echo "🚀 Starting local development server..."
echo "   Port: 3002"
echo "   Dashboard: http://localhost:3002/dashboard"
echo ""
echo "Press Ctrl+C to stop (tunnel will remain open)"
echo "To stop the tunnel: kill \$(cat $TUNNEL_PID_FILE)"
echo ""

# Trap Ctrl+C
trap cleanup INT

cleanup() {
    echo ""
    echo "🛑 Stopping server..."
    if [ -f "$TUNNEL_PID_FILE" ]; then
        echo "ℹ️  SSH tunnel still running (PID: $(cat $TUNNEL_PID_FILE))"
        echo "   To stop: kill \$(cat $TUNNEL_PID_FILE) && rm $TUNNEL_PID_FILE"
    fi
    exit 0
}

# Start the server
cd "$PROJECT_ROOT"
PORT=3002 npm run dev

