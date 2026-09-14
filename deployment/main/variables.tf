variable "cloudflare_api_token" {
  description = "Cloudflare API token (Zone:DNS:Edit + Zone:SSL and Certificates:Edit for the zone containing var.domain)"
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
    Whether Terraform owns mail for var.domain: SES for outbound, Cloudflare Email Routing for
    inbound, and the SPF/DKIM/DMARC records that go with them.

    Leave this off for a domain whose mail is already handled elsewhere. Turning it on there would
    publish a second apex SPF record and add Cloudflare's MX records alongside the existing ones,
    splitting inbound delivery between two providers.

    Defaults to off because enabling this on a domain that already has a mail setup can break the
    existing mail setup. The Deploy workflow requires MANAGE_MAIL to be set explicitly rather than
    relying on this default.
  EOT
  type        = bool
  default     = false
}
