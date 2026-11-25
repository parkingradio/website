# Configuration

At `/admin/configuration`: the settings that change what the site does. From top to bottom, it shows:

- "Envoi des candidatures par e-mail": who the applications artists send are emailed to.
- "Connexion SoundCloud": the credentials of the SoundCloud app the server reads SoundCloud through.
- "Connexion YouTube": the YouTube channel the server reads the site's video from, and the key it reads it with.
- "Chat": the chat, with "Connexion Discord": the Discord bot the server reaches it through, and its channel.
- "Calendriers externes": the calendars that the studio's occupations, and the time protected for sessions, are read
  from.
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

## Chat

The chat, in parts, each under its own subheading. For now, there's only one: "Connexion Discord".

### Connexion Discord

The Discord bot the server reaches the chat through, and the channel it reaches (see
[The Discord credentials](../../server/chat.md#the-discord-credentials)). It says that they're only checked and kept for
now, and that the home page shows the chat through WidgetBot. It says that the bot's token is on its application's "Bot"
page on Discord's developer portal, linking to it (`https://discord.com/developers/applications`), and that the channel's
id is the second number in the channel's address, `https://discord.com/channels/<server id>/<channel id>`. It shows the
bot's and the channel's names, e.g. "Bot « parking.chat » → #chat", which admin last changed them, and when, or, until
they're entered, that there are none.

Under that, a form replaces them, like the YouTube credentials, with the same buttons and check marks: "ID du salon
Discord", filled in with the current one, and "Token du bot Discord", whose field only shows dots in its place, since
it's never sent back.
"vérifier" asks Discord whether they pass the check (see
[The Discord credentials](../../server/chat.md#the-discord-credentials)), without saving them.

## Calendriers externes

The calendar feeds that the studio's occupations and holds are read from (see [Calendar](../../server/calendar.md)). It
says that what takes the studio outside sessions is read from some of these calendars, « Occupations », each occupation
under its calendar's name, and the time protected for sessions from others, « Plages protégées », and that the server
reads them every 15 minutes.

It lists the feeds in a table, one per row, in the order they were added: "Nom", "Type" (« Occupations » or
« Plages protégées »), "Dernière lecture", then "modifier" and "retirer". "Dernière lecture" is « échec », in the
warnings' color (see [Warnings](layout.md#warnings)), when the feed's last read failed, and otherwise when it was last
read successfully, or « pas encore lu » while it hasn't been read. A feed whose last read failed has a line under its
row, in the warnings' color too, which says why: « La dernière lecture a échoué : <why>. », then when it was last read
successfully, if it was: « Dernière lecture réussie le <date et heure>. ». The line is across the whole table, so that a
long message doesn't widen a column. While there are no feeds, it says so rather than showing an empty table. On
narrow screens like phones, it scrolls sideways like the admin pages' other tables (see [Tables](layout.md#tables)).

"retirer" removes a feed, once the admin confirms. When it can't be removed, the line under its row says why.

"modifier" replaces the feed's row with a row across the whole table, holding a form filled in with it: "Nom", which
gets the focus, "Type", « Occupations » or « Plages protégées », one of which is picked, as radio buttons, and "Lien",
its link. Above the fields, it says which admin added the feed and when, « Ajouté par <email> le <date et heure>. », and
which admin last changed it and when, if one did, « Modifié par <email> le <date et heure>. ». The line under the feed's
row, if it has one, stays under the form. "enregistrer" saves only what was changed, so that a form opened before
another admin's change doesn't undo it, and closes the form; "annuler" closes it without saving. Either way, the focus
goes back to "modifier".

Under the table, a form adds a feed, with the same fields, where no type is picked at first, so that it's always chosen
(see [`POST /api/admin/calendar/feeds`](../../server/calendar.md#post-apiadmincalendarfeeds-admin)). "ajouter" adds it,
and clears the form.

"enregistrer" and "ajouter" need a name, a type and a link. When the link is new, the server reads it first (see
[Reading the feeds](../../server/calendar.md#reading-the-feeds)), which can take a while, and the button can't be used
meanwhile. Changing only the name or the type doesn't read it. When the feed can't be saved, the form says why, e.g.
that another feed has that link, naming it.

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
- `GET /api/admin/chat/discord`, `POST /api/admin/chat/discord/check` and `PUT /api/admin/chat/discord`, for "Chat".
- `GET /api/admin/calendar/feeds`, `POST /api/admin/calendar/feeds`, `PATCH /api/admin/calendar/feeds/:id` and
  `DELETE /api/admin/calendar/feeds/:id`, for "Calendriers externes".
- `GET /api/admin/features` and `PUT /api/admin/features/:id`, for "Features".
