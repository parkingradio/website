// `GET /api/radio[?upcoming=N]`: what's on the radio, with the next N tracks of the rotation, or all of
// them by default. Fails with 400 when N isn't a whole number, with 502 when the radio is unavailable, e.g.
// because its rotation can't be fetched from SoundCloud, or with 503 when no playlist has been chosen for
// the rotation yet.
//
// The radio isn't a live stream, but the server decides what's on air: it moves along the rotation, which
// is the tracks of a SoundCloud playlist chosen on the admin pages, in the playlist's order, as tracks end.
// So every listener plays the same track from the same point, and changes to the playlist, e.g. a set being
// added, only ever affect the tracks after the one on air.
//
// Choosing another playlist changes what's on air right away. Listeners who are playing a track keep
// playing it until it ends, since its stream doesn't depend on the rotation, and only then ask again: so a
// client has to stick with the track it's playing, rather than switch to whatever `current` says when it
// asks for other reasons, e.g. to refresh `upcoming`.
export type RadioResponse = {
  // The track on air, and when it started (ISO 8601): it's played from the current time minus
  // `startedAt`. Once it ends, at `startedAt + durationMs`, ask again for what's on air next.
  current: { track: RadioTrack; startedAt: string }
  // The tracks after the one on air, in order, as far as the server knows now: they can still change.
  // Each track of the rotation is in there at most once: after them, the rotation starts over with
  // `current`.
  upcoming: RadioTrack[]
}

export type RadioTrack = {
  // Pass to `GET /api/radio/tracks/:id/stream` to play the track.
  id: string
  // Parsed from the track's title on SoundCloud, "ARTIST | [EVENT @ ]parking.radio | YYYY.MM.DD". A
  // title that doesn't follow that pattern is used whole as the artist, with no event or date.
  artist: string
  // The event the set was played at (e.g. "HAUTE RIVE TAKEOVER"), if any.
  event: string | null
  // The day the set was recorded, "YYYY-MM-DD".
  date: string | null
  durationMs: number
  // The track's page on SoundCloud.
  url: string
}

// `GET /api/radio/tracks/:id/stream`: where to stream a track of the rotation from. Fails with 404 (not
// a track of the rotation) or 502 (SoundCloud can't be reached). A track that leaves the rotation, e.g.
// because another playlist was chosen, can still be streamed for as long as it lasts, so that listeners
// who were playing it can get a new stream if they need one to finish it.
export type RadioStreamResponse = {
  // An HLS playlist on SoundCloud's CDN, which needs no credentials.
  url: string
  // When `url` stops working, as an ISO 8601 timestamp: the playlist has to be loaded by then. The audio
  // it lists stays available for a while longer (about 2 hours), enough to play the track through.
  expiresAt: string
}

// `GET /api/admin/radio`: the playlist the rotation is read from. Requires a session: fails with 401 without
// a valid one.
export type RadioSettingsResponse = {
  ok: true
  // Null until a playlist has been chosen: until then, the radio is off air.
  current: {
    // The playlist's link and title as they were when it was chosen.
    url: string
    title: string
    // The email of the admin who chose it, and when (ISO 8601).
    chosenBy: string
    chosenAt: string
    // What the radio reads from it. Null when it couldn't be read yet, with `error` saying why.
    playlist: RadioPlaylist | null
    // Why it couldn't be read the last time it was tried, if it couldn't. The radio then goes on with what
    // it read before, in `playlist`, if anything.
    error: string | null
  } | null
}

// `POST /api/admin/radio/preview`: what the radio would read from the playlist at `link`, without choosing
// it. Requires a session. Fails with 400 (not a playlist link, see `playlistLink`), 401 (no valid session),
// 404 (no playlist SoundCloud shows at that link) or 502 (SoundCloud can't be reached).
export type RadioPreviewRequest = { link: string }
export type RadioPreviewResponse = { ok: true; playlist: RadioPlaylist }

// `POST /api/admin/radio/playlist`: reads the rotation from the playlist at `link` from now on. It goes on
// air from its first track right away (see `RadioResponse`). Requires a session. Fails like
// `POST /api/admin/radio/preview`, and with 400 when none of the playlist's tracks can be played.
export type RadioPlaylistRequest = { link: string }
export type RadioPlaylistResponse = { ok: true }

// A SoundCloud playlist, as the radio reads it.
export type RadioPlaylist = {
  // Its page on SoundCloud. For a private playlist, that's its private link, which gives access to it.
  url: string
  title: string
  private: boolean
  // The SoundCloud account the playlist belongs to, and its page.
  account: { name: string; url: string }
  // Every track of the playlist that SoundCloud shows, in the playlist's order: the rotation is the ones that
  // are on the radio, in that order.
  tracks: RadioPlaylistTrack[]
}

// A track of a playlist: either it's on the radio, or it's left out of the rotation because SoundCloud doesn't
// let it be played in full, or it's left out because SoundCloud describes it unexpectedly, in which case only
// its title (or SoundCloud's id for it, without one) is known.
export type RadioPlaylistTrack =
  | { kind: 'rotation'; track: RadioTrack }
  | { kind: 'left-out'; track: RadioTrack; reason: RadioLeftOutReason }
  | { kind: 'unexpected'; title: string }

// Why SoundCloud doesn't let a track be played in full, as it says: only a 30 second preview of it can be
// played ("preview"), it can't be played at all ("blocked"), or it can't be streamed ("not-streamable").
export type RadioLeftOutReason = 'preview' | 'blocked' | 'not-streamable'

// Links to SoundCloud playlists, e.g. "https://soundcloud.com/parkingdotradio/sets/rotation". A private
// playlist can only be read through its private link, which ends with its secret, e.g.
// "https://soundcloud.com/parkingdotradio/sets/rotation/s-AbC123". Parameters, e.g. "?si=...", are allowed.
const PLAYLIST_LINK = /^\s*https?:\/\/(?:www\.)?soundcloud\.com(\/[^/?#\s]+\/sets\/[^/?#\s]+(?:\/s-[^/?#\s]+)?)\/?(?:[?#]\S*)?\s*$/

// The playlist `link` leads to, as a link without anything that doesn't identify the playlist, or null if
// it isn't a link to a playlist.
export function playlistLink(link: string): string | null {
  const path = PLAYLIST_LINK.exec(link)?.[1]
  return path ? `https://soundcloud.com${path}` : null
}
