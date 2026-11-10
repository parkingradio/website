# Video

The site shows a video, which the server decides: for now, the newest upload of Parking Radio's YouTube channel. Clients
show the video the server says, without knowing why it's that one, so that other rules can decide it later without
changing them.

## The video

The server reads the channel through the YouTube Data API, with a key, both entered on the admin pages (see [The YouTube
credentials](#the-youtube-credentials)): until they are, there's no video to show. It reads YouTube at most once a
minute with the same credentials, and only when the video or its credentials are asked for, and keeps what it read in
memory. A channel with no uploads has no video to show.

When reading YouTube fails, e.g. because YouTube can't be reached, refuses the key, or uses up its quota, the server
goes on with what it read before. So does it when YouTube gives a video id that isn't 11 letters, digits, `-` or `_`,
which counts as a failed read, since clients put the id in addresses. Only admins see why the last read failed, in the
credentials' `error`: visitors never see YouTube's errors.

## The YouTube credentials

The channel's id, found in the [advanced settings](https://www.youtube.com/account_advanced) of its YouTube account, and
the key the server reads it with, an API key of a Google Cloud project, restricted to the YouTube Data API v3. They're
kept in the database rather than set when the site is deployed, so that they can be changed without deploying it again.
The key is never sent back once it's entered: it can only be replaced. It never appears in the logs, or in any error.

The server checks them with YouTube before it saves them, so that a typo can't leave the site without a video, and reads
the video through them right away. With another key for the same channel, it goes on with the video it read before until
it reads one with the new key, while with another channel, it starts over.

Their `error` is why the last read of YouTube failed, or null when it succeeded. It's only kept in memory, so it's null
after the server restarts, until a read fails.

## `GET /api/video`

The video the site shows now.

| Response field | Type | |
|---|---|---|
| `video` | object or null | `{"id": "<the video's id on YouTube>"}`, or null when there's none, e.g. the channel has no uploads |

Fields can be added to the response, and to `video`, without breaking clients, which ignore those they don't know.

Fails with 502 until something has been read through the current credentials (they haven't been entered, YouTube refuses
the key, or YouTube can't be reached or refuses requests for now, e.g. its quota is used up), or when the database can't
be reached.

## `GET /api/admin/video/credentials` (admin)

The YouTube channel the server reads the video from (see [The YouTube credentials](#the-youtube-credentials)). Unlike
the other credentials' endpoints, it reads YouTube too, like `GET /api/video`, and shares what that reads, so that
`error` is up to date: still at most once a minute.

| Response field | Type | |
|---|---|---|
| `ok` | `true` | |
| `credentials` | object or null | The `channelId`, who last changed the credentials (`updatedBy`, an admin's email) and when (`updatedAt`), and `error` (see [The YouTube credentials](#the-youtube-credentials)). Null until they're entered: until then, there's no video to show |

## `PUT /api/admin/video/credentials` (admin)

| Request field | Type | |
|---|---|---|
| `channelId` | string | The channel's id: `UC`, then 22 letters, digits, `-` or `_`. Trimmed |
| `apiKey` | string | The API key, up to 200 characters. Trimmed |

Asks YouTube for the channel with the key, and only if YouTube accepts the key and finds the channel, saves them, reads
the video through them, and responds like `GET /api/admin/video/credentials`: its `error` is that of this read, which
can fail even though they were saved. Fails with 400 (either one is blank, too long or not in its format, YouTube
refuses the key, saying why, or finds no such channel) or 502 (YouTube can't be reached or refuses requests for now,
e.g. its quota is used up).

## `POST /api/admin/video/credentials/check` (admin)

Takes the same request as `PUT /api/admin/video/credentials`, and asks YouTube for the channel with the key the same
way, but doesn't save them: it responds `{"ok": true}` when YouTube accepts the key and finds the channel, and fails
like `PUT` otherwise. This lets credentials be verified before they're saved.
