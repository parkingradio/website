import { describe, expect, it } from 'vitest'
import type { Session } from '../../../session-fields'
import { addMonths, calendarDays, daysOf, freeTime, fullTimes, gridDays, gridRange, partOfDay, readDay, readMonth, thingKey } from './model'
import type { Calendar, Conflict, ConflictThing } from './model'

// Québec's clocks go back on 2026-11-01, a 25-hour day, and forward on 2027-03-14, a 23-hour day.

const times = (start: string, end: string) => ({ start, end })

describe('the grid', () => {
  it('runs from the Sunday of the first week to the Saturday of the last', () => {
    // November 2026 starts on a Sunday, and ends on a Monday.
    const november = gridDays('2026-11')
    expect([november[0], november.at(-1), november.length]).toEqual(['2026-11-01', '2026-12-05', 35])
    // February 2026 starts on a Sunday, and has 4 weeks.
    expect(gridDays('2026-02')).toHaveLength(28)
    // August 2026 starts on a Saturday, and has 6 weeks.
    const august = gridDays('2026-08')
    expect([august[0], august.at(-1), august.length]).toEqual(['2026-07-26', '2026-09-05', 42])
  })

  it('asks the server only for the days it takes', () => {
    expect(gridRange('2026-11')).toEqual({ from: '2026-11-01', to: '2026-12-05' })
    // 2000-01-01 is a Saturday, and 2999-12-31 a Tuesday.
    expect(gridRange('2000-01')).toEqual({ from: '2000-01-01', to: '2000-02-05' })
    expect(gridRange('2999-12')).toEqual({ from: '2999-12-01', to: '2999-12-31' })
  })

  it('goes from month to month', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
  })
})

describe('the address', () => {
  it('takes the months and the days the server does', () => {
    expect(readMonth('2026-11')).toBe('2026-11')
    for (const month of [null, '2026-13', '2026-1', '1999-12', '3000-01', 'novembre']) expect(readMonth(month)).toBeNull()
    expect(readDay('2026-11-19')).toBe('2026-11-19')
    for (const day of [null, '2026-02-30', '2026-11-19T00:00', '1999-12-31', '3000-01-01']) expect(readDay(day)).toBeNull()
  })
})

describe("a thing's part of a day", () => {
  it('is its times within the day', () => {
    expect(partOfDay(times('2026-11-14T21:00:00-05:00', '2026-11-14T23:00:00-05:00'), '2026-11-14')).toBe('21 h – 23 h')
    // Up to 00:00, which doesn't take the next day.
    expect(partOfDay(times('2026-11-14T21:00:00-05:00', '2026-11-15T00:00:00-05:00'), '2026-11-14')).toBe('21 h – 0 h')
    expect(daysOf(times('2026-11-14T21:00:00-05:00', '2026-11-15T00:00:00-05:00'))).toEqual(['2026-11-14'])
    // Or only those within some days.
    const long = times('2026-11-13T18:00:00-05:00', '2026-11-15T02:00:00-05:00')
    expect(daysOf(long, ['2026-11-14', '2026-11-20'])).toEqual(['2026-11-14', '2026-11-15'])
    expect(daysOf(long, ['2026-11-16', '2026-11-20'])).toEqual([])
  })

  it('writes the end of a thing of less than a day that ends earlier the next day, then what it takes of that day', () => {
    const overnight = times('2026-11-14T21:00:00-05:00', '2026-11-15T01:00:00-05:00')
    expect(daysOf(overnight)).toEqual(['2026-11-14', '2026-11-15'])
    expect(partOfDay(overnight, '2026-11-14')).toBe('21 h – 1 h')
    expect(partOfDay(overnight, '2026-11-15')).toBe("jusqu'à 1 h")
  })

  it('writes where a longer thing starts and ends, and the days it takes whole', () => {
    const long = times('2026-11-13T18:00:00-05:00', '2026-11-15T02:00:00-05:00')
    expect(daysOf(long).map((day) => partOfDay(long, day))).toEqual(['dès 18 h', 'toute la journée', "jusqu'à 2 h"])
    // A thing that ends later the next day than it starts.
    const day = times('2026-11-14T21:00:00-05:00', '2026-11-15T22:00:00-05:00')
    expect(daysOf(day).map((d) => partOfDay(day, d))).toEqual(['dès 21 h', "jusqu'à 22 h"])
  })

  it('takes a whole day from 00:00 to 00:00, whole-day or not, on the days the clocks change too', () => {
    // A timed thing from 00:00 to 00:00, on a 25-hour day and a 23-hour one.
    expect(partOfDay(times('2026-11-01T00:00:00-04:00', '2026-11-02T00:00:00-05:00'), '2026-11-01')).toBe('toute la journée')
    expect(partOfDay(times('2027-03-14T00:00:00-05:00', '2027-03-15T00:00:00-04:00'), '2027-03-14')).toBe('toute la journée')
    // Three whole days, around the clocks going back.
    const days = times('2026-10-31T00:00:00-04:00', '2026-11-03T00:00:00-05:00')
    expect(daysOf(days).map((day) => partOfDay(days, day))).toEqual(['toute la journée', 'toute la journée', 'toute la journée'])
    // From 00:00 over several days, and to 00:00.
    const fromMidnight = times('2027-03-14T00:00:00-05:00', '2027-03-15T10:00:00-04:00')
    expect(daysOf(fromMidnight).map((day) => partOfDay(fromMidnight, day))).toEqual(['toute la journée', "jusqu'à 10 h"])
    const toMidnight = times('2027-03-13T10:00:00-05:00', '2027-03-15T00:00:00-04:00')
    expect(daysOf(toMidnight).map((day) => partOfDay(toMidnight, day))).toEqual(['dès 10 h', 'toute la journée'])
  })

  it('counts the hours of the days the clocks change', () => {
    // 1:30 happens twice on 2026-11-01: from 23 h to the second 1 h 30 is less than a day, but ends later than it starts.
    expect(partOfDay(times('2026-10-31T23:00:00-04:00', '2026-11-01T01:30:00-05:00'), '2026-10-31')).toBe('23 h – 1 h 30')
    // On 2027-03-14, 3 h comes right after 1 h 59.
    expect(partOfDay(times('2027-03-14T01:00:00-05:00', '2027-03-14T04:00:00-04:00'), '2027-03-14')).toBe('1 h – 4 h')
  })
})

describe("a thing's times in full", () => {
  it('are short on the day it starts, as sessions are', () => {
    expect(fullTimes(times('2026-11-14T21:00:00-05:00', '2026-11-14T23:00:00-05:00'), '2026-11-14')).toBe('21 h – 23 h')
    expect(fullTimes(times('2026-11-14T21:00:00-05:00', '2026-11-15T01:00:00-05:00'), '2026-11-14')).toBe('21 h – 1 h')
    expect(fullTimes(times('2026-11-13T18:00:00-05:00', '2026-11-15T02:00:00-05:00'), '2026-11-13')).toBe('18 h – dim. 15 nov., 2 h')
  })

  it('say the day it starts on, on a later day', () => {
    expect(fullTimes(times('2026-11-14T21:00:00-05:00', '2026-11-15T01:00:00-05:00'), '2026-11-15')).toBe('sam. 14 nov., 21 h – 1 h')
    expect(fullTimes(times('2026-11-13T18:00:00-05:00', '2026-11-15T02:00:00-05:00'), '2026-11-14')).toBe('ven. 13 nov., 18 h – dim. 15 nov., 2 h')
  })

  it('give whole days from the first to the last, whole-day or not, on the days the clocks change too', () => {
    expect(fullTimes(times('2026-11-01T00:00:00-04:00', '2026-11-02T00:00:00-05:00'), '2026-11-01')).toBe('toute la journée')
    expect(fullTimes(times('2027-03-14T00:00:00-05:00', '2027-03-15T00:00:00-04:00'), '2027-03-14')).toBe('toute la journée')
    const days = times('2026-10-30T00:00:00-04:00', '2026-11-02T00:00:00-05:00')
    expect(fullTimes(days, '2026-10-30')).toBe('du ven. 30 oct. au dim. 1 nov.')
    expect(fullTimes(days, '2026-11-01')).toBe('du ven. 30 oct. au dim. 1 nov.')
    expect(fullTimes(times('2027-03-13T00:00:00-05:00', '2027-03-15T00:00:00-04:00'), '2027-03-14')).toBe('du sam. 13 mars au dim. 14 mars')
  })
})

describe('free time', () => {
  it("is the day's time outside what takes it", () => {
    expect(freeTime('2026-11-20', [])).toEqual(['toute la journée'])
    // A stay that ends at 11 h, and another that starts at 15 h.
    const stays = [times('2026-11-18T15:00:00-05:00', '2026-11-20T11:00:00-05:00'), times('2026-11-20T15:00:00-05:00', '2026-11-22T11:00:00-05:00')]
    expect(freeTime('2026-11-20', stays)).toEqual(['11 h – 15 h'])
    expect(freeTime('2026-11-20', stays.slice(0, 1))).toEqual(['dès 11 h'])
    expect(freeTime('2026-11-20', stays.slice(1))).toEqual(["jusqu'à 15 h"])
    expect(freeTime('2026-11-19', stays)).toEqual([])
  })

  it('is measured on the days the clocks change', () => {
    expect(freeTime('2026-11-01', [times('2026-11-01T11:00:00-05:00', '2026-11-02T00:00:00-05:00')])).toEqual(["jusqu'à 11 h"])
    expect(freeTime('2027-03-14', [times('2027-03-14T00:00:00-05:00', '2027-03-14T11:00:00-04:00')])).toEqual(['dès 11 h'])
    expect(freeTime('2027-03-14', [times('2027-03-14T00:00:00-05:00', '2027-03-15T00:00:00-04:00')])).toEqual([])
  })
})

describe('things', () => {
  it('are told apart as the server does', () => {
    const occupation = { kind: 'occupation', feed: 'f', start: '2026-11-14T21:00:00-05:00', end: '2026-11-14T23:00:00-05:00', wholeDay: false, title: 'A' } as const
    // The same instants, written otherwise.
    expect(thingKey({ ...occupation, start: '2026-11-15T02:00:00Z' })).toBe(thingKey(occupation))
    for (const other of [{ title: 'B' }, { feed: 'g' }, { wholeDay: true }, { end: '2026-11-14T23:30:00-05:00' }]) {
      expect(thingKey({ ...occupation, ...other })).not.toBe(thingKey(occupation))
    }
    expect(thingKey({ kind: 'quiet-time', feed: 'f', start: occupation.start, end: occupation.end, wholeDay: false })).not.toBe(thingKey({ ...occupation, title: '' }))
    const session = { kind: 'session', id: 's', title: 'X', start: occupation.start, end: occupation.end, status: 'planned' } as const
    expect(thingKey({ ...({ id: 's' } as Session), kind: 'session', start: occupation.start, end: occupation.end })).toBe(thingKey(session))
  })
})

// A session of the calendar, with what the page shows of it.
function session(id: string, start: string, end: string, status: Session['status'] = 'planned'): Session {
  return { id, title: id.toUpperCase(), start, end, status, sets: [] } as unknown as Session
}

function calendar(fields: Partial<Calendar>): Calendar {
  return { ok: true, today: '2026-11-19', feeds: [], sessions: [], occupations: [], quietTimes: [], conflicts: [], undatedSessions: [], ...fields }
}

describe('the days of the month', () => {
  const stay = { feed: 'q', start: '2026-11-20T15:00:00-05:00', end: '2026-11-22T11:00:00-05:00', wholeDay: false }
  const late = session('late', '2026-11-21T21:00:00-05:00', '2026-11-22T01:00:00-05:00')
  const repair = { feed: 'o', start: '2026-11-25T00:00:00-05:00', end: '2026-11-28T00:00:00-05:00', wholeDay: true, title: 'RÉPARATION' }
  const conflict: Conflict = {
    start: late.start!,
    end: stay.end,
    things: [{ kind: 'quiet-time', ...stay }, { kind: 'session', id: 'late', title: 'LATE', start: late.start!, end: late.end!, status: 'planned' }] as ConflictThing[],
  }
  const days = calendarDays(calendar({ sessions: [late], occupations: [repair], quietTimes: [stay], conflicts: [conflict] }), '2026-11', '2026-11-19')

  it('have what takes them, quiet time first', () => {
    expect(days.get('2026-11-21')!.things.map(({ thing, part }) => [thing.kind, part])).toEqual([
      ['quiet-time', 'toute la journée'],
      ['session', '21 h – 1 h'],
    ])
    expect(days.get('2026-11-26')!.things.map(({ part }) => part)).toEqual(['toute la journée'])
  })

  it('say "conflit" only on the days the overlap takes', () => {
    const conflicts = (day: string) => days.get(day)!.things.map(({ conflictsWith }) => conflictsWith.map((other) => other.kind))
    expect(conflicts('2026-11-20')).toEqual([[]])
    expect(conflicts('2026-11-21')).toEqual([['session'], ['quiet-time']])
    expect(conflicts('2026-11-22')).toEqual([['session'], ['quiet-time']])
  })

  it('have free time from today on, in the month, where nothing but quiet time starts', () => {
    const free = (day: string) => days.get(day)!.free
    // Before today, and in another month.
    expect(free('2026-11-18')).toEqual([])
    expect(free('2026-12-01')).toEqual([])
    expect(free('2026-11-19')).toEqual(['toute la journée'])
    // Quiet time starts at 15 h.
    expect(free('2026-11-20')).toEqual(["jusqu'à 15 h"])
    // A session starts.
    expect(free('2026-11-21')).toEqual([])
    // The session's tail, and the stay, end.
    expect(free('2026-11-22')).toEqual(['dès 11 h'])
    // A whole-day occupation, which starts on the 25th and takes the 26th whole.
    expect(free('2026-11-25')).toEqual([])
    expect(free('2026-11-26')).toEqual([])
  })

  it("don't count cancelled sessions", () => {
    const cancelled = session('off', '2026-11-23T20:00:00-05:00', '2026-11-23T23:00:00-05:00', 'cancelled')
    const shown = calendarDays(calendar({ sessions: [cancelled] }), '2026-11', '2026-11-19')
    expect(shown.get('2026-11-23')!.free).toEqual(['toute la journée'])
    expect(shown.get('2026-11-23')!.things).toHaveLength(1)
  })

  it('have free time only in the 365 days from today', () => {
    expect(calendarDays(calendar({}), '2027-11', '2026-11-19').get('2027-11-18')!.free).toEqual(['toute la journée'])
    expect(calendarDays(calendar({}), '2027-11', '2026-11-19').get('2027-11-19')!.free).toEqual([])
  })
})
