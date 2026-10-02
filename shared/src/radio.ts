// `GET /api/radio[?upcoming=N]`: what's on the radio, with the next N tracks of the rotation, or all of
// them by default. Fails with 400 when N isn't a whole number, or with 502 when the radio is unavailable,
// e.g. because its rotation can't be fetched from SoundCloud.
//
// The radio isn't a live stream, but the server decides what's on air: it moves along the rotation, which
// is Parking Radio's sets on SoundCloud in the order SoundCloud lists them, as tracks end. So every listener
// plays the same track from the same point, and changes to the rotation, e.g. a set being uploaded, only
// ever affect the tracks after the one on air.
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
// a track of the rotation) or 502 (SoundCloud can't be reached).
export type RadioStreamResponse = {
  // An HLS playlist on SoundCloud's CDN, which needs no credentials.
  url: string
  // When `url` stops working, as an ISO 8601 timestamp: the playlist has to be loaded by then. The audio
  // it lists stays available for a while longer (about 2 hours), enough to play the track through.
  expiresAt: string
}
