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
export type RotationSetFacts = { status: Status; soundcloudTrackId: string | null; soundcloudTrackUrl: string | null; youtubeVideoId: string | null }
export type RotationSessionFacts = { announced: boolean }
export type TrackReadFacts = { link: string; state: TrackState | null; durationMs: number | null }

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

// What was read of a track, if it was read through `link`, the link its set has: what was read through another one
// doesn't count.
export function readThrough<Read extends { link: string }>(link: string | null, read: Read | null): Read | null {
  return read !== null && read.link === link ? read : null
}

// What was read of the set's track, if it was read through the link the set has, and SoundCloud answered.
function readOf(set: RotationSetFacts, read: TrackReadFacts | null): (TrackReadFacts & { state: TrackState }) | null {
  const current = readThrough(set.soundcloudTrackUrl, read)
  return current?.state != null ? { ...current, state: current.state } : null
}

// Why a set of the rotation is skipped, or empty when it isn't.
export function skipReasons(set: RotationSetFacts, session: RotationSessionFacts, read: TrackReadFacts | null): SkipReason[] {
  const reasons = ineligibility(set, session)
  if (set.soundcloudTrackId === null) return reasons
  const known = readOf(set, read)
  if (!known) return [...reasons, 'unread']
  return known.state === 'playable' ? reasons : [...reasons, known.state]
}

// How long the set's track lasts, in milliseconds, as it was last read through the link the set has, or null when it
// wasn't.
export function durationOf(set: RotationSetFacts, read: TrackReadFacts | null): number | null {
  return readOf(set, read)?.durationMs ?? null
}

// A set of the rotation, as what's on air is worked out from it, in the rotation's order. One that isn't skipped has a
// track, and its length.
export type Entry = { setId: string; position: number; trackId: string | null; durationMs: number | null; skipped: readonly SkipReason[] }

// The set on air, with the track it went on air with, when it went on air, in milliseconds since the epoch, and its place
// in the rotation, from which the radio goes on when the set isn't in the rotation anymore, or is skipped.
export type OnAir = { setId: string; trackId: string; startedAt: number; position: number }
// What's kept of it: once the radio goes off air, the set that was on air last, with null as when it went on air, so that
// the radio comes back after its place.
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

// The place in `entries` of the set at `place` in `before`, the rotation as it was: its own, if it's still in it, or else
// just before the first set after it, in the rotation as it was, that's still in it.
function placeIn(entries: readonly Entry[], before: readonly Entry[], place: Pick<OnAir, 'setId' | 'position'>): number {
  const positions = new Map(entries.map((entry) => [entry.setId, entry.position]))
  const own = positions.get(place.setId)
  if (own !== undefined) return own
  const next = after(before, place.position).find((entry) => positions.has(entry.setId))
  return next ? positions.get(next.setId)! - 1 : -1
}

// What's kept once the rotation changes from `before` to `entries` at `now`, from `saved`, what was kept with `before`
// (see "On air" in docs/design/server/radio.md): the set on air stays on air, where it is in it, while it's still in the
// rotation and isn't skipped. Otherwise the first set after it, in the rotation as it was, that's still in it and isn't
// skipped goes on air, or else the first set of the rotation that isn't skipped. When the radio was off air, it comes back
// as it would have anyway, after the place of the set that was on air last, wherever that is now.
export function onAirAfterChange(before: readonly Entry[], entries: readonly Entry[], saved: Saved | null, now: number): Saved | null {
  const current = onAirAt(before, saved, now)
  if (!isOnAir(current)) return onAirAt(entries, current && { ...current, position: placeIn(entries, before, current) }, now)
  const byId = new Map(entries.map((entry) => [entry.setId, entry]))
  const same = byId.get(current.setId)
  if (stillOnAir(same, current)) return { ...current, position: same.position }
  const next = after(before, current.position)
    .map((entry) => byId.get(entry.setId))
    .find((entry) => entry !== undefined && playable(entry))
  const first = next ?? entries.find(playable)
  return first ? startingAt(first, now) : { ...current, position: placeIn(entries, before, current), startedAt: null }
}

export const sameSaved = (a: Saved | null, b: Saved | null): boolean =>
  a === b || (a !== null && b !== null && a.setId === b.setId && a.trackId === b.trackId && a.startedAt === b.startedAt && a.position === b.position)
