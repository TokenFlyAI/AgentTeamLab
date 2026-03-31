# Tokenfly Agent Team Lab — Root Infrastructure Module
# Quinn (Cloud Engineer) — 2026-03-29
#
# Usage:
#   cd infrastructure/environments/dev
#   terraform init && terraform plan && terraform apply

terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Remote state — S3 backend (configure per environment)
  # Uncomment and set bucket/key before running:
  # backend "s3" {
  #   bucket         = "tokenfly-terraform-state"
  #   key            = "env/dev/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "tokenfly-terraform-locks"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "tokenfly-agent-lab"
      Environment = var.env
      ManagedBy   = "terraform"
      Owner       = "quinn"
    }
  }
}

# ---------------------------------------------------------------------------
# Locals
# ---------------------------------------------------------------------------

locals {
  name_prefix = "tokenfly-${var.env}"
  common_tags = {
    Project     = "tokenfly-agent-lab"
    Environment = var.env
  }
}

# ---------------------------------------------------------------------------
# Modules
# ---------------------------------------------------------------------------

module "networking" {
  source = "./modules/networking"

  name_prefix          = local.name_prefix
  vpc_cidr             = var.vpc_cidr
  availability_zones   = var.availability_zones
  public_subnet_cidrs  = var.public_subnet_cidrs
  private_subnet_cidrs = var.private_subnet_cidrs
  nat_gateway_count    = var.nat_gateway_count
  tags                 = local.common_tags
}

module "efs" {
  source = "./modules/efs"

  name_prefix        = local.name_prefix
  private_subnet_ids = module.networking.private_subnet_ids
  sg_efs_id          = module.networking.sg_efs_id
  tags               = local.common_tags
}

module "alb" {
  source = "./modules/alb"

  name_prefix                = local.name_prefix
  domain_name                = var.domain_name
  vpc_id                     = module.networking.vpc_id
  public_subnet_ids          = module.networking.public_subnet_ids
  sg_alb_id                  = module.networking.sg_alb_id
  enable_deletion_protection = var.env == "prod"

  # CloudWatch alarm actions — ALB 5xx → infra_ops, unhealthy hosts → p1_alert
  alarm_actions_p1_alert   = [module.sns.p1_alert_topic_arn]
  alarm_actions_infra_ops  = [module.sns.infra_ops_topic_arn]

  tags = local.common_tags

  depends_on = [module.sns]
}

# ECR repository for container images
resource "aws_ecr_repository" "app" {
  name                 = "${local.name_prefix}-app"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = local.common_tags
}

resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 tagged images"
        selection = {
          tagStatus   = "tagged"
          tagPrefixList = ["sha-", "env-"]
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Expire untagged images after 1 day"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      }
    ]
  })
}

module "ecs" {
  source = "./modules/ecs"

  name_prefix          = local.name_prefix
  env                  = var.env
  aws_region           = var.aws_region
  ecr_repo_url         = aws_ecr_repository.app.repository_url
  image_tag            = var.image_tag
  task_cpu             = var.task_cpu
  task_memory          = var.task_memory
  desired_count        = var.desired_count
  min_capacity         = var.min_capacity
  max_capacity         = var.max_capacity
  log_retention_days   = var.log_retention_days
  private_subnet_ids   = module.networking.private_subnet_ids
  sg_app_id            = module.networking.sg_app_id
  alb_target_group_arn = module.alb.target_group_arn

  efs_file_system_id   = module.efs.file_system_id
  efs_file_system_arn  = "arn:aws:elasticfilesystem:${var.aws_region}:${var.aws_account_id}:file-system/${module.efs.file_system_id}"
  efs_access_point_id  = module.efs.access_point_id
  efs_access_point_arn = "arn:aws:elasticfilesystem:${var.aws_region}:${var.aws_account_id}:access-point/${module.efs.access_point_id}"

  db_credentials_secret_arn = module.rds.db_credentials_secret_arn

  # CloudWatch alarm actions — 0 tasks → p0_critical, below desired → p1_alert, deploy fail → infra_ops
  alarm_actions_p0_critical = [module.sns.p0_critical_topic_arn]
  alarm_actions_p1_alert    = [module.sns.p1_alert_topic_arn]
  alarm_actions_infra_ops   = [module.sns.infra_ops_topic_arn]

  tags = local.common_tags

  depends_on = [module.sns]
}

module "rds" {
  source = "./modules/rds"

  name_prefix                = local.name_prefix
  env                        = var.env
  aws_region                 = var.aws_region
  private_subnet_ids         = module.networking.private_subnet_ids
  sg_rds_id                  = module.networking.sg_rds_id
  instance_class             = var.rds_instance_class
  allocated_storage_gb       = var.rds_allocated_storage_gb
  max_allocated_storage_gb   = var.rds_max_allocated_storage_gb
  multi_az                   = var.rds_multi_az
  backup_retention_days      = var.rds_backup_retention_days
  deletion_protection        = var.rds_deletion_protection
  skip_final_snapshot        = var.rds_skip_final_snapshot
  # CloudWatch alarm actions — all 3 RDS alarms (RDS-001, RDS-002, RDS-003) → rds_ops topic
  alarm_actions_rds_ops = [module.sns.rds_ops_topic_arn]

  tags = local.common_tags

  depends_on = [module.sns]
}

module "sns" {
  source = "./modules/sns"

  project     = "tokenfly"
  environment = var.env

  # Per-topic email subscriptions (all optional — set in tfvars per env)
  p0_critical_emails = var.alert_emails_p0_critical
  p1_alert_emails    = var.alert_emails_p1_alert
  p2_warning_emails  = var.alert_emails_p2_warning
  rds_ops_emails     = var.alert_emails_rds_ops
  infra_ops_emails   = var.alert_emails_infra_ops

  tags = local.common_tags
}

module "github_oidc" {
  source = "./modules/github_oidc"

  project     = "tokenfly"
  environment = var.env
  github_repo = var.github_repo
  tags        = local.common_tags
}

# ---------------------------------------------------------------------------
# DNS — ACM certificate validation + Route53 A/ALIAS records for ALB
# Requires: a Route53 hosted zone for var.domain_name to already exist.
# Set var.route53_hosted_zone_id in tfvars (prod only; skip for dev).
# ---------------------------------------------------------------------------

module "dns" {
  source = "./modules/dns"

  count = var.route53_hosted_zone_id != "" ? 1 : 0

  hosted_zone_id                        = var.route53_hosted_zone_id
  domain_name                           = var.domain_name
  certificate_arn                       = module.alb.certificate_arn
  certificate_domain_validation_options = module.alb.certificate_domain_validation_options
  alb_dns_name                          = module.alb.alb_dns_name
  alb_zone_id                           = module.alb.alb_zone_id

  depends_on = [module.alb]
}
