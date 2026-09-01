output "instance_public_ip" {
  value = aws_eip.app.public_ip
}

output "rds_endpoint" {
  value = aws_db_instance.main.endpoint
}

output "assets_bucket_name" {
  value = aws_s3_bucket.assets.bucket
}

output "assets_cdn_domain" {
  value = aws_cloudfront_distribution.assets.domain_name
}
