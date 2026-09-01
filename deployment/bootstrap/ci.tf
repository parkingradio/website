# One-time trust setup for the automated deployment pipeline. This creates an IAM policy with just
# enough permissions to perform what the CI needs to do. Run it once manually.

data "aws_caller_identity" "current" {}

data "aws_kms_alias" "rds" {
  name = "alias/aws/rds"
}

data "aws_kms_alias" "secretsmanager" {
  name = "alias/aws/secretsmanager"
}

resource "aws_iam_openid_connect_provider" "github_actions" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  # thumbprint_list intentionally omitted: optional/computed in the current AWS provider version, which
  # fetches it itself rather than needing it hand-specified.
}

# Only the `production` environment in the `deploy.yml` workflow in this repo can assume this role.
resource "aws_iam_role" "github_actions_deploy" {
  name = "parking-radio-github-actions-deploy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github_actions.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:parkingradio/radio:environment:production"
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
          "arn:aws:secretsmanager:us-east-1:${data.aws_caller_identity.current.account_id}:secret:parking-radio/*",
          "arn:aws:secretsmanager:us-east-1:${data.aws_caller_identity.current.account_id}:secret:rds!db-*",
        ]
      },
      {
        Sid    = "TerraformState"
        Effect = "Allow"
        Action = "s3:*"
        Resource = [
          "arn:aws:s3:::parking-radio-terraform-state",
          "arn:aws:s3:::parking-radio-terraform-state/*",
        ]
      },
      {
        Sid    = "Assets"
        Effect = "Allow"
        Action = "s3:*"
        Resource = [
          "arn:aws:s3:::parking-radio-assets-*",
          "arn:aws:s3:::parking-radio-assets-*/*",
        ]
      },
      {
        Sid      = "Cloudfront"
        Effect   = "Allow"
        Action   = "cloudfront:*"
        Resource = "*"
      },
      {
        Sid    = "IamResources"
        Effect = "Allow"
        Action = "iam:*"
        Resource = [
          "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/parking-radio-*",
          "arn:aws:iam::${data.aws_caller_identity.current.account_id}:instance-profile/parking-radio-*",
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
