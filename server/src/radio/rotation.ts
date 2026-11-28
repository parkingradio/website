import type { Status } from '../sessions/fields.js'
import type { TrackState } from './track-states.js'

// The rules of the radio's rotation of sets, which don't depend on where it's kept (see "The rotation of sets" in
// docs/design/server/radio.md): which sets can be in it, which are skipped and why, and which set is on air.

// Why a set of the rotation is skipped: first those that keep it from being added to the rotation, then those of its
// track, whose names are those of `TrackState`, but for "unread".
export const SKIP_REASONS = [
  'cancelled',
  'no-soundcloud-track',
  'no-youtube-video',
  'not-announced',
  'unread',
  'missing',
  'unexpected',
  'preview',
  'blocked',
  'not-streamable',
] as const
export type SkipReason = (typeof SKIP_REASONS)[number]

// What a set's place in the rotation depends on, of the set, its session, and what was read of its track.
export type RotationSetFacts = { status: Status; soundcloudTrackId: string | null; youtubeVideoId: string | null }
export type RotationSessionFacts = { announced: boolean }
// What was read of its track is always through the link the set has (see "set_track_reads" in db/schema.ts).
export type TrackReadFacts = { state: TrackState | null; durationMs: number | null }

// Why a set can't be added to the rotation, or is skipped if it's in it, besides its track: empty when it can be. This is
// the only place that says which sets can be in the rotation.
export function ineligibility(set: RotationSetFacts, session: RotationSessionFacts): SkipReason[] {
  const reasons: SkipReason[] = []
  if (set.status === 'cancelled') reasons.push('cancelled')
  if (set.soundcloudTrackId === null) reasons.push('no-soundcloud-track')
  if (set.youtubeVideoId === null) reasons.push('no-youtube-video')
  if (!session.announced) reasons.push('not-announced')
  return reasons
}

// Why a set of the rotation is skipped, or empty when it isn't.
export function skipReasons(set: RotationSetFacts, session: RotationSessionFacts, read: TrackReadFacts | null): SkipReason[] {
  const reasons = ineligibility(set, session)
  if (set.soundcloudTrackId === null) return reasons
  // Until SoundCloud answers.
  if (read?.state == null) return [...reasons, 'unread']
  return read.state === 'playable' ? reasons : [...reasons, read.state]
}

// How long the set's track lasts, in milliseconds, as it was last read, or null when it wasn't.
export function durationOf(read: TrackReadFacts | null): number | null {
  return read?.state != null ? read.durationMs : null
}

// A set of the rotation, as what's on air is worked out from it, in the rotation's order. One that isn't skipped has a
// track, and its length.
export type Entry = { setId: string; position: number; trackId: string | null; durationMs: number | null; skipped: readonly SkipReason[] }

// The set on air, with the track it went on air with, when it went on air, in milliseconds since the epoch, and its place
// in the rotation, from which the radio goes on when the set isn't in the rotation anymore, or is skipped.
export type OnAir = { setId: string; trackId: string; startedAt: number; position: number }
// What's kept of it: once the radio goes off air, the set that was on air last, with null as when it went on air, so that
// the radio comes back after its place. Null when nothing has been on air since the rotation was changed, so that the
// radio comes back at its first set.
export type Saved = Omit<OnAir, 'startedAt'> & { startedAt: number | null }

export const isOnAir = (saved: Saved | null): saved is OnAir => saved !== null && saved.startedAt !== null

const playable = (entry: Entry) => entry.skipped.length === 0

function startingAt(entry: Entry, now: number): OnAir {
  return { setId: entry.setId, trackId: entry.trackId!, startedAt: now, position: entry.position }
}

// The rotation's sets after the place `position`, around the rotation, without the one at that place, if there's one.
function after(entries: readonly Entry[], position: number): Entry[] {
  return [...entries.filter((entry) => entry.position > position), ...entries.filter((entry) => entry.position < position)]
}

// Whether `entry` is the set `onAir` says, with the track it went on air with, and isn't skipped.
const stillOnAir = (entry: Entry | undefined, onAir: OnAir): entry is Entry => entry !== undefined && playable(entry) && entry.trackId === onAir.trackId

// What's kept at `now`, from `saved`, what was kept until then, if anything (see "On air" in docs/design/server/radio.md):
// - while the set it says is on air, that set, or the ones after it, as sets end,
// - when it isn't on air anymore, or the radio was off air, the first set after its place that isn't skipped, from `now`,
// - without `saved`, the first set that isn't skipped, from `now`,
// - when every set is skipped, `saved`, off air, or null without it.
export function onAirAt(entries: readonly Entry[], saved: Saved | null, now: number): Saved | null {
  const sets = entries.filter(playable)
  if (sets.length === 0) return saved && { ...saved, startedAt: null }
  if (!saved) return startingAt(sets[0], now)
  let index = sets.findIndex((entry) => entry.setId === saved.setId)
  if (!isOnAir(saved) || !stillOnAir(sets[index], saved)) return startingAt(after(sets, saved.position)[0] ?? sets[0], now)

  let { startedAt } = saved
  // Whole rounds of the rotation are skipped at once, e.g. after nobody listened for days, since a round from any set
  // leads back to it.
  const round = sets.reduce((total, entry) => total + entry.durationMs!, 0)
  if (now - startedAt >= round) startedAt += Math.floor((now - startedAt) / round) * round
  while (startedAt + sets[index].durationMs! <= now) {
    startedAt += sets[index].durationMs!
    index = (index + 1) % sets.length
  }
  return startingAt(sets[index], startedAt)
}

// The sets that come after `onAir`, which is on air, with when each one starts: `count` of them, around the rotation as
// many times as it takes, or, without `count`, each other set that isn't skipped, once.
export function upcoming<E extends Entry>(entries: readonly E[], onAir: OnAir, count?: number): { entry: E; startsAt: number }[] {
  const sets = entries.filter(playable)
  const index = sets.findIndex((entry) => entry.setId === onAir.setId)
  let startsAt = onAir.startedAt + sets[index].durationMs!
  const found: { entry: E; startsAt: number }[] = []
  for (let i = 1; i <= (count ?? sets.length - 1); i++) {
    const entry = sets[(index + i) % sets.length]
    found.push({ entry, startsAt })
    startsAt += entry.durationMs!
  }
  return found
}

// The rotation from its play head (see "On air" in docs/design/server/radio.md), what's kept being `saved`, as `onAirAt`
// keeps it: from the set on air, or, off air, after the place of the set that was on air last, or from its first set.
export function fromHead<E extends Entry>(entries: readonly E[], saved: Saved | null): E[] {
  if (!saved) return [...entries]
  const at = isOnAir(saved) ? entries.findIndex((entry) => entry.setId === saved.setId) : entries.findIndex((entry) => entry.position > saved.position)
  return at <= 0 ? [...entries] : [...entries.slice(at), ...entries.slice(0, at)]
}

// What's kept once the rotation changes from `before` to `entries`, which starts at the play head, at `now`, from `saved`,
// what was kept with `before` (see "On air" in docs/design/server/radio.md): the first set of `entries` that isn't skipped
// is on air, where it is, if it's the set on air, once caught up to `now` in the rotation as it was, or else from `now`.
// When none can be played, the radio is off air, and comes back at the rotation's first set.
export function onAirAfterChange(before: readonly Entry[], entries: readonly Entry[], saved: Saved | null, now: number): Saved | null {
  const head = entries.find(playable)
  if (!head) return null
  const current = onAirAt(before, saved, now)
  if (isOnAir(current) && current.setId === head.setId && stillOnAir(head, current)) return { ...current, position: head.position }
  return startingAt(head, now)
}

// What's kept once the tracks that changing the rotation to `changed` reads are read, the rotation being `entries` then,
// from `saved`: when another set is the first that can be played than in `changed`, e.g. a set just added at the play
// head, which can be played once its track is read, it goes on air as if the rotation were changed again, and otherwise
// the radio goes on as it does anyway.
export function onAirAfterReads(changed: readonly Entry[], entries: readonly Entry[], saved: Saved | null, now: number): Saved | null {
  const head = entries.find(playable)
  return head === undefined || head.setId === changed.find(playable)?.setId ? onAirAt(entries, saved, now) : onAirAfterChange(entries, entries, saved, now)
}

export const sameSaved = (a: Saved | null, b: Saved | null): boolean =>
  a === b || (a !== null && b !== null && a.setId === b.setId && a.trackId === b.trackId && a.startedAt === b.startedAt && a.position === b.position)
