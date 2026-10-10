variable "cloudflare_api_token" {
  description = "Cloudflare API token (see docs/deployment.md for the permissions it needs)"
  type        = string
  sensitive   = true
}

variable "cloudflare_zone_id" {
  description = "Zone ID in Cloudflare for the zone containing var.domain"
  type        = string
}

variable "domain" {
  description = "Full domain name the site is served at"
  type        = string
}

variable "ghcr_image" {
  description = "GHCR image reference (without tag) for the app"
  type        = string
  default     = "ghcr.io/parkingradio/radio"
}

variable "app_image_tag" {
  description = "Tag of the app image (in the ghcr_image repository) to deploy."
  type        = string
}

variable "manage_mail" {
  description = <<-EOT
    Whether Terraform owns mail for var.domain: Cloudflare Email Routing for inbound, the mail
    aliases, and the apex SPF/DMARC records that go with them. The SES identity the app uses to send
    as noreply@<domain> is always provisioned since that is required to send admin invitations, and
    does not conflict with other mail setups.

    Leave this off for a domain whose mail is already handled elsewhere. Turning it on there would
    publish a second apex SPF record and add Cloudflare's MX records alongside the existing ones,
    splitting inbound delivery between two providers.

    Defaults to off because enabling this on a domain that already has a mail setup can break the
    existing mail setup.

    This can only be turned on when var.domain is the zone apex, since Email Routing is a zone-wide
    setting that environments on subdomains of the same zone would otherwise fight over.
  EOT
  type        = bool
  default     = false
}
