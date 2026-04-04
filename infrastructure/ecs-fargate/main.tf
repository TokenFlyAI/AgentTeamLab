# ECS Fargate Deployment — Kalshi Trading Pipeline
# Author: Eve (Infra)
# Task: T316
#
# Single ECS Fargate task running 3 containers:
#   - kalshi-dashboard (port 3200)
#   - kalshi-scheduler
#   - kalshi-monitor
#
# Cost target: ~$29/month

terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
  backend "s3" {
    bucket = "tokenfly-tf-state"
    key    = "ecs-fargate/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" { region = "us-east-1" }

# ── VPC ──────────────────────────────────────────────────────────────────────
resource "aws_vpc" "trading" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "tokenfly-trading-ecs" }
}

resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.trading.id
}

resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.trading.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "us-east-1a"
  map_public_ip_on_launch = true
  tags = { Name = "tokenfly-public-a" }
}

resource "aws_subnet" "public_b" {
  vpc_id                  = aws_vpc.trading.id
  cidr_block              = "10.0.2.0/24"
  availability_zone       = "us-east-1b"
  map_public_ip_on_launch = true
  tags = { Name = "tokenfly-public-b" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.trading.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }
}

resource "aws_route_table_association" "public_a" {
  subnet_id      = aws_subnet.public_a.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "public_b" {
  subnet_id      = aws_subnet.public_b.id
  route_table_id = aws_route_table.public.id
}

# ── Security Groups ──────────────────────────────────────────────────────────
resource "aws_security_group" "ecs" {
  name   = "tokenfly-ecs-trading"
  vpc_id = aws_vpc.trading.id

  ingress {
    description = "Kalshi Dashboard"
    from_port   = 3200
    to_port     = 3200
    protocol    = "tcp"
    cidr_blocks = [var.allowed_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "tokenfly-ecs-sg" }
}

# ── IAM ──────────────────────────────────────────────────────────────────────
resource "aws_iam_role" "ecs_execution" {
  name = "tokenfly-ecs-execution-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution_managed" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  role = aws_iam_role.ecs_execution.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = aws_secretsmanager_secret.trading.arn
    }]
  })
}

resource "aws_iam_role" "ecs_task" {
  name = "tokenfly-ecs-task-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_task_cloudwatch" {
  role       = aws_iam_role.ecs_task.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchLogsFullAccess"
}

# ── CloudWatch Logs ──────────────────────────────────────────────────────────
resource "aws_cloudwatch_log_group" "dashboard" {
  name              = "/tokenfly/ecs/dashboard"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "scheduler" {
  name              = "/tokenfly/ecs/scheduler"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "monitor" {
  name              = "/tokenfly/ecs/monitor"
  retention_in_days = 14
}

# ── Secrets Manager ──────────────────────────────────────────────────────────
resource "random_password" "jwt" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "trading" {
  name                    = "tokenfly/ecs-trading"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "trading" {
  secret_id = aws_secretsmanager_secret.trading.id
  secret_string = jsonencode({
    KALSHI_API_KEY        = var.kalshi_api_key
    API_KEY               = var.dashboard_api_key
    DASHBOARD_API_KEY     = var.dashboard_api_key
    JWT_SECRET            = random_password.jwt.result
    TRADING_ALERT_WEBHOOK = var.trading_alert_webhook
  })
}

# ── ECS Cluster ──────────────────────────────────────────────────────────────
resource "aws_ecs_cluster" "trading" {
  name = "tokenfly-trading"

  setting {
    name  = "containerInsights"
    value = "disabled"
  }
}

# ── ECS Task Definition ──────────────────────────────────────────────────────
resource "aws_ecs_task_definition" "trading" {
  family                   = "tokenfly-trading"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name  = "kalshi-dashboard"
      image = var.dashboard_image
      essential = true
      portMappings = [{
        containerPort = 3200
        protocol      = "tcp"
      }]
      secrets = [
        { name = "KALSHI_API_KEY",        valueFrom = "${aws_secretsmanager_secret.trading.arn}:KALSHI_API_KEY::" },
        { name = "API_KEY",               valueFrom = "${aws_secretsmanager_secret.trading.arn}:API_KEY::" },
        { name = "DASHBOARD_API_KEY",     valueFrom = "${aws_secretsmanager_secret.trading.arn}:DASHBOARD_API_KEY::" },
        { name = "JWT_SECRET",            valueFrom = "${aws_secretsmanager_secret.trading.arn}:JWT_SECRET::" },
        { name = "TRADING_ALERT_WEBHOOK", valueFrom = "${aws_secretsmanager_secret.trading.arn}:TRADING_ALERT_WEBHOOK::" }
      ]
      environment = [
        { name = "NODE_ENV",       value = "production" },
        { name = "PORT",           value = "3200" },
        { name = "PAPER_TRADING",  value = "true" }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.dashboard.name
          awslogs-region        = "us-east-1"
          awslogs-stream-prefix = "dashboard"
        }
      }
    },
    {
      name  = "kalshi-scheduler"
      image = var.scheduler_image
      essential = true
      secrets = [
        { name = "KALSHI_API_KEY",        valueFrom = "${aws_secretsmanager_secret.trading.arn}:KALSHI_API_KEY::" },
        { name = "API_KEY",               valueFrom = "${aws_secretsmanager_secret.trading.arn}:API_KEY::" },
        { name = "DASHBOARD_API_KEY",     valueFrom = "${aws_secretsmanager_secret.trading.arn}:DASHBOARD_API_KEY::" },
        { name = "JWT_SECRET",            valueFrom = "${aws_secretsmanager_secret.trading.arn}:JWT_SECRET::" },
        { name = "TRADING_ALERT_WEBHOOK", valueFrom = "${aws_secretsmanager_secret.trading.arn}:TRADING_ALERT_WEBHOOK::" }
      ]
      environment = [
        { name = "NODE_ENV",       value = "production" },
        { name = "PAPER_TRADING",  value = "true" }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.scheduler.name
          awslogs-region        = "us-east-1"
          awslogs-stream-prefix = "scheduler"
        }
      }
    },
    {
      name  = "kalshi-monitor"
      image = var.monitor_image
      essential = true
      secrets = [
        { name = "KALSHI_API_KEY",        valueFrom = "${aws_secretsmanager_secret.trading.arn}:KALSHI_API_KEY::" },
        { name = "API_KEY",               valueFrom = "${aws_secretsmanager_secret.trading.arn}:API_KEY::" },
        { name = "DASHBOARD_API_KEY",     valueFrom = "${aws_secretsmanager_secret.trading.arn}:DASHBOARD_API_KEY::" },
        { name = "JWT_SECRET",            valueFrom = "${aws_secretsmanager_secret.trading.arn}:JWT_SECRET::" },
        { name = "TRADING_ALERT_WEBHOOK", valueFrom = "${aws_secretsmanager_secret.trading.arn}:TRADING_ALERT_WEBHOOK::" }
      ]
      environment = [
        { name = "NODE_ENV",       value = "production" },
        { name = "PAPER_TRADING",  value = "true" }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.monitor.name
          awslogs-region        = "us-east-1"
          awslogs-stream-prefix = "monitor"
        }
      }
    }
  ])
}

# ── ECS Service ──────────────────────────────────────────────────────────────
resource "aws_ecs_service" "trading" {
  name            = "tokenfly-trading"
  cluster         = aws_ecs_cluster.trading.id
  task_definition = aws_ecs_task_definition.trading.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [aws_subnet.public_a.id, aws_subnet.public_b.id]
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = true
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
}

# ── Cost Alert ───────────────────────────────────────────────────────────────
resource "aws_budgets_budget" "trading" {
  name         = "tokenfly-ecs-monthly"
  budget_type  = "COST"
  limit_amount = "40"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }
}
