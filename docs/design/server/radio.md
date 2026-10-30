# Radio

The radio plays a rotation: the tracks of a SoundCloud playlist chosen on the admin pages, in order.

## The rotation

The server reads the playlist through a SoundCloud app, whose credentials are entered on the admin pages (see
[The SoundCloud app](#the-soundcloud-app)): until they are, it can't read any playlist, so the radio is off air. The
server reads the playlist again every 5 minutes, so that changes made to it on SoundCloud get on the radio. If
SoundCloud can't be reached, or none of the playlist's tracks can be played in full anymore, the radio goes on with what
it read before.

The playlist can be private, and so can a private playlist's tracks: they play like the others, and their private
links aren't handed out to listeners. A private playlist can only be read through its private link, which ends with its
secret.

Tracks that SoundCloud doesn't let be played in full are left out of the rotation: those of which only a 30 second
preview can be played, those that can't be played at all, and those that can't be streamed. So are tracks that
SoundCloud describes unexpectedly.

The radio isn't a live stream, but the server decides what's on air: it keeps the track on air and when it started in
the database, and moves along the rotation as tracks end, so that every listener hears the same track at the same
point. Adding sets to the playlist, or moving them, only affects the tracks after the one on air.

Choosing another playlist changes what's on air right away: the new playlist starts from its first track. Choosing the
playlist that's already on air doesn't take it back to its first track: it's only read again right away. Listeners who
are playing a track when another playlist is chosen aren't cut off, though: they finish it, then play what's on air by
then. The same goes for a track that's removed from the playlist. To make this possible, the server still hands out
streams for tracks that left the rotation for as long as they last, unless the server restarts in the meantime.

Each track's artist, event and date are read from its title on SoundCloud,
`ARTIST | [EVENT @ ]parking.radio | YYYY.MM.DD`, where the date is a day that exists. A title that doesn't follow that
pattern is used whole as the artist, with no event or date.

## The SoundCloud app

The server reads playlists through a SoundCloud app, whose credentials (a client ID and a secret) are found in the apps
of the SoundCloud account it belongs to. They're kept in the database rather than set when the site is deployed, so
that they can be changed without deploying it again. Its secret is never sent back once it's entered: it can only be
replaced.

The server checks credentials with SoundCloud before it saves them, so that a typo can't take the radio off air, and
the radio reads its playlist through them right away.

## Tracks

A track has:

| Field | Type | |
|---|---|---|
| `id` | string | |
| `artist` | string | Read from the track's title (see [The rotation](#the-rotation)) |
| `event` | string or null | The event the set was played at, e.g. `"HAUTE RIVE TAKEOVER"` |
| `date` | string or null | The day the set was recorded |
| `durationMs` | number | In milliseconds |

## `GET /api/radio[?upcoming=N]`

| Response field | Type | |
|---|---|---|
| `current` | object | The track on air: `track`, a track, and `startedAt`, when it went on air. It's played from the current time minus `startedAt`, and on air until `startedAt` plus its `durationMs`: ask again then for what's on air next |
| `upcoming` | list of tracks | The next N tracks of the rotation, all of them by default. They can still change |

Fails with 400 (`upcoming` isn't a whole number), 502 (the database can't be reached, or no rotation has been read
from the playlist yet, e.g. because SoundCloud can't be reached, the credentials of the SoundCloud app haven't been
entered yet, or none of its tracks can be played in full) or 503 (no playlist has been chosen yet).

Since another playlist can be chosen at any time, a client playing a track has to stick with it until it ends, rather
than switch to whatever `current` says when it asks for other reasons, e.g. to refresh `upcoming`.

## `GET /api/radio/tracks/:id/stream`

| Response field | Type | |
|---|---|---|
| `url` | string | An HLS playlist on SoundCloud's CDN, which needs no credentials |
| `expiresAt` | string | When `url` stops working: the playlist has to be loaded by then. The audio it lists stays available for a while longer (about 2 hours), enough to play the track through |

Only for tracks of the rotation, or tracks that just left it, for as long as they last. Fails with 404 (not a track of
the rotation) or 502 (the rotation or the stream can't be read right now, e.g. SoundCloud or the database can't be
reached).

## `GET /api/admin/radio` (admin)

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `credentialsEntered` | boolean | Whether the credentials of the SoundCloud app have been entered. Until they are, no playlist can be read |
| `current` | object or null | The chosen playlist (below), or null until one has been chosen |

The chosen playlist has:

| Field | Type | |
|---|---|---|
| `url`, `title` | string | The playlist's link and title, as they were when it was chosen |
| `chosenBy` | string | The email of the admin who chose it |
| `chosenAt` | string | When |
| `playlist` | playlist or null | What the radio reads from it, or null when it couldn't be read yet, or the credentials haven't been entered |
| `error` | string or null | Why it couldn't be read the last time it was tried, if it couldn't. The radio then goes on with what it read before, in `playlist`, if anything |

A playlist has:

| Field | Type | |
|---|---|---|
| `url` | string | Its page on SoundCloud: for a private playlist, its private link |
| `title` | string | |
| `private` | boolean | |
| `account` | object | The SoundCloud account it belongs to: its `name` and the `url` of its page |
| `tracks` | list of objects | Every track of the playlist that SoundCloud shows, in the playlist's order, each with a `kind` (below). The rotation is those that are on the radio, in that order |

Each of a playlist's tracks is one of:

- `kind: "rotation"`: on the radio, with its `track`.
- `kind: "left-out"`: left out of the rotation because SoundCloud doesn't let it be played in full, with its `track`
  and the `reason`: `"preview"` (only a preview can be played), `"blocked"` or `"not-streamable"`.
- `kind: "unexpected"`: left out because SoundCloud describes it unexpectedly, with only its `title`.

## `POST /api/admin/radio/preview` (admin)

| Request field | Type | |
|---|---|---|
| `link` | string | A link to a SoundCloud playlist (see `playlistLink` in `server/src/radio/routes.ts`), e.g. `https://soundcloud.com/parkingdotradio/sets/rotation`, or a private one's private link. Parameters, e.g. `?si=...`, are allowed |

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `playlist` | playlist | What the radio would read from it |

Reads the playlist without choosing it. Fails with 400 (not a link to a playlist), 404 (SoundCloud shows no playlist
there), 409 (the credentials of the SoundCloud app haven't been entered yet) or 502 (SoundCloud can't be reached).

## `POST /api/admin/radio/playlist` (admin)

| Request field | Type | |
|---|---|---|
| `link` | string | Like for the preview |

Reads the rotation from the playlist at `link` from now on, and responds `{"ok": true}`: its first track goes on air
right away, unless it's the playlist already on air, which goes on where it is (see [The rotation](#the-rotation)).
Fails like the preview, and with 400 when none of the playlist's tracks can be played in full.

## `GET /api/admin/radio/credentials` (admin)

The SoundCloud app the radio reads playlists through.

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `credentials` | object or null | The app's `clientId`, and who last changed the credentials (`updatedBy`, an admin's email) and when (`updatedAt`). Null until they're entered: until then, the radio is off air |

## `PUT /api/admin/radio/credentials` (admin)

| Request field | Type | |
|---|---|---|
| `clientId` | string | The app's client ID, up to 200 characters. Trimmed |
| `clientSecret` | string | The app's client secret, up to 200 characters. Trimmed |

Asks SoundCloud for a token with the credentials, and only if it gives one, saves them and responds like
`GET /api/admin/radio/credentials`. The radio reads its playlist through them right away. Fails with 400 (either one
is blank or too long, or SoundCloud refuses them) or 502 (SoundCloud can't be reached).

## `POST /api/admin/radio/credentials/check` (admin)

Takes the same request as `PUT /api/admin/radio/credentials`, and asks SoundCloud for a token with the credentials the
same way, but doesn't save them: it responds `{"ok": true}` when SoundCloud accepts them, and fails like `PUT`
otherwise. This lets credentials be verified before they're saved.
