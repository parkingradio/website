# Design

These documents are the authoritative reference for what the site does. They're split in two:

- [server/](server/README.md): the server, area by area. Each document says what the server keeps for its area, how
  it behaves, and every endpoint of the area, with what it accepts and returns. Together, they specify the API
  completely, along with everything the server does on its own, e.g. moving along the radio's rotation.
- [client/](client/architecture.md): the site as visitors and admins see it, one document per page. Each one says what
  the page shows and does, and ends with the endpoints it calls. It links to the server documents for what the server
  does, rather than saying it again.

A change that affects both starts with the server documents: what the server accepts, returns and does is decided
there first, and the pages are designed on top of it. The server documents can say what callers have to do to use the
API correctly (e.g. which errors need a new Turnstile token), but not how pages look or behave. The client documents
say what pages do, and link to the server documents for why.

For the areas whose endpoints are the MCP server's tools, the part of their server document before its first endpoint is
also what LLM apps get as the area's rules (see [`read_documentation`](server/mcp.md#read_documentation)), so it has to
be enough to use the tools correctly: what they need goes there, rather than after the endpoints.

The code implements these documents, and has to match them: when they disagree, including with comments in the code,
the documents win. The lists and rules that the server documents name in the server's code (e.g. `GENRES`, or the
`ArtistProfile` schema, in `server/src/artists/profile.ts`) are part of the design by reference.

The API's OpenAPI document, `server/openapi.json`, is generated from the schemas that the server's routes validate their
requests and responses with, and the client's types are generated from it (`npm run generate:api`). Both are checked in,
and CI checks that they're up to date. The document shows the API, i.e. every endpoint under `/api` but the two that
apps call for OAuth, which take forms (see [OAuth](server/oauth.md)), as it's implemented, while these documents are its
design: when they disagree, these documents still win.

## Server

| Document | What it covers |
|---|---|
| [README](server/README.md) | Conventions every endpoint follows, how the server serves the client, `/healthz`, `/api/config`, emails, and the index of every endpoint |
| [Radio](server/radio.md) | The radio's rotation, read from a SoundCloud playlist, and the SoundCloud app it's read through |
| [Artists](server/artists.md) | Artists and their photos |
| [Collectives](server/collectives.md) | Collectives, their members and their photos |
| [Applications](server/applications.md) | Artists' and collectives' applications, applying through the form, and the emails about them |
| [Sessions](server/sessions.md) | Sessions at the studio and their sets: who played, when, and their recordings on SoundCloud and YouTube |
| [Admins](server/admins.md) | Admins, invites and sessions |
| [OAuth](server/oauth.md) | Apps that act as an admin, e.g. Claude: connecting them, and their connections |
| [MCP server](server/mcp.md) | What connected apps can do: the API's endpoints, as tools |
| [Events](server/events.md) | Parking Radio's events, read from Resident Advisor |
| [Features](server/features.md) | Feature flags |

## Client

| Document | What it covers |
|---|---|
| [Architecture](client/architecture.md) | The single-page application, the navigation bar, and what every page shares |
| [Player](client/player.md) | The audio player shared by every page |
| [Home](client/home.md) | The main page |
| [Archives](client/archives.md) | Past sessions, from SoundCloud |
| [Programmation](client/programmation.md) | Parking Radio's events |
| [Synth Meetups](client/synth-meetups.md) | The Synth Meetups |
| [Appliquer](client/appliquer.md) | The form artists apply through |
| [Contribuer](client/contribuer.md) | Donations |
| [Page introuvable](client/not-found.md) | Any URL that isn't one of the site's pages |
| [Admin](client/admin/layout.md) | What every admin page shares: logging in, the menu |
| [Calendrier](client/admin/calendrier.md) | The calendar of bookings |
| [Rotation radio](client/admin/rotation.md) | Choosing the radio's playlist |
| [Candidatures](client/admin/candidatures.md) | Going through applications |
| [Sessions](client/admin/sessions.md) | Sessions at the studio and their sets: who played, when, and their recordings |
| [Artistes](client/admin/artistes.md) | The artists and collectives Parking Radio knows of |
| [Admins](client/admin/admins.md) | Who can access the admin pages, and connecting Claude to them |
| [Autoriser une application](client/admin/autoriser.md) | Allowing an app, e.g. Claude, to act as the admin |
| [Configuration](client/admin/configuration.md) | The settings that change what the site does |

The deployment is described in [deployment.md](../deployment.md).
