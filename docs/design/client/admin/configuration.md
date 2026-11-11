# Configuration

At `/admin/configuration`: the settings that change what the site does. From top to bottom, it shows:

- "Envoi des candidatures par e-mail": who the applications artists send are emailed to.
- "Connexion SoundCloud": the credentials of the SoundCloud app the server reads SoundCloud through.
- "Connexion YouTube": the YouTube channel the server reads the site's video from, and the key it reads it with.
- "Publier sur RA": the bookmarklet that creates sessions' events on Resident Advisor.
- "Features": the feature flags.

`/admin/features`, where the feature flags used to be, leads here.

## Envoi des candidatures par e-mail

Chooses who the applications artists send are emailed to (see [Emails](../../server/applications.md#emails)): email
addresses, each typed then added with + (or Enter) and removed with its ×, like a collective's new artists (see
[Artistes](artistes.md#adding-a-collective)). It says how many there can be (see
[`PUT /api/admin/applications/recipients`](../../server/applications.md#put-apiadminapplicationsrecipients-admin)).
Each change is saved right away. It also says which admin last changed them, and when. While there are none, it says
that applications aren't emailed to anyone, but are still listed in [Candidatures](candidatures.md).

## Connexion SoundCloud

The credentials of the SoundCloud app the server reads SoundCloud through: the radio's playlist, and the tracks of
[sets](sessions.md) (see [The SoundCloud app](../../server/radio.md#the-soundcloud-app)). It says that they're found in the
apps of the SoundCloud account it belongs to, linking to them (`https://soundcloud.com/you/apps`). It shows which admin
last changed the credentials, and when, or, until they're entered, that the radio is off air, and that sets' SoundCloud
links can't be checked. When the radio's last read of its playlist failed, it says why: « La dernière lecture de la
playlist de la radio a échoué », then the error.

Under that, a form replaces the credentials: the client ID, filled in with the current one, and the secret. The secret
is never sent back once it's entered, so its field only shows dots in its place, and it has to be typed to replace
the credentials. "vérifier" asks SoundCloud whether it accepts the credentials typed, without saving them, and
"enregistrer" saves them, which it only allows once the credentials typed have been verified. Each one shows a green
check mark next to it once it went through, until the credentials are changed again.

## Connexion YouTube

The YouTube channel the server reads the site's video from, and the API key it reads it with (see
[The YouTube credentials](../../server/video.md#the-youtube-credentials)). It says that the channel's id is found in the
advanced settings of its YouTube account, linking to them (`https://www.youtube.com/account_advanced`), and the key in
the credentials of a Google Cloud project, linking to them (`https://console.cloud.google.com/apis/credentials`),
restricted to the YouTube Data API v3. It shows which admin last changed them, and when, or, until they're entered, that
the home page shows no video. When the last read of YouTube failed, it says why.

Under that, a form replaces them, like the SoundCloud app's credentials: the channel's id, filled in with the current
one, and the key, whose field only shows dots in its place, since it's never sent back, and has to be typed. "vérifier"
asks YouTube whether it accepts the key and finds the channel, without saving them, and "enregistrer" saves them, which
it only allows once they've been verified, each with a check mark like the SoundCloud app's.

## Publier sur RA

The bookmarklet that creates a session's event on Resident Advisor from its page (see
[Publier sur RA](publier-sur-ra.md)). It's a link, « Parking Radio → RA », followed outside production by the
environment's stamp, e.g. « Parking Radio → RA [TEST] », so that admins tell their bookmarks apart (see
[Environment](../architecture.md#environment)), to drag into the browser's bookmarks, whose code loads the bookmarklet's
script from the site it's on (see [The bookmarklet](publier-sur-ra.md#the-bookmarklet)), and clicking it on this page
does nothing. The section says how to use it: under a session's « Événement RA », click « créer », then « Publier sur
RA », log in to RA if needed, then click the bookmark, which shows the event before creating it. It also says that the
bookmark loads its code from the site each time, so that it never needs to be installed again.

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
- `GET /api/admin/video/credentials`, `POST /api/admin/video/credentials/check` and
  `PUT /api/admin/video/credentials`, for "Connexion YouTube".
- `GET /api/admin/features` and `PUT /api/admin/features/:id`, for "Features".
