# This file provisions hosting for static image assets: a private S3 bucket served through CloudFront,
# reachable at a stable `assets.<domain>` name.
#
# S3 bucket names are unique across all of AWS, so generate a S3 bucket name that should be unique
# based on var.domain.
locals {
  assets_domain = "assets.${var.domain}"
}

resource "aws_s3_bucket" "assets" {
  bucket = "parking-radio-assets-${replace(var.domain, ".", "-")}"
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket = aws_s3_bucket.assets.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "assets" {
  name                              = "parking-radio-assets"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "assets" {
  enabled = true
  aliases = [local.assets_domain]

  origin {
    domain_name              = aws_s3_bucket.assets.bucket_regional_domain_name
    origin_id                = aws_s3_bucket.assets.id
    origin_access_control_id = aws_cloudfront_origin_access_control.assets.id
  }

  default_cache_behavior {
    target_origin_id       = aws_s3_bucket.assets.id
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]

    # AWS-managed "CachingOptimized" policy.
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    # Referencing the validation resource rather than the certificate itself makes this wait until
    # the certificate is actually issued. CloudFront rejects an alias whose certificate isn't ready.
    acm_certificate_arn      = aws_acm_certificate_validation.assets.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

# Set up assets.${var.domain} so we have a stable name to reference for accessing assets from the app.
resource "aws_acm_certificate" "assets" {
  domain_name       = local.assets_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "cloudflare_dns_record" "assets_certificate_validation" {
  for_each = {
    for option in aws_acm_certificate.assets.domain_validation_options : option.domain_name => option
  }

  zone_id = var.cloudflare_zone_id
  name    = trimsuffix(each.value.resource_record_name, ".")
  type    = each.value.resource_record_type
  content = trimsuffix(each.value.resource_record_value, ".")
  proxied = false # ACM has to resolve this record directly
  ttl     = 60
}

resource "aws_acm_certificate_validation" "assets" {
  certificate_arn         = aws_acm_certificate.assets.arn
  validation_record_fqdns = [for record in cloudflare_dns_record.assets_certificate_validation : record.name]
}

resource "cloudflare_dns_record" "assets" {
  zone_id = var.cloudflare_zone_id
  name    = local.assets_domain
  type    = "CNAME"
  content = aws_cloudfront_distribution.assets.domain_name
  proxied = false # CloudFront serves this directly; there's no point proxying a CDN through another one
  ttl     = 3600
}

# Only CloudFront (via this specific distribution) can read from the bucket.
resource "aws_s3_bucket_policy" "assets" {
  bucket = aws_s3_bucket.assets.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.assets.arn}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = aws_cloudfront_distribution.assets.arn
        }
      }
    }]
  })
}
