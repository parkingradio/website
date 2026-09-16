# This file provisions the Postgres database that the app talks to. It is a private RDS instance
# only accessible by the app instance.
#
# It is automatically backed up every day and backups are kept for 7 days.
resource "aws_db_subnet_group" "main" {
  name       = local.stack_name
  subnet_ids = data.aws_subnets.default.ids
}

resource "aws_db_instance" "main" {
  identifier     = local.stack_name
  engine         = "postgres"
  engine_version = "16"
  instance_class = "db.t4g.micro"

  allocated_storage = 20
  storage_encrypted = true

  db_name  = "parking_radio"
  username = "parking_radio"

  # AWS generates and stores the master password itself.
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  publicly_accessible = false
  skip_final_snapshot = true
  deletion_protection = false

  backup_retention_period = 7
}
