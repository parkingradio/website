import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { ineligibility, onAirAfterChange, onAirAt, skipReasons, upcoming } from './rotation.js'
import type { Entry, OnAir, Saved, SkipReason } from './rotation.js'

// The rules of the rotation of sets (see "The rotation of sets" in docs/design/server/radio.md), on their own.

const HOUR = 60 * 60 * 1000
const NOW = Date.parse('2026-11-27T12:00:00Z')

// A set of the rotation, `id`, at its place in `ids`, lasting `hours`, with the track `t<id>`, unless it's skipped.
function entry(id: string, position: number, hours = 1, skipped: SkipReason[] = []): Entry {
  return { setId: id, position, trackId: `t${id}`, durationMs: hours * HOUR, skipped }
}

// The sets `ids`, in order, each lasting an hour, but those in `skipped`, which are skipped.
function rotation(ids: string, skipped = ''): Entry[] {
  return [...ids].map((id, position) => entry(id, position, 1, skipped.includes(id) ? ['cancelled'] : []))
}

const onAir = (setId: string, startedAt: number, position: number): OnAir => ({ setId, trackId: `t${setId}`, startedAt, position })

describe('which sets', () => {
  const set = { status: 'done' as const, soundcloudTrackId: '1', soundcloudTrackUrl: 'https://soundcloud.com/a/b', youtubeVideoId: 'abcdefghijk' }
  const announced = { announced: true }

  it('can be added: not cancelled, with a track and a video, whose session is announced', () => {
    expect(ineligibility(set, announced)).toEqual([])
    expect(ineligibility({ ...set, status: 'planned' }, announced)).toEqual([])
    expect(ineligibility({ ...set, status: 'cancelled', soundcloudTrackId: null, soundcloudTrackUrl: null, youtubeVideoId: null }, { announced: false })).toEqual([
      'cancelled',
      'no-soundcloud-track',
      'no-youtube-video',
      'not-announced',
    ])
  })

  it('are skipped while their track was not read through their link, or cannot be played in full', () => {
    const read = { link: set.soundcloudTrackUrl, state: 'playable' as const, durationMs: HOUR }
    expect(skipReasons(set, announced, read)).toEqual([])
    expect(skipReasons(set, announced, null)).toEqual(['unread'])
    expect(skipReasons(set, announced, { ...read, state: null, durationMs: null })).toEqual(['unread'])
    // Read through the link the set had before.
    expect(skipReasons(set, announced, { ...read, link: 'https://soundcloud.com/a/c' })).toEqual(['unread'])
    expect(skipReasons(set, announced, { ...read, state: 'preview' })).toEqual(['preview'])
    expect(skipReasons({ ...set, status: 'cancelled' }, { announced: false }, { ...read, state: 'missing' })).toEqual(['cancelled', 'not-announced', 'missing'])
    // A set without a track has nothing to read.
    expect(skipReasons({ ...set, soundcloudTrackId: null, soundcloudTrackUrl: null }, announced, null)).toEqual(['no-soundcloud-track'])
  })
})

describe('what is on air', () => {
  it('starts with the first set that is not skipped', () => {
    expect(onAirAt(rotation('abc', 'a'), null, NOW)).toEqual(onAir('b', NOW, 1))
    expect(onAirAt(rotation('abc', 'abc'), null, NOW)).toBeNull()
    expect(onAirAt([], null, NOW)).toBeNull()
  })

  it('moves along as sets end, passing over skipped sets, around the rotation', () => {
    const sets = rotation('abcd', 'c')
    expect(onAirAt(sets, onAir('a', NOW, 0), NOW + HOUR - 1)).toEqual(onAir('a', NOW, 0))
    expect(onAirAt(sets, onAir('a', NOW, 0), NOW + HOUR)).toEqual(onAir('b', NOW + HOUR, 1))
    expect(onAirAt(sets, onAir('a', NOW, 0), NOW + 2 * HOUR)).toEqual(onAir('d', NOW + 2 * HOUR, 3))
    expect(onAirAt(sets, onAir('a', NOW, 0), NOW + 3 * HOUR + 1)).toEqual(onAir('a', NOW + 3 * HOUR, 0))
    // Days later.
    expect(onAirAt(sets, onAir('a', NOW, 0), NOW + 1000 * HOUR + 1)).toEqual(onAir('b', NOW + 1000 * HOUR, 1))
  })

  it('goes on after the place of the set on air when it is skipped, out of the rotation, or has another track', () => {
    expect(onAirAt(rotation('abc', 'b'), onAir('b', NOW - HOUR / 2, 1), NOW)).toEqual(onAir('c', NOW, 2))
    expect(onAirAt(rotation('abc', 'bc'), onAir('b', NOW - HOUR / 2, 1), NOW)).toEqual(onAir('a', NOW, 0))
    // b was deleted, at place 1.
    expect(onAirAt([entry('a', 0), entry('c', 2)], onAir('b', NOW - HOUR / 2, 1), NOW)).toEqual(onAir('c', NOW, 2))
    expect(onAirAt(rotation('abc'), { ...onAir('b', NOW - HOUR / 2, 1), trackId: 'another' }, NOW)).toEqual(onAir('c', NOW, 2))
  })

  it('goes off air when every set is skipped, keeping the place of the set that was on air, and comes back after it', () => {
    const off = onAirAt(rotation('abc', 'abc'), onAir('b', NOW - HOUR / 2, 1), NOW)
    expect(off).toEqual({ setId: 'b', trackId: 'tb', startedAt: null, position: 1 })
    // b isn't skipped anymore, but the radio was off air: it comes back after b, rather than in the middle of it.
    expect(onAirAt(rotation('abc'), off, NOW + HOUR)).toEqual(onAir('c', NOW + HOUR, 2))
  })

  it('gives the sets that come next, once each, or as many as asked, around the rotation', () => {
    const sets = [entry('a', 0, 1), entry('b', 1, 2, ['cancelled']), entry('c', 2, 3)]
    const next = (count?: number) => upcoming(sets, onAir('c', NOW, 2), count).map(({ entry, startsAt }) => [entry.setId, (startsAt - NOW) / HOUR])
    expect(next()).toEqual([['a', 3]])
    expect(next(0)).toEqual([])
    expect(next(4)).toEqual([
      ['a', 3],
      ['c', 4],
      ['a', 7],
      ['c', 8],
    ])
    expect(upcoming([entry('a', 0)], onAir('a', NOW, 0))).toEqual([])
  })
})

describe('changing the rotation', () => {
  it('keeps the set on air on air, wherever it moved', () => {
    expect(onAirAfterChange(rotation('abc'), rotation('cab'), onAir('b', NOW - HOUR / 2, 1), NOW)).toEqual(onAir('b', NOW - HOUR / 2, 2))
  })

  it('catches the set on air up to now in the rotation as it was, first', () => {
    // a's hour is over: b is on air, and stays so.
    expect(onAirAfterChange(rotation('abc'), rotation('bc'), onAir('a', NOW - HOUR - 1, 0), NOW)).toEqual(onAir('b', NOW - 1, 0))
  })

  it('puts on air the first set after the one taken out, in the rotation as it was, that is still in it and not skipped', () => {
    // After b, c is gone, and d is skipped: e. In the new order, a would come after b's place, but e is what came next.
    const after = [entry('a', 0), entry('d', 1, 1, ['not-announced']), entry('e', 2)]
    expect(onAirAfterChange(rotation('abcde'), after, onAir('b', NOW - HOUR / 2, 1), NOW)).toEqual(onAir('e', NOW, 2))
    // None of them is still in it: the first set of the rotation that isn't skipped.
    expect(onAirAfterChange(rotation('abc'), [entry('x', 0, 1, ['cancelled']), entry('y', 1)], onAir('a', NOW - HOUR / 2, 0), NOW)).toEqual(onAir('y', NOW, 1))
  })

  it('goes off air when nothing can be played, keeping the place, and starts with the first set when nothing was ever on air', () => {
    expect(onAirAfterChange(rotation('abc'), rotation('ac', 'ac'), onAir('b', NOW - HOUR / 2, 1), NOW)).toEqual({
      setId: 'b',
      trackId: 'tb',
      startedAt: null,
      position: 0,
    })
    expect(onAirAfterChange([], rotation('xy', 'x'), null, NOW)).toEqual(onAir('y', NOW, 1))
    expect(onAirAfterChange([], [], null, NOW)).toBeNull()
  })

  it('comes back on air after the place of the set that was on air last, when it was off air', () => {
    const off: Saved = { setId: 'b', trackId: 'tb', startedAt: null, position: 1 }
    // b is gone: c came after it, and is now at place 0.
    expect(onAirAfterChange(rotation('abc', 'abc'), rotation('cda'), off, NOW)).toEqual(onAir('c', NOW, 0))
  })
})

// Random rotations of a few sets, of whole minutes, some of them skipped, and what's kept of what's on air.
const ids = 'abcdefgh'
const rotations = fc
  .uniqueArray(fc.constantFrom(...ids), { minLength: 0, maxLength: ids.length })
  .chain((setIds) =>
    fc.tuple(
      ...setIds.map((id) =>
        fc.record({ minutes: fc.integer({ min: 1, max: 180 }), skipped: fc.boolean() }).map(({ minutes, skipped }) => ({
          setId: id,
          trackId: `t${id}`,
          durationMs: minutes * 60_000,
          skipped: skipped ? (['cancelled'] as SkipReason[]) : [],
        })),
      ),
    ),
  )
  .map((sets) => sets.map((set, position): Entry => ({ ...set, position })))
const saveds = fc.option(
  fc.record({
    setId: fc.constantFrom(...ids),
    startedAt: fc.option(fc.integer({ min: NOW - 100 * HOUR, max: NOW }), { nil: null }),
    position: fc.integer({ min: -1, max: ids.length }),
  }),
  { nil: null },
)
const toSaved = (saved: { setId: string; startedAt: number | null; position: number } | null): Saved | null => saved && { ...saved, trackId: `t${saved.setId}` }
const later = fc.integer({ min: 0, max: 100 * HOUR })
const playable = (entries: Entry[], setId: string) => entries.some((entry) => entry.setId === setId && entry.skipped.length === 0)

describe('properties of what is on air', () => {
  it('is a set of the rotation that is not skipped, whose time is now, or nothing when every set is skipped', () => {
    fc.assert(
      fc.property(rotations, saveds, later, (entries, sent, elapsed) => {
        const now = NOW + elapsed
        const result = onAirAt(entries, toSaved(sent), now)
        if (!entries.some((entry) => entry.skipped.length === 0)) {
          expect(result?.startedAt ?? null).toBeNull()
          return
        }
        expect(result).not.toBeNull()
        expect(playable(entries, result!.setId)).toBe(true)
        const { durationMs } = entries.find((entry) => entry.setId === result!.setId)!
        expect(result!.startedAt).toBeLessThanOrEqual(now)
        expect(result!.startedAt! + durationMs!).toBeGreaterThan(now)
      }),
    )
  })

  it('is the same worked out at once, or once in between, while nothing changes and something is on air', () => {
    fc.assert(
      fc.property(rotations, saveds, later, later, (entries, sent, first, second) => {
        const saved = onAirAt(entries, toSaved(sent), NOW)
        fc.pre(saved !== null && saved.startedAt !== null)
        const [t1, t2] = [NOW + Math.min(first, second), NOW + Math.max(first, second)]
        expect(onAirAt(entries, onAirAt(entries, saved, t1), t2)).toEqual(onAirAt(entries, saved, t2))
      }),
    )
  })

  it('does not change when the rotation is changed to what it already was', () => {
    fc.assert(
      fc.property(rotations, saveds, later, (entries, sent, elapsed) => {
        const now = NOW + elapsed
        const saved = toSaved(sent)
        const expected = onAirAt(entries, saved, now)
        const changed = onAirAfterChange(entries, entries, saved, now)
        if (expected?.startedAt == null) expect(changed?.startedAt ?? null).toBeNull()
        else expect(changed).toEqual(expected)
      }),
    )
  })

  it('keeps the set on air when the rotation is reordered, and when it changes but keeps that set', () => {
    fc.assert(
      fc.property(rotations, saveds, later, fc.integer(), fc.array(fc.boolean()), (entries, sent, elapsed, seed, kept) => {
        const now = NOW + elapsed
        const current = onAirAt(entries, toSaved(sent), now)
        fc.pre(current !== null && current.startedAt !== null)
        // Some of the sets, the one on air included, in another order, each at its new place.
        const others = entries.filter((entry, i) => entry.setId === current.setId || (kept[i] ?? true))
        const shuffled = others.map((entry, i) => ({ entry, key: (i * 7919 + seed) % 101 })).sort((a, b) => a.key - b.key)
        const after = shuffled.map(({ entry }, position) => ({ ...entry, position }))
        const result = onAirAfterChange(entries, after, toSaved(sent), now)
        expect(result).toEqual({ ...current, position: after.find((entry) => entry.setId === current.setId)!.position })
      }),
    )
  })

  it('puts on air a set that is in the new rotation, and not skipped, when there is one', () => {
    fc.assert(
      fc.property(rotations, rotations, saveds, later, (before, after, sent, elapsed) => {
        const result = onAirAfterChange(before, after, toSaved(sent), NOW + elapsed)
        if (after.some((entry) => entry.skipped.length === 0)) {
          expect(result?.startedAt).not.toBeNull()
          expect(playable(after, result!.setId)).toBe(true)
        } else {
          expect(result?.startedAt ?? null).toBeNull()
        }
      }),
    )
  })
})
