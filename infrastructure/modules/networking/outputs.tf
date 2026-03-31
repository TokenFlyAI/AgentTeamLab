output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "List of public subnet IDs"
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "List of private subnet IDs"
  value       = aws_subnet.private[*].id
}

output "sg_alb_id" {
  description = "Security group ID for the ALB"
  value       = aws_security_group.alb.id
}

output "sg_app_id" {
  description = "Security group ID for ECS app tasks"
  value       = aws_security_group.app.id
}

output "sg_efs_id" {
  description = "Security group ID for EFS"
  value       = aws_security_group.efs.id
}

output "sg_rds_id" {
  description = "Security group ID for RDS"
  value       = aws_security_group.rds.id
}

output "sg_vpc_endpoints_id" {
  description = "Security group ID for VPC interface endpoints (ECR, SSM, Secrets Manager, Logs)"
  value       = aws_security_group.vpc_endpoints.id
}

output "vpc_endpoint_s3_id" {
  description = "ID of the S3 gateway endpoint (free; routes ECR layer traffic through AWS network)"
  value       = aws_vpc_endpoint.s3.id
}
