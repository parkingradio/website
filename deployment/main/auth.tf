# This file provisions the secret needed to bootstrap the first admin account: a randomly
# generated password for admin@<domain> stored in Secrets Manager.
resource "random_password" "bootstrap_admin" {
  length  = 24
  special = false
}

resource "aws_secretsmanager_secret" "auth" {
  name = "parking-radio/auth"
}

resource "aws_secretsmanager_secret_version" "auth" {
  secret_id = aws_secretsmanager_secret.auth.id
  secret_string = jsonencode({
    bootstrap_admin_password = random_password.bootstrap_admin.result
  })
}

resource "aws_iam_role_policy" "auth_secrets" {
  name = "read-auth-secrets"
  role = aws_iam_role.app.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "secretsmanager:GetSecretValue"
      Resource = aws_secretsmanager_secret.auth.arn
    }]
  })
}
