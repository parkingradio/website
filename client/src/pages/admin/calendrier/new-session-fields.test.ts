import { describe, expect, it } from 'vitest'
import { checkSessionOnDay } from './new-session-fields'
import type { NewSessionOnDay } from './new-session-fields'

// Québec's clocks go back on 2026-11-01, and forward on 2027-03-14.

describe('a new session on a day', () => {
  const on = (day: string, start: string, end: string, changes: Partial<NewSessionOnDay> = {}) =>
    checkSessionOnDay(day, { start, end, type: 'guest-mixes', takeover: null, name: '', ...changes })

  it('ends on the day when its end is after its start, and otherwise the next day', () => {
    expect(on('2026-11-21', '19:00', '23:00')).toMatchObject({ fields: { start: '2026-11-21T19:00-05:00', durationMinutes: 240 }, durationMinutes: 240, endsNextDay: false })
    expect(on('2026-11-21', '21:00', '01:00')).toMatchObject({ fields: { start: '2026-11-21T21:00-05:00', durationMinutes: 240 }, durationMinutes: 240, endsNextDay: true })
    // Equal times are refused, as the session form refuses them.
    expect(on('2026-11-21', '21:00', '21:00')).toEqual({ errors: { end: 'La fin doit être après le début.' }, durationMinutes: null, endsNextDay: false })
    expect(on('2026-11-21', '', '')).toEqual({ errors: { start: "Indiquez l'heure de début.", end: "Indiquez l'heure de fin." }, durationMinutes: null, endsNextDay: false })
    // How long it lasts once its times are valid, whatever else is wrong.
    expect(on('2026-11-21', '21:00', '01:00', { type: null })).toMatchObject({ durationMinutes: 240, endsNextDay: true })
  })

  it('follows the clocks', () => {
    // The first 1 h, as the clocks go back.
    expect(on('2026-10-31', '21:00', '01:00').fields).toMatchObject({ start: '2026-10-31T21:00-04:00', durationMinutes: 240 })
    // Equal times, though the second 1 h 30 is after the first.
    expect(on('2026-11-01', '01:30', '01:30').errors).toEqual({ end: 'La fin doit être après le début.' })
    // An earlier time is the next day's, even when it's also later that night.
    expect(on('2026-11-01', '01:30', '01:15').fields).toMatchObject({ start: '2026-11-01T01:30-04:00', durationMinutes: 1485 })
    // A time they skip, as they go forward.
    expect(on('2027-03-13', '23:00', '02:30').errors).toEqual({ end: "Cette heure n'existe pas cette nuit-là, au passage à l'heure d'été." })
    // Within the years 2000 to 2999, in UTC.
    expect(on('2999-12-31', '18:00', '20:00').errors).toEqual({ endDay: 'Une session a lieu entre les années 2000 et 2999.' })
  })

  it('sends only what it has, and only a takeover its collective, and "Autre" its name', () => {
    const collective = { id: 'collective-1', name: 'Haute Rive' }
    expect(on('2026-11-21', '21:00', '01:00', { type: 'takeover', takeover: collective, name: 'SOIRÉE' }).fields).toEqual({
      start: '2026-11-21T21:00-05:00',
      durationMinutes: 240,
      type: 'takeover',
      takeover: 'collective-1',
      application: null,
      name: '',
      raEvent: null,
      description: '',
    })
    expect(on('2026-11-21', '21:00', '01:00', { type: 'other', takeover: collective, name: ' ATELIER ' }).fields).toMatchObject({ type: 'other', takeover: null, name: 'ATELIER' })
    expect(on('2026-11-21', '21:00', '01:00', { type: 'other' }).errors).toEqual({ name: 'Indiquez le nom de la session.' })
    // A name that's too long, but isn't shown, doesn't keep it from being sent.
    expect(on('2026-11-21', '21:00', '01:00', { name: 'x'.repeat(101) }).errors).toBeUndefined()
    expect(on('2026-11-21', '21:00', '01:00', { type: null }).errors).toEqual({ type: 'Choisissez le type de la session.' })
  })
})
