# Parking Radio

Parking Radio an independent non-profit radio whose goal is to promote underground artists and their
music, and to provide a professional grade diffusion platform for their performances.

This web app implements both the user-visible web site for the radio and also provides tools to administer
various aspects of the project, such as managing bookings, helping schedule upcoming diffusion sessions, etc.

## General Technological Choices and Deployment

The web app is implemented in full-stack Javascript talking to a PostgreSQL database. We produce a Docker
image that contains the server itself. In production, we have a Docker Compose stack that layers a Nginx
reverse proxy on top of the server container.

The Postgres database is hosted on Amazon RDS.

Deployment is done via Terraform. See [docs/deployment.md](docs/deployment.md) for how to bootstrap,
apply, and deploy new versions.

## Site Design

See [docs/design.md](docs/design.md) for the page-by-page design of the site.

## Development

The app is an npm-workspaces monorepo: `client` (Vite + React), `server` (Fastify, talking to
Postgres via Drizzle) and `shared`, which holds the types of the API's requests and responses
shared by both sides.

### Prerequisites

- Node.js, matching the version in `.nvmrc` (use `nvm use` if you have nvm installed)
- Docker, for running Postgres locally

### Setup

```sh
npm install
cp .env.example .env
npm run db:up      # starts a local Postgres container
```

### Running

```sh
npm run dev
```

This starts the Vite dev server at http://localhost:5173 and the Fastify server at http://localhost:3000.

### Testing and building

```sh
npm run build
npm run test                # runs client and server test suites
npm run test:integration    # integration tests on the Docker image
```

Stop the local database with `npm run db:down` when you're done.

### Assets

Static image assets (e.g. Synth Meetups poster images) are hosted in an S3 bucket provisioned by
`deployment/main/assets.tf` and served through CloudFront at `assets.<domain>` rather than from the app
itself. Manage them with:

```sh
tools/manage-assets list --environment <name>             # print every asset's public URL
tools/manage-assets add <file> [key] --environment <name> # upload a file and print its public URL
tools/manage-assets download <key> [--out <path>] --environment <name> # download an asset
tools/manage-assets remove <key> --environment <name>     # delete an asset (key as printed by list/add)
```

`--environment` names the deployment to act on, i.e. the Terraform workspace (e.g. `test`, `production`).

This requires the AWS CLI to be configured with credentials that can list/read/write the bucket and read
CloudFront distributions. This is a temporary solution until we have a proper CMS set up.

The client doesn't hardcode the asset domain: it builds URLs from a key using the domain injected in the
server's configuration by the deployment process. Adding an asset to a page only takes the key printed by
`manage-assets`, not a full URL. Set `ASSETS_DOMAIN` in your `.env` for `npm run dev` to resolve assets too.

### Docker

The `Dockerfile` builds the production image (client build + server, no dev tooling). It's not used for
day-to-day development, use `npm run dev` instead. To build the production environment, use:

```sh
docker build -t parking-radio .
npm run db:up   # if not already running
docker run --init --rm -p 3000:3000 --network radio_default \
  --env-file .env.example \
  -e DATABASE_URL="postgres://parking_radio:parking_radio@postgres:5432/parking_radio" \
  parking-radio
npm run db:down # when you're done
```

Note that `DATABASE_URL` is overridden because `.env.example` points at `localhost` (for running the
server directly on the host), but this container reaches Postgres over the `radio_default` Docker
network instead, where it's addressable as `postgres`.

Then `curl localhost:3000/healthz` should return `{"ok":true}`, and `http://localhost:3000` should serve
the built client.
