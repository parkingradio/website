# Deployment

The production stack is a single EC2 host running Docker Compose (the app + Nginx), talking to a Postgres
instance on RDS. DNS and TLS termination are handled by Cloudflare; the Nginx origin holds a Cloudflare
Origin CA certificate so traffic between Cloudflare and the origin is encrypted too. Everything is
provisioned with Terraform, split into two modules under `deployment/`:

- `deployment/bootstrap`: creates the S3 bucket that `deployment/main` uses as its remote state backend,
  and the OIDC provider + IAM role the automatic deploy pipeline (below) uses to authenticate from GitHub
  Actions. Used exactly once on a new AWS deployment — deliberately kept separate from `deployment/main`
  so the CI role it creates can never see or modify its own trust policy/permissions through the pipeline
  it drives.
- `deployment/main`: the actual stack configuring networking, RDS, the EC2 instance, and the Cloudflare DNS
  record + Origin CA certificate.

## One-time bootstrap

```sh
export AWS_PROFILE=your-aws-profile
terraform -chdir=deployment/bootstrap init
terraform -chdir=deployment/bootstrap apply
```

This creates the `parking-radio-terraform-state` S3 bucket to contain the Terraform state, and an IAM
role for the deployment pipeline. After applying, four things need to be configured once in the GitHub
repository:

- Secret `CLOUDFLARE_API_TOKEN`: An API token for the account under which the domain name is configured. The
  token needs `Zone:DNS:Edit`, `Zone:SSL` and `Certificates:Edit` permissions scoped to the domain name zone.
- Variables `DOMAIN` and `CLOUDFLARE_ZONE_ID`: The domain name in use and the Cloudflare zone ID of that domain.
  Those are not sensitive.
- Variable `AWS_DEPLOY_ROLE_ARN`: This is output by Terraform when doing the one-time CI bootstrap. This allows
  the CI deployment pipeline to perform operations in the AWS account (e.g. deploy EC2) based on the OIDC trust
  chain established by the one-time bootstrap. This is not sensitive.

## Deploying the web app

This is done by running `terraform apply`:

```sh
export AWS_PROFILE=your-aws-profile
terraform -chdir=deployment/main init
terraform -chdir=deployment/main apply -var="app_image_tag=..."    \
                                       -var="cloudflare_api_token=..."  \
                                       -var="cloudflare_zone_id=..."    \
                                       -var="domain=parking.radio"
```

The EC2 instance gets re-created automatically whenever required.

Note that this is also done automatically on every push to `main` by the `deploy.yml` workflow:
- The image is built, pushed to `ghcr.io/parkingradio/radio` and tagged with the commit's short SHA (and `:latest`).
- The workflow runs `terraform apply` in `deployment/main` with whatever web app version is configured in
  `deployment/main/variables.tf`. Actually updating the web app that is deployed requires manually bumping
  the image version and pushing to `main`.
