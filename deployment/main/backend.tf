terraform {
  backend "s3" {
    bucket       = "parking-radio-terraform-state"
    key          = "main.tfstate"
    region       = "us-east-1"
    use_lockfile = true
    encrypt      = true
  }
}
