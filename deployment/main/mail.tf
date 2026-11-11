# SES, for the app to send emails as noreply@<domain>. The domain's other mail records are left alone
# (see "Email" in docs/deployment.md).

resource "aws_sesv2_email_identity" "main" {
  email_identity = var.domain
}

data "aws_caller_identity" "current" {}

# One CNAME per Easy DKIM token, so SES can sign outgoing mail as this domain.
resource "cloudflare_dns_record" "ses_dkim" {
  count = 3

  zone_id = var.cloudflare_zone_id
  name    = "${aws_sesv2_email_identity.main.dkim_signing_attributes[0].tokens[count.index]}._domainkey.${var.domain}"
  type    = "CNAME"
  content = "${aws_sesv2_email_identity.main.dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"
  proxied = false
  ttl     = 3600
}

# Let the app instance send email as noreply@<domain> (and only as that).
resource "aws_iam_role_policy" "ses_send" {
  name = "send-email"
  role = aws_iam_role.app.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = ["ses:SendEmail", "ses:SendRawEmail"]
      Resource  = "arn:aws:ses:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:identity/*"
      Condition = { StringEquals = { "ses:FromAddress" = "noreply@${var.domain}" } }
    }]
  })
}
