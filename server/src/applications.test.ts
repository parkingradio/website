import { describe, expect, it } from 'vitest'
import { checkApplication, checkReceivedAt, isDay, isTime } from 'shared/applications'
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
    prestations: ['live-performance', 'dj'],
    otherPrestation: '',
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
  it('keeps dates, time slots and prestations in order, without duplicates', () => {
    const slot = { start: '18:00', end: '22:00' }
    expect(validateApplication(fields({ dates: ['2027-01-15', '2026-12-10', '2027-01-15'], timeSlots: [slot, { start: '11:00', end: '15:00' }, slot] }))).toEqual({
      dates: ['2026-12-10', '2027-01-15'],
      timeSlots: [{ start: '11:00', end: '15:00' }, slot],
      // In the order of PRESTATIONS.
      prestations: ['dj', 'live-performance'],
      otherPrestation: '',
      details: '',
    })
  })

  it('requires at least one date, of any day that exists, past or future', () => {
    expect(() => validateApplication(fields({ dates: [] }))).toThrow('Choisissez au moins une date.')
    expect(() => validateApplication(fields({ dates: undefined }))).toThrow('Choisissez au moins une date.')
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

  it('only takes prestations from the list, by their id, without duplicates', () => {
    expect(validateApplication(fields({ prestations: ['full-band', 'vinyl', 'full-band', 'rap'] })).prestations).toEqual(['vinyl', 'rap', 'full-band'])
    expect(validateApplication(fields({ prestations: [] })).prestations).toEqual([])
    expect(validateApplication(fields({ prestations: undefined })).prestations).toEqual([])
    for (const prestation of ['DJ', 'Performance Live', 'modular', '', 42, null]) {
      expect(() => validateApplication(fields({ prestations: ['dj', prestation] }))).toThrow("Une des prestations n'est pas dans la liste.")
    }
  })

  it('trims the other prestation, and limits its length', () => {
    expect(validateApplication(fields({ otherPrestation: '  Modular\n synth  ' })).otherPrestation).toBe('Modular synth')
    expect(validateApplication(fields({ otherPrestation: undefined })).otherPrestation).toBe('')
    expect(validateApplication(fields({ otherPrestation: 'x'.repeat(60) })).otherPrestation).toHaveLength(60)
    expect(() => validateApplication(fields({ otherPrestation: 'x'.repeat(61) }))).toThrow('La prestation « Autre » dépasse 60 caractères.')
  })

  it('trims the details, and limits their length', () => {
    expect(validateApplication(fields({ details: '  Une question ?\n' })).details).toBe('Une question ?')
    expect(validateApplication(fields({ details: 'x'.repeat(2000) })).details).toHaveLength(2000)
    expect(() => validateApplication(fields({ details: 'x'.repeat(2001) }))).toThrow('Le champ « Questions ou détails » dépasse 2000 caractères.')
  })

  it('refuses anything but an object', () => {
    for (const sent of [null, undefined, 'application', 42]) {
      expect(() => validateApplication(sent)).toThrow('Choisissez au moins une date.')
    }
  })
})

describe('checkApplication', () => {
  it('says what is wrong with every field that is wrong, for forms to show each error by its field', () => {
    const sent = { dates: [''], timeSlots: [{ start: '18:00', end: '' }], prestations: ['modular'], otherPrestation: 'x'.repeat(61), details: 'x'.repeat(2001) }
    expect(checkApplication(sent)).toEqual({
      errors: {
        dates: 'Une des dates est invalide.',
        timeSlots: 'Une des plages horaires est invalide.',
        prestations: "Une des prestations n'est pas dans la liste.",
        otherPrestation: 'La prestation « Autre » dépasse 60 caractères.',
        details: 'Le champ « Questions ou détails » dépasse 2000 caractères.',
      },
    })
  })

  it('returns the application without errors when it is valid', () => {
    const { application, errors } = checkApplication(fields())
    expect(errors).toBeUndefined()
    expect(application?.dates).toEqual(['2026-12-10', '2027-01-15'])
  })
})

describe('checkReceivedAt', () => {
  const now = new Date('2026-10-14T18:00:00Z')

  it('takes a date and time with its offset from UTC, up to now', () => {
    expect(checkReceivedAt('0001-01-01T00:00Z', now)).toEqual({ value: new Date('0001-01-01T00:00:00Z') })
    expect(checkReceivedAt('2026-03-28T10:03-04:00', now)).toEqual({ value: new Date('2026-03-28T14:03:00Z') })
    expect(checkReceivedAt('2026-03-28T14:03:07.123Z', now)).toEqual({ value: new Date('2026-03-28T14:03:07.123Z') })
    expect(checkReceivedAt('2026-10-14T18:00:00Z', now)).toEqual({ value: now })
    expect(checkReceivedAt('2026-10-14T19:00:00+01:00', now)).toEqual({ value: now })
  })

  it('takes nothing as nothing', () => {
    expect(checkReceivedAt(undefined, now)).toEqual({ value: undefined })
  })

  it('refuses a date and time in the future', () => {
    for (const sent of ['2026-10-14T18:00:00.001Z', '2026-10-14T14:01:00-04:00', '2027-01-01T00:00:00Z']) {
      expect(checkReceivedAt(sent, now)).toEqual({ error: 'La date de réception ne peut pas être dans le futur.' })
    }
  })

  it('refuses anything but a date and time that exist, with their offset from UTC', () => {
    const invalid = ['0000-06-01T00:00Z', '0001-01-01T00:00+04:00', '2026-03-28', '2026-03-28T10:03', '2026-03-28 10:03Z', '2026-02-29T10:03Z', '2026-03-28T24:00Z', '2026-03-28T10:60Z', '2026-03-28T10:03+24:00', '', null, 1774706580000]
    for (const sent of invalid) expect(checkReceivedAt(sent, now)).toEqual({ error: 'La date de réception est invalide.' })
  })
})
