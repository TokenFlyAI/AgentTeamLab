output "ecs_cluster_name" {
  value = aws_ecs_cluster.trading.name
}

output "ecs_service_name" {
  value = aws_ecs_service.trading.name
}

output "dashboard_security_group" {
  value = aws_security_group.ecs.id
}

output "secrets_manager_arn" {
  value = aws_secretsmanager_secret.trading.arn
}
