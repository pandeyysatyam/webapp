resource "random_password" "db" {
  length           = 24
  special          = true
  override_special = "!#$%^*()-_=+"
}

resource "aws_secretsmanager_secret" "db" {
  name        = "${var.project}-db-credentials"
  description = "Database credentials for ${var.project}"
}

resource "aws_secretsmanager_secret_version" "db" {
  secret_id = aws_secretsmanager_secret.db.id
  secret_string = jsonencode({
    username = var.db_username
    password = random_password.db.result
    dbname   = var.db_name
    engine   = "mysql"
    port     = 3306
  })
}
