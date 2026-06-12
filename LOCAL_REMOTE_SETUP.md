# Local Development with Remote Databases

This guide shows you how to run the PocketBase Manager locally while connecting to the **live production databases** on AWS.

## 🎯 Goal

- Use the same admin credentials (`hello@oceannet.dev`) locally and in production
- Manage live databases from your local machine
- Avoid creating duplicate local databases

---

## 📋 Prerequisites

1. SSH access to the production AWS instance
2. SSH key: `~/.ssh/bettermap-key.pem`
3. Production IP: `13.135.181.201`

---

## ⚙️ Setup Steps

### Option A: SSH Docker Connection (Recommended)

This connects your local Docker client directly to the remote Docker daemon via SSH.

1. **Test SSH connection first:**
   ```bash
   ssh -i ~/.ssh/bettermap-key.pem ec2-user@13.135.181.201
   ```

2. **Update your local `.env` file:**
   
   Create/edit `/Users/panosstylianou/Documents/GitHub/multi-project-server/.env`:
   
   ```bash
   # Server settings
   PORT=3002
   HOST=0.0.0.0
   NODE_ENV=development

   # Docker - REMOTE CONNECTION via SSH
   DOCKER_HOST=ssh://ec2-user@13.135.181.201
   DOCKER_SOCKET=/var/run/docker.sock
   POCKETBASE_IMAGE=ghcr.io/muchobien/pocketbase:latest
   POCKETBASE_NETWORK=pocketbase-network

   # Storage - REMOTE PATHS
   DATA_DIR=/app/data
   BACKUPS_DIR=/app/backups

   # Domain - PRODUCTION
   BASE_DOMAIN=db.oceannet.dev
   USE_HTTPS=true

   # Security - UNIFIED CREDENTIALS
   API_KEY=dev-api-key
   ADMIN_EMAIL=hello@oceannet.dev
   ADMIN_PASSWORD=CHANGE_ME
   JWT_SECRET=your-production-jwt-secret-here

   # AWS
   AWS_REGION=eu-west-2

   # Traefik
   TRAEFIK_DASHBOARD_ENABLED=true
   TRAEFIK_DASHBOARD_PORT=8080
   ACME_EMAIL=hello@oceannet.dev

   # Limits
   DEFAULT_MEMORY_LIMIT=256m
   DEFAULT_CPU_LIMIT=0.5
   ```

3. **Configure SSH for Docker:**
   
   Add to `~/.ssh/config`:
   ```
   Host pocketbase-prod
     HostName 13.135.181.201
     User ec2-user
     IdentityFile ~/.ssh/bettermap-key.pem
     StrictHostKeyChecking no
   ```

4. **Test Docker connection:**
   ```bash
   DOCKER_HOST=ssh://ec2-user@13.135.181.201 docker ps
   ```
   
   You should see your production containers (including `chords-master`).

5. **Restart local server:**
   ```bash
   lsof -ti:3002 | xargs kill -9
   cd /Users/panosstylianou/Documents/GitHub/multi-project-server
   PORT=3002 npm run dev
   ```

6. **Login locally:**
   - Open `http://localhost:3002/dashboard`
   - Login with: `hello@oceannet.dev` / `CHANGE_ME`
   - You'll see your live databases!

---

### Option B: SSH Tunnel (Alternative)

If the direct SSH connection doesn't work, use an SSH tunnel:

1. **Create the tunnel** (in a separate terminal, keep it running):
   ```bash
   ssh -i ~/.ssh/bettermap-key.pem \
     -N -L 2375:/var/run/docker.sock \
     ec2-user@13.135.181.201
   ```

2. **Update `.env`:**
   ```bash
   DOCKER_HOST=tcp://localhost:2375
   # ... rest of config same as Option A
   ```

3. **Test:**
   ```bash
   DOCKER_HOST=tcp://localhost:2375 docker ps
   ```

---

## 🔄 Switching Between Local and Remote

### For Remote (Production) Management:
```bash
# Use .env with remote config
PORT=3002 npm run dev
```

### For Local Development (Isolated):
```bash
# Use local Docker
DOCKER_HOST=unix:///var/run/docker.sock \
DATA_DIR=./data \
ADMIN_EMAIL=admin@youragency.com \
ADMIN_PASSWORD=admin123 \
PORT=3003 npm run dev
```

---

## 🔐 Consolidate Admin Accounts

The production admin store is at `/app/data/admin-store.json` on the AWS instance.

To sync it locally:

1. **Download production admin store:**
   ```bash
   scp -i ~/.ssh/bettermap-key.pem \
     ec2-user@13.135.181.201:/app/data/admin-store.json \
     ./data/admin-store.json
   ```

2. **Or, reset local admin:**
   ```bash
   rm data/admin-store.json
   # Restart server - it will use ADMIN_EMAIL and ADMIN_PASSWORD from .env
   ```

---

## ✅ Verification

After setup, verify everything works:

```bash
# 1. Check Docker connection
DOCKER_HOST=ssh://ec2-user@13.135.181.201 docker ps

# 2. Start local server
PORT=3002 npm run dev

# 3. Test login
curl -X POST http://localhost:3002/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"hello@oceannet.dev","password":"CHANGE_ME"}'

# 4. List databases
TOKEN="<your-jwt-token>"
curl http://localhost:3002/api/projects \
  -H "Authorization: Bearer $TOKEN"
```

---

## 🚨 Important Notes

### Security
- Your local server connects to production Docker daemon
- Changes you make locally **affect production** databases
- Be careful when creating/deleting databases
- Consider using a separate staging environment for testing

### SSH Requirements
- Ensure port 22 is open in AWS security group (it is)
- SSH key must have correct permissions: `chmod 400 ~/.ssh/bettermap-key.pem`
- Docker must be accessible via SSH on the remote instance

### Data Paths
- When connected remotely, `DATA_DIR` and `BACKUPS_DIR` refer to paths on the **AWS instance**, not your local machine
- To download backups: `scp -i ~/.ssh/bettermap-key.pem ec2-user@13.135.181.201:/app/backups/* ./local-backups/`

---

## 🐛 Troubleshooting

### "Cannot connect to Docker daemon"
```bash
# Test SSH connection
ssh -i ~/.ssh/bettermap-key.pem ec2-user@13.135.181.201

# Test Docker over SSH
ssh -i ~/.ssh/bettermap-key.pem ec2-user@13.135.181.201 'docker ps'
```

### "Permission denied (publickey)"
```bash
# Check key permissions
ls -l ~/.ssh/bettermap-key.pem
chmod 400 ~/.ssh/bettermap-key.pem
```

### "Login failed"
- Make sure you're using production credentials: `hello@oceannet.dev` / `CHANGE_ME`
- Delete local `data/admin-store.json` and restart server to recreate with .env credentials

---

## 📚 Next Steps

1. Set up the remote connection
2. Test that you can see live databases locally
3. (Optional) Create a separate `.env.production` and `.env.local` for easy switching
4. Consider setting up a staging environment for safe testing

---

**Need help?** Check the logs:
- Local server logs: Check the terminal running `npm run dev`
- Remote Docker logs: `ssh ec2-user@13.135.181.201 'docker logs chords-master'`

