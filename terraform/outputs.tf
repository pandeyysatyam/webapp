output "application_url" {
  value = "https://${var.domain_name}"
}

output "alb_dns_name" {
  value = aws_lb.this.dns_name
}

output "rds_endpoint" {
  value     = aws_db_instance.this.endpoint
  sensitive = true
}

output "db_secret_arn" {
  value = aws_secretsmanager_secret.db.arn
}

output "app_bucket" {
  value = aws_s3_bucket.app.bucket
}

output "alb_logs_bucket" {
  value = aws_s3_bucket.logs.bucket
}
