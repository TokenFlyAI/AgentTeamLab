# Tokenfly — SNS Alerting Module
# Creates 5 SNS topics matching Liam's SRE plan (Section 12):
#   p0_critical, p1_alert, p2_warning, rds_ops, infra_ops
# KMS-encrypted. Email subscriptions optional per-topic.
# Quinn (Cloud Engineer) — 2026-03-30

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# ---------------------------------------------------------------------------
# KMS key for SNS encryption at rest
# ---------------------------------------------------------------------------
resource "aws_kms_key" "sns" {
  description             = "${var.project}-${var.environment}-sns"
  deletion_window_in_days = 7
  enable_key_rotation     = true

  tags = merge(var.tags, {
    Name = "${var.project}-${var.environment}-sns-key"
  })
}

resource "aws_kms_alias" "sns" {
  name          = "alias/${var.project}-${var.environment}-sns"
  target_key_id = aws_kms_key.sns.key_id
}

# ---------------------------------------------------------------------------
# Shared IAM policy — allow CloudWatch to publish to any topic in this account
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "sns_publish_policy" {
  statement {
    sid    = "AllowCloudWatchPublish"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com"]
    }

    actions   = ["sns:Publish"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [var.aws_account_id]
    }
  }

  statement {
    sid    = "AllowAccountRootFull"
    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${var.aws_account_id}:root"]
    }

    actions   = ["sns:*"]
    resources = ["*"]
  }
}

# ---------------------------------------------------------------------------
# P0 Critical — server down, 0% agents alive, complete outage (ALT-001, ALT-005)
# Subscribers: PagerDuty / on-call phone, Slack #incidents
# ---------------------------------------------------------------------------
resource "aws_sns_topic" "p0_critical" {
  name              = "${var.project}-${var.environment}-p0-critical"
  kms_master_key_id = aws_kms_key.sns.id

  tags = merge(var.tags, {
    Name     = "${var.project}-${var.environment}-p0-critical"
    Severity = "p0"
  })
}

resource "aws_sns_topic_policy" "p0_critical" {
  arn    = aws_sns_topic.p0_critical.arn
  policy = data.aws_iam_policy_document.sns_publish_policy.json
}

resource "aws_sns_topic_subscription" "p0_critical_email" {
  for_each = toset(var.p0_critical_emails)

  topic_arn = aws_sns_topic.p0_critical.arn
  protocol  = "email"
  endpoint  = each.value
}

# ---------------------------------------------------------------------------
# P1 Alert — latency SLO breach, >50% agents stale, rate limit spike
#   (ALT-002, ALT-003, ALT-006, ALT-007, ALT-008)
# Subscribers: Slack #alerts, email on-call DL
# ---------------------------------------------------------------------------
resource "aws_sns_topic" "p1_alert" {
  name              = "${var.project}-${var.environment}-p1-alert"
  kms_master_key_id = aws_kms_key.sns.id

  tags = merge(var.tags, {
    Name     = "${var.project}-${var.environment}-p1-alert"
    Severity = "p1"
  })
}

resource "aws_sns_topic_policy" "p1_alert" {
  arn    = aws_sns_topic.p1_alert.arn
  policy = data.aws_iam_policy_document.sns_publish_policy.json
}

resource "aws_sns_topic_subscription" "p1_alert_email" {
  for_each = toset(var.p1_alert_emails)

  topic_arn = aws_sns_topic.p1_alert.arn
  protocol  = "email"
  endpoint  = each.value
}

# ---------------------------------------------------------------------------
# P2 Warning — heap saturation, partial agent stale, API error rate
#   (ALT-004, ALT-009, ALT-010)
# Subscribers: Slack #alerts (low-priority), email team DL
# ---------------------------------------------------------------------------
resource "aws_sns_topic" "p2_warning" {
  name              = "${var.project}-${var.environment}-p2-warning"
  kms_master_key_id = aws_kms_key.sns.id

  tags = merge(var.tags, {
    Name     = "${var.project}-${var.environment}-p2-warning"
    Severity = "p2"
  })
}

resource "aws_sns_topic_policy" "p2_warning" {
  arn    = aws_sns_topic.p2_warning.arn
  policy = data.aws_iam_policy_document.sns_publish_policy.json
}

resource "aws_sns_topic_subscription" "p2_warning_email" {
  for_each = toset(var.p2_warning_emails)

  topic_arn = aws_sns_topic.p2_warning.arn
  protocol  = "email"
  endpoint  = each.value
}

# ---------------------------------------------------------------------------
# RDS Ops — RDS-specific: CPU, storage, connection count
#   (RDS-001, RDS-002, RDS-003)
# Subscribers: Slack #ops, DBAs/Quinn
# ---------------------------------------------------------------------------
resource "aws_sns_topic" "rds_ops" {
  name              = "${var.project}-${var.environment}-rds-ops"
  kms_master_key_id = aws_kms_key.sns.id

  tags = merge(var.tags, {
    Name     = "${var.project}-${var.environment}-rds-ops"
    Severity = "ops"
    Service  = "rds"
  })
}

resource "aws_sns_topic_policy" "rds_ops" {
  arn    = aws_sns_topic.rds_ops.arn
  policy = data.aws_iam_policy_document.sns_publish_policy.json
}

resource "aws_sns_topic_subscription" "rds_ops_email" {
  for_each = toset(var.rds_ops_emails)

  topic_arn = aws_sns_topic.rds_ops.arn
  protocol  = "email"
  endpoint  = each.value
}

# ---------------------------------------------------------------------------
# Infra Ops — ECS task failures, ALB 5xx, EFS throughput
# Subscribers: Slack #ops, Eve/Quinn
# ---------------------------------------------------------------------------
resource "aws_sns_topic" "infra_ops" {
  name              = "${var.project}-${var.environment}-infra-ops"
  kms_master_key_id = aws_kms_key.sns.id

  tags = merge(var.tags, {
    Name     = "${var.project}-${var.environment}-infra-ops"
    Severity = "ops"
    Service  = "infra"
  })
}

resource "aws_sns_topic_policy" "infra_ops" {
  arn    = aws_sns_topic.infra_ops.arn
  policy = data.aws_iam_policy_document.sns_publish_policy.json
}

resource "aws_sns_topic_subscription" "infra_ops_email" {
  for_each = toset(var.infra_ops_emails)

  topic_arn = aws_sns_topic.infra_ops.arn
  protocol  = "email"
  endpoint  = each.value
}
