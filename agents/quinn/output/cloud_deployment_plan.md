# Cloud Deployment Plan — Kalshi Trading Pipeline
**Author**: Quinn (Cloud Engineer)
**Task**: T267
**Date**: 2026-04-03
**Target**: AWS (primary) with GCP alternative noted

---

## Architecture Overview

```
                          ┌─────────────────────────────────────────┐
                          │              AWS VPC (us-east-1)         │
                          │                                           │
  Internet ───── ALB ──── │ ── EC2 t3.small ───────────────────────  │
  (HTTPS:443)   (port 80) │   ┌───────────────────────────────────┐  │
                          │   │  Docker Compose                   │  │
                          │   │  ┌─────────────┐ ┌─────────────┐  │  │
                          │   │  │  dashboard  │ │  trading-   │  │  │
                          │   │  │  (port 3199)│ │  api(:8080) │  │  │
                          │   │  └─────────────┘ └──────┬──────┘  │  │
                          │   │  ┌─────────────────────────────┐  │  │
                          │   │  │  scheduler (loop every 10m) │  │  │
                          │   │  └─────────────────────────────┘  │  │
                          │   └───────────────────────────────────┘  │
                          │                    │                       │
                          │   RDS PostgreSQL ──┘                      │
                          │   (db.t3.micro, private subnet)           │
                          └─────────────────────────────────────────────┘
                                      │
                               Secrets Manager
                               (KALSHI_API_KEY, DB creds, JWT_SECRET)
                                      │
                               CloudWatch Logs
                               (pipeline + dashboard logs)
```

---

## Why This Architecture

**Single EC2 + Docker Compose** rather than ECS/EKS:
- One person can deploy in a day
- No cluster management overhead
- The existing `Dockerfile` and `docker-compose.yml` work as-is with minor additions
- Easy SSH access for debugging during early production phase
- Total cost: ~$42/month (vs $100+/month for ECS Fargate + ALB)

**Upgrade path**: Once trading is proven in production, migrate `trading-api` and `scheduler` to ECS Fargate without changing application code.

---

## Step-by-Step Deployment

### 1. Prerequisites (30 min)

```bash
# Install AWS CLI + Terraform
brew install awscli terraform
aws configure  # region: us-east-1
```

### 2. Terraform — VPC + EC2 + RDS + Secrets

Save as `infrastructure/trading/main.tf`:

```hcl
terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
  backend "s3" {
    bucket = "tokenfly-tf-state"
    key    = "trading/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" { region = "us-east-1" }

# ── VPC ──────────────────────────────────────────────────────────────────────
resource "aws_vpc" "trading" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "tokenfly-trading" }
}

resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.trading.id
}

resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.trading.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "us-east-1a"
  map_public_ip_on_launch = true
  tags = { Name = "tokenfly-public-a" }
}

resource "aws_subnet" "private_a" {
  vpc_id            = aws_vpc.trading.id
  cidr_block        = "10.0.10.0/24"
  availability_zone = "us-east-1a"
  tags = { Name = "tokenfly-private-a" }
}

resource "aws_subnet" "private_b" {
  vpc_id            = aws_vpc.trading.id
  cidr_block        = "10.0.11.0/24"
  availability_zone = "us-east-1b"
  tags = { Name = "tokenfly-private-b" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.trading.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }
}

resource "aws_route_table_association" "public_a" {
  subnet_id      = aws_subnet.public_a.id
  route_table_id = aws_route_table.public.id
}

# ── Security Groups ───────────────────────────────────────────────────────────
resource "aws_security_group" "ec2" {
  name   = "tokenfly-ec2"
  vpc_id = aws_vpc.trading.id

  ingress {
    description = "Dashboard"
    from_port   = 3199
    to_port     = 3199
    protocol    = "tcp"
    cidr_blocks = [var.allowed_cidr]   # Set to your IP: "1.2.3.4/32"
  }
  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.allowed_cidr]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "tokenfly-ec2-sg" }
}

resource "aws_security_group" "rds" {
  name   = "tokenfly-rds"
  vpc_id = aws_vpc.trading.id

  ingress {
    description     = "Postgres from EC2 only"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ec2.id]
  }
  tags = { Name = "tokenfly-rds-sg" }
}

# ── RDS PostgreSQL ────────────────────────────────────────────────────────────
resource "aws_db_subnet_group" "trading" {
  name       = "tokenfly-trading"
  subnet_ids = [aws_subnet.private_a.id, aws_subnet.private_b.id]
}

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "aws_db_instance" "trading" {
  identifier        = "tokenfly-trading"
  engine            = "postgres"
  engine_version    = "16.3"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  storage_type      = "gp2"

  db_name  = "kalshi_trading"
  username = "trading_user"
  password = random_password.db.result

  db_subnet_group_name   = aws_db_subnet_group.trading.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  backup_retention_period   = 7
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "tokenfly-trading-final"

  tags = { Name = "tokenfly-trading-db" }
}

# ── EC2 ───────────────────────────────────────────────────────────────────────
data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }
}

resource "aws_iam_role" "ec2" {
  name = "tokenfly-ec2-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "ec2_permissions" {
  role = aws_iam_role.ec2.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [aws_secretsmanager_secret.trading.arn]
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

resource "aws_iam_instance_profile" "ec2" {
  name = "tokenfly-ec2-profile"
  role = aws_iam_role.ec2.name
}

resource "aws_instance" "trading" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = "t3.small"
  subnet_id              = aws_subnet.public_a.id
  vpc_security_group_ids = [aws_security_group.ec2.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name
  key_name               = var.key_pair_name

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
  }

  user_data = templatefile("${path.module}/user_data.sh", {
    secret_arn = aws_secretsmanager_secret.trading.arn
    db_host    = aws_db_instance.trading.address
    db_name    = aws_db_instance.trading.db_name
    db_user    = aws_db_instance.trading.username
    aws_region = "us-east-1"
  })

  tags = { Name = "tokenfly-trading" }
}

resource "aws_eip" "trading" {
  instance = aws_instance.trading.id
  domain   = "vpc"
}

# ── Secrets Manager ───────────────────────────────────────────────────────────
resource "random_password" "jwt" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "trading" {
  name                    = "tokenfly/trading"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "trading" {
  secret_id = aws_secretsmanager_secret.trading.id
  secret_string = jsonencode({
    KALSHI_API_KEY        = var.kalshi_api_key
    API_KEY               = var.dashboard_api_key
    DASHBOARD_API_KEY     = var.dashboard_api_key
    JWT_SECRET            = random_password.jwt.result
    DB_PASSWORD           = random_password.db.result
    TRADING_ALERT_WEBHOOK = var.trading_alert_webhook
  })
}

# ── CloudWatch Log Groups ─────────────────────────────────────────────────────
resource "aws_cloudwatch_log_group" "pipeline" {
  name              = "/tokenfly/trading/pipeline"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "dashboard" {
  name              = "/tokenfly/trading/dashboard"
  retention_in_days = 14
}

# ── Cost Alert ────────────────────────────────────────────────────────────────
resource "aws_budgets_budget" "trading" {
  name         = "tokenfly-trading-monthly"
  budget_type  = "COST"
  limit_amount = "60"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }
}

# ── Variables ─────────────────────────────────────────────────────────────────
variable "kalshi_api_key"        { sensitive = true }
variable "dashboard_api_key"     { sensitive = true }
variable "trading_alert_webhook" { default = "" }
variable "key_pair_name"         { default = "tokenfly-trading" }
variable "alert_email"           {}
variable "allowed_cidr"          { description = "Your IP in CIDR: 1.2.3.4/32" }

# ── Outputs ───────────────────────────────────────────────────────────────────
output "instance_ip" { value = aws_eip.trading.public_ip }
output "ssh_command"  { value = "ssh -i ~/.ssh/${var.key_pair_name}.pem ec2-user@${aws_eip.trading.public_ip}" }
output "dashboard_url" { value = "http://${aws_eip.trading.public_ip}:3199" }
```

### 3. EC2 Bootstrap Script (`infrastructure/trading/user_data.sh`)

```bash
#!/bin/bash
set -e

# Install Docker
dnf install -y docker aws-cli
systemctl enable --now docker
usermod -aG docker ec2-user

# Docker Compose plugin
mkdir -p /usr/local/lib/docker/cli-plugins
curl -sL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# Fetch secrets from Secrets Manager
SECRET=$(aws secretsmanager get-secret-value \
  --secret-id "${secret_arn}" \
  --region "${aws_region}" \
  --query SecretString --output text)

# Parse secret JSON values
KALSHI_API_KEY=$(echo "$SECRET"    | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['KALSHI_API_KEY'])")
API_KEY=$(echo "$SECRET"           | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['API_KEY'])")
DASHBOARD_API_KEY=$(echo "$SECRET" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['DASHBOARD_API_KEY'])")
JWT_SECRET=$(echo "$SECRET"        | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['JWT_SECRET'])")
DB_PASSWORD=$(echo "$SECRET"       | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['DB_PASSWORD'])")
WEBHOOK=$(echo "$SECRET"           | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('TRADING_ALERT_WEBHOOK',''))")

# Write env file (600 permissions — not world-readable)
mkdir -p /opt/tokenfly
cat > /opt/tokenfly/.env <<EOF
NODE_ENV=production
PAPER_TRADING=true

KALSHI_API_KEY=$KALSHI_API_KEY
API_KEY=$API_KEY
DASHBOARD_API_KEY=$DASHBOARD_API_KEY
JWT_SECRET=$JWT_SECRET

DB_HOST=${db_host}
DB_PORT=5432
DB_NAME=${db_name}
DB_USER=${db_user}
DB_PASSWORD=$DB_PASSWORD
PGSSLMODE=require

MAX_POSITION_SIZE=50
MAX_DAILY_LOSS=200
MAX_DRAWDOWN=10
MAX_TOTAL_EXPOSURE=500
MAX_CONCENTRATION=20

TRADING_ALERT_WEBHOOK=$WEBHOOK
EOF
chmod 600 /opt/tokenfly/.env

# Clone repo (replace with actual repo URL)
cd /opt/tokenfly
git clone https://github.com/tokenflyai/aicompany.git .

# Initialize DB schema
export $(grep -v '^#' .env | xargs)
cd agents/bob/backend
node -e "
  const {Pool}=require('pg');
  const fs=require('fs');
  const pool=new Pool();
  const sql=fs.readFileSync('db/schema.sql','utf8')
    +fs.readFileSync('db/schema_strategies.sql','utf8')
    +fs.readFileSync('db/schema_risk.sql','utf8');
  pool.query(sql)
    .then(()=>{console.log('DB init OK');process.exit(0)})
    .catch(e=>{console.error(e);process.exit(1)});
"
cd /opt/tokenfly

# Start stack
docker compose -f docker-compose.prod.yml up -d --build
echo "Tokenfly trading stack started"
```

### 4. Production Docker Compose (`docker-compose.prod.yml`)

```yaml
version: "3.9"
services:
  dashboard:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: tokenfly-dashboard
    env_file: /opt/tokenfly/.env
    ports:
      - "3199:3199"
    volumes:
      - ./agents:/app/agents
      - ./public:/app/public
      - /tmp/aicompany_runtime_logs:/tmp/aicompany_runtime_logs
    restart: unless-stopped
    logging:
      driver: awslogs
      options:
        awslogs-group: /tokenfly/trading/dashboard
        awslogs-region: us-east-1
        awslogs-stream: dashboard

  trading-api:
    build:
      context: ./agents/bob/backend
      dockerfile: Dockerfile.api
    container_name: tokenfly-trading-api
    env_file: /opt/tokenfly/.env
    ports:
      - "8080:8080"
    restart: unless-stopped
    logging:
      driver: awslogs
      options:
        awslogs-group: /tokenfly/trading/pipeline
        awslogs-region: us-east-1
        awslogs-stream: trading-api

  scheduler:
    build:
      context: ./agents/bob/backend
      dockerfile: Dockerfile.scheduler
    container_name: tokenfly-scheduler
    env_file: /opt/tokenfly/.env
    restart: unless-stopped
    logging:
      driver: awslogs
      options:
        awslogs-group: /tokenfly/trading/pipeline
        awslogs-region: us-east-1
        awslogs-stream: scheduler
```

### 5. Dockerfiles for Trading Backend

**`agents/bob/backend/Dockerfile.api`**:
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 8080
ENV PORT=8080
CMD ["node", "api/server.js"]
```

**`agents/bob/backend/Dockerfile.scheduler`**:
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
# Replaces run_scheduler.sh — same 10-minute loop, Docker handles restarts
CMD ["sh", "-c", "while true; do node strategies/live_runner.js; sleep 600; done"]
```

### 6. Terraform Variables (`infrastructure/trading/terraform.tfvars`)

```hcl
# !! Add to .gitignore — never commit !!
kalshi_api_key        = "your-kalshi-api-key"
dashboard_api_key     = "your-dashboard-api-key"
trading_alert_webhook = "https://hooks.slack.com/services/..."
key_pair_name         = "tokenfly-trading"
alert_email           = "alerts@tokenfly.ai"
allowed_cidr          = "YOUR_IP/32"
```

### 7. Deploy Commands (One-Time)

```bash
# 1. Create EC2 SSH key pair
aws ec2 create-key-pair \
  --key-name tokenfly-trading \
  --query 'KeyMaterial' \
  --output text > ~/.ssh/tokenfly-trading.pem
chmod 400 ~/.ssh/tokenfly-trading.pem

# 2. Create Terraform state bucket
aws s3api create-bucket \
  --bucket tokenfly-tf-state \
  --region us-east-1
aws s3api put-bucket-versioning \
  --bucket tokenfly-tf-state \
  --versioning-configuration Status=Enabled

# 3. Deploy infrastructure
cd infrastructure/trading
terraform init
terraform plan  -var-file=terraform.tfvars
terraform apply -var-file=terraform.tfvars

# 4. Verify
INSTANCE_IP=$(terraform output -raw instance_ip)
curl -s http://$INSTANCE_IP:3199/api/health        # expect {"ok":true,...}
ssh -i ~/.ssh/tokenfly-trading.pem ec2-user@$INSTANCE_IP \
  "docker ps"                                       # expect 3 containers
```

---

## Environment Variables Reference

| Variable | Source | Description |
|----------|--------|-------------|
| `KALSHI_API_KEY` | Secrets Manager | Kalshi trading API credentials |
| `API_KEY` | Secrets Manager | Dashboard API auth token |
| `DASHBOARD_API_KEY` | Secrets Manager | Alias for API_KEY (internal calls) |
| `JWT_SECRET` | Secrets Manager (auto-generated) | JWT signing key, 64-char random |
| `DB_HOST` | Terraform output (auto) | RDS endpoint |
| `DB_PORT` | user_data | `5432` |
| `DB_NAME` | Terraform (auto) | `kalshi_trading` |
| `DB_USER` | Terraform (auto) | `trading_user` |
| `DB_PASSWORD` | Secrets Manager (auto-generated) | RDS password |
| `PGSSLMODE` | user_data | `require` (RDS enforces TLS) |
| `PAPER_TRADING` | user_data | `true` — **change to `false` requires Founder approval** |
| `KALSHI_DEMO` | optional | `1` to use Kalshi demo API instead of live |
| `MAX_POSITION_SIZE` | user_data | Max contracts per position (50) |
| `MAX_DAILY_LOSS` | user_data | Daily loss ceiling USD (200) |
| `MAX_DRAWDOWN` | user_data | Max drawdown % (10) |
| `MAX_TOTAL_EXPOSURE` | user_data | Max total exposure USD (500) |
| `TRADING_ALERT_WEBHOOK` | Secrets Manager | Slack/webhook URL for trade alerts |
| `NODE_ENV` | user_data | `production` |

---

## Scheduler Design

`run_scheduler.sh` runs `live_runner.js` every 10 minutes. The container replaces it:

```dockerfile
CMD ["sh", "-c", "while true; do node strategies/live_runner.js; sleep 600; done"]
```

- `restart: unless-stopped` in Docker Compose handles crashes automatically
- Logs stream to CloudWatch via `awslogs` driver
- Future option: AWS EventBridge Scheduler → ECS Fargate task (zero idle cost, no EC2 needed)

---

## Monitoring

### CloudWatch Metric Filter — Pipeline Failures

```bash
aws logs put-metric-filter \
  --log-group-name /tokenfly/trading/pipeline \
  --filter-name PipelineFailures \
  --filter-pattern "Pipeline FAILED" \
  --metric-transformations \
    metricName=PipelineFailures,metricNamespace=Tokenfly,metricValue=1
```

### CloudWatch Alarm — Alert on Failure

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name tokenfly-pipeline-failure \
  --metric-name PipelineFailures \
  --namespace Tokenfly \
  --statistic Sum \
  --period 600 \
  --threshold 1 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --evaluation-periods 1 \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT:tokenfly-alerts
```

### Key metrics to watch
| Metric | Threshold | Action |
|--------|-----------|--------|
| Pipeline FAILED in logs | Any occurrence | Page via SNS |
| EC2 CPUUtilization | > 80% for 5 min | Investigate / upgrade instance |
| RDS FreeStorageSpace | < 2 GB | Expand allocated storage |
| Monthly spend | > $48 | Budget alert fires to email |

---

## Monthly Cost Estimate

| Resource | Spec | Cost/month |
|----------|------|------------|
| EC2 t3.small | 2 vCPU, 2 GB RAM | ~$15 |
| RDS db.t3.micro | PostgreSQL 16, 20 GB | ~$17 |
| EBS gp3 20 GB | EC2 root volume | ~$2 |
| Elastic IP | Static IP | ~$4 |
| CloudWatch Logs | ~5 GB/month | ~$3 |
| Secrets Manager | 1 secret | ~$0.40 |
| Data transfer | ~10 GB out | ~$1 |
| **Total** | | **~$42/month** |

Cost alert fires at $48 (80% of $60 budget). Defined in Terraform.

**GCP equivalent** (if preferred): `e2-small` (~$13) + Cloud SQL `db-f1-micro` (~$10) + Cloud Logging ≈ $30/month. Same architecture, swap `aws_` providers for `google_` — no application code changes.

---

## Security Notes

1. **Network isolation**: RDS is in private subnets — unreachable from internet. EC2 is the only database client.
2. **Secrets at rest**: API keys fetched from Secrets Manager at boot, written to `/opt/tokenfly/.env` with `chmod 600`. Rotate by updating the Secrets Manager secret and re-running `user_data.sh` (or SSHing in and restarting containers).
3. **SSH lockdown**: `allowed_cidr` variable restricts SSH and dashboard access to a single IP. Update after deploy if your IP changes.
4. **Paper trading gate**: `PAPER_TRADING=true` by default. `live_runner.js` enforces: `const PAPER_TRADING = process.env.PAPER_TRADING !== 'false'`. Flipping to live requires explicit Founder approval (consensus.md entry #1).
5. **IAM least-privilege**: EC2 role has only `secretsmanager:GetSecretValue` + CloudWatch write. No admin, no S3 read, no EC2 describe.

---

## Rollback

```bash
# Stop containers only (preserves RDS data)
ssh ec2-user@$INSTANCE_IP \
  "docker compose -f /opt/tokenfly/docker-compose.prod.yml down"

# Roll back to previous git commit + restart
ssh ec2-user@$INSTANCE_IP "cd /opt/tokenfly && git revert HEAD && \
  docker compose -f docker-compose.prod.yml up -d --build"

# Destroy all infrastructure (RDS snapshot taken automatically)
cd infrastructure/trading && terraform destroy -var-file=terraform.tfvars
```

---

## Day-One Checklist

- [ ] `aws configure` with IAM user (EC2, RDS, Secrets Manager, IAM, S3, Budgets permissions)
- [ ] Create SSH key pair: `aws ec2 create-key-pair --key-name tokenfly-trading`
- [ ] Fill in `terraform.tfvars` with real API keys (never commit this file)
- [ ] `terraform init && terraform apply`
- [ ] SSH in, verify `docker ps` shows 3 containers running
- [ ] `curl http://$INSTANCE_IP:3199/api/health` returns `{"ok":true}`
- [ ] Tail pipeline log: `docker logs -f tokenfly-scheduler`
- [ ] Confirm `PAPER_TRADING=true` before any order execution
- [ ] Set `allowed_cidr` to your real IP in tfvars + `terraform apply`

---

*Quinn — Cloud Engineer | Agent Planet*
*All infrastructure is code. `infrastructure/trading/` is the source of truth — no manual console changes.*
