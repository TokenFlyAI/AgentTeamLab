# ECS Fargate Trading Pipeline — Task T316
# Author: Eve (Infra)
# Target: ~$29/month via Fargate Spot for scheduler/monitor

terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
  backend "s3" {
    bucket = "tokenfly-tf-state"
    key    = "trading-ecs/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" { region = "us-east-1" }

# ── VPC ──────────────────────────────────────────────────────────────────────
resource "aws_vpc" "trading" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  tags                 = { Name = "tokenfly-trading" }
}

resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.trading.id
}

resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.trading.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "us-east-1a"
  map_public_ip_on_launch = true
  tags                    = { Name = "tokenfly-public-a" }
}

resource "aws_subnet" "public_b" {
  vpc_id                  = aws_vpc.trading.id
  cidr_block              = "10.0.2.0/24"
  availability_zone       = "us-east-1b"
  map_public_ip_on_launch = true
  tags                    = { Name = "tokenfly-public-b" }
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

# ── Security Groups ───────────────────────────────────────────────────────────
resource "aws_security_group" "alb" {
  name   = "tokenfly-alb"
  vpc_id = aws_vpc.trading.id

  ingress {
    description = "Dashboard HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = [var.allowed_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "ecs" {
  name   = "tokenfly-ecs"
  vpc_id = aws_vpc.trading.id

  ingress {
    description     = "Dashboard from ALB"
    from_port       = 3200
    to_port         = 3200
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ── ALB ───────────────────────────────────────────────────────────────────────
resource "aws_lb" "trading" {
  name               = "tokenfly-trading"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = [aws_subnet.public_a.id, aws_subnet.public_b.id]
}

resource "aws_lb_target_group" "dashboard" {
  name        = "tokenfly-dashboard"
  port        = 3200
  protocol    = "HTTP"
  vpc_id      = aws_vpc.trading.id
  target_type = "ip"

  health_check {
    path                = "/health"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "dashboard" {
  load_balancer_arn = aws_lb.trading.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.dashboard.arn
  }
}

# ── ECS Cluster ───────────────────────────────────────────────────────────────
resource "aws_ecs_cluster" "trading" {
  name = "tokenfly-trading"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "trading" {
  cluster_name = aws_ecs_cluster.trading.name

  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    base              = 1
    weight            = 1
    capacity_provider = "FARGATE"
  }
}

# ── ECR Repositories ──────────────────────────────────────────────────────────
resource "aws_ecr_repository" "dashboard" {
  name                 = "tokenfly/dashboard"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

resource "aws_ecr_repository" "scheduler" {
  name                 = "tokenfly/scheduler"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

resource "aws_ecr_repository" "monitor" {
  name                 = "tokenfly/monitor"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

# ── CloudWatch Logs ───────────────────────────────────────────────────────────
resource "aws_cloudwatch_log_group" "dashboard" {
  name              = "/tokenfly/trading/dashboard"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "scheduler" {
  name              = "/tokenfly/trading/scheduler"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "monitor" {
  name              = "/tokenfly/trading/monitor"
  retention_in_days = 14
}

# ── IAM Roles ─────────────────────────────────────────────────────────────────
resource "aws_iam_role" "ecs_task_execution" {
  name = "tokenfly-ecs-task-execution"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_managed" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_task_execution_ecr" {
  role = aws_iam_role.ecs_task_execution.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage"
      ]
      Resource = [
        aws_ecr_repository.dashboard.arn,
        aws_ecr_repository.scheduler.arn,
        aws_ecr_repository.monitor.arn
      ]
    }]
  })
}

resource "aws_iam_role_policy" "ecs_task_execution_secrets" {
  role = aws_iam_role.ecs_task_execution.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [aws_secretsmanager_secret.trading.arn]
    }]
  })
}

# ── Secrets Manager ───────────────────────────────────────────────────────────
resource "random_password" "jwt" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "trading" {
  name                    = "tokenfly/trading"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "trading" {
  secret_id = aws_secretsmanager_secret.trading.id
  secret_string = jsonencode({
    KALSHI_API_KEY    = var.kalshi_api_key
    API_KEY           = var.dashboard_api_key
    DASHBOARD_API_KEY = var.dashboard_api_key
    JWT_SECRET        = random_password.jwt.result
  })
}

# ── Task Definitions ──────────────────────────────────────────────────────────
locals {
  secrets = [
    { name = "KALSHI_API_KEY", valueFrom = "${aws_secretsmanager_secret.trading.arn}:KALSHI_API_KEY::" },
    { name = "API_KEY", valueFrom = "${aws_secretsmanager_secret.trading.arn}:API_KEY::" },
    { name = "DASHBOARD_API_KEY", valueFrom = "${aws_secretsmanager_secret.trading.arn}:DASHBOARD_API_KEY::" },
    { name = "JWT_SECRET", valueFrom = "${aws_secretsmanager_secret.trading.arn}:JWT_SECRET::" },
  ]
}

resource "aws_ecs_task_definition" "dashboard" {
  family                   = "tokenfly-dashboard"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn

  container_definitions = jsonencode([{
    name  = "dashboard"
    image = "${aws_ecr_repository.dashboard.repository_url}:latest"
    portMappings = [{
      containerPort = 3200
      protocol      = "tcp"
    }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = "3200" },
      { name = "PAPER_TRADING", value = "true" },
    ]
    secrets = local.secrets
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.dashboard.name
        awslogs-region        = "us-east-1"
        awslogs-stream-prefix = "dashboard"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "scheduler" {
  family                   = "tokenfly-scheduler"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "128"
  memory                   = "256"
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn

  container_definitions = jsonencode([{
    name  = "scheduler"
    image = "${aws_ecr_repository.scheduler.repository_url}:latest"
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PAPER_TRADING", value = "true" },
    ]
    secrets = local.secrets
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.scheduler.name
        awslogs-region        = "us-east-1"
        awslogs-stream-prefix = "scheduler"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "monitor" {
  family                   = "tokenfly-monitor"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "128"
  memory                   = "256"
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn

  container_definitions = jsonencode([{
    name  = "monitor"
    image = "${aws_ecr_repository.monitor.repository_url}:latest"
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PAPER_TRADING", value = "true" },
    ]
    secrets = local.secrets
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.monitor.name
        awslogs-region        = "us-east-1"
        awslogs-stream-prefix = "monitor"
      }
    }
  }])
}

# ── ECS Services ──────────────────────────────────────────────────────────────
resource "aws_ecs_service" "dashboard" {
  name            = "dashboard"
  cluster         = aws_ecs_cluster.trading.id
  task_definition = aws_ecs_task_definition.dashboard.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [aws_subnet.public_a.id, aws_subnet.public_b.id]
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.dashboard.arn
    container_name   = "dashboard"
    container_port   = 3200
  }

  depends_on = [aws_lb_listener.dashboard]
}

resource "aws_ecs_service" "scheduler" {
  name            = "scheduler"
  cluster         = aws_ecs_cluster.trading.id
  task_definition = aws_ecs_task_definition.scheduler.arn
  desired_count   = 1

  capacity_provider_strategy {
    base              = 0
    weight            = 1
    capacity_provider = "FARGATE_SPOT"
  }

  network_configuration {
    subnets          = [aws_subnet.public_a.id, aws_subnet.public_b.id]
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = true
  }
}

resource "aws_ecs_service" "monitor" {
  name            = "monitor"
  cluster         = aws_ecs_cluster.trading.id
  task_definition = aws_ecs_task_definition.monitor.arn
  desired_count   = 1

  capacity_provider_strategy {
    base              = 0
    weight            = 1
    capacity_provider = "FARGATE_SPOT"
  }

  network_configuration {
    subnets          = [aws_subnet.public_a.id, aws_subnet.public_b.id]
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = true
  }
}

# ── Budget Alert ──────────────────────────────────────────────────────────────
resource "aws_budgets_budget" "trading" {
  name         = "tokenfly-trading-monthly"
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

# ── Variables & Outputs ───────────────────────────────────────────────────────
variable "kalshi_api_key" {
  sensitive = true
}

variable "dashboard_api_key" {
  sensitive = true
}

variable "alert_email" {}

variable "allowed_cidr" {
  description = "Your IP in CIDR: 1.2.3.4/32"
}

output "dashboard_url" {
  value = "http://${aws_lb.trading.dns_name}"
}

output "ecs_cluster" {
  value = aws_ecs_cluster.trading.name
}
