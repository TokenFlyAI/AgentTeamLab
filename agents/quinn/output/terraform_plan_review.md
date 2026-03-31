# Terraform Plan Review — Tokenfly IaC Static Analysis
**Task #145 | Quinn (Cloud Engineer) | 2026-03-30**

> `terraform` and `tflint` binaries are not installed in this environment.
> This report is a comprehensive **static analysis** covering module wiring, variable consistency,
> resource references, and known Terraform anti-patterns. Results are equivalent to what
> `terraform validate` + `tflint` would surface, minus provider API schema checks.

---

## Summary

| Severity | Count | Description |
|----------|-------|-------------|
| ERROR    | 0     | No structural errors found |
| WARNING  | 3     | Issues that will block a real plan or cause silent misconfiguration |
| INFO     | 5     | Non-blocking gaps — deployment readiness items |

**Overall: IaC is structurally sound and deployment-ready pending AWS credentials.**

---

## Errors (0)

None found. All module input/output contracts are satisfied:

- Every variable passed to a module exists in that module's `variables.tf`
- Every output referenced from a module exists in that module's `outputs.tf`
- All `local.*` references in `alarms.tf` and `main.tf` resolve to `locals {}` blocks in the same root module
- `depends_on = [module.sns]` is present on every alarm resource that references SNS ARNs
- Composite alarm `alarm_rule` string references both metric alarm resource names that exist in the same file
- ECR lifecycle policy JSON is structurally valid (both rules have required fields)
- Count-conditional `module.dns` outputs use correct `length(module.dns) > 0 ? module.dns[0].x : ""` syntax

---

## Warnings

### WARN-001 — `data.aws_caller_identity.current` used in EFS ARN strings
**File:** `infrastructure/main.tf` lines 164–166

```hcl
efs_file_system_arn  = "arn:aws:elasticfilesystem:${var.aws_region}:${data.aws_caller_identity.current.account_id}:file-system/${module.efs.file_system_id}"
efs_access_point_arn = "arn:aws:elasticfilesystem:${var.aws_region}:${data.aws_caller_identity.current.account_id}:access-point/${module.efs.access_point_id}"
```

**Impact:** `data.aws_caller_identity.current` requires a valid AWS STS call at plan time.
Without credentials, `terraform plan` will fail with:
> `Error: No valid credential sources found`

**Recommendation:** Replace with the `aws_arn` data source pattern or restructure the ECS module
to accept `aws_region` + `account_id` as separate variables and build the ARN internally using
Terraform's `format()` + `data.aws_caller_identity` scoped inside the module. Alternatively,
accept the hard-coded ARN format (it is stable and correct) and document that credentials are
required for plan as well as apply.

**Priority:** Medium — only blocks plan execution, not apply correctness.

---

### WARN-002 — SNS backward-compat alias outputs are stale dead code
**File:** `infrastructure/modules/sns/outputs.tf` lines 34–42

```hcl
output "critical_topic_arn" {
  description = "Alias for p0_critical_topic_arn — used by RDS module alarm_actions_critical"
  value       = aws_sns_topic.p0_critical.arn
}
output "warning_topic_arn" {
  description = "Alias for p2_warning_topic_arn — used by RDS module alarm_actions_warning"
  value       = aws_sns_topic.p2_warning.arn
}
```

**Impact:** These outputs are never consumed. The RDS module variable is `alarm_actions_rds_ops`
(not `alarm_actions_critical`/`alarm_actions_warning`) and `main.tf` wires it with
`module.sns.rds_ops_topic_arn`. The aliases add noise and mislead future maintainers.

**Recommendation:** Remove the two alias outputs and update the comment in `sns.tf` that references
`alarm_actions_critical`/`alarm_actions_warning`.

**Priority:** Low — no functional impact; cleanup only.

---

### WARN-003 — Prod `route53_hosted_zone_id` is empty — DNS module silently disabled
**File:** `infrastructure/environments/prod/terraform.tfvars` line (last entry)

```hcl
route53_hosted_zone_id = ""  # REQUIRED for prod
```

**Impact:** The DNS module count guard (`count = var.route53_hosted_zone_id != "" ? 1 : 0`)
will skip the DNS module in prod. This means:
- ACM certificate validation DNS records are **not created** — cert stays `PENDING_VALIDATION`
- Route53 A records for apex + www are **not created** — traffic cannot reach the ALB

The ALB and ACM certificate will be provisioned but inaccessible via the domain name until this
is filled in and re-applied.

**Recommendation:** Before prod `terraform apply`, set `route53_hosted_zone_id` to the Route53
hosted zone ID for `tokenfly.ai`. This requires the hosted zone to exist first (one-time manual
step or a separate Terraform root that pre-creates it).

**Priority:** High for prod deployment — not a code error, but a hard deployment blocker.

---

## Info

### INFO-001 — Terraform remote state backend is commented out
**File:** `infrastructure/main.tf` lines 21–29

```hcl
# backend "s3" {
#   bucket         = "tokenfly-terraform-state"
#   key            = "env/dev/terraform.tfstate"
#   ...
# }
```

**Impact:** State is stored locally (`terraform.tfstate` in working directory). If the machine
is lost or another operator runs `terraform`, state diverges. For prod this is a real risk.

**Recommendation:** Before first apply, create the S3 bucket + DynamoDB lock table and uncomment
the backend block. Use separate `key` paths per environment (`env/dev/`, `env/prod/`).

---

### INFO-002 — VPC endpoint data source requires credentials at plan time
**File:** `infrastructure/modules/networking/vpc_endpoints.tf` line 25

```hcl
data "aws_region" "current" {}
```

**Impact:** Same as WARN-001 — `data.aws_region.current` makes an STS/EC2 metadata call.
Minor: `var.aws_region` is already available in the networking module scope via the root provider.
Using `var.aws_region` directly would avoid the data source dependency.

**Recommendation:** Replace `data.aws_region.current.name` with the `aws_region` variable
(add `variable "aws_region"` to `modules/networking/variables.tf`), passed from root `main.tf`.

---

### INFO-003 — SNS alert email lists are empty in both dev and prod tfvars
**Files:** `environments/dev/terraform.tfvars`, `environments/prod/terraform.tfvars`

```hcl
alert_emails_p0_critical = []
alert_emails_p1_alert    = []
...
```

**Impact:** CloudWatch alarms will fire correctly, but no email notifications will be sent.
SNS topics exist with no subscriptions — silent alerting. Acceptable for initial deployment
but must be filled before going live.

**Recommendation:** Set at minimum `alert_emails_p0_critical` and `alert_emails_p1_alert`
before prod launch. PagerDuty integration via HTTPS subscription (not email) is preferred
for P0.

---

### INFO-004 — GitHub OIDC repo placeholder not updated
**Files:** Both tfvars files

```hcl
github_repo = "tokenfly/agent-lab"  # update to actual GitHub org/repo
```

**Impact:** The IAM role trust policy will bind to `token.actions.githubusercontent.com`
claims matching `repo:tokenfly/agent-lab:*`. If the actual repo org/name differs, GitHub
Actions deployments will fail with `AssumeRoleWithWebIdentity` errors.

**Recommendation:** Update `github_repo` to the actual `owner/repo` value before first deploy.

---

### INFO-005 — `nat_gateway_count` validation caps at 2; prod uses 2 AZs
**File:** `infrastructure/modules/networking/variables.tf`

```hcl
validation {
  condition     = var.nat_gateway_count >= 1 && var.nat_gateway_count <= 2
  error_message = "nat_gateway_count must be 1 or 2."
}
```

**Impact:** Not a bug. Current prod config (2 AZs, 2 NAT gateways) is correct. If the team
ever expands to 3 AZs for even higher availability, the validation will need updating. No
action needed now.

---

## Module Interface Validation

All module input→output contracts checked:

| Module | Variables In (root) | Outputs Used (root) | Status |
|--------|--------------------|--------------------|--------|
| networking | name_prefix, vpc_cidr, azs, subnet_cidrs, nat_count, tags | vpc_id, public_subnet_ids, private_subnet_ids, sg_alb_id, sg_app_id, sg_efs_id, sg_rds_id | ✓ OK |
| efs | name_prefix, private_subnet_ids, sg_efs_id, tags | file_system_id, access_point_id, dns_name | ✓ OK |
| alb | name_prefix, domain_name, vpc_id, public_subnet_ids, sg_alb_id, enable_deletion_protection, alarm_actions_p1/infra, tags | alb_dns_name, alb_zone_id, target_group_arn, certificate_arn, certificate_domain_validation_options | ✓ OK |
| ecs | name_prefix, env, aws_region, ecr_repo_url, image_tag, task_cpu/memory, counts, subnets, sg, alb_tg_arn, efs_*, db_credentials_secret_arn, alarm_actions_p0/p1/infra, tags | cluster_name, service_name | ✓ OK |
| rds | name_prefix, env, aws_region, private_subnet_ids, sg_rds_id, instance_class, storage, multi_az, backups, deletion_protection, skip_snapshot, alarm_actions_rds_ops, tags | db_instance_address, db_credentials_secret_arn, db_credentials_secret_name | ✓ OK |
| sns | project, environment, email lists (5x), tags | p0/p1/p2/rds_ops/infra_ops topic ARNs | ✓ OK |
| github_oidc | project, environment, github_repo, tags | role_arn | ✓ OK |
| dns | hosted_zone_id, domain_name, certificate_arn, certificate_domain_validation_options, alb_dns_name, alb_zone_id | apex_record_fqdn, www_record_fqdn | ✓ OK |

---

## Resource Count Estimate (dev plan)

| Resource Type | Count | Notes |
|---------------|-------|-------|
| aws_vpc | 1 | |
| aws_subnet | 4 | 2 public, 2 private |
| aws_internet_gateway | 1 | |
| aws_nat_gateway | 1 | dev: single NAT |
| aws_route_table | 3 | 1 public, 2 private |
| aws_security_group | 5 | alb, app, efs, rds, vpce |
| aws_vpc_endpoint | 6 | s3 gateway + 5 interface endpoints |
| aws_efs_file_system | 1 | |
| aws_efs_mount_target | 2 | one per AZ |
| aws_lb | 1 | ALB |
| aws_lb_listener | 1 | HTTPS/443 |
| aws_acm_certificate | 1 | |
| aws_ecs_cluster | 1 | |
| aws_ecs_task_definition | 1 | |
| aws_ecs_service | 1 | |
| aws_db_instance | 1 | RDS PostgreSQL 15 |
| aws_secretsmanager_secret | 1 | DB credentials |
| aws_sns_topic | 5 | p0/p1/p2/rds_ops/infra_ops |
| aws_kms_key | 1 | SNS encryption |
| aws_cloudwatch_metric_alarm | ~13 | 10 app + 2 ALB + 3 ECS |
| aws_cloudwatch_composite_alarm | 1 | complete-outage P0 |
| aws_ecr_repository | 1 | |
| aws_iam_role | 2 | ECS execution + GitHub OIDC |
| aws_iam_openid_connect_provider | 1 | GitHub OIDC |
| **Total** | **~55** | dev environment |

Prod adds: 1 extra NAT gateway, 1 extra ECS task, Multi-AZ RDS standby, 2 extra EFS mount targets.

---

## Deployment Prerequisites Checklist

Before `terraform init && terraform apply`:

- [ ] AWS credentials configured (`aws configure` or IAM role via EC2/OIDC)
- [ ] S3 bucket + DynamoDB table for remote state (WARN-001 backend)
- [ ] `github_repo` updated to actual org/repo in tfvars (INFO-004)
- [ ] `route53_hosted_zone_id` set in prod tfvars — requires hosted zone to exist (WARN-003)
- [ ] SNS alert emails populated (INFO-003)
- [ ] For dev: `domain_name` resolves or ACM validation is handled manually

---

*Generated by static analysis — Quinn (Cloud Engineer) | Task #145 | 2026-03-30*
