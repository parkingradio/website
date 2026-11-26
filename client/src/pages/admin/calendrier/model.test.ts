import { describe, expect, it } from 'vitest'
import type { Session } from '../../../session-fields'
import { spaced } from '../../../test-utils'
import { addMonths, briefTimes, calendarDays, daysOf, isAvailable, fullTimes, gridDays, gridRange, inSentence, listRange, listedMonths, nameOf, namedThing, partOfDay, readDay, readMonth, startDay, thingKey, thingsWithConflicts } from './model'
import type { Calendar, CalendarDay, Conflict, ConflictThing, DayThing, Feed } from './model'

// Québec's clocks go back on 2026-11-01, a 25-hour day, and forward on 2027-03-14, a 23-hour day.

const times = (start: string, end: string) => ({ start, end })
// What takes a day, and the parts of the day of its available time.
const thingsOn = (entries: CalendarDay) => entries.filter((entry): entry is DayThing => !isAvailable(entry))
const availableOf = (entries: CalendarDay) => entries.filter(isAvailable).map(({ part }) => spaced(part))
// The parts of the day of `day`'s available time, from the server's stretches `availability`.
const parts = (day: string, availability: { start: string; end: string }[]) => availableOf(calendarDays(calendar({ availability }), [day]).get(day)!)

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
    expect(spaced(partOfDay(times('2026-11-14T21:00:00-05:00', '2026-11-14T23:00:00-05:00'), '2026-11-14'))).toBe('21 h – 23 h')
    // Up to 00:00, which doesn't take the next day.
    expect(spaced(partOfDay(times('2026-11-14T21:00:00-05:00', '2026-11-15T00:00:00-05:00'), '2026-11-14'))).toBe('21 h – 0 h')
    expect(daysOf(times('2026-11-14T21:00:00-05:00', '2026-11-15T00:00:00-05:00'))).toEqual(['2026-11-14'])
    // Or only those within some days.
    const long = times('2026-11-13T18:00:00-05:00', '2026-11-15T02:00:00-05:00')
    expect(daysOf(long, ['2026-11-14', '2026-11-20'])).toEqual(['2026-11-14', '2026-11-15'])
    expect(daysOf(long, ['2026-11-16', '2026-11-20'])).toEqual([])
  })

  it('writes the end of a thing of 12 hours or less that ends the next day, then what it takes of that day', () => {
    const overnight = times('2026-11-14T21:00:00-05:00', '2026-11-15T01:00:00-05:00')
    expect(daysOf(overnight)).toEqual(['2026-11-14', '2026-11-15'])
    expect(spaced(partOfDay(overnight, '2026-11-14'))).toBe('21 h – 1 h')
    expect(spaced(partOfDay(overnight, '2026-11-15'))).toBe("jusqu'à 1 h")
  })

  it('writes where a longer thing starts and ends, and the days it takes whole', () => {
    const long = times('2026-11-13T18:00:00-05:00', '2026-11-15T02:00:00-05:00')
    expect(daysOf(long).map((day) => spaced(partOfDay(long, day)))).toEqual(['dès 18 h', 'toute la journée', "jusqu'à 2 h"])
    // A thing that ends later the next day than it starts.
    const day = times('2026-11-14T21:00:00-05:00', '2026-11-15T22:00:00-05:00')
    expect(daysOf(day).map((d) => spaced(partOfDay(day, d)))).toEqual(['dès 21 h', "jusqu'à 22 h"])
    // Or earlier, more than 12 hours after it starts.
    const stay = times('2026-11-14T15:00:00-05:00', '2026-11-15T11:00:00-05:00')
    expect(daysOf(stay).map((d) => spaced(partOfDay(stay, d)))).toEqual(['dès 15 h', "jusqu'à 11 h"])
  })

  it('takes a whole day from 00:00 to 00:00, whole-day or not, on the days the clocks change too', () => {
    // A timed thing from 00:00 to 00:00, on a 25-hour day and a 23-hour one.
    expect(spaced(partOfDay(times('2026-11-01T00:00:00-04:00', '2026-11-02T00:00:00-05:00'), '2026-11-01'))).toBe('toute la journée')
    expect(spaced(partOfDay(times('2027-03-14T00:00:00-05:00', '2027-03-15T00:00:00-04:00'), '2027-03-14'))).toBe('toute la journée')
    // Three whole days, around the clocks going back.
    const days = times('2026-10-31T00:00:00-04:00', '2026-11-03T00:00:00-05:00')
    expect(daysOf(days).map((day) => spaced(partOfDay(days, day)))).toEqual(['toute la journée', 'toute la journée', 'toute la journée'])
    // From 00:00 over several days, and to 00:00.
    const fromMidnight = times('2027-03-14T00:00:00-05:00', '2027-03-15T10:00:00-04:00')
    expect(daysOf(fromMidnight).map((day) => spaced(partOfDay(fromMidnight, day)))).toEqual(['toute la journée', "jusqu'à 10 h"])
    const toMidnight = times('2027-03-13T10:00:00-05:00', '2027-03-15T00:00:00-04:00')
    expect(daysOf(toMidnight).map((day) => spaced(partOfDay(toMidnight, day)))).toEqual(['dès 10 h', 'toute la journée'])
  })

  it('counts the hours of the days the clocks change', () => {
    // 1:30 happens twice on 2026-11-01: from 23 h to the second 1 h 30 is less than a day, but ends later than it starts.
    expect(spaced(partOfDay(times('2026-10-31T23:00:00-04:00', '2026-11-01T01:30:00-05:00'), '2026-10-31'))).toBe('23 h – 1 h 30')
    // On 2027-03-14, 3 h comes right after 1 h 59.
    expect(spaced(partOfDay(times('2027-03-14T01:00:00-05:00', '2027-03-14T04:00:00-04:00'), '2027-03-14'))).toBe('1 h – 4 h')
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
    expect(spaced(fullTimes(times('2026-11-14T21:00:00-05:00', '2026-11-14T23:00:00-05:00'), '2026-11-14'))).toBe('21 h – 23 h')
    expect(spaced(fullTimes(times('2026-11-14T21:00:00-05:00', '2026-11-15T01:00:00-05:00'), '2026-11-14'))).toBe('21 h – 1 h')
    expect(spaced(fullTimes(times('2026-11-13T18:00:00-05:00', '2026-11-15T02:00:00-05:00'), '2026-11-13'))).toBe('18 h – dim. 15 nov., 2 h')
    expect(spaced(fullTimes(times('2026-11-14T15:00:00-05:00', '2026-11-15T11:00:00-05:00'), '2026-11-14'))).toBe('15 h – dim. 15 nov., 11 h')
  })

  it('say the day it starts on, on a later day', () => {
    expect(spaced(fullTimes(times('2026-11-14T21:00:00-05:00', '2026-11-15T01:00:00-05:00'), '2026-11-15'))).toBe('sam. 14 nov., 21 h – 1 h')
    expect(spaced(fullTimes(times('2026-11-13T18:00:00-05:00', '2026-11-15T02:00:00-05:00'), '2026-11-14'))).toBe('ven. 13 nov., 18 h – dim. 15 nov., 2 h')
  })

  it('give whole days from the first to the last, whole-day or not, on the days the clocks change too', () => {
    expect(spaced(fullTimes(times('2026-11-01T00:00:00-04:00', '2026-11-02T00:00:00-05:00'), '2026-11-01'))).toBe('toute la journée')
    expect(spaced(fullTimes(times('2027-03-14T00:00:00-05:00', '2027-03-15T00:00:00-04:00'), '2027-03-14'))).toBe('toute la journée')
    const days = times('2026-10-30T00:00:00-04:00', '2026-11-02T00:00:00-05:00')
    expect(spaced(fullTimes(days, '2026-10-30'))).toBe('du ven. 30 oct. au dim. 1 nov.')
    expect(spaced(fullTimes(days, '2026-11-01'))).toBe('du ven. 30 oct. au dim. 1 nov.')
    expect(spaced(fullTimes(times('2027-03-13T00:00:00-05:00', '2027-03-15T00:00:00-04:00'), '2027-03-14'))).toBe('du sam. 13 mars au dim. 14 mars')
  })

  it('from the start of its day, as the month writes it, when it starts at 00:00', () => {
    expect(spaced(fullTimes(times('2026-11-28T00:00:00-05:00', '2026-11-28T11:00:00-05:00'), '2026-11-28'))).toBe("jusqu'à 11 h")
    expect(spaced(partOfDay(times('2026-11-28T00:00:00-05:00', '2026-11-28T11:00:00-05:00'), '2026-11-28'))).toBe("jusqu'à 11 h")
    const stay = times('2026-11-28T00:00:00-05:00', '2026-11-30T11:00:00-05:00')
    expect(spaced(fullTimes(stay, '2026-11-28'))).toBe("jusqu'au lun. 30 nov., 11 h")
    expect(spaced(fullTimes(stay, '2026-11-29'))).toBe("du sam. 28 nov. jusqu'au lun. 30 nov., 11 h")
    expect(spaced(fullTimes(stay, '2026-11-30'))).toBe("du sam. 28 nov. jusqu'au lun. 30 nov., 11 h")
  })
})

describe("a thing's times in brief", () => {
  it('are its times when they say when it ends: the same day, or the next day, at 00:00 or within 12 hours', () => {
    expect(spaced(briefTimes(times('2026-11-14T18:00:00-05:00', '2026-11-14T21:00:00-05:00'), '2026-11-14'))).toBe('18 h – 21 h')
    expect(spaced(briefTimes(times('2026-11-14T21:30:00-05:00', '2026-11-15T01:00:00-05:00'), '2026-11-14'))).toBe('21 h 30 – 1 h')
    expect(spaced(briefTimes(times('2026-11-14T21:00:00-05:00', '2026-11-15T00:00:00-05:00'), '2026-11-14'))).toBe('21 h – 0 h')
    expect(spaced(briefTimes(times('2026-11-14T10:00:00-05:00', '2026-11-15T00:00:00-05:00'), '2026-11-14'))).toBe('10 h – 0 h')
    // Over the night the clocks go back, a 25-hour day.
    expect(spaced(briefTimes(times('2026-10-31T22:00:00-04:00', '2026-11-01T02:00:00-05:00'), '2026-10-31'))).toBe('22 h – 2 h')
  })

  it('are its start, then the last day it takes, when it ends on a later day, in another month or year too', () => {
    expect(spaced(briefTimes(times('2026-11-21T15:00:00-05:00', '2026-11-24T11:00:00-05:00'), '2026-11-21'))).toBe('15 h → mar. 24')
    expect(spaced(briefTimes(times('2026-11-21T15:00:00-05:00', '2026-11-25T00:00:00-05:00'), '2026-11-21'))).toBe('15 h → mar. 24')
    // The next day at a later time than it starts, or more than 12 hours after it starts.
    expect(spaced(briefTimes(times('2026-11-14T18:00:00-05:00', '2026-11-15T21:00:00-05:00'), '2026-11-14'))).toBe('18 h → dim. 15')
    expect(spaced(briefTimes(times('2026-11-14T15:00:00-05:00', '2026-11-15T11:00:00-05:00'), '2026-11-14'))).toBe('15 h → dim. 15')
    expect(spaced(briefTimes(times('2026-12-30T20:00:00-05:00', '2027-01-01T11:00:00-05:00'), '2026-12-30'))).toBe('20 h → ven. 1')
    // With its month, four weeks or more after the day, when its weekday and number could be another day's.
    expect(spaced(briefTimes(times('2026-11-21T15:00:00-05:00', '2026-12-18T11:00:00-05:00'), '2026-11-21'))).toBe('15 h → ven. 18')
    expect(spaced(briefTimes(times('2026-11-21T15:00:00-05:00', '2026-12-19T11:00:00-05:00'), '2026-11-21'))).toBe('15 h → sam. 19 déc.')
    expect(spaced(briefTimes(times('2026-11-18T15:00:00-05:00', '2027-01-02T11:00:00-05:00'), '2026-11-19'))).toBe('→ sam. 2 janv.')
  })

  it('take the day from its start, after an earlier day or from 00:00', () => {
    const stay = times('2026-11-21T15:00:00-05:00', '2026-11-24T11:00:00-05:00')
    expect(spaced(briefTimes(stay, '2026-11-23'))).toBe('→ mar. 24')
    expect(spaced(briefTimes(stay, '2026-11-24'))).toBe('→ 11 h')
    expect(spaced(briefTimes(times('2026-11-28T00:00:00-05:00', '2026-11-28T11:00:00-05:00'), '2026-11-28'))).toBe('→ 11 h')
    expect(spaced(briefTimes(times('2026-11-28T00:00:00-05:00', '2026-11-30T11:00:00-05:00'), '2026-11-28'))).toBe('→ lun. 30')
    // Over the end of the month.
    expect(spaced(briefTimes(times('2026-11-28T15:00:00-05:00', '2026-12-01T11:00:00-05:00'), '2026-11-29'))).toBe('→ mar. 1')
  })

  it('are a whole day, or the last of several, on the days the clocks change too', () => {
    expect(spaced(briefTimes(times('2026-11-26T00:00:00-05:00', '2026-11-27T00:00:00-05:00'), '2026-11-26'))).toBe('journée')
    expect(spaced(briefTimes(times('2026-11-01T00:00:00-04:00', '2026-11-02T00:00:00-05:00'), '2026-11-01'))).toBe('journée')
    expect(spaced(briefTimes(times('2027-03-14T00:00:00-05:00', '2027-03-15T00:00:00-04:00'), '2027-03-14'))).toBe('journée')
    const closed = times('2026-12-02T00:00:00-05:00', '2026-12-04T00:00:00-05:00')
    expect(spaced(briefTimes(closed, '2026-12-02'))).toBe('→ jeu. 3')
    expect(spaced(briefTimes(closed, '2026-12-03'))).toBe('journée')
    // Starting before the day, to its end.
    expect(spaced(briefTimes(times('2026-11-21T15:00:00-05:00', '2026-11-24T00:00:00-05:00'), '2026-11-23'))).toBe('journée')
  })
})

describe('available time', () => {
  it("is the server's stretches, cut at each midnight", () => {
    // From 15 h on the 20th to 11 h on the 23rd.
    const stretch = [times('2026-11-20T15:00:00-05:00', '2026-11-23T11:00:00-05:00')]
    expect(parts('2026-11-19', stretch)).toEqual([])
    expect(parts('2026-11-20', stretch)).toEqual(['dès 15 h'])
    expect(parts('2026-11-21', stretch)).toEqual(['toute la journée'])
    expect(parts('2026-11-22', stretch)).toEqual(['toute la journée'])
    expect(parts('2026-11-23', stretch)).toEqual(["jusqu'à 11 h"])
    expect(parts('2026-11-24', stretch)).toEqual([])
    // Over midnight.
    expect(parts('2026-11-21', [times('2026-11-20T20:00:00-05:00', '2026-11-21T02:00:00-05:00')])).toEqual(["jusqu'à 2 h"])
  })

  it('has every stretch of the day, in order', () => {
    const stretches = [times('2026-11-19T20:00:00-05:00', '2026-11-20T11:00:00-05:00'), times('2026-11-20T13:00:00-05:00', '2026-11-20T15:00:00-05:00'), times('2026-11-20T18:00:00-05:00', '2026-11-21T00:00:00-05:00')]
    expect(parts('2026-11-20', stretches)).toEqual(["jusqu'à 11 h", '13 h – 15 h', 'dès 18 h'])
    expect(parts('2026-11-20', [])).toEqual([])
  })

  it('is measured on the days the clocks change', () => {
    // A whole day of 25 hours, then one of 23.
    expect(parts('2026-11-01', [times('2026-11-01T00:00:00-04:00', '2026-11-02T00:00:00-05:00')])).toEqual(['toute la journée'])
    expect(parts('2026-11-01', [times('2026-11-01T00:00:00-04:00', '2026-11-01T11:00:00-05:00')])).toEqual(["jusqu'à 11 h"])
    expect(parts('2027-03-14', [times('2027-03-14T00:00:00-05:00', '2027-03-15T00:00:00-04:00')])).toEqual(['toute la journée'])
    expect(parts('2027-03-14', [times('2027-03-14T11:00:00-04:00', '2027-03-15T00:00:00-04:00')])).toEqual(['dès 11 h'])
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

// Available time over the 365 days from the calendars' today, as the server gives it when they're all protected and
// nothing takes them.
const ALWAYS = times('2026-11-19T00:00:00-05:00', '2027-11-19T00:00:00-05:00')

function calendar(fields: Partial<Calendar>): Calendar {
  const feeds = [feed('q', 'Séjours'), feed('o', 'Équipe'), feed('h', 'Loft', 'holds')]
  return { ok: true, today: '2026-11-19', feeds, sessions: [], occupations: [], availability: [], conflicts: [], unprotectedSessions: [], undatedSessions: [], ...fields }
}

const sessionThing = ({ id, title, start, end, status }: Session): ConflictThing => ({ kind: 'session', id, title, start: start!, end: end!, status })
// A session, as the server gives it among the sessions outside protected time.
const unprotected = ({ id, title, start, end }: Session) => ({ id, title, start: start!, end: end! })

describe('the days of the month', () => {
  // A stay, without a title, a session during it, and a repair over three whole days, and the available time around
  // them, from today.
  const stay = { feedId: 'q', start: '2026-11-20T15:00:00-05:00', end: '2026-11-22T11:00:00-05:00', wholeDay: false, title: '' }
  const late = session('late', '2026-11-21T21:00:00-05:00', '2026-11-22T01:00:00-05:00')
  const repair = { feedId: 'o', start: '2026-11-25T00:00:00-05:00', end: '2026-11-28T00:00:00-05:00', wholeDay: true, title: 'RÉPARATION' }
  const conflict: Conflict = { start: late.start!, end: late.end!, things: [{ kind: 'occupation', ...stay }, sessionThing(late)] }
  const availability = [times(ALWAYS.start, stay.start), times(stay.end, repair.start), times(repair.end, ALWAYS.end)]
  const days = calendarDays(calendar({ sessions: [late], occupations: [stay, repair], conflicts: [conflict], availability }), gridDays('2026-11'))

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

  it('say what lasts until the end of the day, 00:00 or later, things and available time', () => {
    const toDayEnd = (shown: Map<string, CalendarDay>, day: string) => shown.get(day)!.map((entry) => [spaced(entry.part), entry.toDayEnd])
    // The stay, all day, and the session, until 1 h the next day, then their ends, and the available time after them.
    expect(toDayEnd(days, '2026-11-21')).toEqual([
      ['toute la journée', true],
      ['21 h – 1 h', true],
    ])
    expect(toDayEnd(days, '2026-11-22')).toEqual([
      ["jusqu'à 11 h", false],
      ["jusqu'à 1 h", false],
      ['dès 11 h', true],
    ])
    expect(toDayEnd(days, '2026-11-20')).toEqual([
      ["jusqu'à 15 h", false],
      ['dès 15 h', true],
    ])
    expect(toDayEnd(days, '2026-11-19')).toEqual([['toute la journée', true]])
    // Until 00:00, and a cancelled session, which still shows, until the next day.
    const sessions = [session('evening', '2026-11-23T20:00:00-05:00', '2026-11-23T22:00:00-05:00'), session('night', '2026-11-23T22:00:00-05:00', '2026-11-24T00:00:00-05:00')]
    const cancelled = session('off', '2026-11-24T22:00:00-05:00', '2026-11-25T02:00:00-05:00', 'cancelled')
    const shown = calendarDays(calendar({ sessions: [...sessions, cancelled] }), gridDays('2026-11'))
    expect(toDayEnd(shown, '2026-11-23')).toEqual([
      ['20 h – 22 h', false],
      ['22 h – 0 h', true],
    ])
    expect(toDayEnd(shown, '2026-11-24')).toEqual([['22 h – 2 h', true]])
    expect(toDayEnd(shown, '2026-11-25')).toEqual([["jusqu'à 2 h", false]])
    // All of a 25-hour day, the clocks going back.
    const fall = { feedId: 'o', start: '2026-11-01T00:00:00-04:00', end: '2026-11-02T00:00:00-05:00', wholeDay: true, title: 'RÉPARATION' }
    expect(toDayEnd(calendarDays(calendar({ occupations: [fall] }), gridDays('2026-11')), '2026-11-01')).toEqual([['toute la journée', true]])
  })

  it('list what started on an earlier day first, by start, then end, then the available time', () => {
    expect(days.get('2026-11-22')!.map(({ part }) => spaced(part))).toEqual(["jusqu'à 11 h", "jusqu'à 1 h", 'dès 11 h'])
    // A thing before a stretch that starts when it does: a cancelled session, which doesn't take the studio.
    const cancelled = session('off', '2026-11-23T22:00:00-05:00', '2026-11-24T02:00:00-05:00', 'cancelled')
    const shown = calendarDays(calendar({ sessions: [cancelled], availability: [ALWAYS] }), gridDays('2026-11'))
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

  it('have the available time the server gives, cut to each of them', () => {
    const available = (day: string) => availableOf(days.get(day)!)
    // Before today.
    expect(available('2026-11-18')).toEqual([])
    expect(available('2026-11-19')).toEqual(['toute la journée'])
    // In the month after too, as in its own month's grid.
    expect(available('2026-12-01')).toEqual(['toute la journée'])
    expect(availableOf(calendarDays(calendar({ availability: [ALWAYS] }), gridDays('2026-12')).get('2026-12-01')!)).toEqual(['toute la journée'])
    // The stay starts at 15 h.
    expect(available('2026-11-20')).toEqual(["jusqu'à 15 h"])
    // The stay takes all of it.
    expect(available('2026-11-21')).toEqual([])
    // The session's tail, and the stay, end.
    expect(available('2026-11-22')).toEqual(['dès 11 h'])
    // A whole-day occupation, which takes the 25th to the 27th whole.
    expect(available('2026-11-25')).toEqual([])
    expect(available('2026-11-26')).toEqual([])
    expect(available('2026-11-28')).toEqual(['toute la journée'])
    // None when the server gives none, e.g. without holds.
    expect([...calendarDays(calendar({ sessions: [late], occupations: [stay, repair] }), gridDays('2026-11')).values()].flat().filter(isAvailable)).toEqual([])
  })

  it('have available time among what takes them, in order of time', () => {
    const repairs = [{ feedId: 'o', start: '2026-11-24T10:00:00-05:00', end: '2026-11-24T16:00:00-05:00', wholeDay: false, title: '' }]
    const evening = session('evening', '2026-11-24T20:00:00-05:00', '2026-11-24T22:00:00-05:00')
    const availability = [times(ALWAYS.start, repairs[0].start), times(repairs[0].end, evening.start!), times(evening.end!, ALWAYS.end)]
    const shown = calendarDays(calendar({ sessions: [evening], occupations: repairs, availability }), gridDays('2026-11'))
    expect(shown.get('2026-11-24')!.map(({ part }) => spaced(part))).toEqual(["jusqu'à 10 h", '10 h – 16 h', '16 h – 20 h', '20 h – 22 h', 'dès 22 h'])
    expect(availableOf(shown.get('2026-11-24')!)).toEqual(["jusqu'à 10 h", '16 h – 20 h', 'dès 22 h'])
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
    expect(spaced(startDay(times('2026-11-21T21:00:00-05:00', '2026-11-22T01:00:00-05:00'), '2026-11-19'))).toBe('sam. 21 nov.')
    expect(spaced(startDay(times('2027-01-02T21:00:00-05:00', '2027-01-03T01:00:00-05:00'), '2026-11-19'))).toBe('sam. 2 janv. 2027')
    expect(spaced(startDay(times('2027-01-02T21:00:00-05:00', '2027-01-03T01:00:00-05:00'), '2027-01-01'))).toBe('sam. 2 janv.')
  })
})
