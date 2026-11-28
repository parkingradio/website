# Radio

The radio plays a rotation. For now, there are two: the **rotation of sets**, which admins choose and order among the
sets of announced sessions, and the **playlist**, the tracks of a SoundCloud playlist chosen on the admin pages, which
is what the radio plays until the site switches to the rotation of sets. Nothing public uses the rotation of sets yet.

## The rotation of sets

The rotation of sets is a list of [sets](sessions.md#sets), in the order admins give them, each one at most once. The
radio goes through it in order, and around, playing each set's track on SoundCloud, so that what's on air is always a
set, with who played it, its session, and its video on YouTube.

### Which sets

A set can be added to the rotation when:

- it isn't cancelled,
- it has both a `soundcloudTrack` and a `youtubeVideo`,
- and its session is announced, so that the rotation never makes anyone public on its own (see
  [What's public, in Events](events.md#whats-public)).

Once in the rotation, a set stays in its place whatever happens to it, but it's **skipped** while it doesn't meet these
conditions, or while its track can't be played in full. The rotation says why, as a list of reasons:

| Reason | |
|---|---|
| `cancelled` | The set is cancelled |
| `no-soundcloud-track` | It has no track on SoundCloud |
| `no-youtube-video` | It has no video on YouTube |
| `not-announced` | Its session isn't announced |
| `unread` | Its track hasn't been read from SoundCloud yet, since it was added or its link changed (see [Reading the tracks](#reading-the-tracks)) |
| `missing` | SoundCloud shows no track at the set's link anymore, e.g. because it was deleted, made private, or its private link was reset |
| `unexpected` | SoundCloud describes the track unexpectedly |
| `preview` | Only a 30 second preview of the track can be played |
| `blocked` | The track can't be played at all |
| `not-streamable` | The track can't be streamed |

The last six are about the set's track, so only a set that has one can have them. Deleting a set, or its session,
takes it out of the rotation.

### On air

The server decides what's on air: it keeps the set on air and when it started, and moves along the rotation as sets
end, so that every listener hears the same set at the same point. A set lasts as long as its track on SoundCloud, to the
millisecond, rather than its `durationMinutes`. Skipped sets are passed over: the set after another one is the next one
that isn't skipped, around the rotation. When every set is skipped, or the rotation is empty, the radio is off air.

It's a radio, so changing the rotation changes what's on air right away. The set on air stays on air, where it is in
it, as long as it's still in the rotation, wherever it was moved, and isn't skipped. Taking it out, or it being skipped,
puts on air, from then on, the first set after it, in the rotation as it was until then, that's still in it and isn't
skipped, or, when there's none, the first set of the rotation that isn't skipped.

What happens to sets elsewhere, e.g. a set being cancelled or deleted, its session being un-announced, or its track
being read again, is taken into account the next time anyone asks what's on air. When the set on air is then skipped,
out of the rotation, or has another track than the one it went on air with, the first set after its place in the
rotation, in the rotation's order and around it, that isn't skipped goes on air from then on. The radio comes back on
air the same way, after the place of the set that was on air last, or, when no set has ever been on air, with the first
set of the rotation that isn't skipped.

Every set of the rotation that isn't skipped can be streamed, not only the one on air, since a listener's clock can be a
little ahead of the server's when a set ends.

### Reading the tracks

The server reads each set's track through the SoundCloud app (see [The SoundCloud app](#the-soundcloud-app)), from the
set's link: its length, and whether it can be played in full. It keeps what it read, so that the radio goes on as it
was when the server restarts, or while SoundCloud can't be reached. It reads:

- every minute, the tracks of the rotation that haven't been read through the link their set has, e.g. those of the sets
  that were just added, or whose link changed, and those whose last read failed a minute ago or more,
- every hour, every track of the rotation, since a track can be deleted, made private, or blocked on SoundCloud,
- and when the rotation is changed, right away, those that are due to be read as above, so that the sets added to it
  are read then, unless they were read within the hour.

When a read fails, e.g. because SoundCloud can't be reached, the radio goes on with what was read before, and admins see
why it failed. Until the credentials of the SoundCloud app are entered, no track can be read, so the sets that haven't
been read stay `unread`.

Private tracks play like the others: they're read and streamed through their private link, which ends with its secret,
and which is never handed out (see [What's public, in Events](events.md#whats-public)).

## The playlist

What the radio plays for now: the tracks of a SoundCloud playlist chosen on the admin pages, in order, which this
section, and the endpoints of the playlist, call the rotation.

The server reads the playlist through a SoundCloud app, whose credentials are entered on the admin pages (see
[The SoundCloud app](#the-soundcloud-app)): until they are, it can't read any playlist, so the radio is off air. The
server reads the playlist again every 5 minutes, so that changes made to it on SoundCloud get on the radio. If
SoundCloud can't be reached, or none of the playlist's tracks can be played in full anymore, the radio goes on with what
it read before, and the server tries again a minute later.

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

The server reads playlists, and the tracks of the rotation's sets, gets the streams of their tracks, and resolves the
links to the tracks of [sets](sessions.md#links), through a SoundCloud app, whose credentials (a client ID and a secret)
are found in the apps of the SoundCloud account it belongs to. They're kept in the database rather than set when the
site is deployed, so that they can be changed without deploying it again. Its secret is never sent back once it's
entered: it can only be replaced. It never appears in the logs, or in any error.

The server checks credentials with SoundCloud before it saves them, so that a typo can't take the radio off air, and
the radio reads its playlist through them right away, and the tracks of the rotation of sets within a minute.

Their `error` is why the radio's last read of its playlist failed, which is the chosen playlist's `error` (see
[`GET /api/admin/radio`](#get-apiadminradio-admin)), or null when that read succeeded, or while no playlist is chosen.
Previewing a playlist doesn't change it. It's only kept in memory, so it's null after the server restarts, until a read
fails.

In development and in tests, `SOUNDCLOUD_STAND_IN` has the server use a stand-in for SoundCloud instead, so that nothing
reaches it (see "SoundCloud" in the [README](../../../README.md#soundcloud)): it accepts any credentials, and shows a
track at any link to one, but no playlist, and gives no streams.

## Tracks

A track of the playlist has:

| Field | Type | |
|---|---|---|
| `id` | string | |
| `artist` | string | Read from the track's title (see [The playlist](#the-playlist)) |
| `event` | string or null | The event the set was played at, e.g. `"HAUTE RIVE TAKEOVER"` |
| `date` | string or null | The day the set was recorded |
| `durationMs` | number | In milliseconds |

## `GET /api/on-air[?upcoming=N]`

What's on air on the rotation of sets, and what comes next.

| Query parameter | |
|---|---|
| `upcoming` | How many of the sets that come next to give, a whole number up to 1000. They go around the rotation as many times as that takes, e.g. to fill the next 24 hours. Without it, a single round: each other set that isn't skipped, once |

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `current` | object or null | The set on air, or null when the radio is off air: `set`, a set (below), `startedAt`, when it went on air, and `durationMs`, how long it lasts, in milliseconds: its track's length. It's played from the current time minus `startedAt`, and on air until `startedAt` plus `durationMs` |
| `upcoming` | list of objects | The sets that come next, in order, each with `set`, `startsAt`, when it goes on air if nothing changes until then, and `durationMs`. Empty when the radio is off air. They can still change |

A set, here, is a set of an event, as [`GET /api/events`](events.md#get-apievents) gives it, so never with a private
link to its track, with `session`: its session's `id`, `title`, `start` and `takeover`, as its event gives them.

Fails with 400 if `upcoming` is given more than once, or isn't a whole number from 0 to 1000.

## `GET /api/radio/sets/:id/stream`

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `url` | string | An HLS playlist on SoundCloud's CDN, which needs no credentials |
| `expiresAt` | string | When `url` stops working: the playlist has to be loaded by then. The audio it lists stays available for a while longer (about 2 hours), enough to play the set through |

Where to stream a set of the rotation from, for every set that isn't skipped (see [On air](#on-air)). Fails with 404
(not a set of the rotation, or skipped) or 502 (the stream can't be read right now, e.g. SoundCloud can't be reached).

## `GET /api/admin/radio/rotation` (admin)

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `updatedBy`, `updatedAt` | string or null | Who last changed the rotation (an admin's email), and when, or null until it's first changed |
| `current` | object or null | The set on air, its `setId` and when it went on air, `startedAt`, as [`GET /api/on-air`](#get-apion-airupcomingn) gives them, or null when the radio is off air |
| `sets` | list of objects | The rotation's sets, in order (below) |

Each of the rotation's sets has:

| Field | Type | |
|---|---|---|
| `id` | string | The set's id |
| `performers` | list of objects | Its performers, as the admin endpoints give them (see [Sets](sessions.md#sets)) |
| `soundcloudTrack`, `youtubeVideo` | object or null | As the admin endpoints give them (see [Links](sessions.md#links)) |
| `session` | object | Its session's `id`, `title` and `start`, which is null when the session no longer has one, which keeps the set from being added, but not from staying in the rotation, skipped as not announced |
| `durationMs` | number or null | Its track's length, in milliseconds, as it was last read, or null when it hasn't been read |
| `readError` | string or null | Why the last read of its track failed, or null when it didn't. The radio goes on with what was read before |
| `skipped` | list of strings | Why it's skipped, or empty when it isn't (see [Which sets](#which-sets)) |
| `startsAt` | string or null | When it goes on air next, if nothing changes until then, or, for the set on air, when it went on air. Null when it's skipped, or the radio is off air |

## `PUT /api/admin/radio/rotation` (admin)

| Request field | Type | |
|---|---|---|
| `sets` | list of strings | The ids of the rotation's sets, in order |

Makes the rotation these sets, in this order, which changes what's on air right away (see [On air](#on-air)). A set that
isn't in the rotation yet can only be added when it meets the conditions of [Which sets](#which-sets), while one that
already is stays, even when it doesn't meet them anymore, skipped. Then reads the tracks that are due to be read (see
[Reading the tracks](#reading-the-tracks)), for up to about 8 seconds, those that aren't read by then being read later,
as they would anyway, and responds like [`GET /api/admin/radio/rotation`](#get-apiadminradiorotation-admin). It sets
`updatedBy` and `updatedAt`, even when nothing changes.

Fails with:

| Status | When |
|---|---|
| 400 | `sets` isn't a list of strings, the request has another field, a set is there twice (`"A set is only once in the rotation"`), or there's no such set (`"No such set"`) |
| 409 | A set that isn't in the rotation yet doesn't meet the conditions to be added (`"This set can't be added to the rotation"`), with `reasons`, those it doesn't meet, as `skipped` gives them |

The errors about one of the sets have `setIndex`, its place in `sets`, from 0. When it fails, nothing changes.

## `GET /api/admin/radio/rotation/candidates` (admin)

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `total` | number | How many sets `sets` has (see [Conventions](README.md#conventions)) |
| `sets` | list of objects | The sets that can be added to the rotation (see [Which sets](#which-sets)), and aren't in it, each with its `id`, `performers`, `soundcloudTrack`, `youtubeVideo` and `session`, as the rotation's sets have them. The most recent session first (by `start`), then in the session's order |

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
right away, unless it's the playlist already on air, which goes on where it is (see [The playlist](#the-playlist)).
Fails like the preview, and with 400 when none of the playlist's tracks can be played in full.

## `GET /api/admin/radio/credentials` (admin)

The SoundCloud app the server reads SoundCloud through (see [The SoundCloud app](#the-soundcloud-app)). Like
`GET /api/admin/radio`, it reads the playlist again when that's due, so that `error` is up to date.

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `credentials` | object or null | The app's `clientId`, who last changed the credentials (`updatedBy`, an admin's email) and when (`updatedAt`), and `error` (see [The SoundCloud app](#the-soundcloud-app)). Null until they're entered: until then, the radio is off air |

## `PUT /api/admin/radio/credentials` (admin)

| Request field | Type | |
|---|---|---|
| `clientId` | string | The app's client ID, up to 200 characters. Trimmed |
| `clientSecret` | string | The app's client secret, up to 200 characters. Trimmed |

Asks SoundCloud for a token with the credentials, and only if it gives one, saves them, reads the radio's playlist
through the newest credentials, if one is chosen, and responds like `GET /api/admin/radio/credentials`, with those
credentials: its `error` is that of this read, which can fail even though they were saved. Fails with 400 (either one is
blank or too long, or SoundCloud refuses them) or 502 (SoundCloud can't be reached).

## `POST /api/admin/radio/credentials/check` (admin)

Takes the same request as `PUT /api/admin/radio/credentials`, and asks SoundCloud for a token with the credentials the
same way, but doesn't save them: it responds `{"ok": true}` when SoundCloud accepts them, and fails like `PUT`
otherwise. This lets credentials be verified before they're saved.
