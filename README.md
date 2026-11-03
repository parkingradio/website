# Parking Radio

Parking Radio is an independent non-profit radio whose goal is to promote underground artists and their
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

See [docs/design](docs/design/README.md) for the design of the site: the server, area by area, including its API,
and the client, page by page.

## Development

The app is an npm-workspaces monorepo: `client` (Vite + React), `server` (Fastify, talking to Postgres via Drizzle) and
`e2e`, which holds the browser tests, and the seed data they run against (see "Seed data" below). The client's types for
the API are generated from the server's schemas (see "Testing and building" below, and
[docs/design](docs/design/README.md)).

The server's code, in `server/src`, has a folder for each area of the [server's design](docs/design/server/README.md),
plus `site` for serving the client, `/healthz` and `/api/config`. What the areas share is in `core`, `api` and `db`.

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

This starts the Vite dev server at http://localhost:5173 and the Fastify server at http://localhost:3000, unless `.env`
says otherwise (see "Several checkouts" below).

To log in to the admin pages at http://localhost:5173/admin, create an admin once the server has started (it creates the
database's tables when it starts). This prints a link where you choose your password:

```sh
npm run create-admin -w server -- you@example.com
```

Running it again for an existing admin gives a link that resets their password.

### Seed data

With `npm run dev` running, fill the dev database with artists, their photos and their applications, collectives of some
of them, with their applications, and sessions and their sets, of every kind the admin pages have to show (see
`e2e/seed-data.ts`):

```sh
npm run seed
```

It goes through the server's API, as an admin of its own, `seed@example.com`, whom it creates with `create-admin`, and
who is then listed among the admins. You still log in as your own admin. Seeding again only adds the artists and the
collectives that aren't there, by their email, or by their name for those without one, so to seed an artist or a
collective again, delete them first. It only seeds the sessions while there are none, so to seed them again, delete them
all first. It doesn't change any setting, e.g. feature flags.

A few artists and collectives apply through the "Appliquer" form, which needs Cloudflare to be reachable, and the
Turnstile test keys from `.env.example`. It refuses to seed when `MAIL_DOMAIN` is set, since the server would then send
emails.

### Several checkouts

To run several checkouts (e.g. git worktrees) side by side, give each one its own ports in its `.env`:

```sh
SERVER_PORT=3001
CLIENT_PORT=5174
POSTGRES_PORT=5433
DATABASE_URL=postgres://parking_radio:parking_radio@localhost:5433/parking_radio
```

If two checkouts' directories have the same name, also give one of them its own `COMPOSE_PROJECT_NAME`, so that it gets
its own database.

### Trying the MCP server with Claude

With `npm run dev` running, connect Claude Code to the dev server's MCP server (see
[docs/design/server/mcp.md](docs/design/server/mcp.md)):

```sh
claude mcp add --transport http parking-radio "http://localhost:${CLIENT_PORT:-5173}/mcp"
```

Then `/mcp` in Claude Code opens the page where you allow it, once logged in as an admin.

### Testing and building

```sh
npm run build
npm run test                # runs every workspace's test suite
npm run test:integration    # integration tests on the Docker image
npm run test:e2e            # browser tests on the Docker image
```

The API's OpenAPI document (`server/openapi.json`) and the client's types (`client/src/api/schema.d.ts`) are generated and
checked in: `npm run generate:api` regenerates them, and CI checks that they're up to date.

Both `test:integration` and `test:e2e` build the Docker image from the tree, unless `PARKING_RADIO_IMAGE` names one to
use instead, and start it against a throwaway Postgres (see `integration-tests/stack.sh`), so they don't need
`npm run db:up`. The browser tests then seed it, as `npm run seed` does, and run against that data, while the
integration tests start from an empty database, except the one that checks a migration of existing data. Seeding has
some of its artists and collectives apply through the "Appliquer" form, so the browser tests need Cloudflare to be
reachable.

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
  -e PRIVATE_BUCKET_DIRECTORY=/tmp/private-bucket \
  parking-radio
npm run db:down # when you're done
```

Note that `DATABASE_URL` is overridden because `.env.example` points at `localhost` (for running the
server directly on the host), but this container reaches Postgres over the `radio_default` Docker
network instead, where it's addressable as `postgres`. The network is named after the Docker Compose project, i.e.
the checkout's directory or `COMPOSE_PROJECT_NAME` (see "Several checkouts" above), so it's `radio_default` in a
checkout named `radio`. Its port 3000 is published on 3000 too, which a checkout's own server may be using: publish it on
another one, e.g. `-p 3005:3000`, if so. `PRIVATE_BUCKET_DIRECTORY`, the local directory that stands in
for the private S3 bucket, is overridden too: the server runs as a user who can't write to the app's own directory,
where `.env.example` puts it, but can write to `/tmp`.

Then `curl localhost:3000/healthz` should return `{"ok":true}`, and `http://localhost:3000` should serve
the built client.
