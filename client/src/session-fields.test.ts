import { describe, expect, it } from 'vitest'
import type { Application } from './application-fields'
import {
  EMPTY_SESSION_FORM,
  findApplication,
  checkSession,
  checkSet,
  durationOf,
  endTimeAfter,
  listedSet,
  listedSetFields,
  minutesOf,
  newSetFormValues,
  sessionFormValues,
  sessionTimes,
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
  const times = (day: string, start: string, end: string) => {
    const result = sessionTimes({ ...EMPTY_SESSION_FORM, day, start, end })
    return 'errors' in result ? result.errors : { start: result.start?.toISOString(), durationMinutes: result.durationMinutes }
  }

  it('starts on the day, in Québec time', () => {
    expect(times('2026-11-14', '21:00', '22:30')).toEqual({ start: '2026-11-15T02:00:00.000Z', durationMinutes: 90 })
  })

  it("ends the next day when the end time isn't after the start time", () => {
    expect(times('2026-11-14', '23:00', '01:00')).toEqual({ start: '2026-11-15T04:00:00.000Z', durationMinutes: 120 })
    // As long as a session can be.
    expect(times('2026-11-14', '21:00', '21:00')).toEqual({ start: '2026-11-15T02:00:00.000Z', durationMinutes: 1440 })
  })

  it('lasts as long as the clocks say, across a change of the clocks', () => {
    // Clocks fall back at 2:00 on November 1st, 2026: from midnight to 3:00 is 4 hours.
    expect(times('2026-11-01', '00:00', '03:00')).toEqual({ start: '2026-11-01T04:00:00.000Z', durationMinutes: 240 })
  })

  it('refuses a session that would last more than 24 hours across a change of the clocks', () => {
    expect(times('2026-10-31', '21:00', '21:00')).toEqual({ end: 'Une session dure au plus 24 heures.' })
    // When they spring forward, the same is 23 hours.
    expect(times('2026-03-07', '21:00', '21:00')).toEqual({ start: '2026-03-08T02:00:00.000Z', durationMinutes: 1380 })
  })

  it("refuses a time that clocks skip as they spring forward, at 2:00 on March 8th, 2026", () => {
    const skipped = "Cette heure n'existe pas cette nuit-là, au passage à l'heure d'été."
    expect(times('2026-03-08', '02:30', '04:00')).toEqual({ start: skipped })
    expect(times('2026-03-07', '23:00', '02:30')).toEqual({ end: skipped })
  })

  it('takes the first of the two times that happen twice as the start, and ends at the first time after it', () => {
    expect(times('2026-11-01', '01:30', '02:30')).toEqual({ start: '2026-11-01T05:30:00.000Z', durationMinutes: 120 })
    // The second 1:15, after the first 1:30.
    expect(times('2026-11-01', '01:30', '01:15')).toEqual({ start: '2026-11-01T05:30:00.000Z', durationMinutes: 45 })
  })

  it('says what is missing or invalid', () => {
    expect(times('', '', '')).toEqual({ day: 'Choisissez le jour de la session.', start: "Indiquez l'heure de début.", end: "Indiquez l'heure de fin." })
    expect(times('20261-01-01', '25:00', '21:00')).toEqual({ day: 'La date est invalide.', start: "L'heure de début est invalide." })
  })

  it('checks that the start is from 2000 to 2999, in UTC', () => {
    // 19:00 in Québec is midnight in UTC, which is already 2000.
    expect(times('1999-12-31', '19:00', '20:00')).toEqual({ start: '2000-01-01T00:00:00.000Z', durationMinutes: 60 })
    expect(times('1999-12-31', '18:00', '20:00')).toEqual({ day: 'Une session a lieu entre les années 2000 et 2999.' })
    expect(times('2999-12-31', '19:00', '20:00')).toEqual({ day: 'Une session a lieu entre les années 2000 et 2999.' })
  })

  it("takes only the duration of a session whose date isn't known yet, from a minute to 24 hours", () => {
    const undated = (hours: string, minutes: string) => {
      const result = sessionTimes({ ...EMPTY_SESSION_FORM, undated: true, day: 'x', duration: { hours, minutes } })
      return 'errors' in result ? result.errors : result
    }
    expect(undated('4', '')).toEqual({ start: null, durationMinutes: 240 })
    expect(undated('', '')).toEqual({ duration: 'Indiquez la durée de la session.' })
    expect(undated('0', '0')).toEqual({ duration: 'La durée est invalide.' })
    expect(undated('24', '1')).toEqual({ duration: 'Une session dure au plus 24 heures.' })
  })
})

describe('endTimeAfter', () => {
  it('is how long after the start the clocks show, or would if they did not change, while the day is not known', () => {
    expect(endTimeAfter('2026-11-14', '23:00', 150)).toBe('01:30')
    // Clocks fall back an hour on the night of October 31st, 2026.
    expect(endTimeAfter('2026-10-31', '23:00', 240)).toBe('02:00')
    expect(endTimeAfter('', '23:00', 240)).toBe('03:00')
  })
})

describe('checkSession', () => {
  const FORM: SessionFormValues = {
    ...EMPTY_SESSION_FORM,
    day: '2026-11-14',
    start: '21:00',
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
  it('keeps a session that starts at the second 1:30 where it is while its times are unchanged', () => {
    const form = sessionFormValues(session('2026-11-01T06:30:00.000Z', 60))
    expect(form).toMatchObject({ day: '2026-11-01', start: '01:30', end: '02:30' })
    expect(checkSession({ ...form, name: 'AUTRE' }).fields).toMatchObject({ start: '2026-11-01T01:30-05:00', durationMinutes: 60 })
    // Each time stays what it was while it's left as it was: changing the end keeps the start.
    expect(checkSession({ ...form, end: '02:00' }).fields).toMatchObject({ start: '2026-11-01T01:30-05:00', durationMinutes: 30 })
    // A start that's typed is the first of the two again, and the end is the first time after it.
    expect(checkSession({ ...form, start: '01:15' }).fields).toMatchObject({ start: '2026-11-01T01:15-04:00', durationMinutes: 135 })
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

  it('takes a duration from a minute to 24 hours, or none while it is not known', () => {
    const duration = (hours: string, minutes: string) => checkSet({ ...FORM, duration: { hours, minutes } })
    expect(duration('', '').fields).toMatchObject({ durationMinutes: null })
    expect(duration('', '1').fields).toMatchObject({ durationMinutes: 1 })
    expect(duration('24', '').fields).toMatchObject({ durationMinutes: 1440 })
    expect(duration('24', '1').errors).toEqual({ duration: 'Un set dure au plus 24 heures.' })
    for (const [hours, minutes] of [['0', '0'], ['1', '60'], ['x', ''], ['-1', '']]) {
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
