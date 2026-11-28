import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { fromHead, ineligibility, onAirAfterChange, onAirAfterReads, onAirAt, skipReasons, upcoming } from './rotation.js'
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
  const set = { status: 'done' as const, soundcloudTrackId: '1', youtubeVideoId: 'abcdefghijk' }
  const announced = { announced: true }

  it('can be added: not cancelled, with a track and a video, whose session is announced', () => {
    expect(ineligibility(set, announced)).toEqual([])
    expect(ineligibility({ ...set, status: 'planned' }, announced)).toEqual([])
    expect(ineligibility({ ...set, status: 'cancelled', soundcloudTrackId: null, youtubeVideoId: null }, { announced: false })).toEqual([
      'cancelled',
      'no-soundcloud-track',
      'no-youtube-video',
      'not-announced',
    ])
  })

  it('are skipped while their track was not read, or cannot be played in full', () => {
    const read = { state: 'playable' as const, durationMs: HOUR }
    expect(skipReasons(set, announced, read)).toEqual([])
    expect(skipReasons(set, announced, null)).toEqual(['unread'])
    expect(skipReasons(set, announced, { ...read, state: null, durationMs: null })).toEqual(['unread'])
    expect(skipReasons(set, announced, { ...read, state: 'preview' })).toEqual(['preview'])
    expect(skipReasons({ ...set, status: 'cancelled' }, { announced: false }, { ...read, state: 'missing' })).toEqual(['cancelled', 'not-announced', 'missing'])
    // A set without a track has nothing to read.
    expect(skipReasons({ ...set, soundcloudTrackId: null }, announced, null)).toEqual(['no-soundcloud-track'])
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

  it('gives when the sets that come next start from when the set on air started, to the second', () => {
    // Lasting an hour and 700 milliseconds each, from 600 milliseconds into a second.
    const sets = [entry('a', 0), entry('b', 1)].map((set) => ({ ...set, durationMs: HOUR + 700 }))
    const starts = upcoming(sets, onAir('a', NOW + 600, 0), 2).map(({ startsAt }) => startsAt - NOW)
    expect(starts).toEqual([HOUR + 700, 2 * HOUR + 1400])
  })
})

describe('the play head', () => {
  it('is the set on air, or, off air, after the place of the set that was on air last, or the first set without one', () => {
    const ids = (entries: Entry[]) => entries.map((entry) => entry.setId).join('')
    expect(ids(fromHead(rotation('abcd'), onAir('c', NOW, 2)))).toBe('cdab')
    expect(ids(fromHead(rotation('abcd'), { ...onAir('c', NOW, 2), startedAt: null }))).toBe('dabc')
    expect(ids(fromHead(rotation('abcd'), { ...onAir('d', NOW, 3), startedAt: null }))).toBe('abcd')
    // b was deleted, at place 1.
    expect(ids(fromHead([entry('a', 0), entry('c', 2)], { ...onAir('b', NOW, 1), startedAt: null }))).toBe('ca')
    expect(ids(fromHead(rotation('abcd'), null))).toBe('abcd')
  })
})

describe('changing the rotation', () => {
  it('keeps the set on air on air when it is first, wherever the others moved', () => {
    expect(onAirAfterChange(rotation('abc'), rotation('bca'), onAir('b', NOW - HOUR / 2, 1), NOW)).toEqual(onAir('b', NOW - HOUR / 2, 0))
    expect(onAirAfterChange(rotation('abc'), rotation('bac'), onAir('b', NOW - HOUR / 2, 1), NOW)).toEqual(onAir('b', NOW - HOUR / 2, 0))
  })

  it('puts another first set on air from now, which is how the set on air is taken out', () => {
    expect(onAirAfterChange(rotation('abc'), rotation('cab'), onAir('b', NOW - HOUR / 2, 1), NOW)).toEqual(onAir('c', NOW, 0))
    expect(onAirAfterChange(rotation('abc'), rotation('ca'), onAir('b', NOW - HOUR / 2, 1), NOW)).toEqual(onAir('c', NOW, 0))
  })

  it('goes by the first set that is not skipped, which goes on when it is the set on air', () => {
    expect(onAirAfterChange(rotation('abc'), rotation('abc', 'a'), onAir('b', NOW - HOUR / 2, 1), NOW)).toEqual(onAir('b', NOW - HOUR / 2, 1))
    expect(onAirAfterChange(rotation('abc'), rotation('acb', 'a'), onAir('b', NOW - HOUR / 2, 1), NOW)).toEqual(onAir('c', NOW, 1))
    // b has another track than the one it went on air with.
    expect(onAirAfterChange(rotation('abc'), rotation('bc'), { ...onAir('b', NOW - HOUR / 2, 1), trackId: 'another' }, NOW)).toEqual(onAir('b', NOW, 0))
  })

  it('catches the set on air up to now in the rotation as it was, first', () => {
    // a's hour is over: b is on air, and stays so.
    expect(onAirAfterChange(rotation('abc'), rotation('bc'), onAir('a', NOW - HOUR - 1, 0), NOW)).toEqual(onAir('b', NOW - 1, 0))
    // Given as it was before a ended, a goes on air again, from its start.
    expect(onAirAfterChange(rotation('abc'), rotation('abc'), onAir('a', NOW - HOUR - 1, 0), NOW)).toEqual(onAir('a', NOW, 0))
  })

  it('goes off air when nothing can be played, to come back at the first set, and comes back with it when off air', () => {
    expect(onAirAfterChange(rotation('abc'), rotation('ac', 'ac'), onAir('b', NOW - HOUR / 2, 1), NOW)).toBeNull()
    expect(onAirAfterChange([], [], null, NOW)).toBeNull()
    expect(onAirAfterChange([], rotation('xy', 'x'), null, NOW)).toEqual(onAir('y', NOW, 1))
    const off: Saved = { setId: 'b', trackId: 'tb', startedAt: null, position: 1 }
    expect(onAirAfterChange(rotation('abc', 'abc'), rotation('cda'), off, NOW)).toEqual(onAir('c', NOW, 0))
  })

  it('puts on air, once the tracks are read, a set before the first that could be played, which can be played now', () => {
    // x was added first, unread: b went on, and x goes on air once it's read.
    const saved = onAirAfterChange(rotation('abc'), rotation('xbc', 'x'), onAir('b', NOW - HOUR / 2, 1), NOW)
    expect(saved).toEqual(onAir('b', NOW - HOUR / 2, 1))
    const changed = rotation('xbc', 'x')
    expect(onAirAfterReads(changed, rotation('xbc'), saved, NOW + 1000)).toEqual(onAir('x', NOW + 1000, 0))
    // Still unread, or read and skipped: b goes on.
    expect(onAirAfterReads(changed, rotation('xbc', 'x'), saved, NOW + 1000)).toEqual(saved)
    // The radio goes on as it does anyway when b ends meanwhile, or is skipped once read again.
    expect(onAirAfterReads(changed, rotation('xbc', 'x'), saved, NOW + HOUR)).toEqual(onAir('c', NOW + HOUR / 2, 2))
    expect(onAirAfterReads(changed, rotation('xbc', 'xb'), saved, NOW + 1000)).toEqual(onAir('c', NOW + 1000, 2))
    // Off air until x is read.
    expect(onAirAfterReads(rotation('x', 'x'), rotation('x'), null, NOW + 1000)).toEqual(onAir('x', NOW + 1000, 0))
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

  it('does not change when the rotation is given back as it is given, from the play head', () => {
    fc.assert(
      fc.property(rotations, saveds, later, (entries, sent, elapsed) => {
        const now = NOW + elapsed
        const current = onAirAt(entries, toSaved(sent), now)
        const given = fromHead(entries, current).map((entry, position) => ({ ...entry, position }))
        const changed = onAirAfterChange(entries, given, toSaved(sent), now)
        const observed = (saved: Saved | null) => (saved?.startedAt == null ? null : { setId: saved.setId, trackId: saved.trackId, startedAt: saved.startedAt })
        expect(observed(changed)).toEqual(observed(current))
        expect(fromHead(given, changed).map((entry) => entry.setId)).toEqual(given.map((entry) => entry.setId))
      }),
    )
  })

  it('puts the first set that is not skipped on air, where it is if it is the set on air, or else from now', () => {
    fc.assert(
      fc.property(rotations, rotations, saveds, later, (before, after, sent, elapsed) => {
        const now = NOW + elapsed
        const current = onAirAt(before, toSaved(sent), now)
        const result = onAirAfterChange(before, after, toSaved(sent), now)
        const head = after.find((entry) => entry.skipped.length === 0)
        if (!head) {
          // Off air, from the first set.
          expect(result).toBeNull()
          return
        }
        expect(result).toMatchObject({ setId: head.setId, trackId: head.trackId, position: head.position })
        const goesOn = current?.startedAt != null && current.setId === head.setId && current.trackId === head.trackId
        expect(result!.startedAt).toBe(goesOn ? current.startedAt : now)
      }),
    )
  })

  it('puts the first set that can be played on air, once the tracks that were unread when it was changed are read', () => {
    fc.assert(
      fc.property(rotations, rotations, fc.array(fc.boolean()), saveds, later, (before, sets, unread, sent, elapsed) => {
        const now = NOW + elapsed
        // A track lasts as long whichever rotation it's in.
        const lengths = new Map(before.map((entry) => [entry.setId, entry.durationMs]))
        const read = sets.map((entry) => ({ ...entry, durationMs: lengths.get(entry.setId) ?? entry.durationMs }))
        // Some of the sets, unread when the rotation was changed, can be played once they're read.
        const changedTo = read.map((entry, i): Entry => (unread[i] ? { ...entry, skipped: [...entry.skipped, 'unread'] } : entry))
        const changed = onAirAfterChange(before, changedTo, toSaved(sent), now)
        const result = onAirAfterReads(changedTo, read, changed, now)
        expect(result?.startedAt == null ? null : result.setId).toBe(read.find((entry) => entry.skipped.length === 0)?.setId ?? null)
      }),
    )
  })

  it('gives the rotation around from its play head, which is the set on air when there is one', () => {
    fc.assert(
      fc.property(rotations, saveds, later, (entries, sent, elapsed) => {
        const current = onAirAt(entries, toSaved(sent), NOW + elapsed)
        const ids = entries.map((entry) => entry.setId)
        const given = fromHead(entries, current).map((entry) => entry.setId)
        const at = Math.max(ids.indexOf(given[0]), 0)
        expect(given).toEqual([...ids.slice(at), ...ids.slice(0, at)])
        if (current?.startedAt != null) expect(given[0]).toBe(current.setId)
      }),
    )
  })
})
