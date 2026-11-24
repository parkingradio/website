import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { STATUSES } from '../sessions/fields.js'
import type { Status } from '../sessions/fields.js'
import { conflicts } from './conflicts.js'
import type { CalendarSession, OccupationThing, Thing } from './conflicts.js'

// The calendar's conflicts (see "Conflicts" in docs/design/server/calendar.md).

// Times as hours after a base instant, so that ties and things that touch are easy to write.
const BASE = Date.parse('2026-11-23T05:00:00Z')
const HOUR = 60 * 60 * 1000
const at = (hours: number) => new Date(BASE + hours * HOUR)
const hoursOf = (date: Date) => (date.getTime() - BASE) / HOUR

const FEEDS = ['team', 'other-team', 'stays']
const WINDOW = { from: at(0), to: at(100) }

function session(id: string, start: number | null, end: number, status: Status = 'planned'): CalendarSession {
  return { id, title: `Session ${id}`, start: start === null ? null : at(start), end: start === null ? null : at(end), status }
}

function occupation(start: number, end: number, title = 'Réparation', feedId = 'team', wholeDay = false): OccupationThing {
  return { kind: 'occupation', feedId, start: at(start), end: at(end), wholeDay, title }
}

// A guest's stay, titled by the platform it was booked on.
const stay = (start: number, end: number, feedId = 'stays') => occupation(start, end, 'Airbnb', feedId)

// A thing, briefly: its session's id, or its feed and title.
const named = (thing: Thing) => (thing.kind === 'session' ? `session ${thing.id}` : `${thing.feedId}${thing.title ? ` ${thing.title}` : ''}`)

// The conflicts, briefly: when the things overlap, in hours, and the things.
function found(sessions: CalendarSession[], occupations: OccupationThing[], window = WINDOW) {
  return conflicts(sessions, occupations, window).map(({ start, end, things }) => [hoursOf(start), hoursOf(end), ...things.map(named)])
}

describe('conflicts', () => {
  it('are any two things that overlap, whatever they are', () => {
    expect(found([session('a', 1, 3)], [occupation(2, 4)])).toEqual([[2, 3, 'session a', 'team Réparation']])
    expect(found([session('a', 1, 3)], [stay(0, 2)])).toEqual([[1, 2, 'stays Airbnb', 'session a']])
    // Two occupations, of different feeds, or of the same one.
    expect(found([], [occupation(1, 3), stay(2, 5)])).toEqual([[2, 3, 'team Réparation', 'stays Airbnb']])
    expect(found([], [occupation(1, 5, 'A'), occupation(2, 3, 'B')])).toEqual([[2, 3, 'team A', 'team B']])
    expect(found([], [stay(1, 5), stay(2, 6, 'other-team')])).toEqual([[2, 5, 'stays Airbnb', 'other-team Airbnb']])
    // The same event in two feeds.
    expect(found([], [occupation(1, 2, 'Atelier'), occupation(1, 2, 'Atelier', 'other-team')])).toEqual([[1, 2, 'team Atelier', 'other-team Atelier']])
  })

  it("don't count things that only touch", () => {
    expect(found([session('a', 1, 3), session('b', 5, 6)], [occupation(3, 5)])).toEqual([])
  })

  it("don't count cancelled sessions, nor those without a start, but count done ones", () => {
    const things = [occupation(0, 10)]
    expect(found([session('a', 1, 2, 'cancelled'), session('b', null, 1)], things)).toEqual([])
    expect(found([session('a', 1, 2, 'done')], things)).toEqual([[1, 2, 'team Réparation', 'session a']])
  })

  it('give one conflict per pair of things, even of things that are the same', () => {
    // E.g. two guests' stays with the same dates, booked on the same platform.
    const [first, second] = [stay(1, 2), stay(1, 2)]
    expect(conflicts([], [first, second], WINDOW)).toEqual([{ start: at(1), end: at(2), things: [first, second] }])
    expect(found([session('a', 1, 2)], [occupation(0, 3), stay(1, 4)])).toEqual([
      [1, 2, 'team Réparation', 'session a'],
      [1, 2, 'session a', 'stays Airbnb'],
      [1, 3, 'team Réparation', 'stays Airbnb'],
    ])
  })

  it('are those whose overlap takes some of the window, given whole', () => {
    const window = { from: at(10), to: at(20) }
    // Started before the window, and still overlapping in it.
    expect(found([session('a', 5, 12)], [occupation(0, 30)], window)).toEqual([[5, 12, 'team Réparation', 'session a']])
    // Overlapped before it, while one of them is still going on in it.
    expect(found([session('a', 5, 10)], [occupation(0, 30)], window)).toEqual([])
    // Starts to overlap before its end, or at its end.
    expect(found([session('a', 19, 25)], [occupation(0, 30)], window)).toEqual([[19, 25, 'team Réparation', 'session a']])
    expect(found([session('a', 20, 25)], [occupation(0, 30)], window)).toEqual([])
  })

  it('are in order of their start, then end, and their things too, sessions first when tied, then by id', () => {
    // Tied occupations keep the order they're given in.
    const occupations = [occupation(0, 10, 'B', 'other-team'), occupation(0, 10, 'A'), stay(0, 10)]
    expect(found([session('b', 0, 10), session('a', 0, 10)], occupations).slice(0, 4)).toEqual([
      [0, 10, 'session a', 'session b'],
      [0, 10, 'session a', 'other-team B'],
      [0, 10, 'session a', 'team A'],
      [0, 10, 'session a', 'stays Airbnb'],
    ])
    expect(found([], [occupation(2, 5, 'Late'), occupation(0, 10, 'Long'), occupation(1, 3, 'Early')])).toEqual([
      [1, 3, 'team Long', 'team Early'],
      [2, 3, 'team Early', 'team Late'],
      [2, 5, 'team Long', 'team Late'],
    ])
  })

  describe('as a property', () => {
    // Things on a small grid of hours, so that ties and things that touch are frequent, some of them outside the window,
    // and sessions that are cancelled, or without a start.
    const hours = fc.integer({ min: 0, max: 24 })
    const length = fc.integer({ min: 0, max: 6 })
    const sessions = fc.uniqueArray(
      fc.record({ id: fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f'), start: fc.option(hours), length: length.filter((n) => n > 0), status: fc.constantFrom(...STATUSES) }),
      { selector: ({ id }) => id, maxLength: 6 },
    )
    const occupations = fc.array(
      fc.record({ feedId: fc.constantFrom(...FEEDS), start: hours, length, title: fc.constantFrom('', 'A', 'B'), wholeDay: fc.boolean() }),
      { maxLength: 12 },
    )
    const window = fc.record({ from: hours, length: fc.integer({ min: 1, max: 12 }) })

    const toSession = ({ id, start, length, status }: { id: string; start: number | null; length: number; status: Status }) => session(id, start, (start ?? 0) + length, status)
    const toOccupation = ({ feedId, start, length, title, wholeDay }: { feedId: string; start: number; length: number; title: string; wholeDay: boolean }) =>
      occupation(start, start + length, title, feedId, wholeDay)

    // The things, each with how it's named in the conflicts, on their own: a session by its id, and an occupation by its
    // place.
    function key(thing: Thing, all: OccupationThing[]) {
      return thing.kind === 'session' ? `s:${thing.id}` : `o:${all.indexOf(thing)}`
    }

    // The conflicts, worked out pair by pair, on the grid's hours, as the design has them.
    function bruteForce(sent: CalendarSession[], all: OccupationThing[], from: number, to: number): string[] {
      const things = [
        ...sent.filter(({ start, status }) => start !== null && status !== 'cancelled').map((s) => ({ key: `s:${s.id}`, start: hoursOf(s.start!), end: hoursOf(s.end!) })),
        ...all.map((thing, index) => ({ key: `o:${index}`, start: hoursOf(thing.start), end: hoursOf(thing.end) })),
      ]
      const pairs: string[] = []
      for (let i = 0; i < things.length; i++) {
        for (let j = i + 1; j < things.length; j++) {
          const overlapStart = Math.max(things[i].start, things[j].start)
          const overlapEnd = Math.min(things[i].end, things[j].end)
          if (overlapStart < overlapEnd && overlapStart < to && overlapEnd > from) {
            pairs.push(`${overlapStart}-${overlapEnd} ${[things[i].key, things[j].key].sort().join(' ')}`)
          }
        }
      }
      return pairs.sort()
    }

    // The order of things, written out on its own: by start, then end, sessions first, by id, and occupations as given.
    function rank(thing: Thing, all: OccupationThing[]): (number | string)[] {
      const common = [thing.start.getTime(), thing.end.getTime()]
      return thing.kind === 'session' ? [...common, 0, thing.id] : [...common, 1, all.indexOf(thing)]
    }
    function compareRanks(a: (number | string)[], b: (number | string)[]): number {
      for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
      return 0
    }

    it('are every pair of things whose overlap takes some of the window, each once, in order, whatever the order of the sessions', () => {
      fc.assert(
        fc.property(sessions, occupations, window, fc.infiniteStream(fc.nat()), (generatedSessions, generatedOccupations, { from, length }, shuffle) => {
          const sent = generatedSessions.map(toSession)
          const all = generatedOccupations.map(toOccupation)
          const range = { from: at(from), to: at(from + length) }
          const result = conflicts(sent, all, range)
          const rankOf = (thing: Thing) => rank(thing, all)

          const pairs = result.map(({ start, end, things }) => `${hoursOf(start)}-${hoursOf(end)} ${things.map((thing) => key(thing, all)).sort().join(' ')}`)
          expect(pairs.sort()).toEqual(bruteForce(sent, all, from, from + length))

          const ranked = result.map(({ start, end, things }) => [start.getTime(), end.getTime(), ...rankOf(things[0]), '|', ...rankOf(things[1])])
          for (const { things } of result) expect(compareRanks(rankOf(things[0]), rankOf(things[1]))).toBeLessThan(0)
          for (let i = 1; i < result.length; i++) {
            const order =
              result[i - 1].start.getTime() - result[i].start.getTime() ||
              result[i - 1].end.getTime() - result[i].end.getTime() ||
              compareRanks(rankOf(result[i - 1].things[0]), rankOf(result[i].things[0])) ||
              compareRanks(rankOf(result[i - 1].things[1]), rankOf(result[i].things[1]))
            expect(order, JSON.stringify(ranked)).toBeLessThan(0)
          }

          // The same conflicts, whatever the order of the sessions, which the store gives in any order.
          const shuffled = <T>(items: T[]) => {
            const copy = [...items]
            const picks = shuffle.take(copy.length)[Symbol.iterator]()
            for (let i = copy.length - 1; i > 0; i--) {
              const j = picks.next().value! % (i + 1)
              ;[copy[i], copy[j]] = [copy[j], copy[i]]
            }
            return copy
          }
          expect(conflicts(shuffled(sent), all, range)).toEqual(result)
        }),
        { numRuns: 2000 },
      )
    })
  })
})
