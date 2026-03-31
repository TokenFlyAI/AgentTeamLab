variable "env" {
  description = "Environment name (dev, staging, prod)"
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.env)
    error_message = "env must be dev, staging, or prod."
  }
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "aws_account_id" {
  description = "AWS account ID — used in ARN strings so terraform plan works without live credentials"
  type        = string
}

variable "domain_name" {
  description = "Root domain for the application (e.g. tokenfly.ai)"
  type        = string
}

variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

variable "availability_zones" {
  type    = list(string)
  default = ["us-east-1a", "us-east-1b"]
}

variable "public_subnet_cidrs" {
  type    = list(string)
  default = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "private_subnet_cidrs" {
  type    = list(string)
  default = ["10.0.10.0/24", "10.0.11.0/24"]
}

variable "nat_gateway_count" {
  description = "1 for dev (cost-optimized), 2 for prod (HA)"
  type        = number
  default     = 1
}

variable "image_tag" {
  type    = string
  default = "latest"
}

variable "task_cpu" {
  type    = number
  default = 1024
}

variable "task_memory" {
  type    = number
  default = 2048
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "min_capacity" {
  type    = number
  default = 1
}

variable "max_capacity" {
  type    = number
  default = 3
}

variable "log_retention_days" {
  type    = number
  default = 30
}

# ---------------------------------------------------------------------------
# RDS variables
# ---------------------------------------------------------------------------

variable "rds_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.micro"
}

variable "rds_allocated_storage_gb" {
  description = "Initial RDS allocated storage (GB)"
  type        = number
  default     = 20
}

variable "rds_max_allocated_storage_gb" {
  description = "RDS storage autoscaling max (GB); 0 = disabled"
  type        = number
  default     = 100
}

variable "rds_multi_az" {
  description = "Enable Multi-AZ for RDS"
  type        = bool
  default     = false
}

variable "rds_backup_retention_days" {
  description = "Days to retain RDS automated backups"
  type        = number
  default     = 7
}

variable "rds_deletion_protection" {
  description = "Enable RDS deletion protection"
  type        = bool
  default     = false
}

variable "rds_skip_final_snapshot" {
  description = "Skip final snapshot on RDS deletion (false in prod)"
  type        = bool
  default     = true
}

# Per-topic SNS email subscriptions (Liam SRE plan Section 12.1)
variable "alert_emails_p0_critical" {
  description = "Emails for P0 critical topic (server down, 0% agents alive)"
  type        = list(string)
  default     = []
}

variable "alert_emails_p1_alert" {
  description = "Emails for P1 alert topic (latency SLO breach, rate limit spikes)"
  type        = list(string)
  default     = []
}

variable "alert_emails_p2_warning" {
  description = "Emails for P2 warning topic (heap saturation, elevated error rate)"
  type        = list(string)
  default     = []
}

variable "alert_emails_rds_ops" {
  description = "Emails for RDS ops topic (CPU, storage, connections)"
  type        = list(string)
  default     = []
}

variable "alert_emails_infra_ops" {
  description = "Emails for infra ops topic (ECS failures, ALB 5xx, EFS)"
  type        = list(string)
  default     = []
}

variable "github_repo" {
  description = "GitHub repository in owner/repo format (for OIDC role binding)"
  type        = string
  default     = "tokenfly/agent-lab"
}

variable "route53_hosted_zone_id" {
  description = "Route53 hosted zone ID for domain_name. Required for ACM DNS validation and ALB alias records. Leave empty to skip DNS module (dev environments without a real domain)."
  type        = string
  default     = ""
}
