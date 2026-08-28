# This file provisions SES so the app can send email from the site's own domain.
resource "aws_sesv2_email_identity" "main" {
  email_identity = var.domain
}

# One CNAME per Easy DKIM token, so SES can sign outgoing mail as this domain.
resource "cloudflare_record" "ses_dkim" {
  count = 3

  zone_id = var.cloudflare_zone_id
  name    = "${aws_sesv2_email_identity.main.dkim_signing_attributes[0].tokens[count.index]}._domainkey${local.record_suffix}"
  type    = "CNAME"
  content = "${aws_sesv2_email_identity.main.dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"
  proxied = false
  ttl     = 3600
}

resource "cloudflare_record" "ses_spf" {
  zone_id = var.cloudflare_zone_id
  name    = local.record_name
  type    = "TXT"
  content = "v=spf1 include:amazonses.com ~all"
  proxied = false
  ttl     = 3600
}

# Monitoring-only for now (no `rua`): there's no mailbox on this domain to receive aggregated reports.
resource "cloudflare_record" "ses_dmarc" {
  zone_id = var.cloudflare_zone_id
  name    = "_dmarc${local.record_suffix}"
  type    = "TXT"
  content = "v=DMARC1; p=none;"
  proxied = false
  ttl     = 3600
}

# Let the app instance send email as this domain, to any recipient.
resource "aws_iam_role_policy" "ses_send" {
  name = "send-email"
  role = aws_iam_role.app.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ses:SendEmail", "ses:SendRawEmail"]
      Resource = "arn:aws:ses:${data.aws_region.current.name}:*:identity/*"
    }]
  })
}
