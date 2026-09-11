# This file has three jobs:
# 1. Generate a private key + CSR locally and get it signed by Cloudflare's Origin CA. The
#    resulting certificate and private key are stored in Secrets Manager (see secrets.tf),
#    for the EC2 instance to read at boot.
# 2. Point the domain at the instance: an A record, proxied through Cloudflare so TLS terminates
#    at their edge.
# 3. Redirect `www.<domain>` to `<domain>`, when the site is served at the zone apex.
data "cloudflare_zone" "this" {
  zone_id = var.cloudflare_zone_id
}

locals {
  # Whether to serve a `www.<domain>` redirect. Only when the site is at the zone apex: a `www.` name
  # in front of a subdomain deployment (e.g. www.parking.example.com) is meaningless, and it wouldn't
  # work anyway.
  www_redirect = var.domain == data.cloudflare_zone.this.name
}

resource "tls_private_key" "origin" {
  algorithm = "RSA"
  rsa_bits  = 2048
}

resource "tls_cert_request" "origin" {
  private_key_pem = tls_private_key.origin.private_key_pem

  subject {
    common_name = var.domain
  }
}

resource "cloudflare_origin_ca_certificate" "origin" {
  csr                = tls_cert_request.origin.cert_request_pem
  hostnames          = [var.domain]
  request_type       = "origin-rsa"
  requested_validity = 5475
}

resource "cloudflare_dns_record" "app" {
  zone_id = var.cloudflare_zone_id
  name    = var.domain
  type    = "A"
  content = aws_eip.app.public_ip
  proxied = true
  ttl     = 1
}

# Set up the `www` redirect.
resource "cloudflare_dns_record" "www" {
  count = local.www_redirect ? 1 : 0

  zone_id = var.cloudflare_zone_id
  name    = "www.${var.domain}"
  type    = "CNAME"
  content = var.domain
  proxied = true
  ttl     = 1 # must be 1 ("automatic") on a proxied record
}

resource "cloudflare_ruleset" "www_redirect" {
  count = local.www_redirect ? 1 : 0

  zone_id = var.cloudflare_zone_id
  name    = "Redirect www to the apex domain"
  kind    = "zone"
  phase   = "http_request_dynamic_redirect"

  rules = [{
    description = "Redirect www.${var.domain} to ${var.domain}"
    expression  = "http.host eq \"www.${var.domain}\""
    action      = "redirect"
    enabled     = true

    action_parameters = {
      from_value = {
        status_code = 301
        target_url = {
          # Keep the path, so a link to www.<domain>/synth-meetups lands on the right page rather
          # than dumping the visitor on the home page.
          expression = "concat(\"https://${var.domain}\", http.request.uri.path)"
        }
        preserve_query_string = true
      }
    }
  }]
}
