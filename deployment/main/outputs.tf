output "instance_public_ip" {
  value = aws_eip.app.public_ip
}

output "rds_endpoint" {
  value = aws_db_instance.main.endpoint
}

output "assets_bucket_name" {
  value = aws_s3_bucket.assets.bucket
}

# The stable name the app builds asset URLs from. `assets_cdn_domain` is the underlying
# CloudFront-assigned name, which is only useful for debugging (it changes if the distribution
# is ever re-created).
output "assets_domain" {
  value = local.assets_domain
}

output "assets_cdn_domain" {
  value = aws_cloudfront_distribution.assets.domain_name
}
