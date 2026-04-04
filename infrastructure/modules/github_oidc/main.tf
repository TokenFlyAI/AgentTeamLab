# Tokenfly — GitHub Actions OIDC Module
# Grants GitHub Actions keyless AWS access via OIDC federation.
# No long-lived access keys stored in GitHub Secrets.
# Quinn (Cloud Engineer) — 2026-03-30
#
# Usage: after applying, set GitHub Secret AWS_ROLE_ARN = module.github_oidc.role_arn

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# ---------------------------------------------------------------------------
# GitHub OIDC Provider (one per AWS account — idempotent)
# ---------------------------------------------------------------------------
resource "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"

  client_id_list = ["sts.amazonaws.com"]

  # GitHub's OIDC thumbprint — verified 2026-03-30
  # Ref: https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]

  tags = var.tags
}

# ---------------------------------------------------------------------------
# IAM Role — assumed by GitHub Actions workflows
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "github_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Restrict to specific repo + branch (main only for deploys)
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repo}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "github_actions" {
  name               = "${var.project}-${var.environment}-github-actions"
  assume_role_policy = data.aws_iam_policy_document.github_assume_role.json
  max_session_duration = 3600  # 1 hour — enough for a deploy

  tags = merge(var.tags, {
    Name = "${var.project}-${var.environment}-github-actions"
  })
}

# ---------------------------------------------------------------------------
# IAM Policy — ECR push + ECS deploy (least privilege)
# ---------------------------------------------------------------------------
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

data "aws_iam_policy_document" "deploy_permissions" {
  # ECR: authenticate, push images
  statement {
    sid    = "ECRAuth"
    effect = "Allow"
    actions = [
      "ecr:GetAuthorizationToken"
    ]
    resources = ["*"]
  }

  statement {
    sid    = "ECRPush"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
      "ecr:PutImage",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImageScanFindings",
    ]
    resources = [
      "arn:aws:ecr:${data.aws_region.current.name}:${var.aws_account_id}:repository/${var.project}-${var.environment}-*"
    ]
  }

  # ECS: read task defs, register new revision, update service
  statement {
    sid    = "ECSTaskDef"
    effect = "Allow"
    actions = [
      "ecs:DescribeTaskDefinition",
      "ecs:RegisterTaskDefinition",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "ECSService"
    effect = "Allow"
    actions = [
      "ecs:DescribeServices",
      "ecs:UpdateService",
    ]
    resources = [
      "arn:aws:ecs:${data.aws_region.current.name}:${var.aws_account_id}:service/${var.project}-${var.environment}/*"
    ]
  }

  # PassRole — ECS needs to pass the task execution role
  statement {
    sid    = "PassECSRole"
    effect = "Allow"
    actions = ["iam:PassRole"]
    resources = [
      "arn:aws:iam::${var.aws_account_id}:role/${var.project}-${var.environment}-ecs-*"
    ]
  }
}

resource "aws_iam_policy" "deploy" {
  name   = "${var.project}-${var.environment}-github-actions-deploy"
  policy = data.aws_iam_policy_document.deploy_permissions.json

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "deploy" {
  role       = aws_iam_role.github_actions.name
  policy_arn = aws_iam_policy.deploy.arn
}
