# Backend configuration. This module's state lives in the same S3 bucket it creates for
# deployment/main, under its own key. The bucket name must match local.state_bucket_name in
# terraform-state.tf. The name cannot be a variable so it must be hardcoded here.
#
# Since the bucket doesn't exist before the first apply on a new AWS account, that first apply
# has to be done with local state, which is then migrated here. See docs/deployment.md.
terraform {
  backend "s3" {
    bucket       = "parking-radio-terraform-state"
    key          = "bootstrap.tfstate"
    region       = "us-east-1"
    use_lockfile = true
    encrypt      = true
  }
}
