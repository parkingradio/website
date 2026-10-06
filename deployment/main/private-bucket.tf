# This file provisions the app's private S3 bucket: the files only the app reads and writes, as opposed to
# the public assets (see assets.tf).
#
# Files that are deleted or overwritten can be restored for as long as the database's backups are kept
# (see rds.tf), and are gone for good after that.
resource "aws_s3_bucket" "private" {
  bucket = "${local.stack_name}-private"

  # Outside production, allow tearing down without a manual step. In production, refuse to delete a
  # non-empty bucket.
  force_destroy = !local.is_production
}

resource "aws_s3_bucket_versioning" "private" {
  bucket = aws_s3_bucket.private.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "private" {
  bucket = aws_s3_bucket.private.id

  rule {
    id     = "expire-previous-versions-with-database-backups"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = aws_db_instance.main.backup_retention_period
    }

    # Once a deleted file's previous versions have expired, nothing is left behind its delete marker.
    expiration {
      expired_object_delete_marker = true
    }
  }

  # A noncurrent-version rule only means something once versioning is on, so apply it afterwards.
  depends_on = [aws_s3_bucket_versioning.private]
}

resource "aws_s3_bucket_public_access_block" "private" {
  bucket = aws_s3_bucket.private.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_iam_role_policy" "private" {
  name = "manage-private-bucket"
  role = aws_iam_role.app.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.private.arn}/*"
      },
      {
        # Without it, S3 says access is denied when asked for a file that doesn't exist, rather than that it
        # doesn't exist.
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = aws_s3_bucket.private.arn
      },
    ]
  })
}
