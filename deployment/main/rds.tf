# This file provisions the Postgres database that the app talks to. It is a private RDS instance
# only accessible by the app instance.
#
# It is automatically backed up every day and backups are kept for 7 days.
#
# In production, the database can't be deleted without first turning off deletion protection, and
# deleting it takes a final snapshot and keeps the automated backups. This requires manual steps
# but is safer.
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

  deletion_protection       = local.is_production
  skip_final_snapshot       = !local.is_production
  final_snapshot_identifier = local.is_production ? "${local.stack_name}-final" : null

  backup_retention_period  = 7
  delete_automated_backups = !local.is_production
}
