// What a read of a track of the rotation says of it (see "Reading the tracks" in docs/design/server/radio.md): whether it
// can be played in full ("playable"), or why not: SoundCloud shows no such track ("missing"), describes it unexpectedly
// ("unexpected"), or only lets a preview of it be played, or none, or doesn't let it be streamed (see `readTrack` in
// soundcloud.ts). On its own, so that the database's schema doesn't depend on the client for SoundCloud.
export const TRACK_STATES = ['playable', 'missing', 'unexpected', 'preview', 'blocked', 'not-streamable'] as const
export type TrackState = (typeof TRACK_STATES)[number]
