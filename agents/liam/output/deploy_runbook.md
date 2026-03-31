# Production Deployment Runbook — Tokenfly Agent Team Lab

**Owner:** Liam (SRE)
**Last Updated:** 2026-03-30
**Version:** 1.0
**Audience:** On-call engineers, SRE, DevOps

---

## Overview

This runbook covers the end-to-end deployment lifecycle for the Tokenfly Agent Team Lab system:
- Dashboard server (`server.js` on port 3199)
- SRE monitoring scripts (`healthcheck.js`, `heartbeat_monitor.js`)
- Agent subprocesses (20 agents managed via `smart_run.sh` / `run_all.sh`)

Deployment targets: **local/dev** (direct Node) and **prod** (AWS ECS via Terraform + ECR).

---

## 1. Pre-Deploy Checklist

Complete **all** items before beginning deployment. Block on any red item.

### 1.1 Test Suite

```bash
# Run full e2e suite (205 tests) — must be 100% green
cd /path/to/aicompany
npx playwright test

# Or by file if time-constrained (minimum required):
npx playwright test e2e/api.spec.js        # 46 tests — core API
npx playwright test e2e/dashboard.spec.js  # 35 tests — dashboard UI
npx playwright test e2e/metrics.spec.js    # 53 tests — metrics endpoints
npx playwright test e2e/coverage.spec.js   # 71 tests — coverage assertions
```

**Block deploy if any test fails.** 429 rate-limit errors during e2e runs are expected (strictLimiter) and do not indicate a bug.

### 1.2 Environment Variables

Verify the following env vars are set on the target environment:

| Variable | Required | Purpose | Example |
|----------|----------|---------|---------|
| `API_KEY` | **Yes (prod)** | Enables auth on all mutation endpoints | `API_KEY=<random-32-char-secret>` |
| `ALLOWED_ORIGINS` | **Yes (prod)** | CORS allowlist for mutation methods | `ALLOWED_ORIGINS=https://dash.tokenfly.ai` |
| `PORT` | No | Dashboard port (default: 3100; ecosystem.config.js sets 3199) | `PORT=3199` |
| `NODE_ENV` | Recommended | Enables production logging/behavior | `NODE_ENV=production` |

> **Security:** `API_KEY` must be set in prod. Without it, all `/api/*` mutation endpoints are open to unauthenticated access.
> **Exception:** `/api/health` is always public (load balancer health checks, monitoring probes).

Generate a strong API key:
```bash
openssl rand -hex 32
```

### 1.3 Infrastructure / IaC State

```bash
cd infrastructure/

# Verify Terraform is in sync
terraform plan -var-file=environments/prod/terraform.tfvars

# Expected: "No changes" or only known planned additions
# Block if: unexpected resource deletions or security group changes appear
```

Check SNS topics are provisioned (required for alerting):
```bash
terraform output p0_critical_topic_arn
terraform output p1_warning_topic_arn
# Should return non-empty ARNs
```

### 1.4 Database / Migration State

```bash
# Verify no pending migrations
ls backend/migration_*.sql | sort

# Check migration history in DB
sqlite3 backend/messages.db "SELECT * FROM schema_migrations ORDER BY applied_at DESC LIMIT 5;"
```

Block if unapplied migrations exist. Run Pat's migration runbook if needed.

### 1.5 Active Agent Check

```bash
# Stop all agents before deploying (avoids file-lock conflicts during restart)
bash stop_all.sh

# Confirm agents stopped
bash status.sh
# Expected: all agents show "stopped" or no heartbeat
```

---

## 2. Deploy Steps

### 2.1 Local / Dev Deploy

```bash
# 1. Pull latest code
git pull origin main

# 2. Install dependencies
npm ci --only=production

# 3. Run pending DB migrations (if any)
# Apply each migration_XXX.sql in order:
for f in backend/migration_*.sql; do
  echo "Applying $f..."
  sqlite3 backend/messages.db < "$f"
done

# 4. Start all services via pm2
pm2 start ecosystem.config.js
pm2 save  # persist process list

# 5. Verify dashboard is up
curl http://localhost:3199/api/health
# Expected: {"status":"ok","uptime_ms":...}

# 6. Start agents (smart-start: only agents with actual work)
bash smart_run.sh
# Or all agents:
bash run_all.sh
```

### 2.2 Production Deploy (AWS ECS)

```bash
# 1. Build Docker image
docker build -t tokenfly-dashboard:$(git rev-parse --short HEAD) .

# 2. Tag and push to ECR
AWS_ACCOUNT=<account-id>
AWS_REGION=us-east-1
ECR_REPO=$AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/tokenfly-dashboard

docker tag tokenfly-dashboard:$(git rev-parse --short HEAD) $ECR_REPO:$(git rev-parse --short HEAD)
docker tag tokenfly-dashboard:$(git rev-parse --short HEAD) $ECR_REPO:env-prod-latest
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REPO
docker push $ECR_REPO:$(git rev-parse --short HEAD)
docker push $ECR_REPO:env-prod-latest

# 3. Apply Terraform (ECS task definition + service update)
cd infrastructure/
terraform apply -var-file=environments/prod/terraform.tfvars -auto-approve

# 4. Wait for ECS to stabilize (new tasks healthy, old tasks drained)
aws ecs wait services-stable \
  --cluster tokenfly-prod \
  --services dashboard

# 5. Verify ALB health check passes
aws elbv2 describe-target-health \
  --target-group-arn <target-group-arn> \
  --query 'TargetHealthDescriptions[*].TargetHealth'
# Expected: all targets "healthy"
```

---

## 3. Rollback Procedure

Use this if: post-deploy smoke tests fail, error rate spikes, or P0 alert fires within 15 minutes of deploy.

### 3.1 Local Rollback

```bash
# 1. Stop all pm2 processes
pm2 stop all

# 2. Revert to previous git commit
git log --oneline -5  # identify last known-good SHA
git checkout <known-good-sha>

# 3. Restart
pm2 start ecosystem.config.js

# 4. Verify
curl http://localhost:3199/api/health
```

### 3.2 Production Rollback (ECS)

```bash
# Option A: Re-deploy previous ECR image tag
# Edit infrastructure/environments/prod/terraform.tfvars:
#   image_tag = "<previous-sha>"  (or "env-prod-previous")
terraform apply -var-file=environments/prod/terraform.tfvars -auto-approve
aws ecs wait services-stable --cluster tokenfly-prod --services dashboard

# Option B: Force ECS to use previous task definition revision
PREV_REVISION=$(aws ecs describe-task-definition \
  --task-definition tokenfly-dashboard \
  --query 'taskDefinition.revision' \
  --output text)
# Decrement by 1 and force new deployment
aws ecs update-service \
  --cluster tokenfly-prod \
  --service dashboard \
  --task-definition tokenfly-dashboard:$((PREV_REVISION - 1)) \
  --force-new-deployment
```

### 3.3 Database Rollback

SQLite migrations are not auto-reversible. If a migration caused data loss:
```bash
# Restore from pre-deploy backup
cp backend/messages.db.bak backend/messages.db
# Re-apply only the safe migrations
```

> Always create a backup before migrations: `cp backend/messages.db backend/messages.db.bak`

---

## 4. Post-Deploy Smoke Tests

Run within 5 minutes of deployment completing.

```bash
BASE=http://localhost:3199  # or prod URL
KEY=<API_KEY>

# 4.1 Health check (public — no auth)
curl -f $BASE/api/health
# Expected: 200 {"status":"ok"}

# 4.2 Agent list (requires auth)
curl -f -H "Authorization: Bearer $KEY" $BASE/api/agents
# Expected: 200, array of agents

# 4.3 Task board
curl -f -H "Authorization: Bearer $KEY" $BASE/api/tasks
# Expected: 200, array of tasks

# 4.4 Metrics
curl -f -H "Authorization: Bearer $KEY" $BASE/api/metrics
# Expected: 200 with latency + throughput fields

# 4.5 Auth gate (expect 401 without key)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" $BASE/api/agents)
[ "$STATUS" = "401" ] && echo "Auth gate OK" || echo "FAIL: auth gate returned $STATUS"

# 4.6 SRE monitoring scripts running
curl -f $BASE/api/health  # healthcheck.js polls this
cat public/reports/health_check_log.jsonl | tail -1 | python3 -m json.tool
# Expected: recent timestamp, status_code:200, heap_used non-null
```

**If any smoke test fails:** execute rollback procedure immediately. Do not investigate in prod.

---

## 5. pm2 Operations Reference

```bash
# View all process statuses
pm2 list

# Live monitoring (CPU, memory, logs)
pm2 monit

# Restart a specific process
pm2 restart dashboard
pm2 restart healthcheck
pm2 restart heartbeat-monitor

# Restart all
pm2 restart all

# Reload with zero-downtime (fork mode only)
pm2 reload dashboard

# View logs
pm2 logs dashboard --lines 50
pm2 logs healthcheck --lines 20

# Clear logs
pm2 flush

# Stop and remove from pm2
pm2 delete dashboard

# Save current process list (survives reboots)
pm2 save

# Setup auto-start on system boot (run output as root/sudo)
pm2 startup
```

---

## 6. Monitoring During Deploy

Watch these signals during and after deployment:

| Signal | Command | Healthy Range |
|--------|---------|--------------|
| HTTP availability | `curl $BASE/api/health` | 200 OK |
| Latency p50 | health response `p50_ms` | < 10ms |
| Latency p99 | health response `p99_ms` | < 100ms |
| Active agents | health response `activeAgents` | ≥ 15 (after run_all.sh) |
| Active alerts | `cat public/reports/active_alerts.md` | No P0/P1 items |
| Heap utilization | health response `heapUsed/heapTotal` | < 85% and > 50MB total |

SRE monitoring scripts update automatically:
- `public/reports/health_check_log.jsonl` — every 30s (healthcheck.js)
- `public/reports/heartbeat_status.json` — every 60s (heartbeat_monitor.js)
- `public/reports/active_alerts.md` — updated by both scripts

---

## 7. Known Issues and Gotchas

| Issue | Impact | Mitigation |
|-------|--------|-----------|
| `API_KEY=test` in env | All /api/* requires auth; healthcheck.js uses it if set | Use strong random key in prod; confirm `/api/health` returns 200 without key |
| pm2 `max_restarts: 10` | After 10 rapid restarts, process enters errored state | `pm2 reset dashboard` then `pm2 restart dashboard` |
| SQLite WAL files (`messages.db-shm`, `-wal`) | Must be present alongside `.db` file | Never copy `.db` without its WAL pair; use `VACUUM INTO` for clean exports |
| Heap ratio alert (ALT-009) | V8 starts with small heap (~10MB); ratio is high even at idle | Alert uses `heap_min_total_mb: 50` gate and 3-check sustain window to suppress false positives |
| Rate limiter 429s in e2e | Tina's tests deliberately trigger 429s | Expected behavior — do not adjust thresholds for test runs |
| Agent inbox flood | 100+ messages from Tina broadcast tests can slow inbox processing | Normal operation; all agents process and archive in bulk |

---

## 8. Escalation Path

| Severity | Who | How |
|----------|-----|-----|
| P0 — System down | Alice (Tech Lead) | Write to `agents/alice/chat_inbox/` or ping via CEO command API |
| P1 — Degraded perf | Liam (SRE on-call) | Check `active_alerts.md`; page Alice if unresolved >15min |
| P2 — Minor anomaly | Liam (SRE) | Log in `output/reliability_risks.md`; address next cycle |
| Infrastructure (AWS/Terraform) | Quinn (Cloud) | Task or inbox message |
| Database issues | Pat (Database) | Task or inbox message |
| Security incidents | Heidi (Security) | Task marked P0 + Alice inbox |

---

*Liam (SRE) — agents/liam/output/deploy_runbook.md*
*Coordinates with: Quinn (IaC), Pat (DB migrations), Eve (pm2 config), Heidi (security)*
