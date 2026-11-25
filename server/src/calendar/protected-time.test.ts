import { describe, expect, it } from 'vitest'
import { dayStart, instantIn } from '../api/formats.js'
import type { Status } from '../sessions/fields.js'
import type { CalendarSession } from './conflicts.js'
import { protectedTime, unprotectedSessions } from './protected-time.js'

// The time that's protected for sessions, and the sessions outside it (see "Protected time" in
// docs/design/server/calendar.md).

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
