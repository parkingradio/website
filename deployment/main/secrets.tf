# This file sets up the app's runtime secrets in Secrets Manager: the Cloudflare origin
# certificate and private key, the JWT signing secret, etc.
resource "random_password" "jwt_secret" {
  length  = 64
  special = false
}

resource "random_password" "bootstrap_admin" {
  length  = 24
  special = false
}

resource "aws_secretsmanager_secret" "app" {
  name = "${local.stack_name}-secrets"

  # This is auto-generated, so purge to allow tearing down without a manual step.
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    certificate              = cloudflare_origin_ca_certificate.origin.certificate
    private_key              = tls_private_key.origin.private_key_pem
    jwt_secret               = random_password.jwt_secret.result
    bootstrap_admin_password = random_password.bootstrap_admin.result
    turnstile_secret_key     = cloudflare_turnstile_widget.applications.secret
  })
}
