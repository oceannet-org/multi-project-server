#!/bin/bash
# Update admin credentials on AWS instance
# Usage: ./scripts/update-aws-credentials.sh [instance-id]

set -e

INSTANCE_ID="${1:-i-0eeb2f36b052f1228}"
ADMIN_EMAIL="${ADMIN_EMAIL:-hello@oceannet.dev}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-CHANGE_ME}"

echo "🔧 Updating admin credentials on AWS instance..."
echo "   Instance ID: $INSTANCE_ID"
echo "   Admin Email: $ADMIN_EMAIL"
echo ""

# Check if AWS CLI is configured
if ! aws sts get-caller-identity &>/dev/null; then
  echo "❌ AWS CLI not configured. Please run 'aws configure' first."
  exit 1
fi

# Check if instance exists
if ! aws ec2 describe-instances --instance-ids "$INSTANCE_ID" &>/dev/null; then
  echo "❌ Instance $INSTANCE_ID not found or not accessible"
  exit 1
fi

echo "📝 Sending update command via SSM..."
COMMAND_ID=$(aws ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --comment "Update admin credentials for PocketBase Manager" \
  --parameters "commands=[
    \"cd /opt/pocketbase-manager\",
    \"echo 'Updating admin credentials...'\",
    \"# Remove old ADMIN_EMAIL and ADMIN_PASSWORD lines\",
    \"sed -i '/^ADMIN_EMAIL=/d' .env\",
    \"sed -i '/^ADMIN_PASSWORD=/d' .env\",
    \"# Add new credentials\",
    \"echo 'ADMIN_EMAIL=$ADMIN_EMAIL' >> .env\",
    \"echo 'ADMIN_PASSWORD=$ADMIN_PASSWORD' >> .env\",
    \"echo 'Credentials updated in .env file'\",
    \"# Update docker-compose.prod.yml if needed\",
    \"if grep -q 'ADMIN_EMAIL' docker-compose.prod.yml; then\",
    \"  sed -i 's|ADMIN_EMAIL=.*|ADMIN_EMAIL=$ADMIN_EMAIL|g' docker-compose.prod.yml\",
    \"  sed -i 's|ADMIN_PASSWORD=.*|ADMIN_PASSWORD=$ADMIN_PASSWORD|g' docker-compose.prod.yml\",
    \"else\",
    \"  # Add environment variables to docker-compose if not present\",
    \"  sed -i '/ADMIN_EMAIL=.*ADMIN_EMAIL/a\\      - ADMIN_PASSWORD=\\$\\{ADMIN_PASSWORD\\}' docker-compose.prod.yml\",
    \"fi\",
    \"echo 'Restarting container to apply changes...'\",
    \"docker compose -f docker-compose.prod.yml down --remove-orphans || true\",
    \"# Remove any leftover containers with the same name\",
    \"docker rm -f pocketbase-manager 2>/dev/null || true\",
    \"docker rm -f traefik 2>/dev/null || true\",
    \"docker compose -f docker-compose.prod.yml up -d\",
    \"echo 'Waiting for container to start...'\",
    \"sleep 5\",
    \"echo 'Verifying credentials...'\",
    \"docker exec pocketbase-manager env | grep ADMIN || echo 'Container not ready yet'\",
    \"echo '✅ Credentials update complete!'\"
  ]" \
  --output text \
  --query 'Command.CommandId')

if [ -z "$COMMAND_ID" ]; then
  echo "❌ Failed to send command"
  exit 1
fi

echo "✅ Command sent. Command ID: $COMMAND_ID"
echo ""
echo "⏳ Waiting for command to complete..."

# Poll for command completion (max 20 attempts, 3 seconds between)
MAX_ATTEMPTS=20
ATTEMPT=0
STATUS="InProgress"

while [ "$STATUS" = "InProgress" ] && [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  sleep 3
  ATTEMPT=$((ATTEMPT + 1))
  STATUS=$(aws ssm get-command-invocation \
    --command-id "$COMMAND_ID" \
    --instance-id "$INSTANCE_ID" \
    --query 'Status' \
    --output text 2>/dev/null || echo "InProgress")
  
  if [ "$STATUS" != "InProgress" ]; then
    break
  fi
  
  echo "   Attempt $ATTEMPT/$MAX_ATTEMPTS - Status: $STATUS"
done

if [ "$STATUS" = "InProgress" ]; then
  echo "⚠️  Command still running after $MAX_ATTEMPTS attempts. Check status manually:"
  echo "   aws ssm get-command-invocation --command-id $COMMAND_ID --instance-id $INSTANCE_ID"
else
  echo "✅ Command completed with status: $STATUS"
fi

echo ""
echo "📋 Command output:"
aws ssm get-command-invocation \
  --command-id "$COMMAND_ID" \
  --instance-id "$INSTANCE_ID" \
  --query 'StandardOutputContent' \
  --output text

echo ""
echo "📋 Error output (if any):"
aws ssm get-command-invocation \
  --command-id "$COMMAND_ID" \
  --instance-id "$INSTANCE_ID" \
  --query 'StandardErrorContent' \
  --output text

echo ""
echo "✅ Credentials update complete!"
echo ""
echo "💡 To verify, run:"
echo "   aws ssm send-command --instance-ids $INSTANCE_ID --document-name 'AWS-RunShellScript' --parameters 'commands=[\"docker exec pocketbase-manager env | grep ADMIN\"]'"
