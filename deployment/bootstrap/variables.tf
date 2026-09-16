variable "manage_github_oidc_provider" {
  description = <<-EOT
    Whether to create the GitHub Actions OIDC provider (which allows Github Actions to perform deployments).
    An AWS account can hold only one OIDC provider per URL, so leave this false if the account already trusts
    GitHub Actions for another project, in which case the existing provider is reused as-is. On an account
    that has never been used with GitHub Actions, set this to true for the one-time bootstrap.
  EOT
  type        = bool
  default     = false
}

variable "deploy_environments" {
  description = "GitHub environments in this repository allowed to assume the deploy role."
  type        = list(string)
  default     = ["test", "production"]
}
