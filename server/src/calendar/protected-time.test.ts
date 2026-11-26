import { describe, expect, it } from 'vitest'
import { dayStart, instantIn } from '../api/formats.js'
import type { Status } from '../sessions/fields.js'
import type { CalendarSession } from './conflicts.js'
import { freeTime, protectedTime, unprotectedSessions } from './protected-time.js'

// The time that's protected for sessions, the sessions outside it, and the free time (see "Protected time" and "Free time"
// in docs/design/server/calendar.md).

// An instant, at a time of a day in Québec.
const at = (day: string, time: string) => instantIn(null, `${day}T${time}:00`)
const span = (from: Date, to: Date) => ({ start: from, end: to })
// A whole-day hold, from 00:00 on its first day to 00:00 on the day after its last, which can last 23 or 25 hours.
const days = (first: string, next: string) => span(dayStart(first), dayStart(next))

const session = (id: string, start: Date | null, end: Date | null, status: Status = 'planned'): CalendarSession => ({ id, title: id, start, end, status })

// Monday, November 23, 2026, at noon in Québec, and the 365 days from today.
const NOW = at('2026-11-23', '12:00')
const WINDOW = { from: dayStart('2026-11-23'), to: dayStart('2027-11-23') }
const outside = (sessions: CalendarSession[], holds: { start: Date; end: Date }[] | null, { now = NOW, window = WINDOW } = {}) =>
  unprotectedSessions(sessions, holds, { window, now }).map(({ id }) => id)

describe('protectedTime', () => {
  it('makes holds that overlap or follow each other one, whatever their order, and keeps the others apart', () => {
    const ms = (instant: Date, by: number) => new Date(instant.getTime() + by)
    const holds = [
      span(at('2026-11-25', '15:00'), at('2026-11-26', '11:00')),
      // Within the one before.
      span(at('2026-11-25', '20:00'), at('2026-11-25', '22:00')),
      span(at('2026-11-25', '11:00'), at('2026-11-25', '15:00')),
      // 1 ms after the one before ends.
      span(ms(at('2026-11-26', '11:00'), 1), at('2026-11-26', '15:00')),
    ]
    expect(protectedTime(holds)).toEqual([
      span(at('2026-11-25', '11:00'), at('2026-11-26', '11:00')),
      span(ms(at('2026-11-26', '11:00'), 1), at('2026-11-26', '15:00')),
    ])
    // The holds it's given are left as they are.
    expect(holds[0]).toEqual(span(at('2026-11-25', '15:00'), at('2026-11-26', '11:00')))
  })
})

describe('unprotectedSessions', () => {
  it('protects a session exactly as long as a hold, but not one that goes past it, even by a minute', () => {
    const holds = [span(at('2026-11-25', '11:00'), at('2026-11-25', '15:00'))]
    const sessions = [
      session('exact', at('2026-11-25', '11:00'), at('2026-11-25', '15:00')),
      session('earlier', at('2026-11-25', '10:59'), at('2026-11-25', '15:00')),
      session('later', at('2026-11-25', '11:00'), at('2026-11-25', '15:01')),
    ]
    expect(outside(sessions, holds)).toEqual(['earlier', 'later'])
  })

  it('protects a session across holds that follow each other, of one feed or several, but not across a gap of 1 ms', () => {
    const holds = [
      span(at('2026-11-25', '11:00'), at('2026-11-25', '15:00')),
      span(at('2026-11-25', '15:00'), at('2026-11-26', '11:00')),
      // Another feed's, then a third's.
      span(at('2026-11-26', '11:00'), at('2026-11-26', '13:00')),
      span(at('2026-11-26', '13:00'), at('2026-11-26', '18:00')),
      span(new Date(at('2026-11-26', '18:00').getTime() + 1), at('2026-11-26', '23:00')),
    ]
    const sessions = [
      session('chain', at('2026-11-25', '14:00'), at('2026-11-26', '18:00')),
      session('gap', at('2026-11-26', '17:00'), at('2026-11-26', '19:00')),
    ]
    expect(outside(sessions, holds)).toEqual(['gap'])
  })

  it('protects a session across a whole day of 25 hours, or of 23, and the timed holds that follow them', () => {
    const holds = [
      // November 1, 2026, when the clocks go back, then from 00:00 on the next day.
      days('2026-11-01', '2026-11-02'),
      span(at('2026-11-02', '00:00'), at('2026-11-02', '11:00')),
      // March 14, 2027, when the clocks go forward, then from 00:00 on the next day.
      days('2027-03-14', '2027-03-15'),
      span(at('2027-03-15', '00:00'), at('2027-03-15', '11:00')),
      // From 15:00 on Saturday, November 6, 2027, to 11:00 on the Sunday, when the clocks go back.
      span(at('2027-11-06', '15:00'), at('2027-11-07', '11:00')),
    ]
    const window = { from: dayStart('2026-10-01'), to: dayStart('2027-12-01') }
    const now = at('2026-10-01', '00:00')
    const sessions = [
      session('fall', at('2026-11-01', '22:00'), at('2026-11-02', '02:00')),
      session('spring', at('2027-03-14', '22:00'), at('2027-03-15', '02:00')),
      session('night', at('2027-11-06', '21:00'), at('2027-11-07', '03:00')),
      // Before the overnight hold starts.
      session('before', at('2027-11-06', '14:00'), at('2027-11-06', '16:00')),
    ]
    expect(outside(sessions, holds, { window, now })).toEqual(['before'])
  })

  it('only judges what is left of a session that is going on', () => {
    // From noon, now, to 15:00.
    const holds = [span(at('2026-11-23', '12:00'), at('2026-11-23', '15:00'))]
    const sessions = [
      session('rest-protected', at('2026-11-23', '09:00'), at('2026-11-23', '15:00')),
      session('rest-unprotected', at('2026-11-23', '09:00'), at('2026-11-23', '16:00')),
    ]
    expect(outside(sessions, holds)).toEqual(['rest-unprotected'])
  })

  it('only gives planned sessions with a start that take some of the 365 days, and have not ended', () => {
    const sessions = [
      session('planned', at('2026-11-25', '21:00'), at('2026-11-25', '23:00')),
      session('done', at('2026-11-25', '21:00'), at('2026-11-25', '23:00'), 'done'),
      session('cancelled', at('2026-11-25', '21:00'), at('2026-11-25', '23:00'), 'cancelled'),
      session('undated', null, null),
      // Started yesterday, and still going on.
      session('since-yesterday', at('2026-11-22', '21:00'), at('2026-11-23', '13:00')),
      // Ended this morning, and when it's asked for.
      session('this-morning', at('2026-11-23', '09:00'), at('2026-11-23', '11:00')),
      session('ends-now', at('2026-11-23', '10:00'), at('2026-11-23', '12:00')),
      // Starts when the 365 days end, or just before.
      session('next-year', dayStart('2027-11-23'), at('2027-11-23', '02:00')),
      session('last-day', at('2027-11-22', '23:00'), at('2027-11-23', '01:00')),
    ]
    expect(outside(sessions, [])).toEqual(['since-yesterday', 'planned', 'last-day'])
  })

  it('gives none without a `holds` feed, when nothing is known to be protected or not', () => {
    expect(outside([session('planned', at('2026-11-25', '21:00'), at('2026-11-25', '23:00'))], null)).toEqual([])
  })
})

describe('freeTime', () => {
  const free = (holds: { start: Date; end: Date }[], taking: { start: Date; end: Date }[] = [], window = WINDOW) => freeTime(holds, taking, window)

  it('is the protected time that nothing takes, around and between what takes it', () => {
    const afternoon = [span(at('2026-11-25', '11:00'), at('2026-11-25', '18:00'))]
    expect(free(afternoon)).toEqual(afternoon)
    // A session within the hold, an occupation that starts before it, and another within that occupation.
    const taking = [
      span(at('2026-11-25', '15:00'), at('2026-11-25', '16:00')),
      span(at('2026-11-25', '09:00'), at('2026-11-25', '12:00')),
      span(at('2026-11-25', '10:00'), at('2026-11-25', '11:30')),
    ]
    expect(free(afternoon, taking)).toEqual([span(at('2026-11-25', '12:00'), at('2026-11-25', '15:00')), span(at('2026-11-25', '16:00'), at('2026-11-25', '18:00'))])
    // Something that takes all of it, or more, and something that ends when it starts, or starts when it ends.
    expect(free(afternoon, [span(at('2026-11-25', '10:00'), at('2026-11-26', '00:00'))])).toEqual([])
    expect(free(afternoon, [span(at('2026-11-25', '09:00'), at('2026-11-25', '11:00')), span(at('2026-11-25', '18:00'), at('2026-11-25', '20:00'))])).toEqual(afternoon)
  })

  it("is none of the time that isn't protected, even when nothing takes it", () => {
    expect(free([])).toEqual([])
    expect(free([span(at('2026-11-25', '11:00'), at('2026-11-25', '15:00'))], [span(at('2026-11-25', '11:00'), at('2026-11-25', '15:00'))])).toEqual([])
  })

  it('makes holds that overlap or follow each other, of any feeds, one stretch, across midnight too, but not across a gap of 1 ms', () => {
    const holds = [
      // From 15:00 on November 25 to 11:00 on November 27, from two feeds that follow each other at midnight.
      span(at('2026-11-26', '00:00'), at('2026-11-27', '11:00')),
      span(at('2026-11-25', '15:00'), at('2026-11-26', '00:00')),
      span(at('2026-11-25', '20:00'), at('2026-11-26', '02:00')),
      span(new Date(at('2026-11-27', '11:00').getTime() + 1), at('2026-11-27', '15:00')),
    ]
    expect(free(holds)).toEqual([
      span(at('2026-11-25', '15:00'), at('2026-11-27', '11:00')),
      span(new Date(at('2026-11-27', '11:00').getTime() + 1), at('2026-11-27', '15:00')),
    ])
    // A session over midnight cuts it there, and nowhere else.
    expect(free(holds.slice(0, 2), [span(at('2026-11-25', '21:00'), at('2026-11-26', '01:00'))])).toEqual([
      span(at('2026-11-25', '15:00'), at('2026-11-25', '21:00')),
      span(at('2026-11-26', '01:00'), at('2026-11-27', '11:00')),
    ])
  })

  it('is cut at the start and the end of the 365 days, from 00:00 today, what is over today included', () => {
    // From a week before today to a week after the 365 days end.
    const always = [span(at('2026-11-16', '15:00'), at('2027-11-30', '11:00'))]
    expect(free(always)).toEqual([span(WINDOW.from, WINDOW.to)])
    // What takes it before today, and from before the 365 days end to after.
    const taking = [span(at('2026-11-20', '10:00'), at('2026-11-23', '01:00')), span(at('2027-11-22', '21:00'), at('2027-11-23', '01:00'))]
    expect(free(always, taking)).toEqual([span(at('2026-11-23', '01:00'), at('2027-11-22', '21:00'))])
    // Holds that are all before today, or after the 365 days.
    expect(free([span(at('2026-11-22', '11:00'), dayStart('2026-11-23')), span(dayStart('2027-11-23'), at('2027-11-23', '11:00'))])).toEqual([])
  })

  it('takes whole days of 25 hours, or of 23, whole', () => {
    const window = { from: dayStart('2026-10-01'), to: dayStart('2027-12-01') }
    // November 1, 2026, when the clocks go back, and March 14, 2027, when they go forward.
    const fall = days('2026-11-01', '2026-11-02')
    const spring = days('2027-03-14', '2027-03-15')
    expect(free([fall, spring], [], window)).toEqual([fall, spring])
    expect(fall.end.getTime() - fall.start.getTime()).toBe(25 * 3600_000)
    expect(spring.end.getTime() - spring.start.getTime()).toBe(23 * 3600_000)
    // A session from 1:30 to 3:00 on the day of 25 hours, of which 1:30 comes twice: from the first one.
    const night = span(new Date('2026-11-01T05:30:00Z'), at('2026-11-01', '03:00'))
    expect(free([fall], [night], window)).toEqual([span(fall.start, night.start), span(night.end, fall.end)])
  })
})
