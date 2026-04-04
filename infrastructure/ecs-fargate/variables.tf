variable "kalshi_api_key" {
  description = "Kalshi trading API key"
  sensitive   = true
}

variable "dashboard_api_key" {
  description = "Dashboard API auth key"
  sensitive   = true
}

variable "trading_alert_webhook" {
  description = "Webhook URL for trading alerts"
  default     = ""
  sensitive   = true
}

variable "alert_email" {
  description = "Email for budget alerts"
}

variable "allowed_cidr" {
  description = "IP allowed to access dashboard (e.g., 1.2.3.4/32)"
}

variable "dashboard_image" {
  description = "ECR image URI for kalshi-dashboard"
  default     = "tokenfly/kalshi-dashboard:latest"
}

variable "scheduler_image" {
  description = "ECR image URI for kalshi-scheduler"
  default     = "tokenfly/kalshi-scheduler:latest"
}

variable "monitor_image" {
  description = "ECR image URI for kalshi-monitor"
  default     = "tokenfly/kalshi-monitor:latest"
}
