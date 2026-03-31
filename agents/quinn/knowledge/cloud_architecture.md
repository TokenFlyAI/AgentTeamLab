# Tokenfly Agent Team Lab — Cloud Architecture

**Author**: Quinn (Cloud Engineer)
**Date**: 2026-03-30
**Status**: IaC Complete — Awaiting AWS Credentials to Apply

---

## 1. System Overview

Tokenfly Agent Team Lab is a Node.js application consisting of:

| Component | Description | File |
|-----------|-------------|------|
| Web Server | Express-like HTTP server, serves dashboard + API | `server.js` |
| Backend API | REST API for agents, tasks, messages, health | `backend/api.js` |
| Agent State | File-based agent memory (status.md, heartbeat.md) | `agents/{name}/` |
| Shared State | Task board, announcements, team channel | `public/` |
| Agent Processes | 20 Claude Code subprocess agents | `run_agent.sh` |

**Key characteristics**:
- Node.js runtime (no framework dependency)
- File-based storage as primary state (not a database yet — Pat is formalizing schema)
- 20 long-running agent subprocesses per deployment
- Read/write heavy on shared filesystem (`public/task_board.md`, agent inboxes)
- Dashboard served as static HTML + JS polling `/api/*` endpoints

---

## 2. Target Cloud Architecture (AWS)

### 2.1 Architecture Diagram

```
                        ┌─────────────────────────────────────────────────────────┐
                        │                     AWS us-east-1                        │
                        │                                                           │
   Users ──────────────►│  CloudFront (CDN)                                        │
                        │       │                                                   │
                        │       ▼                                                   │
                        │  ALB (Application Load Balancer)                         │
                        │       │                                                   │
                        │   ┌───┴────────────────────────┐                         │
                        │   │      VPC (10.0.0.0/16)     │                         │
                        │   │                            │                         │
                        │   │  ┌─────────────────────┐  │                         │
                        │   │  │  ECS Fargate Service │  │                         │
                        │   │  │  (tokenfly-app)      │  │                         │
                        │   │  │  1–3 tasks           │  │                         │
                        │   │  │  1024 CPU / 2048 MB  │  │                         │
                        │   │  └──────────┬──────────┘  │                         │
                        │   │             │              │                         │
                        │   │             ▼              │                         │
                        │   │  ┌─────────────────────┐  │                         │
                        │   │  │  EFS (Elastic File   │  │                         │
                        │   │  │  System)             │  │                         │
                        │   │  │  agents/ + public/   │  │                         │
                        │   │  └─────────────────────┘  │                         │
                        │   │                            │                         │
                        │   │  ┌─────────────────────┐  │                         │
                        │   │  │  RDS PostgreSQL       │  │                         │
                        │   │  │  (future — Pat's     │  │                         │
                        │   │  │   schema migration)  │  │                         │
                        │   │  └─────────────────────┘  │                         │
                        │   └────────────────────────────┘                         │
                        │                                                           │
                        │  S3 (logs, archives, backups)                            │
                        └─────────────────────────────────────────────────────────┘
```

### 2.2 Component Decisions

| Component | Choice | Reasoning |
|-----------|--------|-----------|
| Compute | ECS Fargate | Serverless containers — no EC2 management, scales to zero, pay-per-use |
| Shared storage | EFS | POSIX filesystem — agents read/write files; EFS mounts directly to Fargate tasks |
| CDN | CloudFront | Cache static dashboard assets; reduce origin load |
| Load balancer | ALB | HTTP routing, health checks on `/api/health`, TLS termination |
| Database | RDS PostgreSQL (future) | When Pat's schema is ready; migrate from file-based to DB |
| Logs | CloudWatch Logs | Centralized logging for all agent stdout/stderr |
| Secrets | SSM Parameter Store | API keys, environment vars — never in container image |
| Networking | VPC + private subnets | ECS and EFS in private subnets; only ALB in public |

---

## 3. Network Architecture

### 3.1 VPC Design

```
VPC: 10.0.0.0/16

Public Subnets (ALB, NAT Gateway):
  us-east-1a: 10.0.1.0/24
  us-east-1b: 10.0.2.0/24

Private Subnets (ECS Fargate, EFS, RDS):
  us-east-1a: 10.0.10.0/24
  us-east-1b: 10.0.11.0/24
```

### 3.2 Security Groups

| SG | Inbound | Outbound |
|----|---------|----------|
| `sg-alb` | 443 from 0.0.0.0/0 | 3100 to sg-app |
| `sg-app` | 3100 from sg-alb | 2049 to sg-efs, 5432 to sg-rds, 443 to sg-vpce |
| `sg-efs` | 2049 from sg-app | — |
| `sg-rds` | 5432 from sg-app | — |
| `sg-vpce` | 443 from sg-app | — |

Principle: least-privilege. No direct internet access to compute or storage. With VPC endpoints, `sg-app` outbound 443 goes to `sg-vpce` (ECR, Secrets Manager, SSM, Logs) — not to the internet.

### 3.3 VPC Endpoints

Interface and gateway endpoints keep AWS API traffic inside the VPC — no NAT traversal for image pulls or secret fetches.

| Endpoint | Type | Purpose |
|----------|------|---------|
| `com.amazonaws.*.ecr.api` | Interface | ECR control plane (DescribeImages, GetAuthorizationToken) |
| `com.amazonaws.*.ecr.dkr` | Interface | ECR data plane (image layer downloads) |
| `com.amazonaws.*.s3` | Gateway (free) | ECR stores layers in S3; gateway routes off NAT |
| `com.amazonaws.*.secretsmanager` | Interface | DB credentials at container startup |
| `com.amazonaws.*.ssm` | Interface | Parameter Store + SSM Session Manager |
| `com.amazonaws.*.logs` | Interface | CloudWatch Logs (agent metrics, container stdout) |

All interface endpoints use `private_dns_enabled = true` — AWS SDK calls resolve to private IPs automatically, no application changes required.

---

## 4. Terraform Module Structure

```
infrastructure/
├── main.tf                  — root module, calls sub-modules
├── variables.tf
├── outputs.tf
├── terraform.tfvars         — (gitignored, per-env values)
├── modules/
│   ├── networking/          — VPC, subnets, SGs, NAT, IGW
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── ecs/                 — Fargate cluster, service, task definition
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── efs/                 — EFS filesystem, mount targets, access points
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── alb/                 — ALB, target group, listener, ACM cert
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── cloudfront/          — CloudFront distribution
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   └── rds/                 — RDS PostgreSQL (disabled by default)
│       ├── main.tf
│       ├── variables.tf
│       └── outputs.tf
└── environments/
    ├── dev/                 — Dev environment (smaller instances, no multi-AZ)
    └── prod/                — Prod environment (multi-AZ, larger instances)
```

---

## 5. Key Terraform Resources

### 5.1 ECS Task Definition (excerpt)

```hcl
resource "aws_ecs_task_definition" "tokenfly_app" {
  family                   = "tokenfly-app"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 1024  # 1 vCPU
  memory                   = 2048  # 2 GB

  container_definitions = jsonencode([{
    name      = "tokenfly-app"
    image     = "${var.ecr_repo_url}:${var.image_tag}"
    essential = true

    portMappings = [{ containerPort = 3100, protocol = "tcp" }]

    environment = [
      { name = "PORT",    value = "3100" },
      { name = "DIR",     value = "/data" },
      { name = "NODE_ENV", value = var.env }
    ]

    mountPoints = [{
      sourceVolume  = "agent-data"
      containerPath = "/data"
      readOnly      = false
    }]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = "/ecs/tokenfly-app"
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "ecs"
      }
    }
  }])

  volume {
    name = "agent-data"
    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.agent_data.id
      transit_encryption = "ENABLED"
      authorization_config {
        access_point_id = aws_efs_access_point.app.id
        iam             = "ENABLED"
      }
    }
  }
}
```

### 5.2 EFS Configuration

```hcl
resource "aws_efs_file_system" "agent_data" {
  creation_token   = "tokenfly-agent-data"
  performance_mode = "generalPurpose"
  throughput_mode  = "bursting"
  encrypted        = true

  lifecycle_policy {
    transition_to_ia = "AFTER_30_DAYS"
  }

  tags = { Name = "tokenfly-agent-data", Env = var.env }
}

resource "aws_efs_access_point" "app" {
  file_system_id = aws_efs_file_system.agent_data.id
  posix_user     { uid = 1000; gid = 1000 }
  root_directory {
    path = "/tokenfly"
    creation_info { owner_uid = 1000; owner_gid = 1000; permissions = "755" }
  }
}
```

### 5.3 ALB Health Check

```hcl
resource "aws_lb_target_group" "app" {
  name        = "tokenfly-app-tg"
  port        = 3100
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/api/health"
    interval            = 30
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    matcher             = "200"
  }
}
```

---

## 6. Cost Estimate (Monthly, us-east-1)

### Development Environment

| Resource | Spec | Est. Cost/mo |
|----------|------|-------------|
| ECS Fargate | 1 task × 1 vCPU × 2 GB × 730h | ~$30 |
| EFS | 5 GB active + bursting | ~$2 |
| ALB | 1 ALB + 730h | ~$22 |
| NAT Gateway | ~5 GB/mo (non-AWS traffic only) | ~$4 |
| VPC Interface Endpoints | ECR×2 + SM + SSM + Logs (1 AZ) | ~$36 |
| S3 Gateway Endpoint | Free — routes ECR layer traffic off NAT | $0 |
| CloudWatch Logs | ~1 GB/mo | ~$0.50 |
| RDS PostgreSQL | db.t3.micro, single-AZ | ~$14 |
| **Dev Total** | | **~$109/mo** |

> Note: VPC endpoints add ~$36/mo in dev but reduce NAT data charges and improve security posture. Break-even on NAT savings at ~10 GB/mo ECR pull volume.

### Production Environment

| Resource | Spec | Est. Cost/mo |
|----------|------|-------------|
| ECS Fargate | 2 tasks × 2 vCPU × 4 GB × 730h | ~$115 |
| EFS | 20 GB + multi-AZ mount | ~$10 |
| ALB | 1 ALB + moderate LCUs | ~$25 |
| NAT Gateway | 2 AZs × 20 GB data (non-AWS traffic) | ~$14 |
| VPC Interface Endpoints | ECR×2 + SM + SSM + Logs (2 AZs) | ~$73 |
| S3 Gateway Endpoint | Free | $0 |
| CloudFront | 100 GB transfer | ~$9 |
| CloudWatch Logs | 5 GB/mo + 30d retention | ~$5 |
| RDS PostgreSQL | db.t3.small, Multi-AZ | ~$55 |
| **Prod Total** | | **~$306/mo** |

> Note: Prod VPC endpoints cost ~$73/mo across 2 AZs but save ~$30/mo in NAT bandwidth (ECR + Secrets Manager calls stay off internet). Net add: ~$43/mo for meaningfully improved security (secrets never traverse internet).

**Cost optimization levers**:
- Spot/Fargate Spot for non-critical agent tasks: up to 70% compute savings
- EFS Intelligent Tiering: auto-moves cold data to IA storage (~$0.025/GB vs $0.08/GB)
- CloudFront caches dashboard HTML/JS: reduces ALB + origin traffic by ~60%
- Consolidate to 1 NAT GW in dev (already done); consider NAT instance (~$4/mo EC2 t4g.nano) vs managed NAT if budget-constrained
- VPC endpoints optional in dev — remove to save $36/mo if cost > security tradeoff

---

## 7. Container Image Strategy

```dockerfile
# infrastructure/docker/Dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy application code (not agent state — that lives on EFS)
COPY package*.json ./
RUN npm ci --only=production

COPY server.js .
COPY backend/ ./backend/
COPY public/ ./public/  # static templates only — runtime data on EFS
COPY index_lite.html .

# Agent state dir is mounted from EFS at runtime
VOLUME ["/data"]

ENV PORT=3100
ENV DIR=/data

EXPOSE 3100
CMD ["node", "server.js", "--port", "3100", "--dir", "/data"]
```

**Image tagging strategy**:
- `sha-{git-sha}` — immutable, tied to commit
- `env-dev-latest`, `env-prod-latest` — mutable pointers for rollback
- Never tag `latest` as the only tag — always include sha

**ECR lifecycle policy**: Keep last 10 tagged images; expire untagged after 1 day.

---

## 8. Deployment Strategy

### Immutable Blue/Green via ECS

1. Build new Docker image → push to ECR with `sha-{commit}` tag
2. Update ECS task definition with new image tag
3. ECS performs rolling update: new tasks start → health check passes → old tasks drain
4. ALB drains connections from old tasks (30s deregistration delay)
5. Rollback: update task definition back to previous image tag

**Zero-downtime**: ALB health checks ensure no traffic hits unhealthy containers. Minimum healthy percent = 100% during deployment (no capacity reduction).

### Deployment Environments

| Env | Branch | Trigger | Approval |
|-----|--------|---------|---------|
| dev | `main` | Auto on push | None |
| staging | `release/*` | Auto on push | None |
| prod | `release/*` | Manual trigger | Alice approval |

---

## 9. Deployment Status

### IaC Modules (all complete)

| Module | File | Status |
|--------|------|--------|
| Networking (VPC, subnets, NAT GW, VPC Endpoints) | `infrastructure/modules/networking/` | ✅ Done |
| ECS (Fargate, task def, service, autoscaling, alarms) | `infrastructure/modules/ecs/` | ✅ Done |
| EFS (encrypted, access points, mount targets) | `infrastructure/modules/efs/` | ✅ Done |
| ALB (HTTPS listener, cert, WAF, alarms) | `infrastructure/modules/alb/` | ✅ Done |
| RDS (PostgreSQL Multi-AZ, backup, alarms) | `infrastructure/modules/rds/` | ✅ Done |
| SNS (5 topics: P0/P1/P2/RDS-ops/Infra-ops, KMS) | `infrastructure/modules/sns/` | ✅ Done |
| GitHub OIDC (keyless deploy role, ECR/ECS perms) | `infrastructure/modules/github_oidc/` | ✅ Done |
| App-level CloudWatch alarms (ALT-001..ALT-010) | `infrastructure/alarms.tf` | ✅ Done |
| Root module wiring | `infrastructure/main.tf` | ✅ Done |
| Dev + Prod tfvars | `infrastructure/environments/` | ✅ Done |

### CI/CD Pipelines (all complete)

| Pipeline | File | Status |
|----------|------|--------|
| CI (lint + test gate) | `.github/workflows/ci.yml` | ✅ Done (Eve) |
| CD (ECR push + ECS rolling deploy + smoke) | `.github/workflows/cd.yml` | ✅ Done (Quinn) |
| Terraform validate (fmt + validate per module) | `.github/workflows/terraform-validate.yml` | ✅ Done (Quinn) |

### Monitoring Scripts (all complete)

| Script | Purpose | Status |
|--------|---------|--------|
| `scripts/healthcheck.js` | Poll `/api/health` every 30s, fire ALT-001/002/009 | ✅ Done (Liam) |
| `scripts/heartbeat_monitor.js` | Check agent heartbeats every 60s, fire ALT-005/006 | ✅ Done (Liam) |

### Security Status

| Finding | Fix | Status |
|---------|-----|--------|
| SEC-001: No API auth | `isAuthorized()` in server.js + api.js (API_KEY env var) | ✅ Done (Quinn) |
| SEC-011: Hardcoded DB creds | Explicit DATABASE_URL required in metrics_db.js + db_sync.js | ✅ Done |
| SEC-010/012: Metrics auth + CORS | Assigned to Eve (Task #121) | ⏳ In Progress |
| SG/IAM review | Assigned to Heidi | ⏳ Pending |

### Remaining Blockers for Production

| Blocker | Owner | Notes |
|---------|-------|-------|
| AWS account credentials | CEO/Ops | Required for `terraform apply` |
| GitHub repo name | Team | Required for OIDC trust policy (`github_repo` tfvars) |
| Heidi SG/IAM sign-off | Heidi | Security audit of network layer |
| Eve Task #121 (metrics auth + CORS) | Eve | Must merge before production |

---

## 10. Open Questions / Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| File-based state not suited for multi-task ECS | Medium — two Fargate tasks writing the same files causes race conditions | Single-task for now; migrate to RDS when Pat's schema is ready |
| 20 Claude Code subprocesses per container — high CPU | Medium — may need larger Fargate task (2 vCPU) | Benchmark locally; adjust task CPU/memory accordingly |
| EFS latency vs local disk | Low — file ops are metadata heavy (small files) | EFS General Purpose mode handles <7K ops/sec; should be fine for 20 agents |
| Dashboard auth API_KEY not rotatable without restart | Low — env var requires ECS task restart to rotate | Add `/api/admin/rotate-key` endpoint or use Secrets Manager auto-rotation |
| No staging environment | Medium — dev→prod gap increases deploy risk | Create `environments/staging/terraform.tfvars` when AWS creds available |

---

*Last updated: 2026-03-30 by Quinn*
