import { describe, expect, it } from 'vitest'
import { isDay, isTime } from 'shared/applications'
import type { ApplicationFields } from 'shared/applications'
import { validateApplication } from './applications.js'

// Tests for the rules in shared/src/applications.ts.

function fields(changes: Partial<Record<keyof ApplicationFields, unknown>> = {}) {
  return {
    dates: ['2027-01-15', '2026-12-10'],
    timeSlots: [
      { start: '18:00', end: '22:00' },
      { start: '11:00', end: '15:00' },
    ],
    prestations: ['Performance live', 'DJ'],
    details: '',
    ...changes,
  }
}

describe('isDay', () => {
  it('only knows days that exist', () => {
    expect(isDay('2026-12-31')).toBe(true)
    expect(isDay('2028-02-29')).toBe(true)
    for (const value of ['2027-02-29', '2026-13-01', '2026-12-1', '2026-12-01T00:00', '']) expect(isDay(value)).toBe(false)
  })
})

describe('isTime', () => {
  it('only knows times of day, as HH:MM', () => {
    for (const value of ['00:00', '09:30', '23:59']) expect(isTime(value)).toBe(true)
    for (const value of ['24:00', '9:30', '12:60', '12:00:00', '']) expect(isTime(value)).toBe(false)
  })
})

describe('validateApplication', () => {
  it('keeps dates and time slots in order, without duplicates, and prestations as they were sent', () => {
    const slot = { start: '18:00', end: '22:00' }
    expect(validateApplication(fields({ dates: ['2027-01-15', '2026-12-10', '2027-01-15'], timeSlots: [slot, { start: '11:00', end: '15:00' }, slot] }))).toEqual({
      dates: ['2026-12-10', '2027-01-15'],
      timeSlots: [{ start: '11:00', end: '15:00' }, slot],
      prestations: ['Performance live', 'DJ'],
      details: '',
    })
  })

  it('requires at least one date, of any day that exists, past or future', () => {
    expect(() => validateApplication(fields({ dates: [] }))).toThrow('Choisis au moins une date.')
    expect(() => validateApplication(fields({ dates: undefined }))).toThrow('Choisis au moins une date.')
    expect(() => validateApplication(fields({ dates: ['2027-02-30'] }))).toThrow('Une des dates est invalide.')
    expect(() => validateApplication(fields({ dates: [20270115] }))).toThrow('Une des dates est invalide.')
    expect(validateApplication(fields({ dates: ['2099-12-31', '2020-02-29'] })).dates).toEqual(['2020-02-29', '2099-12-31'])
    const many = Array.from({ length: 60 }, (_, i) => `2027-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`)
    expect(validateApplication(fields({ dates: many })).dates).toHaveLength(60)
  })

  it('takes any time slot within a day, and none as any time', () => {
    expect(validateApplication(fields({ timeSlots: [{ start: '00:00', end: '23:59' }] })).timeSlots).toEqual([{ start: '00:00', end: '23:59' }])
    expect(validateApplication(fields({ timeSlots: [] })).timeSlots).toEqual([])
    expect(validateApplication(fields({ timeSlots: undefined })).timeSlots).toEqual([])
    // Only the start and the end are kept.
    expect(validateApplication(fields({ timeSlots: [{ start: '13:00', end: '17:00', label: 'x' }] })).timeSlots).toEqual([{ start: '13:00', end: '17:00' }])
  })

  it('refuses time slots that are not times of day, or that end before they start', () => {
    for (const slot of [{ start: '22:00', end: '18:00' }, { start: '18:00', end: '18:00' }, { start: '18:00' }, { start: '18h', end: '22h' }, '18-22', null]) {
      expect(() => validateApplication(fields({ timeSlots: [slot] }))).toThrow('Une des plages horaires est invalide.')
    }
  })

  it('trims prestations, without blank ones or duplicates whatever their case, and limits their length', () => {
    expect(validateApplication(fields({ prestations: ['  Modular\n synth  ', 'DJ', 'dj', '  '] })).prestations).toEqual(['Modular synth', 'DJ'])
    expect(validateApplication(fields({ prestations: [] })).prestations).toEqual([])
    expect(validateApplication(fields({ prestations: undefined })).prestations).toEqual([])
    expect(() => validateApplication(fields({ prestations: ['x'.repeat(61)] }))).toThrow('Une prestation dépasse 60 caractères.')
  })

  it('trims the details, and limits their length', () => {
    expect(validateApplication(fields({ details: '  Une question ?\n' })).details).toBe('Une question ?')
    expect(validateApplication(fields({ details: 'x'.repeat(2000) })).details).toHaveLength(2000)
    expect(() => validateApplication(fields({ details: 'x'.repeat(2001) }))).toThrow('Le champ « Questions ou détails » dépasse 2000 caractères.')
  })

  it('refuses anything but an object', () => {
    for (const sent of [null, undefined, 'application', 42]) {
      expect(() => validateApplication(sent)).toThrow('Choisis au moins une date.')
    }
  })
})
