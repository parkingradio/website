variable "deploy_environments" {
  description = "GitHub environments in this repository allowed to assume the deploy role."
  type        = list(string)
  default     = ["test", "production"]
}
