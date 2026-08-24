output "state_bucket" {
  value = aws_s3_bucket.terraform_state.bucket
}

output "github_actions_deploy_role_arn" {
  value = aws_iam_role.github_actions_deploy.arn
}
