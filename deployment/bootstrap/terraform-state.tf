# Creates the S3 bucket that holds the Terraform state of both deployment/main and this module.
# This is a one-time setup to run on a new AWS account.
locals {
  # This needs to be a unique name across all S3 buckets. Just pick anything that's available.
  # Whatever is chosen here must also be set in the backend.tf of both modules, which cannot read
  # locals or variables.
  state_bucket_name = "parking-radio-terraform-state"
}

resource "aws_s3_bucket" "terraform_state" {
  bucket = local.state_bucket_name

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
