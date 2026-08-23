# This file provisions the app server: a single EC2 instance running the Docker Compose stack,
# reached only through Cloudflare and given a stable public Elastic IP.
#
# Its IAM role grants just enough to allow shell access via SSM and fetch the secrets it needs
# from the AWS Secrets Manager.
data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-arm64"]
  }

  filter {
    name   = "architecture"
    values = ["arm64"]
  }
}

resource "aws_eip" "app" {
  domain = "vpc"
}

resource "aws_eip_association" "app" {
  instance_id   = aws_instance.app.id
  allocation_id = aws_eip.app.id
}

resource "aws_iam_role" "app" {
  name = "parking-radio-app"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "secrets" {
  name = "read-secrets"
  role = aws_iam_role.app.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = "secretsmanager:GetSecretValue"
      Resource = [
        aws_db_instance.main.master_user_secret[0].secret_arn,
        aws_secretsmanager_secret.origin_cert.arn,
      ]
    }]
  })
}

resource "aws_iam_instance_profile" "app" {
  name = "parking-radio-app"
  role = aws_iam_role.app.name
}

resource "aws_instance" "app" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = "t4g.micro"
  subnet_id              = data.aws_subnets.default.ids[0]
  vpc_security_group_ids = [aws_security_group.ec2.id]
  iam_instance_profile   = aws_iam_instance_profile.app.name

  user_data = templatefile("${path.module}/../templates/user_data.sh.tftpl", {
    db_secret_arn     = aws_db_instance.main.master_user_secret[0].secret_arn
    db_username       = aws_db_instance.main.username
    db_endpoint       = aws_db_instance.main.endpoint
    db_name           = aws_db_instance.main.db_name
    origin_secret_arn = aws_secretsmanager_secret.origin_cert.arn
    compose_file = templatefile("${path.module}/../templates/docker-compose.prod.yml.tftpl", {
      image = "${var.ghcr_image}:latest"
    })
    nginx_conf = templatefile("${path.module}/../templates/nginx.conf.tftpl", {
      domain = var.domain
    })
  })
  user_data_replace_on_change = true

  tags = {
    Name = "parking-radio"
  }
}
