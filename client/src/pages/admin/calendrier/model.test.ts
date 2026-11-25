import { describe, expect, it } from 'vitest'
import type { Session } from '../../../session-fields'
import { spaced } from '../../../test-utils'
import { addMonths, calendarDays, daysOf, freeTime, isFree, gridDays, gridRange, inSentence, listRange, listedMonths, nameOf, namedThing, readDay, readMonth, thingKey, thingsWithConflicts } from './model'
import * as model from './model'
import type { Calendar, CalendarDay, Conflict, ConflictThing, DayThing, Feed } from './model'

// Québec's clocks go back on 2026-11-01, a 25-hour day, and forward on 2027-03-14, a 23-hour day.

const times = (start: string, end: string) => ({ start, end })
// What the page writes, with its non-breaking spaces as spaces (see describe.test.ts for where they are).
const partOfDay = (...args: Parameters<typeof model.partOfDay>) => spaced(model.partOfDay(...args))
const fullTimes = (...args: Parameters<typeof model.fullTimes>) => spaced(model.fullTimes(...args))
const briefTimes = (...args: Parameters<typeof model.briefTimes>) => spaced(model.briefTimes(...args))
const startDay = (...args: Parameters<typeof model.startDay>) => spaced(model.startDay(...args))
// The parts of the day of `day`'s free time, the time `holds` protect outside `busy`.
const parts = (day: string, holds: { start: string; end: string }[], busy: { start: string; end: string }[] = []) => freeTime(day, holds, busy).map(({ part }) => spaced(part))
// What takes a day, and the parts of the day of its free time.
const thingsOn = (entries: CalendarDay) => entries.filter((entry): entry is DayThing => !isFree(entry))
const freeOf = (entries: CalendarDay) => entries.filter(isFree).map(({ part }) => spaced(part))

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
    expect(gridRange(gridDays('2026-11'))).toEqual({ from: '2026-11-01', to: '2026-12-05' })
    // 2000-01-01 is a Saturday, and 2999-12-31 a Tuesday.
    expect(gridRange(gridDays('2000-01'))).toEqual({ from: '2000-01-01', to: '2000-02-05' })
    expect(gridRange(gridDays('2999-12'))).toEqual({ from: '2999-12-01', to: '2999-12-31' })
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

  it('writes the end of a thing of 12 hours or less that ends the next day, then what it takes of that day', () => {
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
    // Or earlier, more than 12 hours after it starts.
    const stay = times('2026-11-14T15:00:00-05:00', '2026-11-15T11:00:00-05:00')
    expect(daysOf(stay).map((d) => partOfDay(stay, d))).toEqual(['dès 15 h', "jusqu'à 11 h"])
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

describe("a conflict's things", () => {
  it('are named by their names alone', () => {
    expect(nameOf({ kind: 'session', id: 's', title: 'GUEST MIXES', status: 'planned' })).toBe('GUEST MIXES')
    expect(nameOf({ kind: 'occupation', title: 'RÉPARATION', calendar: 'Équipe' })).toBe('RÉPARATION')
    expect(nameOf({ kind: 'occupation', title: null, calendar: 'Séjours' })).toBe('Séjours')
  })
})

describe("a thing's times in full", () => {
  it('are short on the day it starts, as sessions are', () => {
    expect(fullTimes(times('2026-11-14T21:00:00-05:00', '2026-11-14T23:00:00-05:00'), '2026-11-14')).toBe('21 h – 23 h')
    expect(fullTimes(times('2026-11-14T21:00:00-05:00', '2026-11-15T01:00:00-05:00'), '2026-11-14')).toBe('21 h – 1 h')
    expect(fullTimes(times('2026-11-13T18:00:00-05:00', '2026-11-15T02:00:00-05:00'), '2026-11-13')).toBe('18 h – dim. 15 nov., 2 h')
    expect(fullTimes(times('2026-11-14T15:00:00-05:00', '2026-11-15T11:00:00-05:00'), '2026-11-14')).toBe('15 h – dim. 15 nov., 11 h')
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

  it('from the start of its day, as the month writes it, when it starts at 00:00', () => {
    expect(fullTimes(times('2026-11-28T00:00:00-05:00', '2026-11-28T11:00:00-05:00'), '2026-11-28')).toBe("jusqu'à 11 h")
    expect(partOfDay(times('2026-11-28T00:00:00-05:00', '2026-11-28T11:00:00-05:00'), '2026-11-28')).toBe("jusqu'à 11 h")
    const stay = times('2026-11-28T00:00:00-05:00', '2026-11-30T11:00:00-05:00')
    expect(fullTimes(stay, '2026-11-28')).toBe("jusqu'au lun. 30 nov., 11 h")
    expect(fullTimes(stay, '2026-11-29')).toBe("du sam. 28 nov. jusqu'au lun. 30 nov., 11 h")
    expect(fullTimes(stay, '2026-11-30')).toBe("du sam. 28 nov. jusqu'au lun. 30 nov., 11 h")
  })
})

describe("a thing's times in brief", () => {
  it('are its times when they say when it ends: the same day, or the next day, at 00:00 or within 12 hours', () => {
    expect(briefTimes(times('2026-11-14T18:00:00-05:00', '2026-11-14T21:00:00-05:00'), '2026-11-14')).toBe('18 h – 21 h')
    expect(briefTimes(times('2026-11-14T21:30:00-05:00', '2026-11-15T01:00:00-05:00'), '2026-11-14')).toBe('21 h 30 – 1 h')
    expect(briefTimes(times('2026-11-14T21:00:00-05:00', '2026-11-15T00:00:00-05:00'), '2026-11-14')).toBe('21 h – 0 h')
    expect(briefTimes(times('2026-11-14T10:00:00-05:00', '2026-11-15T00:00:00-05:00'), '2026-11-14')).toBe('10 h – 0 h')
    // Over the night the clocks go back, a 25-hour day.
    expect(briefTimes(times('2026-10-31T22:00:00-04:00', '2026-11-01T02:00:00-05:00'), '2026-10-31')).toBe('22 h – 2 h')
  })

  it('are its start, then the last day it takes, when it ends on a later day, in another month or year too', () => {
    expect(briefTimes(times('2026-11-21T15:00:00-05:00', '2026-11-24T11:00:00-05:00'), '2026-11-21')).toBe('15 h → mar. 24')
    expect(briefTimes(times('2026-11-21T15:00:00-05:00', '2026-11-25T00:00:00-05:00'), '2026-11-21')).toBe('15 h → mar. 24')
    // The next day at a later time than it starts, or more than 12 hours after it starts.
    expect(briefTimes(times('2026-11-14T18:00:00-05:00', '2026-11-15T21:00:00-05:00'), '2026-11-14')).toBe('18 h → dim. 15')
    expect(briefTimes(times('2026-11-14T15:00:00-05:00', '2026-11-15T11:00:00-05:00'), '2026-11-14')).toBe('15 h → dim. 15')
    expect(briefTimes(times('2026-12-30T20:00:00-05:00', '2027-01-01T11:00:00-05:00'), '2026-12-30')).toBe('20 h → ven. 1')
    // With its month, four weeks or more after the day, when its weekday and number could be another day's.
    expect(briefTimes(times('2026-11-21T15:00:00-05:00', '2026-12-18T11:00:00-05:00'), '2026-11-21')).toBe('15 h → ven. 18')
    expect(briefTimes(times('2026-11-21T15:00:00-05:00', '2026-12-19T11:00:00-05:00'), '2026-11-21')).toBe('15 h → sam. 19 déc.')
    expect(briefTimes(times('2026-11-18T15:00:00-05:00', '2027-01-02T11:00:00-05:00'), '2026-11-19')).toBe('→ sam. 2 janv.')
  })

  it('take the day from its start, after an earlier day or from 00:00', () => {
    const stay = times('2026-11-21T15:00:00-05:00', '2026-11-24T11:00:00-05:00')
    expect(briefTimes(stay, '2026-11-23')).toBe('→ mar. 24')
    expect(briefTimes(stay, '2026-11-24')).toBe('→ 11 h')
    expect(briefTimes(times('2026-11-28T00:00:00-05:00', '2026-11-28T11:00:00-05:00'), '2026-11-28')).toBe('→ 11 h')
    expect(briefTimes(times('2026-11-28T00:00:00-05:00', '2026-11-30T11:00:00-05:00'), '2026-11-28')).toBe('→ lun. 30')
    // Over the end of the month.
    expect(briefTimes(times('2026-11-28T15:00:00-05:00', '2026-12-01T11:00:00-05:00'), '2026-11-29')).toBe('→ mar. 1')
  })

  it('are a whole day, or the last of several, on the days the clocks change too', () => {
    expect(briefTimes(times('2026-11-26T00:00:00-05:00', '2026-11-27T00:00:00-05:00'), '2026-11-26')).toBe('journée')
    expect(briefTimes(times('2026-11-01T00:00:00-04:00', '2026-11-02T00:00:00-05:00'), '2026-11-01')).toBe('journée')
    expect(briefTimes(times('2027-03-14T00:00:00-05:00', '2027-03-15T00:00:00-04:00'), '2027-03-14')).toBe('journée')
    const closed = times('2026-12-02T00:00:00-05:00', '2026-12-04T00:00:00-05:00')
    expect(briefTimes(closed, '2026-12-02')).toBe('→ jeu. 3')
    expect(briefTimes(closed, '2026-12-03')).toBe('journée')
    // Starting before the day, to its end.
    expect(briefTimes(times('2026-11-21T15:00:00-05:00', '2026-11-24T00:00:00-05:00'), '2026-11-23')).toBe('journée')
  })
})

describe('free time', () => {
  // Holds over the whole week of the 20th.
  const week = [times('2026-11-16T00:00:00-05:00', '2026-11-23T00:00:00-05:00')]

  it("is the day's protected time outside what takes it", () => {
    expect(parts('2026-11-20', week)).toEqual(['toute la journée'])
    // A stay that ends at 11 h, and another that starts at 15 h.
    const stays = [times('2026-11-18T15:00:00-05:00', '2026-11-20T11:00:00-05:00'), times('2026-11-20T15:00:00-05:00', '2026-11-22T11:00:00-05:00')]
    expect(parts('2026-11-20', week, stays)).toEqual(['11 h – 15 h'])
    expect(parts('2026-11-20', week, stays.slice(0, 1))).toEqual(['dès 11 h'])
    expect(parts('2026-11-20', week, stays.slice(1))).toEqual(["jusqu'à 15 h"])
    expect(parts('2026-11-19', week, stays)).toEqual([])
  })

  it("is none of the time that isn't protected, even when nothing takes it", () => {
    expect(parts('2026-11-20', [])).toEqual([])
    const afternoon = [times('2026-11-20T11:00:00-05:00', '2026-11-20T18:00:00-05:00')]
    expect(parts('2026-11-20', afternoon)).toEqual(['11 h – 18 h'])
    // A session within the hold, and an occupation that starts before it.
    const session = times('2026-11-20T13:00:00-05:00', '2026-11-20T15:00:00-05:00')
    expect(parts('2026-11-20', afternoon, [session])).toEqual(['11 h – 13 h', '15 h – 18 h'])
    expect(parts('2026-11-20', afternoon, [times('2026-11-20T09:00:00-05:00', '2026-11-20T12:00:00-05:00'), session])).toEqual(['12 h – 13 h', '15 h – 18 h'])
    expect(parts('2026-11-21', afternoon)).toEqual([])
  })

  it('counts the holds of every feed together, those that overlap or follow each other as one', () => {
    const [noon, afternoon, evening] = [times('2026-11-20T11:00:00-05:00', '2026-11-20T15:00:00-05:00'), times('2026-11-20T15:00:00-05:00', '2026-11-20T18:00:00-05:00'), times('2026-11-20T17:00:00-05:00', '2026-11-20T20:00:00-05:00')]
    expect(parts('2026-11-20', [evening, noon, afternoon])).toEqual(['11 h – 20 h'])
    // Within another.
    expect(parts('2026-11-20', [noon, times('2026-11-20T12:00:00-05:00', '2026-11-20T13:00:00-05:00')])).toEqual(['11 h – 15 h'])
    // Following each other at midnight, from two feeds, each day's from 00:00 to 00:00, and the whole day between.
    const holds = [times('2026-11-20T15:00:00-05:00', '2026-11-21T00:00:00-05:00'), times('2026-11-21T00:00:00-05:00', '2026-11-23T11:00:00-05:00')]
    expect(parts('2026-11-20', holds)).toEqual(['dès 15 h'])
    expect(parts('2026-11-22', holds)).toEqual(['toute la journée'])
    expect(parts('2026-11-23', holds)).toEqual(["jusqu'à 11 h"])
    // Over midnight.
    expect(parts('2026-11-21', [times('2026-11-20T20:00:00-05:00', '2026-11-21T02:00:00-05:00')])).toEqual(["jusqu'à 2 h"])
  })

  it('is measured on the days the clocks change', () => {
    const fall = [times('2026-11-01T00:00:00-04:00', '2026-11-02T00:00:00-05:00')]
    expect(parts('2026-11-01', fall)).toEqual(['toute la journée'])
    expect(parts('2026-11-01', fall, [times('2026-11-01T11:00:00-05:00', '2026-11-02T00:00:00-05:00')])).toEqual(["jusqu'à 11 h"])
    // A whole-day hold of 23 hours.
    const spring = [times('2027-03-14T00:00:00-05:00', '2027-03-15T00:00:00-04:00')]
    expect(parts('2027-03-14', spring)).toEqual(['toute la journée'])
    expect(parts('2027-03-14', spring, [times('2027-03-14T00:00:00-05:00', '2027-03-14T11:00:00-04:00')])).toEqual(['dès 11 h'])
    expect(parts('2027-03-14', spring, spring)).toEqual([])
  })
})

describe('things', () => {
  it('are told apart as the server does', () => {
    const occupation = { kind: 'occupation', feedId: 'f', start: '2026-11-14T21:00:00-05:00', end: '2026-11-14T23:00:00-05:00', wholeDay: false, title: 'A' } as const
    // The same instants, written otherwise.
    expect(thingKey({ ...occupation, start: '2026-11-15T02:00:00Z' })).toBe(thingKey(occupation))
    for (const other of [{ title: 'B' }, { feedId: 'g' }, { wholeDay: true }, { end: '2026-11-14T23:30:00-05:00' }]) {
      expect(thingKey({ ...occupation, ...other })).not.toBe(thingKey(occupation))
    }
    const session = { kind: 'session', id: 's', title: 'X', start: occupation.start, end: occupation.end, status: 'planned' } as const
    expect(thingKey({ ...session, title: 'Y' })).toBe(thingKey(session))
  })

  it("name an occupation by its title and its feed's name, or by its feed's name alone", () => {
    const feeds = [feed('f', 'Équipe'), feed('g', 'Séjours')]
    const occupation = { kind: 'occupation', feedId: 'f', start: '2026-11-14T21:00:00-05:00', end: '2026-11-14T23:00:00-05:00', wholeDay: false } as const
    expect(namedThing({ ...occupation, title: 'RÉPARATION' }, feeds)).toEqual({ kind: 'occupation', title: 'RÉPARATION', calendar: 'Équipe' })
    expect(namedThing({ ...occupation, feedId: 'g', title: '' }, feeds)).toEqual({ kind: 'occupation', title: null, calendar: 'Séjours' })
    expect(inSentence({ kind: 'occupation', title: 'RÉPARATION', calendar: 'Équipe' })).toBe("l'occupation RÉPARATION (Équipe)")
    expect(inSentence({ kind: 'occupation', title: null, calendar: 'Séjours' })).toBe("l'occupation Séjours")
    expect(inSentence({ kind: 'session', id: 's', title: 'HAUTE RIVE', status: 'planned' })).toBe('la session HAUTE RIVE')
  })
})

function feed(id: string, name: string, kind: Feed['kind'] = 'occupations'): Feed {
  return { id, name, kind, link: `https://example.com/${id}.ics`, createdBy: 'a@example.com', createdAt: '2026-11-01T12:00:00Z', updatedBy: null, updatedAt: null, readAt: null, error: null }
}

// A session of the calendar, with what the page shows of it.
function session(id: string, start: string, end: string, status: Session['status'] = 'planned'): Session {
  return { id, title: id.toUpperCase(), start, end, status, sets: [] } as unknown as Session
}

// A hold over the 365 days from the calendars' today, and beyond.
const ALWAYS = { feedId: 'h', start: '2026-10-01T00:00:00-04:00', end: '2028-01-01T00:00:00-05:00', wholeDay: true }

function calendar(fields: Partial<Calendar>): Calendar {
  const feeds = [feed('q', 'Séjours'), feed('o', 'Équipe'), feed('h', 'Loft', 'holds')]
  return { ok: true, today: '2026-11-19', feeds, sessions: [], occupations: [], holds: [ALWAYS], conflicts: [], unprotectedSessions: [], undatedSessions: [], ...fields }
}

const sessionThing = ({ id, title, start, end, status }: Session): ConflictThing => ({ kind: 'session', id, title, start: start!, end: end!, status })
// A session, as the server gives it among the sessions outside protected time.
const unprotected = ({ id, title, start, end }: Session) => ({ id, title, start: start!, end: end! })

describe('the days of the month', () => {
  // A stay, without a title, a session during it, and a repair over three whole days.
  const stay = { feedId: 'q', start: '2026-11-20T15:00:00-05:00', end: '2026-11-22T11:00:00-05:00', wholeDay: false, title: '' }
  const late = session('late', '2026-11-21T21:00:00-05:00', '2026-11-22T01:00:00-05:00')
  const repair = { feedId: 'o', start: '2026-11-25T00:00:00-05:00', end: '2026-11-28T00:00:00-05:00', wholeDay: true, title: 'RÉPARATION' }
  const conflict: Conflict = { start: late.start!, end: late.end!, things: [{ kind: 'occupation', ...stay }, sessionThing(late)] }
  const days = calendarDays(calendar({ sessions: [late], occupations: [stay, repair], conflicts: [conflict] }), gridDays('2026-11'))

  it('have what takes them, by start, then end, with their names', () => {
    expect(thingsOn(days.get('2026-11-21')!).map(({ thing, part }) => [thing.kind, thing.title, spaced(part)])).toEqual([
      ['occupation', null, 'toute la journée'],
      ['session', 'LATE', '21 h – 1 h'],
    ])
    expect(thingsOn(days.get('2026-11-21')!)[0].thing).toMatchObject({ calendar: 'Séjours' })
    expect(thingsOn(days.get('2026-11-26')!).map(({ thing, part }) => [thing.title, part])).toEqual([['RÉPARATION', 'toute la journée']])
    expect(thingsOn(days.get('2026-11-26')!)[0].thing).toMatchObject({ calendar: 'Équipe' })
  })

  it('say "conflit" only on the days the overlap takes', () => {
    const conflicts = (day: string) => thingsOn(days.get(day)!).map(({ conflicts }) => conflicts.map(({ other }) => other.kind))
    expect(conflicts('2026-11-20')).toEqual([[]])
    expect(conflicts('2026-11-21')).toEqual([['session'], ['occupation']])
    expect(conflicts('2026-11-22')).toEqual([['session'], ['occupation']])
  })

  it('list what started on an earlier day first, by start, then end, then the free time', () => {
    expect(days.get('2026-11-22')!.map(({ part }) => spaced(part))).toEqual(["jusqu'à 11 h", "jusqu'à 1 h", 'dès 11 h'])
    // A thing before a stretch that starts when it does: a cancelled session, which doesn't take the studio.
    const cancelled = session('off', '2026-11-23T22:00:00-05:00', '2026-11-24T02:00:00-05:00', 'cancelled')
    const shown = calendarDays(calendar({ sessions: [cancelled] }), gridDays('2026-11'))
    expect(shown.get('2026-11-24')!.map(({ part }) => spaced(part))).toEqual(["jusqu'à 2 h", 'toute la journée'])
  })

  it('come from each thing with every one of its conflicts, whatever days they take', () => {
    const [stayed, played, repaired] = thingsWithConflicts(calendar({ sessions: [late], occupations: [repair, stay], conflicts: [conflict] }))
    expect([stayed.thing.kind, played.thing.kind, repaired.thing.kind]).toEqual(['occupation', 'session', 'occupation'])
    expect(stayed.conflicts).toEqual([{ conflict, other: { kind: 'session', id: 'late', title: 'LATE', status: 'planned' } }])
    expect(played.conflicts).toEqual([{ conflict, other: { kind: 'occupation', title: null, calendar: 'Séjours' } }])
    expect(repaired.conflicts).toEqual([])
  })

  it('name each other thing once, for things that are the same', () => {
    // Two stays with the same dates, without titles, each in conflict with the session and the other.
    const stays: ConflictThing[] = [{ kind: 'occupation', ...stay }, { kind: 'occupation', ...stay }]
    const conflicts: Conflict[] = [
      { start: stay.start, end: stay.end, things: stays as [ConflictThing, ConflictThing] },
      { start: late.start!, end: late.end!, things: [stays[0], sessionThing(late)] },
      { start: late.start!, end: late.end!, things: [stays[1], sessionThing(late)] },
    ]
    const shown = calendarDays(calendar({ sessions: [late], occupations: [stay, stay], conflicts }), gridDays('2026-11'))
    const lines = thingsOn(shown.get('2026-11-21')!).map(({ conflicts }) => conflicts.map(({ other }) => inSentence(other)))
    expect(lines).toEqual([["l'occupation Séjours", 'la session LATE'], ["l'occupation Séjours", 'la session LATE'], ["l'occupation Séjours"]])
  })

  it('have free time from today on, outside what takes them', () => {
    const free = (day: string) => freeOf(days.get(day)!)
    // Before today.
    expect(free('2026-11-18')).toEqual([])
    expect(free('2026-11-19')).toEqual(['toute la journée'])
    // In the month after too, as in its own month's grid.
    expect(free('2026-12-01')).toEqual(['toute la journée'])
    expect(freeOf(calendarDays(calendar({}), gridDays('2026-12')).get('2026-12-01')!)).toEqual(['toute la journée'])
    // The stay starts at 15 h.
    expect(free('2026-11-20')).toEqual(["jusqu'à 15 h"])
    // The stay takes all of it.
    expect(free('2026-11-21')).toEqual([])
    // The session's tail, and the stay, end.
    expect(free('2026-11-22')).toEqual(['dès 11 h'])
    // A whole-day occupation, which takes the 25th to the 27th whole.
    expect(free('2026-11-25')).toEqual([])
    expect(free('2026-11-26')).toEqual([])
    expect(free('2026-11-28')).toEqual(['toute la journée'])
  })

  it('have free time around an occupation that starts on them', () => {
    const repairs = [{ feedId: 'o', start: '2026-11-24T10:00:00-05:00', end: '2026-11-24T16:00:00-05:00', wholeDay: false, title: '' }]
    const shown = calendarDays(calendar({ occupations: repairs }), gridDays('2026-11'))
    expect(freeOf(shown.get('2026-11-24')!)).toEqual(["jusqu'à 10 h", 'dès 16 h'])
    // In order of time, with what takes the day.
    expect(shown.get('2026-11-24')!.map(({ part }) => spaced(part))).toEqual(["jusqu'à 10 h", '10 h – 16 h', 'dès 16 h'])
    // Today's stretches count from 00:00 too.
    expect(freeOf(calendarDays(calendar({ occupations: repairs, today: '2026-11-24' }), gridDays('2026-11')).get('2026-11-24')!)).toEqual(["jusqu'à 10 h", 'dès 16 h'])
  })

  it("don't count cancelled sessions", () => {
    const cancelled = session('off', '2026-11-23T20:00:00-05:00', '2026-11-23T23:00:00-05:00', 'cancelled')
    const shown = calendarDays(calendar({ sessions: [cancelled] }), gridDays('2026-11'))
    expect(freeOf(shown.get('2026-11-23')!)).toEqual(['toute la journée'])
    expect(thingsOn(shown.get('2026-11-23')!)).toHaveLength(1)
  })

  it('have free time around a session', () => {
    const evening = session('evening', '2026-11-23T20:00:00-05:00', '2026-11-23T22:00:00-05:00')
    const shown = calendarDays(calendar({ sessions: [evening] }), gridDays('2026-11'))
    expect(shown.get('2026-11-23')!.map(({ part }) => spaced(part))).toEqual(["jusqu'à 20 h", '20 h – 22 h', 'dès 22 h'])
  })

  it('have free time only where it is protected, and none without holds', () => {
    // Protected from 11 h to 15 h, then from 15 h the day after to 11 h the day after that, by two feeds.
    const holds = [
      { feedId: 'h', start: '2026-11-23T11:00:00-05:00', end: '2026-11-23T15:00:00-05:00', wholeDay: false },
      { feedId: 'i', start: '2026-11-24T15:00:00-05:00', end: '2026-11-25T00:00:00-05:00', wholeDay: false },
      { feedId: 'h', start: '2026-11-25T00:00:00-05:00', end: '2026-11-25T11:00:00-05:00', wholeDay: false },
    ]
    const shown = calendarDays(calendar({ holds }), gridDays('2026-11'))
    expect(freeOf(shown.get('2026-11-22')!)).toEqual([])
    expect(freeOf(shown.get('2026-11-23')!)).toEqual(['11 h – 15 h'])
    expect(freeOf(shown.get('2026-11-24')!)).toEqual(['dès 15 h'])
    expect(freeOf(shown.get('2026-11-25')!)).toEqual(["jusqu'à 11 h"])
    expect([...calendarDays(calendar({ holds: [] }), gridDays('2026-11')).values()].flat().filter(isFree)).toEqual([])
  })

  it("have free time only in the 365 days from the server's today, a hold over them being cut to them", () => {
    // The hold starts before today, which free time starts with (see above), and ends after the last of the days.
    const shown = calendarDays(calendar({}), gridDays('2027-11'))
    expect(freeOf(shown.get('2027-11-18')!)).toEqual(['toute la journée'])
    expect(freeOf(shown.get('2027-11-19')!)).toEqual([])
  })

  it('say which sessions are outside protected time, on every day they take', () => {
    const unprotectedSessions = [unprotected(late)]
    const shown = calendarDays(calendar({ sessions: [late], unprotectedSessions }), gridDays('2026-11'))
    const flags = (day: string) => thingsOn(shown.get(day)!).map(({ thing }) => thing.kind === 'session' && thing.unprotected)
    expect(flags('2026-11-21')).toEqual([true])
    expect(flags('2026-11-22')).toEqual([true])
    expect(thingsOn(days.get('2026-11-21')!).map(({ thing }) => thing.kind === 'session' && thing.unprotected)).toEqual([false, false])
  })
})

describe('the list', () => {
  it('has the 365 days from today, those conflicts are found in', () => {
    expect(listRange('2026-11-19')).toEqual({ from: '2026-11-19', to: '2027-11-18' })
    // Over a 29 February.
    expect(listRange('2027-11-19')).toEqual({ from: '2027-11-19', to: '2028-11-17' })
  })

  // A stay going on since yesterday, until December, in conflict with a meeting today and a session later on, a
  // session over three days, and a repair over three whole days in January.
  const { from, to } = listRange('2026-11-19')
  const stay = { feedId: 'q', start: '2026-11-18T15:00:00-05:00', end: '2026-12-02T11:00:00-05:00', wholeDay: false, title: '' }
  const meeting = { feedId: 'o', start: '2026-11-19T10:00:00-05:00', end: '2026-11-19T12:00:00-05:00', wholeDay: false, title: 'RÉUNION' }
  const late = session('late', '2026-11-21T21:00:00-05:00', '2026-11-22T01:00:00-05:00')
  const marathon = session('marathon', '2027-02-06T18:00:00-05:00', '2027-02-08T01:00:00-05:00')
  const repair = { feedId: 'o', start: '2027-01-05T00:00:00-05:00', end: '2027-01-08T00:00:00-05:00', wholeDay: true, title: 'RÉPARATION' }
  const stayThing = { kind: 'occupation', ...stay } as const
  const conflicts: Conflict[] = [
    { start: meeting.start, end: meeting.end, things: [stayThing, { kind: 'occupation', ...meeting }] },
    { start: late.start!, end: late.end!, things: [stayThing, sessionThing(late)] },
  ]
  const months = listedMonths(calendar({ sessions: [late, marathon], occupations: [stay, meeting, repair], conflicts }), from, to)

  it('has every month of its days, each thing once, on the first of these days it takes, by start, then end', () => {
    expect(months.map(({ month }) => month)).toEqual(['2026-11', '2026-12', ...Array.from({ length: 11 }, (_, i) => addMonths('2027-01', i))])
    const listed = months.flatMap(({ month, things }) => things.map(({ day, thing }) => [month, day, thing.kind === 'session' ? thing.title : (thing.title ?? thing.calendar), thing.start]))
    expect(listed).toEqual([
      // Today, though it started yesterday.
      ['2026-11', '2026-11-19', 'Séjours', stay.start],
      ['2026-11', '2026-11-19', 'RÉUNION', meeting.start],
      ['2026-11', '2026-11-21', 'LATE', late.start],
      ['2027-01', '2027-01-05', 'RÉPARATION', repair.start],
      ['2027-02', '2027-02-06', 'MARATHON', marathon.start],
    ])
    expect(months[1].things).toEqual([])
  })

  it('gives each thing every one of its conflicts, saying which miss the day it is listed on', () => {
    const [stayed, met, played] = months[0].things
    expect(stayed.conflicts.map(({ other, elsewhere }) => [nameOf(other), elsewhere])).toEqual([
      ['RÉUNION', false],
      ['LATE', true],
    ])
    expect(met.conflicts.map(({ other, elsewhere }) => [nameOf(other), elsewhere])).toEqual([['Séjours', false]])
    expect(played.conflicts.map(({ other, elsewhere }) => [nameOf(other), elsewhere])).toEqual([['Séjours', false]])
  })

  it('says which sessions are outside protected time', () => {
    const unprotectedSessions = [unprotected(marathon)]
    const listed = listedMonths(calendar({ sessions: [late, marathon], unprotectedSessions }), from, to).flatMap(({ things }) => things)
    expect(listed.map(({ thing }) => thing.kind === 'session' && [thing.title, thing.unprotected])).toEqual([
      ['LATE', false],
      ['MARATHON', true],
    ])
  })

  it('leaves out what the calendar has outside its days', () => {
    const played = session('played', '2026-11-07T20:00:00-05:00', '2026-11-07T23:00:00-05:00', 'done')
    expect(listedMonths(calendar({ sessions: [played] }), from, to).flatMap(({ things }) => things)).toEqual([])
  })

  it("says the day an overlap starts, with its year when it isn't that of the day it's near", () => {
    expect(startDay(times('2026-11-21T21:00:00-05:00', '2026-11-22T01:00:00-05:00'), '2026-11-19')).toBe('sam. 21 nov.')
    expect(startDay(times('2027-01-02T21:00:00-05:00', '2027-01-03T01:00:00-05:00'), '2026-11-19')).toBe('sam. 2 janv. 2027')
    expect(startDay(times('2027-01-02T21:00:00-05:00', '2027-01-03T01:00:00-05:00'), '2027-01-01')).toBe('sam. 2 janv.')
  })
})
