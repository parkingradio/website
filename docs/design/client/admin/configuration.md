# Configuration

At `/admin/configuration`: the settings that change what the site does. From top to bottom, it shows:

- "Envoi des candidatures par e-mail": who the applications artists send are emailed to.
- "Connexion SoundCloud": the credentials of the SoundCloud app the radio reads its playlist through.
- "Features": the feature flags.

`/admin/features`, where the feature flags used to be, leads here.

## Envoi des candidatures par e-mail

Chooses who the applications artists send are emailed to (see [Emails](../../server/applications.md#emails)): email
addresses, each typed then added with + (or Enter) and removed with its ×, like a collective's artists (see
[Artistes](artistes.md#adding-an-artist)). Each change is saved right away. It also says which admin last changed them,
and when.

## Connexion SoundCloud

The credentials of the SoundCloud app the radio reads its playlist through (see
[The SoundCloud app](../../server/radio.md#the-soundcloud-app)). It says that they're found in the apps of the
SoundCloud account it belongs to, linking to them (`https://soundcloud.com/you/apps`). It shows which admin last changed
the credentials, and when, or that the radio is off air until they're entered.

Under that, a form replaces the credentials: the client ID, filled in with the current one, and the secret. The secret
is never sent back once it's entered, so its field only shows dots in its place, and it has to be typed to replace
the credentials. "vérifier" asks SoundCloud whether it accepts the credentials typed, without saving them, and
"enregistrer" saves them, which it only allows once the credentials typed have been verified. Each one shows a green
check mark next to it once it went through, until the credentials are changed again.

## Features

The feature flags (see [Features](../../server/features.md)). It lists every flag, each with a switch, its name, what it
does, and which admin last switched it, and when. Each switch is saved right away (see
[Feature flags](../architecture.md#feature-flags) for when visitors get the change). While there are no flags, it says
so. The flags' names and what they do are in `FEATURE_LABELS`, in `client/src/pages/admin/describe.ts`, from which a
retired flag is removed too.

## Endpoints

- `GET /api/admin/applications/recipients` and `PUT /api/admin/applications/recipients`, for "Envoi des candidatures
  par e-mail".
- `GET /api/admin/radio/credentials`, `POST /api/admin/radio/credentials/check` and
  `PUT /api/admin/radio/credentials`, for "Connexion SoundCloud".
- `GET /api/admin/features` and `PUT /api/admin/features/:id`, for "Features".
