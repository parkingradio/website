# Each deployment is a Terraform workspace, so the workspace both selects the state and names the
# resources below. Deriving both from `terraform.workspace` means there is one source of truth:
# you can't apply production's configuration onto test's state by passing a stale variable.

locals {
  # Every resource whose name has to be unique account-wide, region-wide, or (for the assets bucket)
  # across all of AWS is named "${local.stack_name}-<thing>", or just local.stack_name where a resource
  # takes a single name. Resources where var.domain is the subject rather than a uniquifier (like DNS
  # records, certificates, the SES identity) use the domain.
  stack_name = "parking-radio-${terraform.workspace}"
}

# Force explicit selection of a workspace.
resource "terraform_data" "workspace_guard" {
  lifecycle {
    precondition {
      condition     = terraform.workspace != "default"
      error_message = "Select a workspace first: terraform workspace select -or-create <environment>."
    }
  }
}
