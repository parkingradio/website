import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReceivedAt } from './application-fields.js'
import type { ApplicationFields } from './application-fields.js'
import { validateApplication } from './applications.js'

// The rules in application-fields.ts, which every application has to follow. The server answers with the first error.

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

  it('only takes prestations from the list, by their id, without duplicates', () => {
    expect(validateApplication(fields({ prestations: ['full-band', 'vinyl', 'full-band', 'rap'] })).prestations).toEqual(['vinyl', 'rap', 'full-band'])
    expect(validateApplication(fields({ prestations: [] })).prestations).toEqual([])
    for (const prestation of ['DJ', 'Performance Live', 'modular', '', 42, null]) {
      expect(() => validateApplication(fields({ prestations: ['dj', prestation] }))).toThrow("Une des prestations n'est pas dans la liste.")
    }
  })

  it('trims the other prestation, and limits its length', () => {
    expect(validateApplication(fields({ otherPrestation: '  Modular\n synth  ' })).otherPrestation).toBe('Modular synth')
    expect(validateApplication(fields({ otherPrestation: 'x'.repeat(60) })).otherPrestation).toHaveLength(60)
    expect(() => validateApplication(fields({ otherPrestation: 'x'.repeat(61) }))).toThrow('La prestation « Autre » dépasse 60 caractères.')
  })

  it('trims the details, and limits their length', () => {
    expect(validateApplication(fields({ details: '  Une question ?\n' })).details).toBe('Une question ?')
    expect(validateApplication(fields({ details: 'x'.repeat(2000) })).details).toHaveLength(2000)
    expect(() => validateApplication(fields({ details: 'x'.repeat(2001) }))).toThrow('Le champ « Questions ou détails » dépasse 2000 caractères.')
  })

  it('refuses anything but an object, with the error of the dates', () => {
    for (const sent of [null, undefined, 'application', 42, [], {}]) {
      expect(() => validateApplication(sent)).toThrow('Choisissez au moins une date.')
    }
  })

  it('explains, in French, what is wrong with a field that is missing, or of the wrong type', () => {
    const invalid = [
      { field: 'timeSlots', other: '18:00-22:00', error: 'Les plages horaires sont invalides.' },
      { field: 'prestations', other: 'dj', error: 'Les prestations sont invalides.' },
      { field: 'otherPrestation', other: ['Visuels'], error: 'La prestation « Autre » est invalide.' },
      { field: 'details', other: ['Une question ?'], error: 'Le champ « Questions ou détails » est invalide.' },
    ]
    for (const { field, other, error } of invalid) {
      for (const value of [undefined, null, 42, true, other, {}]) {
        expect(() => validateApplication(fields({ [field]: value }))).toThrow(error)
      }
    }
  })

  it('says what is wrong with the first field that is wrong, in the order of the application', () => {
    const sent = { dates: [''], timeSlots: [{ start: '18:00', end: '' }], prestations: ['modular'], otherPrestation: 'x'.repeat(61), details: 'x'.repeat(2001) }
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

  it('takes a date and time with its offset from UTC, up to now', () => {
    expect(check('0001-01-01T00:00Z')).toEqual({ value: new Date('0001-01-01T00:00:00Z') })
    expect(check('2026-03-28T10:03-04:00')).toEqual({ value: new Date('2026-03-28T14:03:00Z') })
    expect(check('2026-03-28T14:03:07.123Z')).toEqual({ value: new Date('2026-03-28T14:03:07.123Z') })
    expect(check('2026-10-14T18:00:00Z')).toEqual({ value: now })
    expect(check('2026-10-14T19:00:00+01:00')).toEqual({ value: now })
  })

  it('takes nothing as nothing', () => {
    expect(check(undefined)).toEqual({ value: undefined })
  })

  it('refuses a date and time in the future', () => {
    for (const sent of ['2026-10-14T18:00:00.001Z', '2026-10-14T14:01:00-04:00', '2027-01-01T00:00:00Z']) {
      expect(check(sent)).toEqual({ error: 'La date de réception ne peut pas être dans le futur.' })
    }
  })

  it('refuses anything but a date and time that exist, with their offset from UTC', () => {
    const invalid = ['0000-06-01T00:00Z', '0001-01-01T00:00+04:00', '2026-03-28', '2026-03-28T10:03', '2026-03-28 10:03Z', '2026-02-29T10:03Z', '2026-03-28T24:00Z', '2026-03-28T10:60Z', '2026-03-28T10:03+24:00', '', null, 1774706580000]
    for (const sent of invalid) expect(check(sent)).toEqual({ error: 'La date de réception est invalide.' })
  })
})
