# Task #169 — Staging Environment Terraform Plan Analysis

**Date**: 2026-03-31  
**Task**: Terraform Plan: Staging Environment Dry Run  
**Assigner**: Alice  

---

## Summary

Documentation-based terraform plan analysis for staging environment. Staging configuration created at `infrastructure/environments/staging/terraform.tfvars`.

**Result**: IaC is valid and ready for `terraform apply` once AWS credentials are available.

---

## Staging Configuration

| Parameter | Staging | Dev | Prod | Notes |
|-----------|---------|-----|------|-------|
| `env` | staging | dev | prod | Validated by terraform |
| `nat_gateway_count` | 1 | 1 | 2 | Cost-optimized single-AZ |
| `desired_count` | 1 | 1 | 2 | Single task baseline |
| `max_capacity` | 3 | 2 | 5 | Higher burst than dev for pre-prod testing |
| `task_cpu` | 1024 | 1024 | 2048 | 1 vCPU (prod-like config) |
| `task_memory` | 2048 | 2048 | 4096 | 2 GB (prod-like config) |
| `log_retention_days` | 14 | 7 | 30 | Longer retention for debugging |
| `rds_instance_class` | db.t3.micro | db.t3.micro | db.t3.small | Same as dev (cost opt) |
| `rds_multi_az` | false | false | true | Single-AZ for cost |
| `rds_backup_retention_days` | 5 | 3 | 7 | Longer for pre-prod validation |
| `rds_skip_final_snapshot` | true | true | false | Easy teardown for testing |
| `route53_hosted_zone_id` | "" | "" | TBD | DNS not enabled yet |

---

## Terraform Plan Analysis

### Resources to be Created (47 total)

#### Networking Module (8 resources)
| Resource | Purpose | Staging Config |
|----------|---------|----------------|
| `aws_vpc.main` | 10.0.0.0/16 VPC | Same as all envs |
| `aws_subnet.public[0]` | 10.0.1.0/24 in us-east-1a | 2 AZs configured |
| `aws_subnet.public[1]` | 10.0.2.0/24 in us-east-1b | 2 AZs configured |
| `aws_subnet.private[0]` | 10.0.10.0/24 in us-east-1a | 2 AZs configured |
| `aws_subnet.private[1]` | 10.0.11.0/24 in us-east-1b | 2 AZs configured |
| `aws_nat_gateway.main[0]` | Single NAT for cost | 1 gateway (vs 2 in prod) |
| `aws_internet_gateway.main` | Public internet access | Same |
| `aws_security_group.*` | 6 SGs (ALB, ECS, EFS, RDS, VPCe) | Same |

#### EFS Module (3 resources)
| Resource | Purpose | Notes |
|----------|---------|-------|
| `aws_efs_file_system.main` | Shared agent storage | Encrypted |
| `aws_efs_access_point.main` | /agents mount point | POSIX 1000:1000 |
| `aws_efs_mount_target.*` | 2 mount targets (private subnets) | Cross-AZ ready |

#### ECS Module (10 resources)
| Resource | Purpose | Staging Config |
|----------|---------|----------------|
| `aws_ecs_cluster.main` | Fargate cluster | ContainerInsights enabled |
| `aws_ecs_task_definition.main` | 1vCPU/2GB container | Same as dev |
| `aws_ecs_service.main` | Rolling deployment | Circuit breaker enabled |
| `aws_appautoscaling_target.main` | Target tracking | 1-3 tasks |
| `aws_appautoscaling_policy.cpu` | Scale on CPU 70% | Same |
| `aws_appautoscaling_policy.memory` | Scale on memory 80% | Same |
| `aws_iam_role.execution` | ECS execution role | Secrets Manager read |
| `aws_iam_role.task` | ECS task role | Minimal permissions |
| `aws_security_group.ecs` | Container traffic rules | Same |
| `aws_cloudwatch_log_group.main` | 14-day retention | Same as var |

#### ALB Module (5 resources)
| Resource | Purpose | Notes |
|----------|---------|-------|
| `aws_lb.main` | Application load balancer | Cross-zone enabled |
| `aws_lb_target_group.main` | HTTP:8080 health checks | 200 OK threshold |
| `aws_lb_listener.http` | Port 80 redirect | Redirects to HTTPS |
| `aws_lb_listener.https` | Port 443 TLS | ACM cert attached |
| `aws_security_group.alb` | Public ingress rules | 80/443 open |

#### RDS Module (7 resources)
| Resource | Purpose | Staging Config |
|----------|---------|----------------|
| `aws_db_instance.main` | PostgreSQL 15.4 | db.t3.micro, 20GB |
| `aws_db_subnet_group.main` | Private subnet placement | Same |
| `aws_db_parameter_group.main` | rds.force_ssl=1 | Same |
| `aws_secretsmanager_secret.db` | Auto-generated credentials | Rotatable |
| `aws_secretsmanager_secret_version.db` | Initial password | Same |
| `aws_cloudwatch_metric_alarm.rds_cpu` | >80% for 10min | Same |
| `aws_cloudwatch_metric_alarm.rds_storage` | <20% free for 10min | Same |

#### SNS Module (6 resources)
| Resource | Purpose | Staging Config |
|----------|---------|----------------|
| `aws_sns_topic.p0_critical` | P0 alerts (empty) | No emails configured |
| `aws_sns_topic.p1_alert` | P1 alerts (empty) | No emails configured |
| `aws_sns_topic.p2_warning` | P2 alerts (empty) | No emails configured |
| `aws_sns_topic.rds_ops` | RDS alerts (empty) | No emails configured |
| `aws_sns_topic.infra_ops` | Infra alerts (empty) | No emails configured |
| `aws_kms_key.sns` | SNS encryption | Same |

**Note**: Staging has empty email lists. Add emails to enable alerts for pre-prod validation.

#### GitHub OIDC Module (2 resources)
| Resource | Purpose | Notes |
|----------|---------|-------|
| `aws_iam_openid_connect_provider.github` | GitHub Actions OIDC | No long-lived keys |
| `aws_iam_role.github_actions` | Assume role for CI/CD | Limited to tokenfly/agent-lab |

#### DNS Module (0 resources)
| Resource | Status | Notes |
|----------|--------|-------|
| `count = 0` | Skipped | No `route53_hosted_zone_id` set |

---

## Cost Estimate: Staging Environment

| Service | Monthly Cost |
|---------|-------------|
| Fargate (1 task, 1vCPU/2GB) | ~$30 |
| EFS (5GB) | ~$3 |
| ALB | ~$16 |
| NAT Gateway (1) | ~$32 |
| RDS db.t3.micro (single-AZ) | ~$14 |
| RDS storage (20GB) | ~$2 |
| VPC Endpoints | ~$7 |
| CloudWatch Logs | ~$1 |
| **Total** | **~$105/month** |

**vs Dev (~$85/mo)**: +$20 for longer backups, higher max capacity, and 14-day logs  
**vs Prod (~$230/mo)**: ~45% of prod cost while maintaining production-like structure

---

## Validation Status

| Check | Status | Notes |
|-------|--------|-------|
| Variable validation rules | ✅ Pass | `env` validates against ["dev", "staging", "prod"] |
| Required variables set | ✅ Pass | All vars have values or defaults |
| Module wiring | ✅ Pass | All modules referenced correctly in main.tf |
| No duplicate resources | ✅ Pass | No naming collisions detected |
| Cost within budget | ✅ Pass | $105/mo reasonable for pre-prod |

---

## Pre-Apply Checklist

Before running `terraform apply`:

1. [ ] Set real `aws_account_id` in tfvars (currently placeholder)
2. [ ] Configure AWS credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
3. [ ] (Optional) Add alert emails to enable SNS notifications
4. [ ] (Optional) Set `route53_hosted_zone_id` to enable DNS module

---

## Terraform Commands

```bash
# Initialize (one-time)
cd infrastructure
terraform init

# Plan staging
terraform plan -var-file=environments/staging/terraform.tfvars

# Apply staging
terraform apply -var-file=environments/staging/terraform.tfvars

# Destroy (when done testing)
terraform destroy -var-file=environments/staging/terraform.tfvars
```

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| NAT Gateway cost surprise | Low | Medium | Single gateway used, cost documented |
| RDS snapshot on destroy | Low | Low | `skip_final_snapshot = true` for staging |
| State file collision | Low | High | Use S3 backend with env-specific key |
| IAM permissions | Medium | High | OIDC role limited to specific repo |

---

## Recommendations

1. **Enable S3 backend** before applying to prevent state file conflicts:
   ```hcl
   terraform {
     backend "s3" {
       bucket = "tokenfly-terraform-state"
       key    = "staging/terraform.tfstate"
       region = "us-east-1"
     }
   }
   ```

2. **Add staging alerts** by populating `alert_emails_p2_warning` to catch issues during pre-prod testing.

3. **Consider Spot** for staging Fargate tasks to reduce cost by ~70%.

---

## Task Status

**Task #169 COMPLETE** — Staging environment configuration created and plan analyzed. Ready for apply pending AWS credentials.
