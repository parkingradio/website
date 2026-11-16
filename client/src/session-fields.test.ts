import { describe, expect, it } from 'vitest'
import type { Application } from './application-fields'
import {
  EMPTY_SESSION_FORM,
  findApplication,
  checkSession,
  checkSet,
  durationOf,
  listedSet,
  listedSetFields,
  minutesOf,
  newSetFormValues,
  sessionFormValues,
  sessionTimes,
  startChanges,
  setFormValues,
  newSetDuration,
  shownSet,
  typeName,
  setsMinutes,
} from './session-fields'
import type { Session, SessionFormValues, SetFormValues, StudioSet } from './session-fields'

// The client's copies of the server's rules for sessions and sets, which must agree with them (see
// server/src/sessions/fields.test.ts), and how the forms' times of day become what the server takes.

const TRACKED = {
  createdAt: '2026-10-01T16:00:00.000Z',
  createdBy: 'admin@example.com',
  updatedBy: null,
  updatedAt: null,
  status: 'planned' as const,
  statusUpdatedBy: null,
  statusUpdatedAt: null,
}

// An application, as a session or a set gives it.
const link = (id: string) => ({ id, receivedAt: '2026-09-01T16:00:00.000Z' })

function studioSet(fields: Partial<StudioSet>): StudioSet {
  return {
    id: 'set-1',
    performers: [{ id: 'artist-1', name: 'Aurore' }],
    durationMinutes: null,
    performanceTypes: [],
    otherPerformanceType: '',
    genres: [],
    soundcloudTrack: null,
    youtubeVideo: null,
    application: null,
    ...TRACKED,
    ...fields,
  }
}

function session(start: string | null, durationMinutes: number, sets: StudioSet[] = []): Session {
  return {
    id: 'session-1',
    start,
    end: start && new Date(Date.parse(start) + durationMinutes * 60000).toISOString(),
    durationMinutes,
    type: 'guest-mixes',
    takeover: null,
    application: null,
    name: '',
    title: 'GUEST MIXES',
    raEvent: null,
    description: '',
    effectiveDescription: 'LIVE STREAMING FROM QUÉBEC CITY. SPACE OPEN TO PUBLIC',
    hasFlyer: false,
    sets,
    ...TRACKED,
    announced: false,
    announcedUpdatedBy: null,
    announcedUpdatedAt: null,
  }
}

describe('durations', () => {
  it('are hours and minutes, either of which can be left empty, or both, for none', () => {
    expect(minutesOf({ hours: '1', minutes: '30' })).toBe(90)
    expect(minutesOf({ hours: '', minutes: '45' })).toBe(45)
    expect(minutesOf({ hours: '2', minutes: ' ' })).toBe(120)
    expect(minutesOf({ hours: '', minutes: '' })).toBeNull()
    expect(minutesOf({ hours: '1', minutes: '60' })).toBeUndefined()
    expect(minutesOf({ hours: '-1', minutes: '' })).toBeUndefined()
    expect(minutesOf({ hours: '1.5', minutes: '' })).toBeUndefined()
    expect(durationOf(90)).toEqual({ hours: '1', minutes: '30' })
    expect(durationOf(null)).toEqual({ hours: '', minutes: '' })
  })
})

describe('sessionTimes', () => {
  const times = (day: string, start: string, endDay: string, end: string) => {
    const result = sessionTimes({ ...EMPTY_SESSION_FORM, day, start, endDay, end })
    return 'errors' in result ? result.errors : { start: result.start?.toISOString(), durationMinutes: result.durationMinutes }
  }

  it('starts and ends on their days, in Québec time', () => {
    expect(times('2026-11-14', '21:00', '2026-11-14', '22:30')).toEqual({ start: '2026-11-15T02:00:00.000Z', durationMinutes: 90 })
    expect(times('2026-11-14', '23:00', '2026-11-15', '01:00')).toEqual({ start: '2026-11-15T04:00:00.000Z', durationMinutes: 120 })
  })

  it('lasts several days, if need be', () => {
    // A weekend.
    expect(times('2026-11-13', '18:00', '2026-11-15', '02:00')).toEqual({ start: '2026-11-13T23:00:00.000Z', durationMinutes: 32 * 60 })
    expect(times('2026-11-14', '21:00', '2027-11-14', '21:00')).toEqual({ start: '2026-11-15T02:00:00.000Z', durationMinutes: 365 * 24 * 60 })
  })

  it('refuses an end that is not after the start, rather than moving it to the next day', () => {
    const notAfter = { end: 'La fin doit être après le début.' }
    expect(times('2026-11-14', '23:00', '2026-11-14', '01:00')).toEqual(notAfter)
    expect(times('2026-11-14', '21:00', '2026-11-14', '21:00')).toEqual(notAfter)
    expect(times('2026-11-14', '21:00', '2026-11-13', '23:00')).toEqual(notAfter)
  })

  it('lasts as long as the clocks say, across a change of the clocks', () => {
    // Clocks fall back at 2:00 on November 1st, 2026: from midnight to 3:00 is 4 hours.
    expect(times('2026-11-01', '00:00', '2026-11-01', '03:00')).toEqual({ start: '2026-11-01T04:00:00.000Z', durationMinutes: 240 })
    expect(times('2026-10-31', '21:00', '2026-11-01', '21:00')).toEqual({ start: '2026-11-01T01:00:00.000Z', durationMinutes: 1500 })
    // When they spring forward, the same is 23 hours.
    expect(times('2026-03-07', '21:00', '2026-03-08', '21:00')).toEqual({ start: '2026-03-08T02:00:00.000Z', durationMinutes: 1380 })
  })

  it("refuses a time that clocks skip as they spring forward, at 2:00 on March 8th, 2026", () => {
    const skipped = "Cette heure n'existe pas cette nuit-là, au passage à l'heure d'été."
    expect(times('2026-03-08', '02:30', '2026-03-08', '04:00')).toEqual({ start: skipped })
    expect(times('2026-03-07', '23:00', '2026-03-08', '02:30')).toEqual({ end: skipped })
    expect(times('2026-03-08', '02:30', '2026-03-08', '02:45')).toEqual({ start: skipped, end: skipped })
  })

  it('takes the first of the two times that happen twice as the start, and the first of the two after the start as the end', () => {
    expect(times('2026-11-01', '01:30', '2026-11-01', '02:30')).toEqual({ start: '2026-11-01T05:30:00.000Z', durationMinutes: 120 })
    // The second 1:15, after the first 1:30.
    expect(times('2026-11-01', '01:30', '2026-11-01', '01:15')).toEqual({ start: '2026-11-01T05:30:00.000Z', durationMinutes: 45 })
    // The first 1:45, which is after the first 1:30.
    expect(times('2026-11-01', '01:30', '2026-11-01', '01:45')).toEqual({ start: '2026-11-01T05:30:00.000Z', durationMinutes: 15 })
    expect(times('2026-11-01', '00:30', '2026-11-01', '01:30')).toEqual({ start: '2026-11-01T04:30:00.000Z', durationMinutes: 60 })
  })

  it('says what is missing or invalid', () => {
    expect(times('', '', '', '')).toEqual({
      day: 'Choisissez la date de début.',
      start: "Indiquez l'heure de début.",
      endDay: 'Choisissez la date de fin.',
      end: "Indiquez l'heure de fin.",
    })
    expect(times('20261-01-01', '25:00', '2026-02-30', '21:00')).toEqual({
      day: 'La date de début est invalide.',
      start: "L'heure de début est invalide.",
      endDay: 'La date de fin est invalide.',
    })
  })

  it('checks that the session takes place within the years 2000 to 2999, in UTC', () => {
    const years = 'Une session a lieu entre les années 2000 et 2999.'
    // 19:00 in Québec is midnight in UTC, which is already 2000.
    expect(times('1999-12-31', '19:00', '1999-12-31', '20:00')).toEqual({ start: '2000-01-01T00:00:00.000Z', durationMinutes: 60 })
    expect(times('1999-12-31', '18:00', '1999-12-31', '20:00')).toEqual({ day: years })
    expect(times('2999-12-31', '19:00', '2999-12-31', '20:00')).toEqual({ day: years })
    // It ends by the start of 3000, which isn't part of it.
    expect(times('2999-12-31', '18:00', '2999-12-31', '19:00')).toEqual({ start: '2999-12-31T23:00:00.000Z', durationMinutes: 60 })
    expect(times('2999-12-31', '18:00', '2999-12-31', '19:01')).toEqual({ endDay: years })
    // As a year is typed in a date field.
    expect(times('0002-11-14', '21:00', '2026-11-15', '01:00')).toEqual({ day: years })
    expect(times('2026-11-14', '21:00', '0002-11-15', '01:00')).toEqual({ end: 'La fin doit être après le début.' })
  })

  it("takes only the duration of a session whose date isn't known yet, however long", () => {
    const undated = (hours: string, minutes: string) => {
      const result = sessionTimes({ ...EMPTY_SESSION_FORM, undated: true, day: 'x', duration: { hours, minutes } })
      return 'errors' in result ? result.errors : result
    }
    expect(undated('4', '')).toEqual({ start: null, durationMinutes: 240 })
    expect(undated('100', '1')).toEqual({ start: null, durationMinutes: 6001 })
    expect(undated('', '')).toEqual({ duration: 'Indiquez la durée de la session.' })
    expect(undated('0', '0')).toEqual({ duration: 'La durée est invalide.' })
    // Longer than the time from the start of 2000 to the start of 3000.
    expect(undated('8765832', '0')).toEqual({ start: null, durationMinutes: 525949920 })
    expect(undated('8765832', '1')).toEqual({ duration: 'La durée est invalide.' })
  })
})

describe('startChanges', () => {
  const form = (changes: Partial<SessionFormValues>): SessionFormValues => ({ ...EMPTY_SESSION_FORM, ...changes })

  it("gives the end the start's day while it has none, then keeps its distance in days from the start's", () => {
    expect(startChanges(form({}), { day: '2026-11-14' })).toEqual({ day: '2026-11-14', lastDay: '2026-11-14', endDay: '2026-11-14' })
    const overnight = form({ day: '2026-11-14', lastDay: '2026-11-14', endDay: '2026-11-15' })
    expect(startChanges(overnight, { day: '2026-11-21' })).toEqual({ day: '2026-11-21', lastDay: '2026-11-21', endDay: '2026-11-22' })
    expect(startChanges(overnight, { day: '2026-12-31' })).toMatchObject({ endDay: '2027-01-01' })
    // An end's day that the admin chose first stays.
    expect(startChanges(form({ endDay: '2026-11-15' }), { day: '2026-11-14' })).toEqual({ day: '2026-11-14', lastDay: '2026-11-14' })
  })

  it("keeps the distance from the last day the start had, while the start's day isn't one", () => {
    const overnight = form({ day: '2026-11-14', lastDay: '2026-11-14', endDay: '2026-11-15' })
    const cleared = { ...overnight, ...startChanges(overnight, { day: '' }) }
    expect(cleared).toMatchObject({ day: '', lastDay: '2026-11-14', endDay: '2026-11-15' })
    const typed = { ...cleared, ...startChanges(cleared, { day: '2026-11-02' }) }
    expect(typed).toMatchObject({ day: '2026-11-02', endDay: '2026-11-03' })
    expect({ ...typed, ...startChanges(typed, { day: '2026-11-21' }) }).toMatchObject({ day: '2026-11-21', endDay: '2026-11-22' })
  })

  it('keeps the distance through every year a date field goes through as a year is typed', () => {
    let typing = form({ day: '2026-11-14', lastDay: '2026-11-14', endDay: '2026-11-15', start: '21:00', end: '01:00' })
    for (const day of ['0002-11-21', '0020-11-21', '0202-11-21', '2027-11-21']) {
      typing = { ...typing, ...startChanges(typing, { day }) }
      expect(typing.endDay, day).toBe(`${day.slice(0, 4)}-11-22`)
    }
  })

  it('fills an empty end in, as long after the start as the duration, once the start is a day and a time the clocks show', () => {
    const undated = form({ duration: { hours: '2', minutes: '30' } })
    // The start's time first, then its day, or the other way around.
    expect(startChanges(undated, { start: '23:00' })).toEqual({ start: '23:00' })
    expect(startChanges({ ...undated, start: '23:00' }, { day: '2026-11-14' })).toEqual({ day: '2026-11-14', lastDay: '2026-11-14', endDay: '2026-11-15', end: '01:30' })
    const withDay = { ...undated, ...startChanges(undated, { day: '2026-11-14' }) }
    expect(withDay).toMatchObject({ endDay: '2026-11-14', end: '' })
    expect(startChanges(withDay, { start: '23:00' })).toEqual({ start: '23:00', endDay: '2026-11-15', end: '01:30' })
    // Across a change of the clocks, as they show it: 4 hours after 23:00 on October 31st, 2026, is 2:00.
    expect(startChanges({ ...undated, day: '2026-10-31', duration: { hours: '4', minutes: '' } }, { start: '23:00' })).toMatchObject({ endDay: '2026-11-01', end: '02:00' })
    // Not at a time the clocks skip, nor once there's an end, nor without a duration.
    expect(startChanges({ ...undated, day: '2026-03-08' }, { start: '02:30' })).toEqual({ start: '02:30' })
    expect(startChanges({ ...withDay, end: '22:00' }, { start: '21:00' })).toEqual({ start: '21:00' })
    expect(startChanges({ ...withDay, duration: { hours: '', minutes: '' } }, { start: '21:00' })).toEqual({ start: '21:00' })

    // A session that's changed keeps lasting as long as it did when its form opened.
    const opened = { ...sessionFormValues(session('2026-11-15T02:00:00.000Z', 240)), end: '' }
    expect(startChanges(opened, { start: '22:00' })).toEqual({ start: '22:00', endDay: '2026-11-15', end: '02:00' })
  })
})

describe('checkSession', () => {
  const FORM: SessionFormValues = {
    ...EMPTY_SESSION_FORM,
    day: '2026-11-14',
    start: '21:00',
    endDay: '2026-11-15',
    end: '01:00',
    type: 'takeover',
    takeover: { id: 'collective-1', name: 'Ondes' },
    application: link('application-1'),
    name: '  HAUTE   RIVE\nTAKEOVER ',
    raEvent: { id: '6683745', url: 'https://ra.co/events/6683745' },
  }

  it('returns what the server is sent: the start with its offset, the duration, the ids, the name cleaned up and the event on RA by its id', () => {
    expect(checkSession(FORM)).toEqual({
      fields: {
        start: '2026-11-14T21:00-05:00',
        durationMinutes: 240,
        type: 'takeover',
        takeover: 'collective-1',
        // As the session has it.
        application: 'application-1',
        name: 'HAUTE RIVE TAKEOVER',
        raEvent: '6683745',
        description: '',
      },
    })
    // The collective picked stays in the form for a takeover, but another type doesn't send it.
    expect(checkSession({ ...FORM, type: 'live-performance', raEvent: null, undated: true, duration: { hours: '3', minutes: '' } }).fields).toEqual({
      start: null,
      durationMinutes: 180,
      type: 'live-performance',
      takeover: null,
      // Like its collective, it stays in the form, but only a takeover sends it.
      application: null,
      name: 'HAUTE RIVE TAKEOVER',
      raEvent: null,
      description: '',
    })
  })

  it('needs a type, a collective for a takeover, and a name for a session of type other', () => {
    expect(checkSession({ ...FORM, type: null }).errors).toEqual({ type: 'Choisissez le type de la session.' })
    expect(checkSession({ ...FORM, takeover: null }).errors).toEqual({ takeover: 'Choisissez le collectif du takeover.' })
    expect(checkSession({ ...FORM, type: 'other', name: ' ' }).errors).toEqual({ name: 'Indiquez le nom de la session.' })
    expect(checkSession({ ...FORM, type: 'guest-mixes', name: ' ' }).fields).toMatchObject({ type: 'guest-mixes', takeover: null, name: '' })
    expect(checkSession({ ...FORM, type: 'other', name: 'ATELIER DE DJing' }).fields).toMatchObject({ type: 'other', name: 'ATELIER DE DJing' })
  })

  it("needs a takeover's application to be its collective's, once the applications are known", () => {
    const applications = [
      { id: 'application-1', artistId: null, collectiveId: 'collective-1' },
      { id: 'application-2', artistId: null, collectiveId: 'collective-2' },
      { id: 'application-3', artistId: 'artist-1', collectiveId: null },
    ]
    expect(checkSession(FORM, undefined, applications).fields).toMatchObject({ takeover: 'collective-1', application: 'application-1' })
    const error = 'La candidature doit être celle du collectif du takeover\u00a0: choisissez-en une autre, ou «\u00a0Aucune candidature\u00a0».'
    for (const application of ['application-2', 'application-3']) {
      expect(checkSession({ ...FORM, application: link(application) }, undefined, applications).errors).toEqual({ application: error })
    }
    expect(checkSession({ ...FORM, takeover: { id: 'collective-2', name: 'Vagues' } }, undefined, applications).errors).toEqual({ application: error })
    // Left to the server when they aren't known, or when it isn't one of them.
    expect(checkSession({ ...FORM, application: link('application-2') }).fields).toMatchObject({ application: 'application-2' })
    expect(checkSession({ ...FORM, application: link('application-9') }, undefined, applications).fields).toMatchObject({ application: 'application-9' })
    // Another type doesn't send it, whatever it is.
    expect(checkSession({ ...FORM, type: 'guest-mixes', application: link('application-3') }, undefined, applications).fields).toMatchObject({ application: null })
  })

  it('says what is wrong with each field', () => {
    expect(checkSession({ ...FORM, start: '', name: 'x'.repeat(101) }).errors).toEqual({
      start: "Indiquez l'heure de début.",
      name: 'Le nom dépasse 100 caractères.',
    })
  })

  // Clocks fall back from 2:00 to 1:00 on November 1st, 2026, so that night's times from 1:00 to 2:00 happen twice:
  // first at 5:00 UTC, then at 6:00 UTC.
  it('keeps a session that starts at the second 1:30 where it is while its start is unchanged', () => {
    const form = sessionFormValues(session('2026-11-01T06:30:00.000Z', 60))
    expect(form).toMatchObject({ day: '2026-11-01', start: '01:30', endDay: '2026-11-01', end: '02:30' })
    expect(checkSession({ ...form, name: 'AUTRE' }).fields).toMatchObject({ start: '2026-11-01T01:30-05:00', durationMinutes: 60 })
    // Its start and its end each stay what they were while they're left as they were: changing the end keeps the start.
    expect(checkSession({ ...form, end: '02:00' }).fields).toMatchObject({ start: '2026-11-01T01:30-05:00', durationMinutes: 30 })
    // A start that's typed is the first of the two again.
    expect(checkSession({ ...form, start: '01:15' }).fields).toMatchObject({ start: '2026-11-01T01:15-04:00', durationMinutes: 135 })
  })

  it('keeps a session that ends at the second 1:30 where it ends while its end is unchanged', () => {
    const form = sessionFormValues(session('2026-11-01T04:00:00.000Z', 150))
    expect(form).toMatchObject({ day: '2026-11-01', start: '00:00', endDay: '2026-11-01', end: '01:30' })
    // Changing the start keeps the end at the second 1:30, rather than the first.
    expect(checkSession({ ...form, start: '00:30' }).fields).toMatchObject({ start: '2026-11-01T00:30-04:00', durationMinutes: 120 })
    // An end that's typed is the first of the two after the start.
    expect(checkSession({ ...form, end: '01:45' }).fields).toMatchObject({ start: '2026-11-01T00:00-04:00', durationMinutes: 105 })
  })

  it('reads the days and times of a session that lasts several days', () => {
    const form = sessionFormValues(session('2026-11-13T23:00:00.000Z', 32 * 60))
    expect(form).toMatchObject({ day: '2026-11-13', lastDay: '2026-11-13', start: '18:00', endDay: '2026-11-15', end: '02:00' })
    expect(checkSession({ ...form, name: 'X' }).fields).toMatchObject({ start: '2026-11-13T18:00-05:00', durationMinutes: 32 * 60 })
  })

  it('names a session as its type does, with its collective in upper case for a takeover', () => {
    expect(typeName('guest-mixes', null)).toBe('GUEST MIXES')
    expect(typeName('live-performance', null)).toBe('LIVE PERFORMANCE')
    expect(typeName('synth-meetup', null)).toBe('SYNTH MEETUPS')
    expect(typeName('takeover', { name: 'Saut de Clôture' })).toBe('SAUT DE CLÔTURE TAKEOVER')
    expect(typeName('takeover', null)).toBeNull()
    expect(typeName('other', null)).toBeNull()
  })

  it("shows a session whose date isn't known by its duration", () => {
    expect(sessionFormValues(session(null, 90))).toMatchObject({ undated: true, day: '', duration: { hours: '1', minutes: '30' } })
  })
})

describe("a new set's duration", () => {
  const sets = (...durations: (number | null)[]) => durations.map((durationMinutes, i) => studioSet({ id: `set-${i}`, durationMinutes }))

  it("is an hour, or what's left of the session after its sets, cancelled ones included, or none when they fill it", () => {
    expect(newSetDuration({ durationMinutes: 240, sets: [] })).toBe(60)
    expect(newSetDuration({ durationMinutes: 240, sets: sets(60, null, 150) })).toBe(30)
    expect(newSetDuration({ durationMinutes: 240, sets: [...sets(60, 150), studioSet({ durationMinutes: 30, status: 'cancelled' })] })).toBeNull()
    expect(newSetDuration({ durationMinutes: 240, sets: sets(300) })).toBeNull()
    expect(newSetDuration({ durationMinutes: 45, sets: [] })).toBe(45)
    // While the session's times aren't valid.
    expect(newSetDuration({ durationMinutes: null, sets: sets(600) })).toBe(60)
    expect(newSetFormValues({ durationMinutes: 240, sets: sets(150) }).duration).toEqual({ hours: '1', minutes: '0' })
    expect(newSetFormValues({ durationMinutes: 240, sets: sets(240) }).duration).toEqual({ hours: '', minutes: '' })
  })
})

describe("how long a session's sets last together", () => {
  it('is the sum of their durations, cancelled ones included, an unknown one counting for nothing', () => {
    expect(setsMinutes([])).toBe(0)
    const sets = [null, 60, 45].map((durationMinutes, i) => studioSet({ id: `set-${i}`, durationMinutes }))
    expect(setsMinutes([...sets, studioSet({ durationMinutes: 30, status: 'cancelled' })])).toBe(135)
  })
})

describe('checkSet', () => {
  const FORM: SetFormValues = {
    ...newSetFormValues({ durationMinutes: 240, sets: [] }),
    performers: [
      { id: 'artist-1', name: 'Aurore' },
      { id: 'artist-2', name: 'Brume' },
    ],
    performanceTypes: ['live-performance', 'dj'],
    otherPerformanceType: '  Synthé   modulaire ',
    genres: ['ambient', 'techno'],
    soundcloudTrack: ' https://soundcloud.com/parkingdotradio/3tons ',
    youtubeVideo: '',
    application: link('application-1'),
  }

  it('returns what the server is sent: the ids, the duration, the performance types in order, the other one cleaned up, and the links trimmed', () => {
    expect(checkSet(FORM)).toEqual({
      fields: {
        performers: [{ id: 'artist-1' }, { id: 'artist-2' }],
        durationMinutes: 60,
        performanceTypes: ['dj', 'live-performance'],
        otherPerformanceType: 'Synthé modulaire',
        genres: ['ambient', 'techno'],
        soundcloudTrack: 'https://soundcloud.com/parkingdotradio/3tons',
        youtubeVideo: null,
        application: 'application-1',
      },
    })
  })

  it('takes a duration from a minute, or none while it is not known', () => {
    const duration = (hours: string, minutes: string) => checkSet({ ...FORM, duration: { hours, minutes } })
    expect(duration('', '').fields).toMatchObject({ durationMinutes: null })
    expect(duration('', '1').fields).toMatchObject({ durationMinutes: 1 })
    expect(duration('25', '').fields).toMatchObject({ durationMinutes: 1500 })
    for (const [hours, minutes] of [['0', '0'], ['1', '60'], ['x', ''], ['-1', ''], ['8765832', '1']]) {
      expect(duration(hours, minutes).errors, `${hours} h ${minutes}`).toEqual({ duration: 'La durée est invalide.' })
    }
  })

  it("needs its application to be one of its performers', once the applications are known", () => {
    const applications = [
      { id: 'application-1', artistId: 'artist-1', collectiveId: null },
      { id: 'application-2', artistId: 'artist-3', collectiveId: null },
      { id: 'application-3', artistId: null, collectiveId: 'collective-1' },
    ]
    expect(checkSet(FORM, applications).fields).toMatchObject({ application: 'application-1' })
    const error = "La candidature doit être celle d'un des artistes du set\u00a0: choisissez-en une autre, ou «\u00a0Aucune candidature\u00a0»."
    for (const application of ['application-2', 'application-3']) {
      expect(checkSet({ ...FORM, application: link(application) }, applications).errors).toEqual({ application: error })
    }
    expect(checkSet({ ...FORM, performers: [{ id: 'artist-2', name: 'Brume' }] }, applications).errors).toEqual({ application: error })
    expect(checkSet({ ...FORM, application: null }, applications).fields).toMatchObject({ application: null })
    // Left to the server when they aren't known.
    expect(checkSet({ ...FORM, application: link('application-2') }).fields).toMatchObject({ application: 'application-2' })
  })

  it('says what is wrong with each field', () => {
    expect(
      checkSet({
        ...FORM,
        performers: [],
        duration: { hours: '', minutes: '75' },
        otherPerformanceType: 'x'.repeat(61),
        soundcloudTrack: 'https://on.soundcloud.com/AbCdE',
        youtubeVideo: 'https://www.youtube.com/@parkingradio',
      }).errors,
    ).toEqual({
      performers: 'Choisissez au moins un artiste.',
      duration: 'La durée est invalide.',
      otherPerformanceType: 'La prestation « Autre » dépasse 60 caractères.',
      soundcloudTrack: 'Le lien SoundCloud doit mener à la piste sur soundcloud.com, p. ex. « https://soundcloud.com/parkingdotradio/3tons ».',
      youtubeVideo: 'Le lien YouTube est invalide : collez le lien de la vidéo, ou son identifiant.',
    })
  })
})

describe("a new session's listed sets", () => {
  const fields = {
    performers: [{ id: 'artist-1' }],
    durationMinutes: 90,
    performanceTypes: [],
    otherPerformanceType: '',
    genres: [],
    soundcloudTrack: 'https://soundcloud.com/parkingdotradio/3tons',
    youtubeVideo: 'https://youtu.be/dQw4w9WgXcQ',
    application: 'application-1',
  }
  const listed = listedSet(fields, { performers: [{ id: 'artist-1', name: 'Aurore' }], application: { id: 'application-1', receivedAt: '2026-10-01T12:00:00-04:00' } })

  it('are sent as their form sends them', () => {
    expect(listedSetFields(listed)).toEqual(fields)
  })

  it('are shown as planned, without times', () => {
    const shown = shownSet(listed)
    expect(shown).toMatchObject({ durationMinutes: 90, performers: [{ id: 'artist-1', name: 'Aurore' }], status: 'planned' })
    expect(shown).not.toHaveProperty('start')
  })

  it('open their form as they were added, with the link to their video on YouTube', () => {
    expect(setFormValues(shownSet(listed))).toEqual({
      performers: [{ id: 'artist-1', name: 'Aurore' }],
      duration: { hours: '1', minutes: '30' },
      performanceTypes: [],
      otherPerformanceType: '',
      genres: [],
      soundcloudTrack: 'https://soundcloud.com/parkingdotradio/3tons',
      youtubeVideo: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      application: { id: 'application-1', receivedAt: '2026-10-01T12:00:00-04:00' },
    })
  })
})

describe('the application a form starts from', () => {
  const owned = (id: string, owner: { artistId: string } | { collectiveId: string }) =>
    ({ id, artistId: null, collectiveId: null, ...owner }) as unknown as Application
  const APPLICATIONS = [owned('application-1', { artistId: 'artist-1' }), owned('application-2', { collectiveId: 'collective-1' })]
  const ARTISTS = [{ id: 'artist-1', name: 'Aurore' }]

  it("is an artist's, with the artist, or a collective's", () => {
    expect(findApplication('application-1', APPLICATIONS, ARTISTS)).toEqual({ application: APPLICATIONS[0], artist: { id: 'artist-1', name: 'Aurore' } })
    expect(findApplication('application-2', APPLICATIONS, null)).toEqual({ application: APPLICATIONS[1], artist: null })
  })

  it("is none when there's no such application, or artist", () => {
    expect(findApplication('unknown', APPLICATIONS, ARTISTS)).toBeNull()
    expect(findApplication('application-1', APPLICATIONS, [])).toBeNull()
  })

  it("can't be told without the applications, or the artists for an artist's", () => {
    expect(findApplication('application-1', null, ARTISTS)).toBeUndefined()
    expect(findApplication('application-1', APPLICATIONS, null)).toBeUndefined()
  })
})
