# Staging environment — pre-prod validation, single-AZ but prod-like structure
env               = "staging"
aws_region        = "us-east-1"
domain_name       = "staging.tokenfly.ai"
nat_gateway_count = 1
desired_count     = 1
min_capacity      = 1
max_capacity      = 3
task_cpu          = 1024
task_memory       = 2048
log_retention_days = 14

# RDS — staging (same size as dev, but longer backup retention for pre-prod testing)
rds_instance_class             = "db.t3.micro"
rds_allocated_storage_gb       = 20
rds_max_allocated_storage_gb   = 100
rds_multi_az                   = false
rds_backup_retention_days      = 5
rds_deletion_protection        = false
rds_skip_final_snapshot        = true

# SNS alert emails — staging (enable alerts for pre-prod validation)
alert_emails_p0_critical = []  # e.g. ["oncall@tokenfly.ai"]
alert_emails_p1_alert    = []  # e.g. ["oncall@tokenfly.ai"]
alert_emails_p2_warning  = []  # e.g. ["staging-alerts@tokenfly.ai"]
alert_emails_rds_ops     = []  # e.g. ["staging-alerts@tokenfly.ai"]
alert_emails_infra_ops   = []  # e.g. ["staging-alerts@tokenfly.ai"]

# GitHub OIDC
github_repo = "tokenfly/agent-lab"

# Route53 — DNS module (leave empty until staging domain is set up)
route53_hosted_zone_id = ""

# AWS Account ID — used in EFS ARN strings
aws_account_id = "123456789012"
