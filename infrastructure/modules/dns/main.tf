# Tokenfly — DNS Module
# Quinn (Cloud) — 2026-03-30
#
# Route53 records for:
#   1. ACM certificate DNS validation (CNAME records)
#   2. Domain A/ALIAS records pointing to the ALB
#
# Prerequisite: a Route53 hosted zone for var.domain_name must already exist.
#               Provide its ID via var.hosted_zone_id.
#
# Cost: $0.50/mo per hosted zone (if already exists = $0). Route53 queries $0.40/1M.
# ---------------------------------------------------------------------------

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# ---------------------------------------------------------------------------
# ACM Certificate Validation Records
#
# aws_acm_certificate.domain_validation_options emits one record per SAN.
# We use for_each to create all required CNAME records in one pass.
# The `distinct` + `for_each` pattern handles deduplication when multiple
# SANs share the same validation record (common with wildcard certs).
# ---------------------------------------------------------------------------

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in var.certificate_domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id         = var.hosted_zone_id
  name            = each.value.name
  type            = each.value.type
  ttl             = 60
  records         = [each.value.record]
  allow_overwrite = true
}

# Wait for the cert to reach ISSUED status before anything uses it.
resource "aws_acm_certificate_validation" "main" {
  certificate_arn         = var.certificate_arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

# ---------------------------------------------------------------------------
# ALB Alias Records
#
# Apex domain (tokenfly.ai) and www subdomain both ALIAS to the ALB.
# ALIAS records are free and resolve at AWS DNS level (no extra hop).
# ---------------------------------------------------------------------------

resource "aws_route53_record" "apex" {
  zone_id = var.hosted_zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = var.alb_dns_name
    zone_id                = var.alb_zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "www" {
  zone_id = var.hosted_zone_id
  name    = "www.${var.domain_name}"
  type    = "A"

  alias {
    name                   = var.alb_dns_name
    zone_id                = var.alb_zone_id
    evaluate_target_health = true
  }
}
