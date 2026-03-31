variable "hosted_zone_id" {
  description = "Route53 hosted zone ID for the domain (must already exist)"
  type        = string
}

variable "domain_name" {
  description = "Root domain name (e.g. tokenfly.ai)"
  type        = string
}

variable "certificate_arn" {
  description = "ACM certificate ARN (from alb module output)"
  type        = string
}

variable "certificate_domain_validation_options" {
  description = "Domain validation options from ACM certificate (from alb module output)"
  type = set(object({
    domain_name           = string
    resource_record_name  = string
    resource_record_type  = string
    resource_record_value = string
  }))
}

variable "alb_dns_name" {
  description = "ALB DNS name for ALIAS records (from alb module output)"
  type        = string
}

variable "alb_zone_id" {
  description = "ALB hosted zone ID for ALIAS records (from alb module output)"
  type        = string
}
