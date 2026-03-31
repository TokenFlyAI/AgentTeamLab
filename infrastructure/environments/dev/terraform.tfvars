# Dev environment — cost-optimized, single-AZ
env               = "dev"
aws_region        = "us-east-1"
domain_name       = "dev.tokenfly.ai"
nat_gateway_count = 1
desired_count     = 1
min_capacity      = 1
max_capacity      = 2
task_cpu          = 1024
task_memory       = 2048
log_retention_days = 7

# RDS — dev (smallest viable instance, no multi-AZ)
rds_instance_class             = "db.t3.micro"
rds_allocated_storage_gb       = 20
rds_max_allocated_storage_gb   = 50
rds_multi_az                   = false
rds_backup_retention_days      = 3
rds_deletion_protection        = false
rds_skip_final_snapshot        = true

# SNS alert emails — dev (set to your email to receive alerts)
# Liam SRE plan Section 12.1: 5 topics per severity
alert_emails_p0_critical = []  # e.g. ["oncall@tokenfly.ai"]
alert_emails_p1_alert    = []  # e.g. ["oncall@tokenfly.ai"]
alert_emails_p2_warning  = []  # e.g. ["dev-team@tokenfly.ai"]
alert_emails_rds_ops     = []  # e.g. ["dev-team@tokenfly.ai"]
alert_emails_infra_ops   = []  # e.g. ["dev-team@tokenfly.ai"]

# GitHub OIDC
github_repo = "tokenfly/agent-lab"  # update to actual GitHub org/repo

# Route53 — DNS module (leave empty for dev without a real domain)
route53_hosted_zone_id = ""  # e.g. "Z1234567890ABC"

# AWS Account ID — used in EFS ARN strings (avoids data.aws_caller_identity live lookup)
aws_account_id = "123456789012"  # replace with actual AWS account ID
