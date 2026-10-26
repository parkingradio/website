import { describe, expect, it } from 'vitest'
import { checkApplication, checkReceivedAt, isDay, isTime } from './application-fields'
import type { ApplicationFields } from './application-fields'

// The client's copy of the server's rules for applications (see server/src/application-fields.ts), which the forms check
// as the server does.

function fields(changes: Partial<ApplicationFields> = {}): ApplicationFields {
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

describe('checkApplication', () => {
  it('returns what the server would save: dates, time slots and prestations in order, without duplicates, and text trimmed', () => {
    const slot = { start: '18:00', end: '22:00' }
    const sent = fields({
      dates: ['2027-01-15', '2026-12-10', '2027-01-15'],
      timeSlots: [slot, { start: '11:00', end: '15:00' }, slot],
      prestations: ['full-band', 'vinyl', 'full-band'],
      otherPrestation: '  Synthé\n  modulaire ',
      details: ' Une question ?\n',
    })
    expect(checkApplication(sent)).toEqual({
      application: {
        dates: ['2026-12-10', '2027-01-15'],
        timeSlots: [{ start: '11:00', end: '15:00' }, slot],
        prestations: ['vinyl', 'full-band'],
        otherPrestation: 'Synthé modulaire',
        details: 'Une question ?',
      },
    })
  })

  it('says what is wrong with every field that is wrong, for forms to show each error by its field', () => {
    const sent = fields({ dates: [''], timeSlots: [{ start: '18:00', end: '' }], otherPrestation: 'x'.repeat(61), details: 'x'.repeat(2001) })
    expect(checkApplication(sent)).toEqual({
      errors: {
        dates: 'Une des dates est invalide.',
        timeSlots: 'Une des plages horaires est invalide.',
        otherPrestation: 'La prestation « Autre » dépasse 60 caractères.',
        details: 'Le champ « Questions ou détails » dépasse 2000 caractères.',
      },
    })
  })

  it('requires a date, and takes no time slot as any time', () => {
    expect(checkApplication(fields({ dates: [] })).errors).toEqual({ dates: 'Choisissez au moins une date.' })
    expect(checkApplication(fields({ timeSlots: [] })).application?.timeSlots).toEqual([])
    for (const slot of [{ start: '22:00', end: '18:00' }, { start: '18:00', end: '18:00' }, { start: '18h', end: '22h' }]) {
      expect(checkApplication(fields({ timeSlots: [slot] })).errors).toEqual({ timeSlots: 'Une des plages horaires est invalide.' })
    }
  })
})

describe('checkReceivedAt', () => {
  const now = new Date('2026-10-14T18:00:00Z')

  it('takes any time up to now', () => {
    expect(checkReceivedAt(new Date('0001-01-01T00:00Z'), now)).toBeNull()
    expect(checkReceivedAt(now, now)).toBeNull()
  })

  it('refuses a time in the future, or before year 1, which the database does not have', () => {
    expect(checkReceivedAt(new Date('2026-10-14T18:00:00.001Z'), now)).toBe('La date de réception ne peut pas être dans le futur.')
    expect(checkReceivedAt(new Date('0001-01-01T00:00+04:00'), now)).toBe('La date de réception est invalide.')
  })
})
