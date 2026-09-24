# This file provisions mail for the site's own domain:
# - SES for outbound, since the app itself sends emails as noreply@<domain>
# - individual mail aliases (see mail-aliases.tf), which get their own restricted sending credentials
#   and Cloudflare Email Routing for inbound (each alias is forwarded to a real mailbox).
#
# All of it is gated on var.manage_mail, so the app can be deployed to a domain whose mail is already
# handled by someone else without Terraform fighting the existing setup. See that variable for why.

locals {
  # Empty when Terraform isn't managing mail, which is what switches off every per-alias resource
  # below without having to repeat the conditional on each one.
  mail_aliases_managed = var.manage_mail ? local.mail_aliases : {}
}

resource "aws_sesv2_email_identity" "main" {
  count = var.manage_mail ? 1 : 0

  email_identity = var.domain
}

data "aws_caller_identity" "current" {}

# One CNAME per Easy DKIM token, so SES can sign outgoing mail as this domain.
resource "cloudflare_dns_record" "ses_dkim" {
  count = var.manage_mail ? 3 : 0

  zone_id = var.cloudflare_zone_id
  name    = "${aws_sesv2_email_identity.main[0].dkim_signing_attributes[0].tokens[count.index]}._domainkey.${var.domain}"
  type    = "CNAME"
  content = "${aws_sesv2_email_identity.main[0].dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"
  proxied = false
  ttl     = 3600
}

# A domain can only have one SPF record, so SES (outbound app email) and Cloudflare Email
# Routing (which re-sends bounces/forwards as this domain) both need to be authorized here.
resource "cloudflare_dns_record" "ses_spf" {
  count = var.manage_mail ? 1 : 0

  zone_id = var.cloudflare_zone_id
  name    = var.domain
  type    = "TXT"
  content = "v=spf1 include:amazonses.com include:_spf.mx.cloudflare.net ~all"
  proxied = false
  ttl     = 3600
}

# Monitoring-only for now (no `rua`): there's no mailbox on this domain to receive aggregated reports.
resource "cloudflare_dns_record" "ses_dmarc" {
  count = var.manage_mail ? 1 : 0

  zone_id = var.cloudflare_zone_id
  name    = "_dmarc.${var.domain}"
  type    = "TXT"
  content = "v=DMARC1; p=none;"
  proxied = false
  ttl     = 3600
}

# Let the app instance send email as noreply@<domain> (and only as that).
resource "aws_iam_role_policy" "ses_send" {
  count = var.manage_mail ? 1 : 0

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

# Inbound: forward each alias in local.mail_aliases (e.g. contact@<domain>) to its mailbox via
# Cloudflare Email Routing.
resource "cloudflare_email_routing_settings" "main" {
  count = var.manage_mail ? 1 : 0

  zone_id = var.cloudflare_zone_id
}

resource "cloudflare_dns_record" "routing_mx" {
  count = var.manage_mail ? 3 : 0

  zone_id  = var.cloudflare_zone_id
  name     = var.domain
  type     = "MX"
  content  = "route${count.index + 1}.mx.cloudflare.net"
  priority = (count.index + 1) * 10
  ttl      = 3600
}

# One destination per unique mailbox (several aliases can potentially forward to the same mailbox).
# Requires a one-time manual step per mailbox: Cloudflare emails it a confirmation link, and the owner
# of the mailbox has to validate ownership by clicking the link before routing will actually deliver there.
resource "cloudflare_email_routing_address" "destination" {
  for_each = toset(values(local.mail_aliases_managed))

  account_id = data.cloudflare_zone.this.account.id
  email      = each.value
}

resource "cloudflare_email_routing_rule" "alias" {
  for_each = local.mail_aliases_managed

  zone_id = var.cloudflare_zone_id
  name    = "forward ${each.key}@${var.domain}"
  enabled = true

  matchers = [{
    type  = "literal"
    field = "to"
    value = "${each.key}@${var.domain}"
  }]

  actions = [{
    type  = "forward"
    value = [cloudflare_email_routing_address.destination[each.value].email]
  }]
}

# Outbound: give each alias its own SMTP credentials, restricted to sending as exactly that
# address, so e.g. owner@<domain>'s credentials can't be used to send as contact@<domain>.
resource "aws_iam_user" "mail_alias" {
  for_each = local.mail_aliases_managed

  name = "${local.stack_name}-mail-${each.key}"
}

resource "aws_iam_access_key" "mail_alias" {
  for_each = local.mail_aliases_managed

  user = aws_iam_user.mail_alias[each.key].name
}

resource "aws_iam_user_policy" "mail_alias" {
  for_each = local.mail_aliases_managed

  name = "send-as-${each.key}"
  user = aws_iam_user.mail_alias[each.key].name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "ses:SendRawEmail"
      Resource  = "arn:aws:ses:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:identity/*"
      Condition = { StringEquals = { "ses:FromAddress" = "${each.key}@${var.domain}" } }
    }]
  })
}

# SMTP username/password per alias. These credentials are stored in Secrets Manager and must
# be handed out manually by someone with AWS access to the person owning the destination
# mailbox.
resource "aws_secretsmanager_secret" "mail_smtp" {
  count = var.manage_mail ? 1 : 0

  name = "${local.stack_name}-mail-smtp-credentials"

  # These are automatically generated, purge to allow tearing down without a manual step.
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "mail_smtp" {
  count = var.manage_mail ? 1 : 0

  secret_id = aws_secretsmanager_secret.mail_smtp[0].id
  secret_string = jsonencode({
    for name, _ in local.mail_aliases_managed : name => {
      smtp_username = aws_iam_access_key.mail_alias[name].id
      smtp_password = aws_iam_access_key.mail_alias[name].ses_smtp_password_v4
    }
  })
}
