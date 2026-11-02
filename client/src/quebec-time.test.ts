import { afterEach, describe, expect, it, vi } from 'vitest'
import { addDays, quebecDateTime, quebecDayAndTime, quebecInstant, quebecInstantFrom } from './quebec-time'

describe('Québec time', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('gives the instant of a day and time in Québec, in winter and in summer', () => {
    expect(quebecInstant('2026-11-14', '21:00')?.toISOString()).toBe('2026-11-15T02:00:00.000Z')
    expect(quebecInstant('2026-07-01', '00:30')?.toISOString()).toBe('2026-07-01T04:30:00.000Z')
  })

  it("refuses a time that doesn't happen as clocks spring forward, and a day that doesn't exist", () => {
    expect(quebecInstant('2026-03-08', '02:30')).toBeNull()
    expect(quebecInstant('2026-03-08', '03:00')?.toISOString()).toBe('2026-03-08T07:00:00.000Z')
    expect(quebecInstant('2026-02-30', '21:00')).toBeNull()
  })

  it('takes the first of the two times that happen twice as clocks fall back', () => {
    expect(quebecInstant('2026-11-01', '01:30')?.toISOString()).toBe('2026-11-01T05:30:00.000Z')
    expect(quebecInstant('2026-11-01', '02:00')?.toISOString()).toBe('2026-11-01T07:00:00.000Z')
  })

  it('writes an instant with the day, the time and the offset of Québec then', () => {
    expect(quebecDateTime(new Date('2026-11-15T02:00:00Z'))).toBe('2026-11-14T21:00-05:00')
    expect(quebecDateTime(new Date('2026-11-01T05:30:00Z'))).toBe('2026-11-01T01:30-04:00')
    expect(quebecDateTime(new Date('2026-11-01T06:30:00Z'))).toBe('2026-11-01T01:30-05:00')
    expect(quebecDayAndTime(new Date('2026-07-01T04:00:00Z'))).toEqual({ day: '2026-07-01', time: '00:00' })
  })

  it('gives the first instant after another one when the clocks show a time, that day or the next', () => {
    const from = (after: string, time: string, inclusive = false) => quebecInstantFrom(new Date(after), time, { inclusive })?.toISOString() ?? null
    // 21:00 on November 14th, 2026.
    expect(from('2026-11-15T02:00:00Z', '22:30')).toBe('2026-11-15T03:30:00.000Z')
    expect(from('2026-11-15T02:00:00Z', '01:00')).toBe('2026-11-15T06:00:00.000Z')
    expect(from('2026-11-15T02:00:00Z', '21:00')).toBe('2026-11-16T02:00:00.000Z')
    expect(from('2026-11-15T02:00:00Z', '21:00', true)).toBe('2026-11-15T02:00:00.000Z')
    expect(from('2026-11-15T02:00:00Z', '20:00')).toBe('2026-11-16T01:00:00.000Z')
  })

  it('counts both times that happen twice as clocks fall back', () => {
    const from = (after: string, time: string) => quebecInstantFrom(new Date(after), time)?.toISOString() ?? null
    // From the first 1:30, the second 1:15, then the second 1:30.
    expect(from('2026-11-01T05:30:00Z', '01:15')).toBe('2026-11-01T06:15:00.000Z')
    expect(from('2026-11-01T05:30:00Z', '01:30')).toBe('2026-11-01T06:30:00.000Z')
    // From the second 1:30, 1:15 is the next day.
    expect(from('2026-11-01T06:30:00Z', '01:15')).toBe('2026-11-02T06:15:00.000Z')
  })

  it('refuses a time that clocks skip before they show it, as they spring forward', () => {
    const from = (after: string, time: string) => quebecInstantFrom(new Date(after), time)?.toISOString() ?? null
    // From 23:00 on March 7th, 2026, 2:30 is skipped the next night, rather than shown the night after.
    expect(from('2026-03-08T04:00:00Z', '02:30')).toBeNull()
    expect(from('2026-03-08T04:00:00Z', '03:00')).toBe('2026-03-08T07:00:00.000Z')
    // From 1:00 on March 8th, too.
    expect(from('2026-03-08T06:00:00Z', '02:30')).toBeNull()
    // From 4:00 on March 8th, 2:30 comes the next day, which has it.
    expect(from('2026-03-08T08:00:00Z', '02:30')).toBe('2026-03-09T06:30:00.000Z')
    expect(from('2026-03-08T04:00:00Z', '25:00')).toBeNull()
  })

  it("doesn't depend on the browser's time zone", async () => {
    // Loaded again in Tokyo's time zone, since formatters keep the one they're created in.
    vi.stubEnv('TZ', 'Asia/Tokyo')
    vi.resetModules()
    const { quebecDayAndTime, quebecInstant } = await import('./quebec-time')
    expect(new Date('2026-11-15T02:00:00Z').getHours()).toBe(11)
    expect(quebecInstant('2026-11-14', '21:00')?.toISOString()).toBe('2026-11-15T02:00:00.000Z')
    expect(quebecDayAndTime(new Date('2026-11-15T02:00:00Z'))).toEqual({ day: '2026-11-14', time: '21:00' })
    expect(quebecInstant('2026-03-08', '02:30')).toBeNull()
  })

  it('adds days, across months and years', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })
})
