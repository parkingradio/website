import type { Schema } from '../api/client'

// The track on air, and when it started, as `GET /api/radio` gives it.
export type OnAir = Schema<'Radio'>['current']

// What the radio is doing, as far as the page knows. It's off air when `GET /api/radio` fails, e.g. because no
// playlist has been chosen yet or SoundCloud can't be reached (see docs/design/server/radio.md).
export type RadioState = { kind: 'loading' } | { kind: 'off-air' } | { kind: 'on-air'; onAir: OnAir }

/** Where `onAir`'s track is at `now` (in milliseconds since the epoch), in seconds from its start. */
export function positionAt(onAir: OnAir, now: number): number {
  return Math.max(0, (now - Date.parse(onAir.startedAt)) / 1000)
}

/** How long until `onAir`'s track ends at `now`, in milliseconds: then, what's on air next has to be asked for. */
export function untilEnd(onAir: OnAir, now: number): number {
  return Math.max(0, Date.parse(onAir.startedAt) + onAir.track.durationMs - now)
}

// Sessions are days, "YYYY-MM-DD", which are read as midnight UTC: they're formatted in UTC to stay the same day.
const sessionDate = new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

/** E.g. "rediffusion · 19 avril 2026", or just "rediffusion" for a set whose title has no date. */
export function rediffusion(track: Schema<'RadioTrack'>): string {
  return track.date ? `rediffusion · ${sessionDate.format(new Date(track.date))}` : 'rediffusion'
}
