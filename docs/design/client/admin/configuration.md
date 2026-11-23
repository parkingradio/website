# Configuration

At `/admin/configuration`: the settings that change what the site does. From top to bottom, it shows:

- "Envoi des candidatures par e-mail": who the applications artists send are emailed to.
- "Connexion SoundCloud": the credentials of the SoundCloud app the server reads SoundCloud through.
- "Connexion YouTube": the YouTube channel the server reads the site's video from, and the key it reads it with.
- "Calendriers externes": the calendars that the studio's occupations are read from.
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
links can't be checked. When the radio's last read of its playlist failed, it says why.

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

## Calendriers externes

The calendar feeds that the studio's occupations are read from (see [Calendar](../../server/calendar.md)). It says that
what takes the studio outside sessions is read from these calendars, in iCal, each occupation known by its calendar's
name, e.g. from the team's Google Calendar, whose link is its "adresse secrète au format iCal", in its settings. It says
that the server reads them every 15 minutes, that their links are secret, since anyone who has one can read its
calendar, and are never given to connected apps, and what private titles ("titres privés") are: the server never keeps
the titles of the calendar's events, e.g. for a calendar of guests' stays, which can have their names, so that its
occupations are only known by its name.

It lists the feeds, in the order they were added, each with its name, "titres privés" when its titles are private, its
link, as text rather than as a link, which admin added it, and when, and when it was last read, or that it hasn't been
read yet, and, when its last read failed, why. Each one is removed with "retirer", once the admin confirms, and changed
with "modifier". While there are none, it says so.

"modifier" replaces the feed's details with a form, filled in with them: its name ("Nom"), which gets the focus, its
link ("Lien") and a checkbox, "Titres privés". "enregistrer" saves what was changed, and only that, so that a form
opened before another admin changed the feed doesn't undo their changes, once the name and the link are filled in: when
the link changed, the server reads it first, which takes as long as when a feed is added (see below), during which
"enregistrer" can't be used again. Once it's saved, or when nothing was changed, the form closes, and the feed shows its
details as they are then. "annuler" closes the form without saving. Once the form closes, the focus goes back to the
feed's "modifier". When it can't be saved, the form says why, e.g. that another feed has that link, naming it.

Under the list, a form adds a feed: its name ("Nom"), its link ("Lien") and "Titres privés", which is checked to start
with. "ajouter" adds it, once the name and the link are filled in: the server reads the link first, which can take up
to 30 seconds, plus up to 10 seconds for each other calendar the server goes through first (see
[Reading the feeds](../../server/calendar.md#reading-the-feeds)), during which "ajouter" can't be used again. Once it's
added, the form is cleared, and the list shows it. When it can't be added, the form says why, e.g. that another feed has
that link, naming it.

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
- `GET /api/admin/calendar/feeds`, `POST /api/admin/calendar/feeds`, `PATCH /api/admin/calendar/feeds/:id` and
  `DELETE /api/admin/calendar/feeds/:id`, for "Calendriers externes".
- `GET /api/admin/features` and `PUT /api/admin/features/:id`, for "Features".
