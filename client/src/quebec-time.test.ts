import { afterEach, describe, expect, it, vi } from 'vitest'
import { addDays, daysBetween, quebecDateTime, quebecDayAndTime, quebecInstant, quebecInstants } from './quebec-time'

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

  it('gives every instant of a day and time in Québec: none when clocks skip it, and both when they show it twice', () => {
    const instants = (day: string, time: string) => quebecInstants(day, time).map((instant) => instant.toISOString())
    expect(instants('2026-11-14', '21:00')).toEqual(['2026-11-15T02:00:00.000Z'])
    expect(instants('2026-11-01', '01:30')).toEqual(['2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z'])
    expect(instants('2026-11-01', '02:00')).toEqual(['2026-11-01T07:00:00.000Z'])
    expect(instants('2026-03-08', '02:30')).toEqual([])
    expect(instants('2026-03-08', '25:00')).toEqual([])
    expect(instants('2026-02-30', '21:00')).toEqual([])
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

  it('counts the days between two days, across months, years and changes of the clocks', () => {
    expect(daysBetween('2026-11-14', '2026-11-15')).toBe(1)
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2)
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1)
    expect(daysBetween('2026-11-21', '2026-11-14')).toBe(-7)
  })
})
