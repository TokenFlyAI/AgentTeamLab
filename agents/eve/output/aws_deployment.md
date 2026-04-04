# AWS Deployment Runbook — Kalshi Trading Pipeline
**Task**: T316 | **Author**: Eve (Infra) | **Date**: 2026-04-03

## Architecture

ECS Fargate deployment with 3 services:
- **kalshi-dashboard** (port 3200) — Express API serving trade signals and frontend
- **kalshi-scheduler** — Runs `live_runner.js` every 10 minutes
- **kalshi-monitor** — Health checks and alerting

```
Internet ── ALB ── ECS Fargate (dashboard:3200)
                      ├── dashboard  (Fargate, 256 CPU / 512 MB)
                      ├── scheduler  (Fargate Spot, 128 CPU / 256 MB)
                      └── monitor    (Fargate Spot, 128 CPU / 256 MB)
```

## Files Delivered

| File | Purpose |
|------|---------|
| `infrastructure/trading/main.tf` | Terraform: VPC, ALB, ECS cluster, services, IAM, Secrets Manager, CloudWatch |
| `infrastructure/trading/ecs-task-dashboard.json` | ECS task definition for dashboard |
| `infrastructure/trading/ecs-task-scheduler.json` | ECS task definition for scheduler |
| `infrastructure/trading/ecs-task-monitor.json` | ECS task definition for monitor |
| `agents/bob/backend/Dockerfile.api` | Dashboard container image |
| `agents/bob/backend/Dockerfile.scheduler` | Scheduler container image |
| `agents/bob/backend/Dockerfile.monitor` | Monitor container image |

## Prerequisites

1. AWS CLI installed and configured (`aws configure`)
2. Terraform >= 1.5
3. Docker installed and running
4. ECR repository access (or use Docker Hub)

## Step 1: Build & Push Images

```bash
cd agents/bob/backend

# Build images
docker build -t tokenfly/dashboard:latest -f Dockerfile.api .
docker build -t tokenfly/scheduler:latest -f Dockerfile.scheduler .
docker build -t tokenfly/monitor:latest -f Dockerfile.monitor .

# Push to ECR (replace ACCOUNT_ID and region)
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com

docker tag tokenfly/dashboard:latest ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/tokenfly/dashboard:latest
docker tag tokenfly/scheduler:latest ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/tokenfly/scheduler:latest
docker tag tokenfly/monitor:latest ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/tokenfly/monitor:latest

docker push ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/tokenfly/dashboard:latest
docker push ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/tokenfly/scheduler:latest
docker push ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/tokenfly/monitor:latest
```

Update the `image` fields in the ECS task definition JSON files to match your ECR URLs.

## Step 2: Create Terraform State Bucket

```bash
aws s3api create-bucket --bucket tokenfly-tf-state --region us-east-1
aws s3api put-bucket-versioning --bucket tokenfly-tf-state --versioning-configuration Status=Enabled
```

## Step 3: Deploy Infrastructure

```bash
cd infrastructure/trading

# Create tfvars (add to .gitignore — never commit secrets)
cat > terraform.tfvars <<EOF
kalshi_api_key    = "your-kalshi-api-key"
dashboard_api_key = "your-dashboard-api-key"
alert_email       = "alerts@tokenfly.ai"
allowed_cidr      = "YOUR_IP/32"
EOF

terraform init
terraform plan -var-file=terraform.tfvars
terraform apply -var-file=terraform.tfvars
```

## Step 4: Register Task Definitions (if using JSON files directly)

```bash
# Substitute ACCOUNT_ID in JSON files, then register:
aws ecs register-task-definition --cli-input-json file://ecs-task-dashboard.json
aws ecs register-task-definition --cli-input-json file://ecs-task-scheduler.json
aws ecs register-task-definition --cli-input-json file://ecs-task-monitor.json
```

## Step 5: Verify Deployment

```bash
# Get dashboard URL
DASHBOARD_URL=$(terraform output -raw dashboard_url)
curl -s http://$DASHBOARD_URL/health

# Check ECS services
aws ecs describe-services --cluster tokenfly-trading --services dashboard scheduler monitor

# Tail logs
aws logs tail /tokenfly/trading/dashboard --follow
aws logs tail /tokenfly/trading/scheduler --follow
aws logs tail /tokenfly/trading/monitor --follow
```

## Security Checklist

- [ ] `PAPER_TRADING=true` is hardcoded in task definitions and Dockerfiles (double protection)
- [ ] API keys are stored in AWS Secrets Manager, never in Git or env files
- [ ] `allowed_cidr` restricts dashboard and ALB access to operator IP only
- [ ] ECS task execution role has least privilege (Secrets Manager read + CloudWatch write only)
- [ ] Scheduler and monitor run on Fargate Spot to reduce cost

## Cost Estimate

| Resource | Spec | Cost/month |
|----------|------|------------|
| Dashboard (Fargate) | 0.25 vCPU, 0.5 GB | ~$9 |
| Scheduler (Fargate Spot) | 0.125 vCPU, 0.25 GB | ~$3 |
| Monitor (Fargate Spot) | 0.125 vCPU, 0.25 GB | ~$3 |
| ALB | LCU-minimum | ~$16 |
| CloudWatch Logs | ~2 GB/month | ~$1 |
| Secrets Manager | 1 secret | ~$0.40 |
| **Total** | | **~$32/month** |

Budget alert fires at 80% of $40/month.

## Known Issues

- `monitor.js` currently polls `localhost:3100` for strategy API health. This port is not exposed by any service. The monitor will log P0-Critical alerts until Liam (Task #238) updates the health check target to the dashboard port (3200) or trade_signals.json mtime.

## Rollback

```bash
# Scale services to zero (preserves task definitions)
aws ecs update-service --cluster tokenfly-trading --service dashboard --desired-count 0
aws ecs update-service --cluster tokenfly-trading --service scheduler --desired-count 0
aws ecs update-service --cluster tokenfly-trading --service monitor --desired-count 0

# Destroy all infrastructure
cd infrastructure/trading
terraform destroy -var-file=terraform.tfvars
```

## References

- Quinn's Cloud Deployment Plan: `agents/quinn/output/cloud_deployment_plan.md`
- Trading API: `agents/bob/backend/dashboard_api.js`
- Scheduler: `agents/bob/backend/dashboard/run_scheduler.sh`
- Monitor: `agents/bob/backend/dashboard/monitor.js`
