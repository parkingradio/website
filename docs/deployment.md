# Deployment

The production stack is a single EC2 host running Docker Compose (the app + Nginx), talking to a Postgres
instance on RDS. DNS and TLS termination are handled by Cloudflare; the Nginx origin holds a Cloudflare
Origin CA certificate so traffic between Cloudflare and the origin is encrypted too. Everything is
provisioned with Terraform, split into two modules under `deployment/`:

- `deployment/bootstrap`: creates the S3 bucket that `deployment/main` uses as its remote state backend,
  and the IAM role the `Deploy` GitHub Actions workflow uses to authenticate to AWS. This is used once on
  a new AWS deployment. Its own state is kept in the same S3 bucket, next to `main`'s.
- `deployment/main`: the actual stack configuring networking, RDS, the EC2 instance, and the Cloudflare DNS
  record + Origin CA certificate.

## One-time bootstrap

The bootstrap creates the `parking-radio-terraform-state` S3 bucket to contain the Terraform state, and
an IAM role for the deployment pipeline.

### Account prerequisites

A few things are account-wide singletons which must be created in the account before performing the
bootstrap. They are not managed by Terraform since they are not tied to this project.

```sh
export AWS_PROFILE=your-aws-profile

# The GitHub Actions OIDC provider, which the deployment role is assumed through. AWS allows only one
# per URL per AWS account.
aws iam create-open-id-connect-provider --url https://token.actions.githubusercontent.com \
                                        --client-id-list sts.amazonaws.com

# The AWS managed KMS keys for RDS and Secrets Manager, used by the deployment role. Describing
# their alias creates them.
aws kms describe-key --region us-east-1 --key-id alias/aws/rds
aws kms describe-key --region us-east-1 --key-id alias/aws/secretsmanager
```

On an account that is already used with GitHub Actions for something else, the OIDC provider already
exists, so creating it fails harmlessly and can be skipped. Describing the KMS keys is harmless to repeat.

### Bootstrapping

The `bootstrap` module keeps its state in the S3 bucket that it creates, so the very first apply on a
new AWS account has to start from local state, which is then moved into the bucket:

```sh
export AWS_PROFILE=your-aws-profile

# The state bucket doesn't exist yet, so temporarily override the backend to use local state.
cat > deployment/bootstrap/backend_override.tf <<'EOF'
terraform {
  backend "local" {}
}
EOF
terraform -chdir=deployment/bootstrap init
terraform -chdir=deployment/bootstrap apply

# Once the apply has succeeded and the bucket exists, move the state into it.
rm deployment/bootstrap/backend_override.tf
terraform -chdir=deployment/bootstrap init -migrate-state
```

After migrating, the bootstrap state is stored in S3 alongside the `main` state that will be created
on the first deployment. From then on, `bootstrap` is used like any other module (`init`, then `apply`)
from any machine with credentials for the account.

After applying, the GitHub repository needs to be configured once. We use two GitHub environments
(`test` and `production`) which allows two different deployments to coexist at once. `AWS_DEPLOY_ROLE_ARN`
is the same for every environment and belongs at the repository level:

- Variable `AWS_DEPLOY_ROLE_ARN`: This is output by Terraform when doing the one-time CI bootstrap. This allows
  the CI deployment pipeline to perform operations in the AWS account (e.g. deploy EC2) based on the OIDC trust
  chain established by the one-time bootstrap. This is not sensitive.

Other variables differ per deployment and belong on each deployment's GitHub environment:

- Secret `CLOUDFLARE_API_TOKEN`: An API token for the account under which the domain name is configured.
  The token needs the following capabilities, scoped to the domain name zone: `Zone:DNS:Edit`,
  `Zone:SSL and Certificates:Edit`, `Zone:Email Routing Rules:Edit`, `Zone:Zone Settings:Edit`, and
  `Zone:Single Redirect:Edit`. It also needs `Account:Email Routing Addresses:Edit` and `Account:Turnstile:Edit`,
  scoped to the account (these are account-level concepts in Cloudflare).
- Variables `DOMAIN` and `CLOUDFLARE_ZONE_ID`: The domain name in use and the Cloudflare zone ID of that domain.
  Those are not sensitive.
- Variable `MANAGE_MAIL`: `true` or `false`. Whether Terraform manages mail for the domain. This can only be
  `true` for a domain at the zone apex.

## Building and pushing the app image

A workflow builds the image on all PRs and branch pushes, after running tests. On pushes to `main` (exclusively),
the built Docker image is pushed to `ghcr.io/parkingradio/radio` and tagged with the commit's short SHA.

## Deploying the web app

Deploying is done manually by triggering the `deploy.yml` Github workflow. Select the environment and the
web app image to use, then launch the workflow, which will run `terraform apply` in `deployment/main`
against that environment's state with that tag. The EC2 instance gets re-created automatically whenever
required.

Alternatively, deployment can be triggered locally without going through the workflow. Note the workspace
selection.

```sh
export AWS_PROFILE=your-aws-profile
terraform -chdir=deployment/main init
terraform -chdir=deployment/main workspace select -or-create test
terraform -chdir=deployment/main apply -var="app_image_tag=..."          \
                                       -var="cloudflare_api_token=..."   \
                                       -var="cloudflare_zone_id=..."     \
                                       -var="domain=parking.example.com"
```

## Database migrations

The server migrates the database when it starts, before it serves anything: it applies the migrations of
`server/drizzle` that the database doesn't have yet, all of them in a single transaction. If one fails, none of them is
applied, and the server exits, with the error in its log. Docker then restarts it (`restart: unless-stopped`), so it
keeps trying and failing, which is harmless since every attempt is rolled back, and the deploy's wait for `/healthz`
fails. The server's log is on the instance, which is only reachable through SSM, the way `tools/create-admin` reaches
it:

```sh
export AWS_PROFILE=your-aws-profile
instance=$(aws ec2 describe-instances --output text --query 'Reservations[].Instances[].InstanceId' \
             --filters Name=tag:Name,Values=parking-radio-production Name=instance-state-name,Values=running)
command=$(aws ssm send-command --output text --query Command.CommandId --instance-ids "$instance" \
            --document-name AWS-RunShellScript \
            --parameters '{"commands":["cd /opt/app && docker compose logs --tail 50 app"]}')
aws ssm wait command-executed --command-id "$command" --instance-id "$instance"
aws ssm get-command-invocation --output text --query StandardOutputContent \
                               --command-id "$command" --instance-id "$instance"
```

Since nothing was applied, deploying the previous image again brings the site back, and the cause can be fixed from
there before deploying again.

Once a migration has succeeded, though, an older image may not work with the database anymore: its server finds no
migration to apply, but its queries can need what the migration removed. For instance, after `0007_legacy_collectives`,
which turns the artists whose `kind` was `collective` into collectives and removes `kind` and `members`, every query an
older server makes on artists fails. A problem found after such a migration is fixed forward, with a new image. Before
deploying a migration like this one, which removes something older images need, take a manual snapshot of the database,
and wait for it to be ready:

```sh
aws rds create-db-snapshot --db-instance-identifier parking-radio-production \
                           --db-snapshot-identifier parking-radio-production-before-<what>
aws rds wait db-snapshot-available --db-snapshot-identifier parking-radio-production-before-<what>
```

Restoring that snapshot, or restoring the database to a point in time within the 7 days of automated backups, is a last
resort rather than a way to roll back: either one creates a new database instance, outside Terraform, which then has to
be swapped in by hand.

## Creating admins

A new deployment has no admins. Once it's deployed, create the first one with `tools/create-admin`, which prints a link
where they choose their password:

```sh
export AWS_PROFILE=your-aws-profile
tools/create-admin you@example.com --environment test
```

That admin can then invite the others from the admin pages. The link lasts 24 hours and can be used once, and nothing is
emailed, so this works before email is set up. This can also be used to regain admin access after being locked out (e.g.
forgetting your password).

## Tearing down a deployment

The `teardown.yml` workflow destroys everything Terraform manages in an environment. Note that this includes
the assets buckets, the database, the DNS entries, etc. In practice this is for cleaning up the `test` environment
after a round of testing. Note that this can take a while since the CloudFront distribution has to be deleted and
Terraform will wait for that to propagate.

The workflow doesn't allow tearing down the `production` environment, since that should not be done regularly,
should be done by hand and by someone who knows exactly what they are doing. Tearing down production requires
manually turning off the database's deletion protection, emptying the assets and private buckets and running
`terraform destroy`.

## Static assets

Assets are served from a CloudFront distribution in front of a private S3 bucket, at `assets.<domain>`.
That name is an alias to the underlying `<id>.cloudfront.net` name assigned by AWS. The purpose of the
alias is to avoid hardcoding the CloudFront URL in the app.

The alias needs a certificate, so `terraform apply` provisions an ACM certificate and validates it with a
DNS record in Cloudflare. The apply blocks while ACM waits for that record to propagate — usually a couple
of minutes. Both that validation record and the `assets` CNAME are intentionally *not* proxied through
Cloudflare: ACM has to resolve the former directly, and there's no point putting a proxy in front of a CDN.

Note that the S3 bucket containing assets is versionned, so older versions can be retrieved if needed.

## The legacy radio's R2 bucket

The home page's legacy radio player (see [Home](design/client/home.md)) plays tracks from a Cloudflare R2 bucket
that neither Terraform nor this repository manages (`pub-ac6abcc67fed4f8f8072bac54bb99274.r2.dev`), along with its
rotation, `playlist.json` and `durations.json`. Browsers read those two from the site, so the bucket's CORS policy has to
let every deployment's origin, and local development's, `GET` them: it allows any origin. The tracks themselves don't
need it. This goes away along with the legacy radio player.

## Private files

Each deployment gets a private S3 bucket for the files only the app reads and writes, as opposed to the public
assets. The bucket is versioned and keeps the previous versions of files for as long as the database's backups
are kept.

## Mail aliases

Terraform only manages mail when `manage_mail` is `true`. It defaults to `false`, so nothing in this
section applies unless you turn it on. The rest of this section assumes Terraform is managing the mail
setup.

Note that only an environment deployed at the zone apex can manage mail. Cloudflare Email Routing is
enabled for the whole zone, so letting a subdomain environment manage it would mean that tearing that
environment down disables mail for every domain in the zone.

`deployment/main/mail-aliases.tf` is a table of `name@<domain>` aliases (e.g. `contact`, or a team member's
first name) and the mailbox each one forwards to. To add or remove an alias, edit that table and re-apply
Terraform. Each entry gets:

- A Cloudflare Email Routing rule forwarding `name@<domain>` to its mailbox. The first time a given
  destination mailbox is used, Cloudflare emails it a confirmation link that someone has to click before
  forwarding actually works.
- Its own SMTP credentials (via a dedicated IAM user), restricted so it can only send as that one address,
  stored in Secrets Manager.

Note that running `terraform apply` twice may be required: the first time will fail if the destination
mailbox is not already approved (for Cloudflare) and the `apply` will stop partway. Then, verify the mailbox
and re-run `apply`, which should succeed. Another way to do this without running `apply` twice is to add the
destination mailbox manually in Cloudflare and get the mailbox verified *before* running `apply`.

To let someone send as their alias from their own mail client (e.g. Gmail), get their SMTP username and password
from Secrets Manager and hand it over to them, so they can set it up using e.g. "send-as" in Gmail.
