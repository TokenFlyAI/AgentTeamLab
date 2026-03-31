# Tokenfly — VPC Endpoints
# Quinn (Cloud) — 2026-03-30
#
# Interface endpoints for ECR, SSM, and Secrets Manager allow ECS Fargate tasks
# to pull images and fetch secrets entirely within the VPC — no NAT gateway
# required for these calls.
#
# Cost impact:
#   - Each interface endpoint: ~$7.30/mo per AZ (us-east-1 pricing)
#   - Gateway endpoint (S3): free
#   - Savings: ECR image pulls + SSM/Secrets Manager calls skip NAT bandwidth charges
#     (~$0.045/GB NAT vs ~$0.01/GB PrivateLink). Payback point: ~10 GB/mo ECR traffic.
#
# Security benefit: traffic stays inside AWS network (no internet path for secrets).
#
# Endpoints created:
#   - com.amazonaws.<region>.ecr.api   (ECR control plane — DescribeImages, etc.)
#   - com.amazonaws.<region>.ecr.dkr   (ECR data plane — image layer pulls)
#   - com.amazonaws.<region>.s3        (gateway — ECR stores layers in S3, free)
#   - com.amazonaws.<region>.secretsmanager
#   - com.amazonaws.<region>.ssm
#   - com.amazonaws.<region>.ssmmessages (optional: SSM Session Manager for debugging)
#   - com.amazonaws.<region>.logs      (CloudWatch Logs — agent telemetry)
# ---------------------------------------------------------------------------

data "aws_region" "current" {}

# ---------------------------------------------------------------------------
# Security Group — VPC Endpoints
# Allows inbound HTTPS from app tasks only (ECR, SSM, Secrets Manager all use 443)
# ---------------------------------------------------------------------------

resource "aws_security_group" "vpc_endpoints" {
  name        = "${var.name_prefix}-vpce-sg"
  description = "VPC interface endpoints — HTTPS from app SG only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "HTTPS from app containers"
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-vpce-sg" })
}

# ---------------------------------------------------------------------------
# S3 Gateway Endpoint (free — required for ECR layer downloads)
# ---------------------------------------------------------------------------

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${data.aws_region.current.name}.s3"
  vpc_endpoint_type = "Gateway"

  # Attach to all private route tables so ECS tasks route S3 traffic internally
  route_table_ids = aws_route_table.private[*].id

  tags = merge(var.tags, { Name = "${var.name_prefix}-vpce-s3" })
}

# ---------------------------------------------------------------------------
# ECR API Interface Endpoint
# ---------------------------------------------------------------------------

resource "aws_vpc_endpoint" "ecr_api" {
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${data.aws_region.current.name}.ecr.api"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.vpc_endpoints.id]
  private_dns_enabled = true

  tags = merge(var.tags, { Name = "${var.name_prefix}-vpce-ecr-api" })
}

# ---------------------------------------------------------------------------
# ECR DKR Interface Endpoint (image layer downloads)
# ---------------------------------------------------------------------------

resource "aws_vpc_endpoint" "ecr_dkr" {
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${data.aws_region.current.name}.ecr.dkr"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.vpc_endpoints.id]
  private_dns_enabled = true

  tags = merge(var.tags, { Name = "${var.name_prefix}-vpce-ecr-dkr" })
}

# ---------------------------------------------------------------------------
# Secrets Manager Interface Endpoint
# ---------------------------------------------------------------------------

resource "aws_vpc_endpoint" "secretsmanager" {
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${data.aws_region.current.name}.secretsmanager"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.vpc_endpoints.id]
  private_dns_enabled = true

  tags = merge(var.tags, { Name = "${var.name_prefix}-vpce-secretsmanager" })
}

# ---------------------------------------------------------------------------
# SSM Interface Endpoint
# ---------------------------------------------------------------------------

resource "aws_vpc_endpoint" "ssm" {
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${data.aws_region.current.name}.ssm"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.vpc_endpoints.id]
  private_dns_enabled = true

  tags = merge(var.tags, { Name = "${var.name_prefix}-vpce-ssm" })
}

# ---------------------------------------------------------------------------
# CloudWatch Logs Interface Endpoint (agent metrics + container logs)
# ---------------------------------------------------------------------------

resource "aws_vpc_endpoint" "logs" {
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${data.aws_region.current.name}.logs"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.vpc_endpoints.id]
  private_dns_enabled = true

  tags = merge(var.tags, { Name = "${var.name_prefix}-vpce-logs" })
}
