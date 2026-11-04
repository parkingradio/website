import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReceivedAt } from './fields.js'
import type { ApplicationFields } from './fields.js'
import { validateApplication } from './store.js'

const BAD_RECEIVED_AT =
  'La date de réception doit être une date et une heure du Québec, avec le décalage horaire en vigueur alors (-05:00, ou ' +
  '-04:00 du deuxième dimanche de mars à 2 h au premier dimanche de novembre à 2 h), sauf une heure sautée au passage à ' +
  "l'heure avancée, par exemple 2026-11-14T21:00-05:00."

// The rules in applications/fields.ts, which every application has to follow. The server answers with the first error.

function fields(changes: Partial<Record<keyof ApplicationFields, unknown>> = {}) {
  return {
    dates: ['2027-01-15', '2026-12-10'],
    timeSlots: [
      { start: '18:00', end: '22:00' },
      { start: '11:00', end: '15:00' },
    ],
    performanceTypes: ['live-performance', 'dj'],
    otherPerformanceType: '',
    details: '',
    ...changes,
  }
}

describe('validateApplication', () => {
  it('keeps dates, time slots and performance types in order, without duplicates', () => {
    const slot = { start: '18:00', end: '22:00' }
    expect(validateApplication(fields({ dates: ['2027-01-15', '2026-12-10', '2027-01-15'], timeSlots: [slot, { start: '11:00', end: '15:00' }, slot] }))).toEqual({
      dates: ['2026-12-10', '2027-01-15'],
      timeSlots: [{ start: '11:00', end: '15:00' }, slot],
      // In the order of PERFORMANCE_TYPES.
      performanceTypes: ['dj', 'live-performance'],
      otherPerformanceType: '',
      details: '',
    })
  })

  it('requires at least one date, of any day that exists, past or future', () => {
    expect(() => validateApplication(fields({ dates: [] }))).toThrow('Choisissez au moins une date.')
    expect(() => validateApplication(fields({ dates: undefined }))).toThrow('Choisissez au moins une date.')
    expect(() => validateApplication(fields({ dates: ['2027-02-30'] }))).toThrow('Une des dates est invalide.')
    for (const date of [20270115, '2026-13-01', '2026-12-1', '2026-12-01T00:00', '', null]) {
      expect(() => validateApplication(fields({ dates: ['2027-01-15', date] }))).toThrow('Une des dates est invalide.')
    }
    expect(() => validateApplication(fields({ dates: '2027-01-15' }))).toThrow('Choisissez au moins une date.')
    expect(validateApplication(fields({ dates: ['2099-12-31', '2020-02-29'] })).dates).toEqual(['2020-02-29', '2099-12-31'])
    const many = Array.from({ length: 60 }, (_, i) => `2027-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`)
    expect(validateApplication(fields({ dates: many })).dates).toHaveLength(60)
  })

  it('takes any time slot within a day, and none as any time', () => {
    expect(validateApplication(fields({ timeSlots: [{ start: '00:00', end: '23:59' }] })).timeSlots).toEqual([{ start: '00:00', end: '23:59' }])
    expect(validateApplication(fields({ timeSlots: [] })).timeSlots).toEqual([])
    // Only the start and the end are kept.
    expect(validateApplication(fields({ timeSlots: [{ start: '13:00', end: '17:00', label: 'x' }] })).timeSlots).toEqual([{ start: '13:00', end: '17:00' }])
  })

  it('refuses time slots that are not times of day, or that end before they start', () => {
    const invalid = [
      { start: '22:00', end: '18:00' },
      { start: '18:00', end: '18:00' },
      { start: '18:00' },
      { start: '18h', end: '22h' },
      { start: '9:00', end: '22:00' },
      { start: '18:00', end: '24:00' },
      { start: '18:00', end: '22:00:00' },
      { start: 1800, end: 2200 },
      '18-22',
      null,
    ]
    for (const slot of invalid) {
      expect(() => validateApplication(fields({ timeSlots: [slot] }))).toThrow('Une des plages horaires est invalide.')
    }
  })

  it('only takes performance types from the list, by their id, without duplicates', () => {
    expect(validateApplication(fields({ performanceTypes: ['full-band', 'vinyl', 'full-band', 'rap'] })).performanceTypes).toEqual(['vinyl', 'rap', 'full-band'])
    expect(validateApplication(fields({ performanceTypes: [] })).performanceTypes).toEqual([])
    for (const performanceType of ['DJ', 'Performance Live', 'modular', '', 42, null]) {
      expect(() => validateApplication(fields({ performanceTypes: ['dj', performanceType] }))).toThrow("Une des prestations n'est pas dans la liste.")
    }
  })

  it('trims the other performance type, and limits its length', () => {
    expect(validateApplication(fields({ otherPerformanceType: '  Modular\n synth  ' })).otherPerformanceType).toBe('Modular synth')
    expect(validateApplication(fields({ otherPerformanceType: 'x'.repeat(60) })).otherPerformanceType).toHaveLength(60)
    expect(() => validateApplication(fields({ otherPerformanceType: 'x'.repeat(61) }))).toThrow('La prestation « Autre » dépasse 60 caractères.')
  })

  it('trims the details, and limits their length', () => {
    expect(validateApplication(fields({ details: '  Une question ?\n' })).details).toBe('Une question ?')
    expect(validateApplication(fields({ details: 'x'.repeat(2000) })).details).toHaveLength(2000)
    expect(() => validateApplication(fields({ details: 'x'.repeat(2001) }))).toThrow('Le champ « Questions ou détails » dépasse 2000 caractères.')
    expect(() => validateApplication(fields({ details: 'Une\0question' }))).toThrow('Le champ « Questions ou détails » contient un caractère invalide.')
  })

  it('refuses anything but an object, with the error of the dates', () => {
    for (const sent of [null, undefined, 'application', 42, [], {}]) {
      expect(() => validateApplication(sent)).toThrow('Choisissez au moins une date.')
    }
  })

  it('explains, in French, what is wrong with a field that is missing, or of the wrong type', () => {
    const invalid = [
      { field: 'timeSlots', other: '18:00-22:00', error: 'Les plages horaires sont invalides.' },
      { field: 'performanceTypes', other: 'dj', error: 'Les prestations sont invalides.' },
      { field: 'otherPerformanceType', other: ['Visuels'], error: 'La prestation « Autre » est invalide.' },
      { field: 'details', other: ['Une question ?'], error: 'Le champ « Questions ou détails » est invalide.' },
    ]
    for (const { field, other, error } of invalid) {
      for (const value of [undefined, null, 42, true, other, {}]) {
        expect(() => validateApplication(fields({ [field]: value }))).toThrow(error)
      }
    }
  })

  it('says what is wrong with the first field that is wrong, in the order of the application', () => {
    const sent = { dates: [''], timeSlots: [{ start: '18:00', end: '' }], performanceTypes: ['modular'], otherPerformanceType: 'x'.repeat(61), details: 'x'.repeat(2001) }
    const errors = ['Une des dates est invalide.', 'Une des plages horaires est invalide.', "Une des prestations n'est pas dans la liste.", 'La prestation « Autre » dépasse 60 caractères.', 'Le champ « Questions ou détails » dépasse 2000 caractères.']
    for (const [index, field] of Object.keys(sent).entries()) {
      expect(() => validateApplication({ ...fields(), ...Object.fromEntries(Object.entries(sent).slice(index)) })).toThrow(errors[index])
      expect(() => validateApplication(fields({ [field]: sent[field as keyof typeof sent] }))).toThrow(errors[index])
    }
  })
})

describe('ReceivedAt', () => {
  const now = new Date('2026-10-14T18:00:00Z')
  const check = (sent: unknown) => {
    const result = ReceivedAt.optional().safeParse(sent)
    return result.success ? { value: result.data } : { error: result.error.issues[0].message }
  }

  beforeEach(() => {
    vi.useFakeTimers({ now })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("takes a date and time with Québec's offset then, from the year 2000, in UTC, up to now", () => {
    expect(check('1999-12-31T19:00-05:00')).toEqual({ value: new Date('2000-01-01T00:00:00Z') })
    expect(check('2026-03-28T10:03-04:00')).toEqual({ value: new Date('2026-03-28T14:03:00Z') })
    expect(check('2026-03-28T10:03:07.123-04:00')).toEqual({ value: new Date('2026-03-28T14:03:07.123Z') })
    expect(check('2026-03-08T00:00-05:00')).toEqual({ value: new Date('2026-03-08T05:00:00Z') })
    expect(check('2026-10-14T14:00:00-04:00')).toEqual({ value: now })
  })

  it('takes either offset the night the clocks go back, when the hour before 2:00 happens twice', () => {
    expect(check('2025-11-02T01:30-04:00')).toEqual({ value: new Date('2025-11-02T05:30:00Z') })
    expect(check('2025-11-02T01:30-05:00')).toEqual({ value: new Date('2025-11-02T06:30:00Z') })
  })

  it('takes nothing as nothing', () => {
    expect(check(undefined)).toEqual({ value: undefined })
  })

  it('refuses a date and time before the year 2000, in UTC', () => {
    for (const sent of ['1999-12-31T18:59:59.999-05:00', '1999-07-01T12:00-04:00', '1900-01-01T00:00-05:00']) {
      expect(check(sent)).toEqual({ error: "La date de réception doit être en l'an 2000 ou après." })
    }
  })

  it('refuses a date and time in the future', () => {
    for (const sent of ['2026-10-14T14:00:00.001-04:00', '2026-10-14T14:01-04:00', '2027-01-01T00:00:00-05:00']) {
      expect(check(sent)).toEqual({ error: 'La date de réception ne peut pas être dans le futur.' })
    }
  })

  it("refuses anything but a date and time that exist in Québec, with Québec's offset then", () => {
    const invalid = [
      '2026-03-28',
      '2026-03-28T10:03',
      '2026-03-28 10:03-04:00',
      '2026-02-29T10:03-05:00',
      '2026-03-28T24:00-04:00',
      '2026-03-28T10:60-04:00',
      '2026-03-28T10:03+24:00',
      // Other offsets than Québec's then.
      '2026-03-28T14:03Z',
      '2026-03-28T14:03+00:00',
      '2026-03-28T14:03-00:00',
      '2026-03-28T15:03+01:00',
      '2026-03-28T09:03-05:00',
      // Clocks skip from 2:00 to 3:00 that night.
      '2026-03-08T02:30-05:00',
      '2026-03-08T02:30-04:00',
      // Québec's offset wasn't whole minutes before 1895.
      '0001-01-01T00:00-05:00',
      '',
      null,
      1774706580000,
    ]
    for (const sent of invalid) expect(check(sent), String(sent)).toEqual({ error: BAD_RECEIVED_AT })
  })
})
