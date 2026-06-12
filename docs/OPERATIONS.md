# Oceannet Infrastructure — Operations Runbook

Last updated: 2026-04-23  
Author: Panos Stylianou

This is the single source of truth for running, deploying, and debugging the Oceannet production stack. It supersedes the older generic docs in this folder.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [DNS — Cloudflare](#dns--cloudflare)
3. [Frontend — oceannet.dev (Amplify)](#frontend--oceannetdev-amplify)
4. [API — App Runner](#api--app-runner)
5. [PocketBase Tenants (EC2)](#pocketbase-tenants-ec2)
6. [CI/CD Reference](#cicd-reference)
7. [Credentials & Secrets](#credentials--secrets)
8. [Known Gotchas](#known-gotchas)
9. [Break-Glass Procedures](#break-glass-procedures)

---

## Architecture Overview

```
Browser
  │
  ▼
oceannet.dev (Amplify — Vite/React)
  │  HTTPS → ers3esgpp9.eu-west-2.awsapprunner.com
  ▼
oceannet-api (App Runner, eu-west-2)
  │  HTTPS → api.db.oceannet.dev
  ▼
PocketBase — Oceannet tenant (EC2 port 8090, exposed via Traefik)
  EC2: 13.135.181.201 (eu-west-1 London, t3.small)

Also on same EC2:
  PocketBase — ChordsMaster tenant (port 8091, chords-master.db.oceannet.dev)
  Traefik (reverse proxy, routes by subdomain)
  Manager API (manager.db.oceannet.dev/api)
```

**App Runner services (eu-west-2):**
| Service | ARN | URL |
|---------|-----|-----|
| oceannet-api | `cb9b663887be49f69cb293f05d813e93` | `ers3esgpp9.eu-west-2.awsapprunner.com` |
| chordmaster-api | `7644f1031447462d908c13a6492f9598` | separate URL |

**ECR repositories (eu-west-2):**
- `323603432190.dkr.ecr.eu-west-2.amazonaws.com/oceannet-api`
- `323603432190.dkr.ecr.eu-west-2.amazonaws.com/chordmaster-api`
- `323603432190.dkr.ecr.eu-west-2.amazonaws.com/oceannet-pipeline-api`

---

## DNS — Cloudflare

**Domain:** `oceannet.dev`  
**Zone ID:** `4d5dd50a1260fac713bd63d064debe36`  
**Nameservers:** Cloudflare (migrated from GoDaddy April 2026)

### How to manage DNS

Credentials in `~/.claude/settings.json` env block (`CF_API_TOKEN`, `CF_ZONE_ID`). Script at `multi-project-server/scripts/setup-cloudflare-dns.sh`.

```bash
# View all records (credentials auto-available as env vars in Claude sessions)
curl -s "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CF_API_TOKEN" | python3 -c "
import sys,json
for r in json.load(sys.stdin)['result']:
    print(r['type'].ljust(6), r['name'].ljust(40), r['content'][:50])
"
```

### Key records

| Type | Name | Content | Notes |
|------|------|---------|-------|
| A | db.oceannet.dev | 13.135.181.201 | EC2 — proxied: false |
| A | *.db.oceannet.dev | 13.135.181.201 | PB wildcard — proxied: false |
| CNAME | oceannet.dev (apex) | d2w8xweclare78.cloudfront.net | Amplify (Cloudflare flattens to A) |
| CNAME | www | d2w8xweclare78.cloudfront.net | Amplify |
| CNAME | lavoro | 185.158.133.1 (A) | Client site |
| NS | preview | (4 AWS NS records) | preview.oceannet.dev delegated to Route53 |

### Critical: Apex CNAME flattening

Cloudflare flattens the apex CNAME (`oceannet.dev → CloudFront`) to an A record. Amplify's domain verifier sees the A record, not the CNAME, so it always reports `(apex): verified=False`. **This is cosmetic** — the site works correctly. Do not try to "fix" it by deleting the record.

### GoDaddy nameserver change (for reference)

If the GoDaddy login is ever needed:
```bash
# GoDaddy credentials from ~/.claude/settings.json (GODADDY_API_KEY, GODADDY_API_SECRET)
curl -s -X PATCH "https://api.godaddy.com/v1/domains/oceannet.dev" \
  -H "Authorization: sso-key $GODADDY_API_KEY:$GODADDY_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"nameServers":["nova.ns.cloudflare.com","yuki.ns.cloudflare.com"]}'
```

---

## Frontend — oceannet.dev (Amplify)

**Amplify App ID:** `d1a4hu9uwbjt1k`  
**Branch:** `main`  
**Repo:** `ocean-tech-solutions` (GitHub)

### Why manual zip upload (not repo-connected builds)

The AWS Organisation (`master: 869455321707 / aws@partner-way.com`) has an SCP that blocks `sts:AssumeRole` for Amplify's build environment. Repo-connected builds fail with "Unable to assume specified IAM Role". The workaround is the GitHub Actions workflow that builds locally and uploads via `create-deployment` + `start-deployment` API. **Do not re-enable repo-connected builds without first getting the SCP lifted.**

### Deploy flow

1. Push to `main` on `ocean-tech-solutions` → GitHub Actions triggers
2. `npm run build` → `dist/`
3. `aws amplify create-deployment` → gets pre-signed S3 upload URL
4. `curl PUT dist.zip → upload URL`
5. `aws amplify start-deployment` → Amplify serves new content
6. Polls until `SUCCEED` (max 5 min)

### Trigger a manual redeploy

```bash
AMPLIFY_APP_ID=d1a4hu9uwbjt1k
AMPLIFY_BRANCH=main
AWS_REGION=eu-west-2

# Build first (from ocean-tech-solutions dir)
npm run build

# Deploy
DEPLOYMENT=$(aws amplify create-deployment --app-id $AMPLIFY_APP_ID --branch-name $AMPLIFY_BRANCH --output json)
JOB_ID=$(echo $DEPLOYMENT | jq -r '.jobId')
UPLOAD_URL=$(echo $DEPLOYMENT | jq -r '.zipUploadUrl')

cd dist && zip -r ../deploy.zip . && cd ..
curl -s -X PUT --upload-file deploy.zip --header "Content-Type: application/zip" "$UPLOAD_URL"
aws amplify start-deployment --app-id $AMPLIFY_APP_ID --branch-name $AMPLIFY_BRANCH --job-id $JOB_ID
```

### Domain association

`oceannet.dev` uses `AMPLIFY_MANAGED` cert strategy (not `CUSTOM`). The CloudFront distribution is `d2w8xweclare78.cloudfront.net`.  
**Do not call `create-domain-association` again** unless the Amplify app is being fully rebuilt — each call provisions a NEW CloudFront distribution, which breaks DNS until you update the CNAME.

### Build env vars (GitHub Secrets on ocean-tech-solutions)

- `VITE_API_URL` → `https://ers3esgpp9.eu-west-2.awsapprunner.com/oceannet/v1`
- `VITE_STRIPE_*` — Stripe keys
- `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` — `eb-user` IAM user credentials

### Static assets in the frontend

**Always import images via Vite module imports** (`import Logo from '@/assets/images/logo5.png'`), not via hardcoded `/src/assets/...` paths. Hardcoded paths produce 404 in production because Vite hashes asset filenames (`logo5-BK7HLcIf.png`).

---

## API — App Runner

Both APIs are on **AWS App Runner, eu-west-2**. Auto-deploy is **OFF** — all deployments are triggered explicitly by CI/CD or manually.

### oceannet-api

- **Repo:** `multi-tenant-api/packages/oceannet-api`
- **Dockerfile:** `packages/oceannet-api/Dockerfile` (build context = repo root)
- **CI/CD:** `.github/workflows/deploy-oceannet-api.yml` — triggers on changes to `packages/oceannet-api/**`, `packages/shared/**`
- **Runtime env vars:** set in App Runner console (not in `.env`)
- **PocketBase:** `POCKETBASE_URL=https://api.db.oceannet.dev`, admin `hello@oceannet.dev` / `CHANGE_ME`

**Manual redeploy:**
```bash
# 1. Build and push image
docker build -f packages/oceannet-api/Dockerfile -t 323603432190.dkr.ecr.eu-west-2.amazonaws.com/oceannet-api:latest .
aws ecr get-login-password --region eu-west-2 | docker login --username AWS --password-stdin 323603432190.dkr.ecr.eu-west-2.amazonaws.com
docker push 323603432190.dkr.ecr.eu-west-2.amazonaws.com/oceannet-api:latest

# 2. Trigger App Runner
aws apprunner start-deployment \
  --service-arn arn:aws:apprunner:eu-west-2:323603432190:service/oceannet-api/cb9b663887be49f69cb293f05d813e93 \
  --region eu-west-2
```

### chordmaster-api

- **Repo:** `multi-tenant-api/deploy/` (has its own Dockerfile)
- **CI/CD:** `.github/workflows/deploy.yml` — triggers on changes to `deploy/**`, `packages/chordmaster-api/**`, `packages/shared/**`
- **OIDC auth:** uses `GitHubActionsDeployRole` (no secrets needed in GitHub)

### PocketBase JS SDK quirk (pocketbase@0.21.x)

`pb.admins.authWithPassword()` is the old PocketBase ≤0.18 API. In 0.21+, the `/api/admins/auth-with-password` endpoint returns **404**. The correct method is:

```typescript
await pb.collection('_superusers').authWithPassword(email, password);
```

The `onRequest` token-refresh hook must use a fallback pattern that catches the 404 and retries with `_superusers`. Without this, the hook leaks 404 errors on every request and `pbAdmin` stops being authenticated. This is already fixed in the current source as of commit `b3089eb`.

---

## PocketBase Tenants (EC2)

**EC2 IP:** `13.135.181.201`  
**SSH:** `ssh -i ~/.ssh/bettermap-key ec2-user@13.135.181.201`

| Tenant | Subdomain | Container | Port | Admin login |
|--------|-----------|-----------|------|-------------|
| Oceannet | `api.db.oceannet.dev` | `pocketbase-api` | 8090 | `hello@oceannet.dev` / `CHANGE_ME` |
| ChordsMaster | `chords-master.db.oceannet.dev` | `pocketbase-chords-master` | 8091 | same creds |

### Admin auth endpoint (PocketBase ≥0.22)

```bash
curl -s -X POST "https://api.db.oceannet.dev/api/collections/_superusers/auth-with-password" \
  -H "Content-Type: application/json" \
  -d '{"identity":"hello@oceannet.dev","password":"CHANGE_ME"}'
```

The old `/api/admins/auth-with-password` path returns 404 on PocketBase ≥0.22. Always use `_superusers` collection.

### Service accounts in Oceannet PB

| Email | Role | Password location |
|-------|------|-------------------|
| `panos@oceannet.dev` | superuser | Claude memory: `project_oceannet_service_accounts.md` |
| `pipeline@oceannet.dev` | superuser | `oceannet-leads/.env` → `OCEANNET_API_PASSWORD` |
| `hello@oceannet.dev` | _superusers (DB admin) | `multi-tenant-api/.env` → `POCKETBASE_ADMIN_PASSWORD` |

### Reset a user's PocketBase password

```bash
# 1. Get admin token (password from multi-tenant-api/.env POCKETBASE_ADMIN_PASSWORD)
ADMIN_TOKEN=$(curl -s -X POST "https://api.db.oceannet.dev/api/collections/_superusers/auth-with-password" \
  -H "Content-Type: application/json" \
  -d '{"identity":"hello@oceannet.dev","password":"<POCKETBASE_ADMIN_PASSWORD>"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# 2. Find user ID
curl -s "https://api.db.oceannet.dev/api/collections/users/records?filter=email%3D%22user%40example.com%22" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['items'][0]['id'])"

# 3. Update password
curl -s -X PATCH "https://api.db.oceannet.dev/api/collections/users/records/RECORD_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"password":"NewPass123!","passwordConfirm":"NewPass123!"}'
```

---

## CI/CD Reference

| Repo | Workflow | Trigger | What it deploys |
|------|----------|---------|-----------------|
| `ocean-tech-solutions` | `deploy.yml` | push to `main` | oceannet.dev via Amplify zip upload |
| `multi-tenant-api` | `deploy-oceannet-api.yml` | push to `main` (paths: `packages/oceannet-api/**`, `packages/shared/**`) | oceannet-api to App Runner |
| `multi-tenant-api` | `deploy.yml` | push to `main` (paths: `deploy/**`, `packages/chordmaster-api/**`) | chordmaster-api to App Runner |

All multi-tenant-api workflows use **OIDC** (`GitHubActionsDeployRole`) — no AWS secrets needed in GitHub.

The ocean-tech-solutions workflow uses `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` GitHub secrets (eb-user credentials).

---

## Credentials & Secrets

| Secret | Where to find it |
|--------|-----------------|
| Cloudflare API token + Zone ID | `~/.claude/settings.json` env block (`CF_API_TOKEN`, `CF_ZONE_ID`) |
| GoDaddy API key + secret | `~/.claude/settings.json` env block (`GODADDY_API_KEY`, `GODADDY_API_SECRET`) |
| PB admin password | `multi-tenant-api/.env` → `POCKETBASE_ADMIN_PASSWORD` |
| panos@oceannet.dev password | Claude memory: `project_oceannet_service_accounts.md` |
| pipeline service account | `oceannet-leads/.env` → `OCEANNET_API_PASSWORD` |
| EC2 SSH key name | `bettermap-key` (in `~/.ssh/`) |
| AWS account ID | `323603432190` |
| AWS region (primary) | `eu-west-2` |

Cloudflare + GoDaddy credentials are in `~/.claude/settings.json` env vars so they're always available to Claude's Bash tool in any session without re-pasting.

---

## Known Gotchas

### 1. Amplify apex domain always shows `verified=False`
Cloudflare CNAME flattening hides the CNAME type from Amplify's verifier. The site works; ignore the unverified status on the apex record.

### 2. PocketBase admin auth endpoint changed in v0.22
`/api/admins/auth-with-password` → 404. Use `collection('_superusers').authWithPassword()`. The old JS SDK `pb.admins.authWithPassword()` also calls the old endpoint and must not be used.

### 3. pbAdmin token-refresh hook leaks errors in old deployments
The March 2026 App Runner deployment had a bug in the `onRequest` hook: the catch block called `pbAdmin.admins.authWithPassword()` directly (no `_superusers` fallback). This produced a 404 error on every request, causing all `pbAdmin.collection(...).getFirstListItem()` calls to silently return null. Fixed in commit `b3089eb` — must redeploy after that commit for the fix to take effect.

### 4. Creating a new Amplify domain association creates a new CloudFront distribution
Each `create-domain-association` call provisions a separate CloudFront distribution. The CNAME in Cloudflare must be updated to point to the new distribution or traffic won't route. **Do not call `create-domain-association` unless the Amplify app is being rebuilt from scratch.**

### 5. App Runner auto-deploy is OFF for oceannet-api
Pushing a new ECR image does NOT automatically redeploy. The workflow explicitly calls `apprunner start-deployment`. If deploying manually, remember to call it.

### 6. Vite asset imports must use module imports, not hardcoded paths
`src="/src/assets/images/foo.png"` → 404 in production. Always: `import Foo from '@/assets/images/foo.png'` and `src={Foo}`.

### 7. Amplify SCP blocks repo-connected CI builds
AWS Org SCP blocks `sts:AssumeRole` for `amplify.amazonaws.com`. All Amplify builds must use the manual zip upload method. This also applies to preview sites in `oceannet-leads`.

### 8. `multi-tenant-api` CI/CD was missing for oceannet-api
The existing `deploy.yml` only deployed `chordmaster-api`. `oceannet-api` was deployed manually from March 2026 onward. The new `deploy-oceannet-api.yml` workflow (added April 2026) covers this.

### 9. PocketBase user passwords can get lost during migration
When the schema was migrated from the wrong PB tenant (ChordsMaster) to the correct one (Oceannet), the `panos@oceannet.dev` account was recreated with an unknown password. Always document account passwords when creating/recreating service accounts.

### 10. pnpm lockfile version must match locally and in Docker
The Dockerfile runs `pnpm install --frozen-lockfile`. If the local pnpm version is different from the one that generated `pnpm-lock.yaml`, the Docker build will fail. Keep the lockfile committed and don't upgrade pnpm versions casually.

---

## Break-Glass Procedures

### oceannet.dev is down

1. Check Amplify job status: `aws amplify list-jobs --app-id d1a4hu9uwbjt1k --branch-name main --region eu-west-2`
2. Check DNS: `curl -I https://oceannet.dev` — should be Amplify CloudFront headers
3. Check CNAME in Cloudflare points to `d2w8xweclare78.cloudfront.net`
4. Force redeploy: push an empty commit to ocean-tech-solutions main

### API returning 401 everywhere

1. Try signing in manually: `curl -X POST https://ers3esgpp9.eu-west-2.awsapprunner.com/oceannet/v1/auth/signin -H "Content-Type: application/json" -d '{"email":"panos@oceannet.dev","password":"Oceannet2024!"}'`
2. If signin fails with "Invalid email or password" → reset the PB password (see above)
3. If signin returns token but subsequent calls fail → check App Runner logs for `ClientResponseError 404` on the old admins endpoint. Redeploy with the latest image.

### App Runner health check failing

```bash
# Check service status
aws apprunner describe-service \
  --service-arn arn:aws:apprunner:eu-west-2:323603432190:service/oceannet-api/cb9b663887be49f69cb293f05d813e93 \
  --region eu-west-2 --query 'Service.{Status:Status,Url:ServiceUrl}'

# Check recent logs
aws logs filter-log-events \
  --log-group-name "/aws/apprunner/oceannet-api/cb9b663887be49f69cb293f05d813e93/application" \
  --filter-pattern "error" --region eu-west-2 \
  --start-time $(date -v-1H +%s000) \
  --query 'events[*].message' --output text | head -50
```

### PocketBase is unreachable

```bash
# Check directly on EC2
ssh -i ~/.ssh/bettermap-key ec2-user@13.135.181.201 "docker ps | grep pocketbase"

# Restart a container
ssh -i ~/.ssh/bettermap-key ec2-user@13.135.181.201 "docker restart pocketbase-api"

# Check Traefik routes
curl -s https://traefik.db.oceannet.dev/api/http/routers 2>/dev/null | python3 -c "import sys,json; [print(r['name']) for r in json.load(sys.stdin)]"
```

### DNS propagation issues

```bash
# Check from multiple resolvers
dig @1.1.1.1 oceannet.dev A +short    # Cloudflare public resolver
dig @8.8.8.8 oceannet.dev A +short    # Google
dig @208.67.222.222 oceannet.dev A +short  # OpenDNS

# Check nameservers
dig oceannet.dev NS +short
```
