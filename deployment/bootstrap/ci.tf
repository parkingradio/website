# One-time trust setup for the automated deployment pipeline. This creates an IAM policy with just
# enough permissions to perform what the CI needs to do. Run it once manually.

data "aws_caller_identity" "current" {}

data "aws_kms_alias" "rds" {
  name = "alias/aws/rds"
}

data "aws_kms_alias" "secretsmanager" {
  name = "alias/aws/secretsmanager"
}

# The GitHub Actions OIDC provider is account-wide: IAM allows only one per URL per account, and it
# isn't specific to this project. So it's created once per account outside of Terraform (see
# docs/deployment.md) and only looked up here. If this lookup fails, the provider hasn't been created.
#
# Also check that it accepts the audience the trust policy below requires, since a provider set up
# differently may list other audiences than the ones we need.
data "aws_iam_openid_connect_provider" "github_actions" {
  url = "https://token.actions.githubusercontent.com"

  lifecycle {
    postcondition {
      condition     = contains(self.client_id_list, "sts.amazonaws.com")
      error_message = "The existing GitHub Actions OIDC provider does not list sts.amazonaws.com as an audience."
    }
  }
}

# Only the environments in var.deploy_environments, running the `deploy.yml` workflow in this repo,
# can assume this role. A `sub` claim listing several values matches if any one of them does.
resource "aws_iam_role" "github_actions_deploy" {
  name = "parking-radio-github-actions-deploy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = data.aws_iam_openid_connect_provider.github_actions.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = [
            for environment in var.deploy_environments :
            "repo:parkingradio/radio:environment:${environment}"
          ]
        }
      }
    }]
  })
}

# IAM Policy allowing the use of roughly the parts of AWS we need.
resource "aws_iam_role_policy" "deploy_scoped" {
  name = "scoped-resources"
  role = aws_iam_role.github_actions_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "Secrets"
        Effect = "Allow"
        Action = "secretsmanager:*"
        Resource = [
          "arn:aws:secretsmanager:us-east-1:${data.aws_caller_identity.current.account_id}:secret:parking-radio-*",
          "arn:aws:secretsmanager:us-east-1:${data.aws_caller_identity.current.account_id}:secret:rds!db-*",
        ]
      },
      # Only deployment/main's state: its default workspace and the other workspaces, along with their
      # lock files. The bucket also holds the bootstrap state, which CI has no business touching.
      {
        Sid      = "TerraformStateList"
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = "arn:aws:s3:::${local.state_bucket_name}"
      },
      {
        Sid    = "TerraformState"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
        ]
        Resource = [
          "arn:aws:s3:::${local.state_bucket_name}/main.tfstate*",
          "arn:aws:s3:::${local.state_bucket_name}/env:/*/main.tfstate*",
        ]
      },
      {
        Sid    = "Assets"
        Effect = "Allow"
        Action = "s3:*"
        Resource = [
          "arn:aws:s3:::parking-radio-*-assets",
          "arn:aws:s3:::parking-radio-*-assets/*",
        ]
      },
      {
        Sid      = "Cloudfront"
        Effect   = "Allow"
        Action   = "cloudfront:*"
        Resource = "*"
      },
      # The certificate for the assets.<domain> alias on the CloudFront distribution. Certificate
      # ARNs contain a generated ID, so there's nothing stable to scope this to.
      {
        Sid      = "Acm"
        Effect   = "Allow"
        Action   = "acm:*"
        Resource = "*"
      },
      {
        Sid    = "IamResources"
        Effect = "Allow"
        Action = "iam:*"
        Resource = [
          "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/parking-radio-*",
          "arn:aws:iam::${data.aws_caller_identity.current.account_id}:instance-profile/parking-radio-*",
          # The per-alias SMTP users created in mail.tf, along with their access keys and inline
          # policies: those all authorize against the user's ARN.
          "arn:aws:iam::${data.aws_caller_identity.current.account_id}:user/parking-radio-*",
        ]
      },
      {
        Sid      = "Ec2"
        Effect   = "Allow"
        Action   = "ec2:*"
        Resource = "*"
      },
      {
        Sid      = "RDS"
        Effect   = "Allow"
        Action   = "rds:*"
        Resource = "*"
      },
      {
        Sid      = "Ses"
        Effect   = "Allow"
        Action   = "ses:*"
        Resource = "*"
      },
      # Needed for RDS storage encryption (aws/rds) and the auto-generated master
      # password secret (aws/secretsmanager).
      {
        Sid    = "Kms"
        Effect = "Allow"
        Action = [
          "kms:CreateGrant",
          "kms:DescribeKey",
          "kms:Decrypt",
          "kms:Encrypt",
          "kms:GenerateDataKey*",
        ]
        Resource = [
          data.aws_kms_alias.rds.target_key_arn,
          data.aws_kms_alias.secretsmanager.target_key_arn,
        ]
      },
    ]
  })
}
