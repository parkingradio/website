import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { STATUSES } from '../sessions/fields.js'
import type { Status } from '../sessions/fields.js'
import { conflicts, thingOrder } from './conflicts.js'
import type { CalendarSession, EventThing, Thing } from './conflicts.js'

// The calendar's conflicts (see "Conflicts" in docs/design/server/calendar.md).

// Times as hours after a base instant, so that ties and things that touch are easy to write.
const BASE = Date.parse('2026-11-23T05:00:00Z')
const HOUR = 60 * 60 * 1000
const at = (hours: number) => new Date(BASE + hours * HOUR)
const hoursOf = (date: Date) => (date.getTime() - BASE) / HOUR

const FEEDS = ['team', 'other-team', 'stays']
const WINDOW = { from: at(0), to: at(100) }
const ORDER = thingOrder(FEEDS)

function session(id: string, start: number | null, end: number, status: Status = 'planned'): CalendarSession {
  return { id, title: `Session ${id}`, start: start === null ? null : at(start), end: start === null ? null : at(end), status }
}

function occupation(start: number, end: number, title = 'Réparation', feed = 'team', wholeDay = false): EventThing {
  return { kind: 'occupation', feed, start: at(start), end: at(end), wholeDay, title }
}

function quietTime(start: number, end: number, feed = 'stays', wholeDay = false): EventThing {
  return { kind: 'quiet-time', feed, start: at(start), end: at(end), wholeDay, title: null }
}

// A thing, briefly: its kind, then its session's id, or its feed and title.
const named = (thing: Thing) => (thing.kind === 'session' ? `session ${thing.id}` : `${thing.kind} ${thing.feed}${thing.title ? ` ${thing.title}` : ''}`)

// The conflicts, briefly: when the things overlap, in hours, and the things.
function found(sessions: CalendarSession[], events: EventThing[], window = WINDOW) {
  return conflicts(sessions, events, window, ORDER).map(({ start, end, things }) => [hoursOf(start), hoursOf(end), ...things.map(named)])
}

describe('conflicts', () => {
  it('are any two things that overlap, whatever they are', () => {
    expect(found([session('a', 1, 3)], [occupation(2, 4)])).toEqual([[2, 3, 'session a', 'occupation team Réparation']])
    expect(found([session('a', 1, 3)], [quietTime(0, 2)])).toEqual([[1, 2, 'quiet-time stays', 'session a']])
    expect(found([], [occupation(1, 3), quietTime(2, 5)])).toEqual([[2, 3, 'occupation team Réparation', 'quiet-time stays']])
    expect(found([], [occupation(1, 5, 'A'), occupation(2, 3, 'B')])).toEqual([[2, 3, 'occupation team A', 'occupation team B']])
    expect(found([], [quietTime(1, 5), quietTime(2, 6, 'other-team')])).toEqual([[2, 5, 'quiet-time stays', 'quiet-time other-team']])
    // The same event in two feeds.
    expect(found([], [occupation(1, 2, 'Atelier', 'other-team'), occupation(1, 2, 'Atelier')])).toEqual([[1, 2, 'occupation team Atelier', 'occupation other-team Atelier']])
  })

  it("don't count things that only touch", () => {
    expect(found([session('a', 1, 3), session('b', 5, 6)], [occupation(3, 5)])).toEqual([])
  })

  it("don't count cancelled sessions, nor those without a start, but count done ones", () => {
    const things = [occupation(0, 10)]
    expect(found([session('a', 1, 2, 'cancelled'), session('b', null, 1)], things)).toEqual([])
    expect(found([session('a', 1, 2, 'done')], things)).toEqual([[1, 2, 'occupation team Réparation', 'session a']])
  })

  it('give one conflict per pair of things, even of things that are alike', () => {
    expect(found([], [occupation(1, 2), occupation(1, 2)])).toEqual([[1, 2, 'occupation team Réparation', 'occupation team Réparation']])
    expect(found([session('a', 1, 2)], [occupation(0, 3), quietTime(1, 4)])).toEqual([
      [1, 2, 'occupation team Réparation', 'session a'],
      [1, 2, 'session a', 'quiet-time stays'],
      [1, 3, 'occupation team Réparation', 'quiet-time stays'],
    ])
  })

  it('are those whose overlap takes some of the window, given whole', () => {
    const window = { from: at(10), to: at(20) }
    // Started before the window, and still overlapping in it.
    expect(found([session('a', 5, 12)], [occupation(0, 30)], window)).toEqual([[5, 12, 'occupation team Réparation', 'session a']])
    // Overlapped before it, while one of them is still going on in it.
    expect(found([session('a', 5, 10)], [occupation(0, 30)], window)).toEqual([])
    // Starts to overlap before its end, or at its end.
    expect(found([session('a', 19, 25)], [occupation(0, 30)], window)).toEqual([[19, 25, 'occupation team Réparation', 'session a']])
    expect(found([session('a', 20, 25)], [occupation(0, 30)], window)).toEqual([])
  })

  it('are in order of their start, end, then things, which are in order of start, end, kind, then id, or feed, title and whole day', () => {
    const events = [
      quietTime(0, 10),
      occupation(0, 10, 'B', 'other-team'),
      occupation(0, 10, 'B', 'team', true),
      occupation(0, 10, 'B'),
      occupation(0, 10, 'A'),
    ]
    expect(found([session('b', 0, 10), session('a', 0, 10)], events).slice(0, 6)).toEqual([
      [0, 10, 'session a', 'session b'],
      [0, 10, 'session a', 'occupation team A'],
      [0, 10, 'session a', 'occupation team B'],
      [0, 10, 'session a', 'occupation team B'],
      [0, 10, 'session a', 'occupation other-team B'],
      [0, 10, 'session a', 'quiet-time stays'],
    ])
    const [first, second] = conflicts([], [occupation(0, 10, 'B', 'team', true), occupation(0, 10, 'B')], WINDOW, ORDER)[0].things
    expect([first, second].map((thing) => (thing as EventThing).wholeDay)).toEqual([false, true])
    expect(found([], [occupation(2, 5, 'Late'), occupation(0, 10, 'Long'), occupation(1, 3, 'Early')])).toEqual([
      [1, 3, 'occupation team Long', 'occupation team Early'],
      [2, 3, 'occupation team Early', 'occupation team Late'],
      [2, 5, 'occupation team Long', 'occupation team Late'],
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
    const events = fc.array(
      fc.record({ feed: fc.constantFrom(...FEEDS), start: hours, length, title: fc.constantFrom('', 'A', 'B'), wholeDay: fc.boolean() }),
      { maxLength: 12 },
    )
    const window = fc.record({ from: hours, length: fc.integer({ min: 1, max: 12 }) })

    const toSession = ({ id, start, length, status }: { id: string; start: number | null; length: number; status: Status }) => session(id, start, (start ?? 0) + length, status)
    const toEvent = ({ feed, start, length, title, wholeDay }: { feed: string; start: number; length: number; title: string; wholeDay: boolean }): EventThing =>
      feed === 'stays' ? quietTime(start, start + length, feed, wholeDay) : occupation(start, start + length, title, feed, wholeDay)

    // The things, each with how it's named in the conflicts, on their own: a session by its id, and an event by its place.
    function key(thing: Thing, all: EventThing[]) {
      return thing.kind === 'session' ? `s:${thing.id}` : `e:${all.indexOf(thing)}`
    }

    // The conflicts, worked out pair by pair, on the grid's hours, as the design has them.
    function bruteForce(sent: CalendarSession[], all: EventThing[], from: number, to: number): string[] {
      const things = [
        ...sent.filter(({ start, status }) => start !== null && status !== 'cancelled').map((s) => ({ key: `s:${s.id}`, start: hoursOf(s.start!), end: hoursOf(s.end!) })),
        ...all.map((event, index) => ({ key: `e:${index}`, start: hoursOf(event.start), end: hoursOf(event.end) })),
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

    // The order of things, as the design has it, written out on its own.
    const KIND_ORDER = ['session', 'occupation', 'quiet-time']
    function rank(thing: Thing): (number | string)[] {
      const common = [thing.start.getTime(), thing.end.getTime(), KIND_ORDER.indexOf(thing.kind)]
      return thing.kind === 'session' ? [...common, thing.id] : [...common, FEEDS.indexOf(thing.feed), thing.title ?? '', thing.wholeDay ? 1 : 0]
    }
    function compareRanks(a: (number | string)[], b: (number | string)[]): number {
      for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
      return 0
    }

    it('are every pair of things whose overlap takes some of the window, each once, in order, whatever the order of the things', () => {
      fc.assert(
        fc.property(sessions, events, window, fc.infiniteStream(fc.nat()), (generatedSessions, generatedEvents, { from, length }, shuffle) => {
          const sent = generatedSessions.map(toSession)
          const all = generatedEvents.map(toEvent)
          const range = { from: at(from), to: at(from + length) }
          const result = conflicts(sent, all, range, ORDER)

          const pairs = result.map(({ start, end, things }) => `${hoursOf(start)}-${hoursOf(end)} ${things.map((thing) => key(thing, all)).sort().join(' ')}`)
          expect(pairs.sort()).toEqual(bruteForce(sent, all, from, from + length))

          const ranked = result.map(({ start, end, things }) => [start.getTime(), end.getTime(), ...rank(things[0]), '|', ...rank(things[1])])
          for (const { things } of result) expect(compareRanks(rank(things[0]), rank(things[1]))).toBeLessThanOrEqual(0)
          for (let i = 1; i < result.length; i++) {
            const order =
              result[i - 1].start.getTime() - result[i].start.getTime() ||
              result[i - 1].end.getTime() - result[i].end.getTime() ||
              compareRanks(rank(result[i - 1].things[0]), rank(result[i].things[0])) ||
              compareRanks(rank(result[i - 1].things[1]), rank(result[i].things[1]))
            expect(order, JSON.stringify(ranked)).toBeLessThanOrEqual(0)
          }

          // The same conflicts, whatever the order of the things.
          const shuffled = <T>(items: T[]) => {
            const copy = [...items]
            const picks = shuffle.take(copy.length)[Symbol.iterator]()
            for (let i = copy.length - 1; i > 0; i--) {
              const j = picks.next().value! % (i + 1)
              ;[copy[i], copy[j]] = [copy[j], copy[i]]
            }
            return copy
          }
          expect(conflicts(shuffled(sent), shuffled(all), range, ORDER)).toEqual(result)
        }),
        { numRuns: 2000 },
      )
    })
  })
})
