# Prod environment — HA, multi-AZ, deletion protection
env               = "prod"
aws_region        = "us-east-1"
domain_name       = "tokenfly.ai"
nat_gateway_count = 2
desired_count     = 2
min_capacity      = 2
max_capacity      = 6
task_cpu          = 2048
task_memory       = 4096
log_retention_days = 90

# RDS — prod (multi-AZ, deletion protection, full backups)
rds_instance_class             = "db.t3.small"
rds_allocated_storage_gb       = 50
rds_max_allocated_storage_gb   = 200
rds_multi_az                   = true
rds_backup_retention_days      = 7
rds_deletion_protection        = true
rds_skip_final_snapshot        = false

# SNS alert emails — prod (Liam SRE plan Section 12.1: 5 topics per severity)
alert_emails_p0_critical = []  # e.g. ["pagerduty-endpoint@pagerduty.com", "oncall@tokenfly.ai"]
alert_emails_p1_alert    = []  # e.g. ["oncall@tokenfly.ai", "alerts@tokenfly.ai"]
alert_emails_p2_warning  = []  # e.g. ["team@tokenfly.ai"]
alert_emails_rds_ops     = []  # e.g. ["dba@tokenfly.ai", "quinn@tokenfly.ai"]
alert_emails_infra_ops   = []  # e.g. ["eve@tokenfly.ai", "quinn@tokenfly.ai"]

# GitHub OIDC
github_repo = "tokenfly/agent-lab"  # update to actual GitHub org/repo

# Route53 — hosted zone ID for tokenfly.ai (required for ACM validation + ALB alias)
route53_hosted_zone_id = ""  # REQUIRED for prod: set to Route53 hosted zone ID for domain_name

# AWS Account ID — used in EFS ARN strings (avoids data.aws_caller_identity live lookup)
aws_account_id = "123456789012"  # replace with actual AWS account ID
