# Deployment

The production stack is a single EC2 host running Docker Compose (the app + Nginx), talking to a Postgres
instance on RDS. DNS and TLS termination are handled by Cloudflare; the Nginx origin holds a Cloudflare
Origin CA certificate so traffic between Cloudflare and the origin is encrypted too. Everything is
provisioned with Terraform, split into two modules under `deployment/`:

- `deployment/bootstrap`: creates the S3 bucket that `deployment/main` uses as its remote state backend,
  and the OIDC provider + IAM role the `Deploy` GitHub Actions workflow uses to authenticate to AWS. This
  is used once on a new AWS deployment.
- `deployment/main`: the actual stack configuring networking, RDS, the EC2 instance, and the Cloudflare DNS
  record + Origin CA certificate.

## One-time bootstrap

```sh
export AWS_PROFILE=your-aws-profile
terraform -chdir=deployment/bootstrap init
terraform -chdir=deployment/bootstrap apply
```

This creates the `parking-radio-terraform-state` S3 bucket to contain the Terraform state, and an IAM
role for the deployment pipeline. That role is assumed via a GitHub Actions OIDC provider, which is
account-wide: AWS allows only one per URL per AWS account. By default the bootstrap assumes one already
exists and reuses it, failing the apply if it doesn't. On an AWS account that has never been used with
GitHub Actions, create it as part of the bootstrap instead:

```sh
terraform -chdir=deployment/bootstrap apply -var="manage_github_oidc_provider=true"
```

After applying, four things need to be configured once in the GitHub repository:

- Secret `CLOUDFLARE_API_TOKEN`: An API token for the account under which the domain name is configured.
  The token needs the following capabilities, scoped to the domain name zone: `Zone:DNS:Edit`,
  `Zone:SSL and Certificates:Edit`, `Zone:Email Routing Rules:Edit`, and `Zone:Zone Settings:Edit`.
  It also needs `Account:Email Routing Addresses:Edit`, scoped to the account (this one is an account-level
  permission since mailboxes are an account-level concept in Cloudflare).
- Variables `DOMAIN` and `CLOUDFLARE_ZONE_ID`: The domain name in use and the Cloudflare zone ID of that domain.
  Those are not sensitive.
- Variable `AWS_DEPLOY_ROLE_ARN`: This is output by Terraform when doing the one-time CI bootstrap. This allows
  the CI deployment pipeline to perform operations in the AWS account (e.g. deploy EC2) based on the OIDC trust
  chain established by the one-time bootstrap. This is not sensitive.

## Building and pushing the app image

A workflow builds the image on all PRs and branch pushes, after running tests. On pushes to `main` (exclusively),
the built Docker image is pushed to `ghcr.io/parkingradio/radio` and tagged with the commit's short SHA.

## Deploying the web app

Deploying is done manually by triggering the `deploy.yml` Github workflow. Select the web app image to use and
launch the workflow, which will run `terraform apply` in `deployment/main` with that tag. The EC2 instance gets
re-created automatically whenever required.

Alternatively, deployment can be triggered locally without going through the workflow:

```sh
export AWS_PROFILE=your-aws-profile
terraform -chdir=deployment/main init
terraform -chdir=deployment/main apply -var="app_image_tag=..."         \
                                       -var="cloudflare_api_token=..."  \
                                       -var="cloudflare_zone_id=..."    \
                                       -var="domain=parking.radio"
```

## Static assets

Assets are served from a CloudFront distribution in front of a private S3 bucket, at `assets.<domain>`.
That name is an alias to the underlying `<id>.cloudfront.net` name assigned by AWS. The purpose of the
alias is to avoid hardcoding the CloudFront URL in the app.

The alias needs a certificate, so `terraform apply` provisions an ACM certificate and validates it with a
DNS record in Cloudflare. The apply blocks while ACM waits for that record to propagate — usually a couple
of minutes. Both that validation record and the `assets` CNAME are intentionally *not* proxied through
Cloudflare: ACM has to resolve the former directly, and there's no point putting a proxy in front of a CDN.

## Mail aliases

`deployment/main/mail-aliases.tf` is a table of `name@<domain>` aliases (e.g. `contact`, or a team member's
first name) and the mailbox each one forwards to. To add or remove an alias, edit that table and re-apply
Terraform. Each entry gets:

- A Cloudflare Email Routing rule forwarding `name@<domain>` to its mailbox. The first time a given
  destination mailbox is used, Cloudflare emails it a confirmation link that someone has to click before
  forwarding actually works.
- Its own SMTP credentials (via a dedicated IAM user), restricted so it can only send as that one address,
  stored in the `parking-radio/mail-smtp-credentials` Secrets Manager secret.

Note that running `terraform apply` twice may be required: the first time will fail if the destination
mailbox is not already approved (for Cloudflare) and the `apply` will stop partway. Then, verify the mailbox
and re-run `apply`, which should succeed. Another way to do this without running `apply` twice is to add the
destination mailbox manually in Cloudflare and get the mailbox verified *before* running `apply`.

To let someone send as their alias from their own mail client (e.g. Gmail), get their SMTP username and password
from Secrets Manager and hand it over to them, so they can set it up using e.g. "send-as" in Gmail.
