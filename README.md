# Parking Radio

Parking Radio an independent non-profit radio whose goal is to promote underground artists and their
music, and to provide a professional grade diffusion platform for their performances.

This web app implements both the user-visible web site for the radio and also provides tools to administer
various aspects of the project, such as uploading sets, helping schedule upcoming diffusion sessions, etc.

## General Technological Choices and Deployment

The web app is implemented in full-stack Javascript talking to a PostgreSQL database. We produce a Docker
image that contains the server itself. In production, we have a Docker Compose stack that layers a Nginx
reverse proxy on top of the server container.

The Postgres database is hosted on Amazon RDS.

Deployment is done via Terraform.

## Site Design

See [docs/design.md](docs/design.md) for the page-by-page design of the site.

## Development

The app is an npm-workspaces monorepo: `client` (Vite + React) and `server` (Fastify, talking to
Postgres via Drizzle).

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
npm test    # runs both workspaces' test suites
npm run build
```

Stop the local database with `npm run db:down` when you're done.

### Docker

The `Dockerfile` builds the production image (client build + server, no dev tooling). It's not used for
day-to-day development, use `npm run dev` instead. To build the production environment, use:

```sh
docker build -t parking-radio .
npm run db:up   # if not already running
docker run --init --rm -p 3000:3000 --network radio_default \
  -e DATABASE_URL="postgres://parking_radio:parking_radio@postgres:5432/parking_radio" \
  -e PORT=3000 \
  parking-radio
npm run db:down # when you're done
```

Then `curl localhost:3000/healthz` should return `{"ok":true}`, and `http://localhost:3000` should serve
the built client.
