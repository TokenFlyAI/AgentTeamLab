output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer"
  value       = module.alb.alb_dns_name
}

output "ecr_repository_url" {
  description = "ECR repository URL for pushing images"
  value       = aws_ecr_repository.app.repository_url
}

output "efs_dns_name" {
  description = "EFS DNS name (for troubleshooting)"
  value       = module.efs.dns_name
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = module.ecs.cluster_name
}

output "ecs_service_name" {
  description = "ECS service name"
  value       = module.ecs.service_name
}

output "certificate_validation_records" {
  description = "DNS records to add for ACM certificate validation"
  value       = module.alb.certificate_domain_validation_options
}

output "rds_instance_address" {
  description = "RDS PostgreSQL hostname (private DNS)"
  value       = module.rds.db_instance_address
}

output "rds_credentials_secret_arn" {
  description = "Secrets Manager ARN for DB credentials"
  value       = module.rds.db_credentials_secret_arn
  sensitive   = true
}

output "rds_credentials_secret_name" {
  description = "Secrets Manager secret name for DB credentials"
  value       = module.rds.db_credentials_secret_name
}

# Note: SNS topic ARNs are exported in sns.tf (sns_p0_critical_topic_arn etc.)
# to keep SNS-related outputs co-located with the SNS resource declarations.

output "github_actions_role_arn" {
  description = "IAM role ARN for GitHub Actions OIDC — set as GitHub Secret AWS_ROLE_ARN"
  value       = module.github_oidc.role_arn
}

# Application-level CloudWatch alarm names — for reference in runbooks / dashboards
output "alarm_app_health_check_failed" {
  description = "ALT-001/ALT-008: Alarm name for server health check failure (P0)"
  value       = aws_cloudwatch_metric_alarm.app_health_check_failed.alarm_name
}

output "alarm_app_zero_agents_alive" {
  description = "ALT-005: Alarm name for 0 agents alive (P0)"
  value       = aws_cloudwatch_metric_alarm.app_zero_agents_alive.alarm_name
}

output "alarm_app_low_agent_liveness" {
  description = "ALT-006: Alarm name for <25% agents alive (P1)"
  value       = aws_cloudwatch_metric_alarm.app_low_agent_liveness.alarm_name
}

output "alarm_app_heap_high" {
  description = "ALT-009: Alarm name for heap utilization >85% (P1)"
  value       = aws_cloudwatch_metric_alarm.app_heap_high.alarm_name
}

output "alarm_composite_complete_outage" {
  description = "Composite P0 alarm — fires when server unreachable AND all agents down"
  value       = aws_cloudwatch_composite_alarm.app_complete_outage.alarm_name
}

# DNS module outputs (only set when route53_hosted_zone_id is provided)
output "apex_dns_record" {
  description = "Apex domain A record FQDN (empty if DNS module disabled)"
  value       = length(module.dns) > 0 ? module.dns[0].apex_record_fqdn : ""
}

output "www_dns_record" {
  description = "www subdomain A record FQDN (empty if DNS module disabled)"
  value       = length(module.dns) > 0 ? module.dns[0].www_record_fqdn : ""
}
