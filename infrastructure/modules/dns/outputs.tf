output "certificate_validation_id" {
  description = "ACM certificate validation resource ID (signals cert is ISSUED)"
  value       = aws_acm_certificate_validation.main.id
}

output "apex_record_fqdn" {
  description = "FQDN of the apex A record"
  value       = aws_route53_record.apex.fqdn
}

output "www_record_fqdn" {
  description = "FQDN of the www A record"
  value       = aws_route53_record.www.fqdn
}
