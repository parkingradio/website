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
  description = "Tag of the app image (in the ghcr_image repository) to deploy. Bump this manually to deploy the web app."
  type        = string
  default     = "TODO"
}
