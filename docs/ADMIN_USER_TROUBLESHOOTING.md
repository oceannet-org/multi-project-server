# Admin User Troubleshooting Guide

## Current Issue

The Oceannet database (`api.db.oceannet.dev`) is returning a 400 error when attempting to authenticate with:
- Email: `hello@oceannet.dev`
- Password: `CHANGE_ME`

Error response:
```json
{
  "status": 400,
  "message": "Failed to authenticate.",
  "endpoint": "/api/collections/_superusers/auth-with-password"
}
```

## Important: Data Directory

PocketBase containers mount the data directory at `/pb_data`. When running `superuser` commands, you **must** specify the `--dir /pb_data` flag:

```bash
docker exec pocketbase-api /usr/local/bin/pocketbase --dir /pb_data superuser upsert hello@oceannet.dev CHANGE_ME
```

## Possible Causes

1. **Admin user doesn't exist** - The most common cause
2. **Incorrect password** - Password may have been changed or set incorrectly
3. **Incorrect email** - Email may be different than expected
4. **Data directory not specified** - If `--dir` flag is missing, user might be created in wrong location
5. **Database was reset** - If the database was recreated, admin users are lost
6. **Timing issue** - Sometimes need to wait a few seconds after creating user

## Verification Steps

### 1. Check if Admin User Exists (via SSH)

```bash
# Connect to AWS server
ssh -i ~/.ssh/bettermap-key.pem ec2-user@13.135.181.201

# List admin users in the Oceannet database (IMPORTANT: use --dir flag)
docker exec pocketbase-api /usr/local/bin/pocketbase --dir /pb_data superuser list
```

### 2. Create/Update Admin User (via SSH)

**Option A: Use the fix script (recommended)**
```bash
# From your local machine
./scripts/fix-admin-user-remote.sh api.db.oceannet.dev hello@oceannet.dev CHANGE_ME
```

**Option B: Manual SSH command**
```bash
ssh -i ~/.ssh/bettermap-key.pem ec2-user@13.135.181.201 \
  "docker exec pocketbase-api /usr/local/bin/pocketbase --dir /pb_data superuser upsert hello@oceannet.dev CHANGE_ME"
```

### 3. Verify Container is Running

```bash
ssh -i ~/.ssh/bettermap-key.pem ec2-user@13.135.181.201 \
  "docker ps | grep pocketbase-api"
```

If not running, start it:
```bash
ssh -i ~/.ssh/bettermap-key.pem ec2-user@13.135.181.201 \
  "docker start pocketbase-api"
```

### 4. Restart Container (if login still fails)

Sometimes PocketBase needs a restart after creating admin users:

```bash
ssh -i ~/.ssh/bettermap-key.pem ec2-user@13.135.181.201 \
  "docker restart pocketbase-api"
```

Wait 5-10 seconds for PocketBase to start, then try logging in again.

### 5. Check Container Logs

```bash
ssh -i ~/.ssh/bettermap-key.pem ec2-user@13.135.181.201 \
  "docker logs pocketbase-api --tail 50"
```

## Testing Authentication

After creating the admin user, test authentication:

```bash
# Try with identity field
curl -X POST "https://api.db.oceannet.dev/api/collections/_superusers/auth-with-password" \
  -H "Content-Type: application/json" \
  -d '{"identity":"hello@oceannet.dev","password":"CHANGE_ME"}'

# Try with email field (some PocketBase versions)
curl -X POST "https://api.db.oceannet.dev/api/collections/_superusers/auth-with-password" \
  -H "Content-Type: application/json" \
  -d '{"email":"hello@oceannet.dev","password":"CHANGE_ME"}'

# Try the /api/admins endpoint
curl -X POST "https://api.db.oceannet.dev/api/admins/auth-with-password" \
  -H "Content-Type: application/json" \
  -d '{"identity":"hello@oceannet.dev","password":"CHANGE_ME"}'
```

Expected success response:
```json
{
  "token": "...",
  "admin": {
    "id": "...",
    "email": "hello@oceannet.dev",
    ...
  }
}
```

## Current Credentials (from database-credentials.json)

- **Oceannet Database** (`api.db.oceannet.dev`):
  - Email: `hello@oceannet.dev`
  - Password: `CHANGE_ME`
  - Container: `pocketbase-api`
  - Data Directory: `/pb_data`

- **ChordsMaster Database** (`chords-master.db.oceannet.dev`):
  - Email: `hello@oceannet.dev`
  - Password: `CHANGE_ME`
  - Container: `pocketbase-chords-master`
  - Data Directory: `/pb_data`

## Troubleshooting Steps

If login still fails after creating the user:

1. **Verify user exists:**
   ```bash
   ssh -i ~/.ssh/bettermap-key.pem ec2-user@13.135.181.201 \
     "docker exec pocketbase-api /usr/local/bin/pocketbase --dir /pb_data superuser list"
   ```

2. **Restart the container:**
   ```bash
   ssh -i ~/.ssh/bettermap-key.pem ec2-user@13.135.181.201 \
     "docker restart pocketbase-api"
   ```

3. **Wait 10 seconds** for PocketBase to fully start

4. **Try logging in again** via the web interface at `https://api.db.oceannet.dev/_/#/login`

5. **Check container logs** for any errors:
   ```bash
   ssh -i ~/.ssh/bettermap-key.pem ec2-user@13.135.181.201 \
     "docker logs pocketbase-api --tail 100"
   ```

## Notes

- **Always use `--dir /pb_data`** when running PocketBase CLI commands in containers
- The `superuser upsert` command will create the user if it doesn't exist, or update it if it does
- Sometimes PocketBase needs a restart after creating admin users
- If SSH is not available, you'll need to access the AWS instance through the AWS console
