import { describe, expect, it } from 'vitest'
import {
  EMPTY_SESSION_FORM,
  checkSession,
  checkSet,
  durationOf,
  endTimeAfter,
  minutesOf,
  newSetFormValues,
  sessionFormValues,
  sessionTimes,
  setFormValues,
  setPlace,
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

function studioSet(fields: Partial<StudioSet>): StudioSet {
  return {
    id: 'set-1',
    performers: [{ id: 'artist-1', name: 'Aurore' }],
    offsetMinutes: null,
    durationMinutes: null,
    start: null,
    end: null,
    fitsInSession: true,
    overlappingSets: [],
    performanceTypes: [],
    otherPerformanceType: '',
    genres: [],
    soundcloudTrack: null,
    youtubeVideo: null,
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
    takeover: null,
    name: '',
    raEvent: null,
    sets,
    ...TRACKED,
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
    takeover: { id: 'collective-1', name: 'Ondes' },
    name: '  HAUTE   RIVE\nTAKEOVER ',
    raEvent: ' https://ra.co/events/6683745 ',
  }

  it('returns what the server is sent: the start with its offset, the duration, the id, the name cleaned up and the link trimmed', () => {
    expect(checkSession(FORM)).toEqual({
      fields: { start: '2026-11-14T21:00-05:00', durationMinutes: 240, takeover: 'collective-1', name: 'HAUTE RIVE TAKEOVER', raEvent: 'https://ra.co/events/6683745' },
    })
    expect(checkSession({ ...FORM, takeover: null, raEvent: ' ', undated: true, duration: { hours: '3', minutes: '' } }).fields).toEqual({
      start: null,
      durationMinutes: 180,
      takeover: null,
      name: 'HAUTE RIVE TAKEOVER',
      raEvent: null,
    })
  })

  it('says what is wrong with each field', () => {
    expect(checkSession({ ...FORM, start: '', name: 'x'.repeat(101), raEvent: 'https://ra.co/promoters/183980' }).errors).toEqual({
      start: "Indiquez l'heure de début.",
      name: 'Le nom dépasse 100 caractères.',
      raEvent: "Le lien de l'événement RA est invalide, p. ex. « https://ra.co/events/6683745 ».",
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

  it("shows a session whose date isn't known by its duration", () => {
    expect(sessionFormValues(session(null, 90))).toMatchObject({ undated: true, day: '', duration: { hours: '1', minutes: '30' } })
  })
})

describe('setPlace', () => {
  // Saturday, November 14th, 2026, from 21:00 to 1:00 in Québec.
  const SESSION = session('2026-11-15T02:00:00.000Z', 240)
  const FORM = newSetFormValues({ ...SESSION, sets: [] })
  const place = (form: Partial<SetFormValues>, of: Session = SESSION) => {
    const result = setPlace({ ...FORM, opened: undefined, ...form }, of)
    return 'errors' in result ? result.errors : result
  }
  const late = 'Un set commence au plus 23 h 59 après le début de la session.'
  const longest = 'Un set dure au plus 24 heures.'

  it("is worked out from the times of day, from the session's start, a start before its start time being the next day", () => {
    expect(place({ start: '21:00', end: '22:00' })).toEqual({ offsetMinutes: 0, durationMinutes: 60 })
    expect(place({ start: '23:30', end: '00:15' })).toEqual({ offsetMinutes: 150, durationMinutes: 45 })
    expect(place({ start: '00:30', end: '01:00' })).toEqual({ offsetMinutes: 210, durationMinutes: 30 })
  })

  it("doesn't have to take place within the session, but starts at most 23 h 59 after its start, and lasts at most 24 hours", () => {
    // The next day at 20:00, which is after the session, and until after it ends.
    expect(place({ start: '20:00', end: '21:00' })).toEqual({ offsetMinutes: 1380, durationMinutes: 60 })
    expect(place({ start: '00:30', end: '01:30' })).toEqual({ offsetMinutes: 210, durationMinutes: 60 })
    expect(place({ start: '20:59', end: '21:00' })).toEqual({ offsetMinutes: 1439, durationMinutes: 1 })
    // The night clocks fall back, times of day are an hour further apart: from 23:00 in summer time, 22:59 the next day is
    // 24 h 59 later, and from 23:00 to 22:30 is 24 h 30.
    const night = session('2026-11-01T03:00:00.000Z', 240)
    expect(place({ start: '22:59', end: '23:30' }, night)).toEqual({ start: late })
    expect(place({ start: '23:00', end: '22:30' }, night)).toEqual({ end: longest })
    expect(place({ start: '23:00', end: '22:00' }, night)).toEqual({ offsetMinutes: 0, durationMinutes: 1440 })
  })

  it('says what is missing or invalid', () => {
    expect(place({ start: '', end: '25:00' })).toEqual({ start: "Indiquez l'heure de début.", end: "L'heure de fin est invalide." })
  })

  it('refuses a start that clocks skip after the session starts, as they spring forward', () => {
    // From 23:00 in winter time, on the night of March 7th, 2026, for 4 hours: 2:30 is skipped, and 3:00 is 3 hours later.
    const night = session('2026-03-08T04:00:00.000Z', 240)
    expect(place({ start: '02:30', end: '03:30' }, night)).toEqual({ start: "Cette heure n'existe pas cette nuit-là, au passage à l'heure d'été." })
    expect(place({ start: '01:30', end: '02:30' }, night)).toEqual({ end: "Cette heure n'existe pas cette nuit-là, au passage à l'heure d'été." })
    expect(place({ start: '03:00', end: '04:00' }, night)).toEqual({ offsetMinutes: 180, durationMinutes: 60 })
  })

  it('lasts as long as the clocks say on the night they fall back', () => {
    // From 23:00 in summer time to 2:00 in winter time: from the first 1:00 to 2:00 is 2 hours.
    const night = session('2026-11-01T03:00:00.000Z', 240)
    expect(place({ start: '01:00', end: '02:00' }, night)).toEqual({ offsetMinutes: 120, durationMinutes: 120 })
    // From midnight, the first time clocks show 1:00 is the first 1:00.
    expect(place({ start: '00:00', end: '01:00' }, night)).toEqual({ offsetMinutes: 60, durationMinutes: 60 })
  })

  it("is the set's offset and duration in a session without a date, a duration being needed once there's a start", () => {
    const undated = session(null, 180)
    expect(place({ offset: { hours: '1', minutes: '30' }, duration: { hours: '1', minutes: '' } }, undated)).toEqual({ offsetMinutes: 90, durationMinutes: 60 })
    expect(place({ offset: { hours: '0', minutes: '' }, duration: { hours: '', minutes: '' } }, undated)).toEqual({ duration: 'Indiquez la durée du set.' })
    expect(place({ offset: { hours: '', minutes: '' }, duration: { hours: '1', minutes: '' } }, undated)).toEqual({ offset: 'Indiquez quand le set commence.' })
    // After the session, or until after it.
    expect(place({ offset: { hours: '2', minutes: '30' }, duration: { hours: '1', minutes: '' } }, undated)).toEqual({ offsetMinutes: 150, durationMinutes: 60 })
    expect(place({ offset: { hours: '23', minutes: '59' }, duration: { hours: '24', minutes: '' } }, undated)).toEqual({ offsetMinutes: 1439, durationMinutes: 1440 })
    expect(place({ offset: { hours: '24', minutes: '' }, duration: { hours: '1', minutes: '' } }, undated)).toEqual({ offset: late })
    expect(place({ offset: { hours: '1', minutes: '' }, duration: { hours: '24', minutes: '1' } }, undated)).toEqual({ duration: longest })
  })

  it("is only a duration, which can be left out, and can be longer than the session, while the set's place isn't known", () => {
    expect(place({ unplaced: true, duration: { hours: '', minutes: '' } })).toEqual({ offsetMinutes: null, durationMinutes: null })
    expect(place({ unplaced: true, duration: { hours: '1', minutes: '' } })).toEqual({ offsetMinutes: null, durationMinutes: 60 })
    expect(place({ unplaced: true, duration: { hours: '5', minutes: '' } })).toEqual({ offsetMinutes: null, durationMinutes: 300 })
    expect(place({ unplaced: true, duration: { hours: '25', minutes: '' } })).toEqual({ duration: longest })
  })
})

describe('the place a set form opens with', () => {
  const sent = (form: SetFormValues, of: Session) => {
    const { fields, errors } = checkSet(form, of)
    return errors ?? { offsetMinutes: fields.offsetMinutes, durationMinutes: fields.durationMinutes }
  }

  it("is a set's, by its times of day, or by its offset and duration in a session without a date", () => {
    const set = studioSet({ offsetMinutes: 150, durationMinutes: 60 })
    expect(setFormValues(set, session('2026-11-15T02:00:00.000Z', 240))).toMatchObject({ unplaced: false, start: '23:30', end: '00:30' })
    expect(setFormValues(set, session(null, 240))).toMatchObject({ offset: { hours: '2', minutes: '30' }, duration: { hours: '1', minutes: '0' } })
    expect(setFormValues(studioSet({ durationMinutes: 45 }), session(null, 240))).toMatchObject({ unplaced: true, duration: { hours: '0', minutes: '45' } })
  })

  it('is, for a new set, when the last set that is not cancelled and whose place is known ends, for an hour, or until the session ends', () => {
    const sets = [
      studioSet({ offsetMinutes: 0, durationMinutes: 60 }),
      studioSet({ offsetMinutes: 150, durationMinutes: 30, status: 'cancelled' }),
      studioSet({ offsetMinutes: 60, durationMinutes: 60, status: 'done' }),
      studioSet({ durationMinutes: 60 }),
    ]
    const dated = session('2026-11-15T02:00:00.000Z', 150, sets)
    expect(newSetFormValues(dated)).toMatchObject({ unplaced: false, start: '23:00', end: '23:30' })
    expect(newSetFormValues(session(null, 240, sets))).toMatchObject({ offset: { hours: '2', minutes: '0' }, duration: { hours: '1', minutes: '0' } })
    expect(newSetFormValues(session('2026-11-15T02:00:00.000Z', 240))).toMatchObject({ start: '21:00', end: '22:00' })
    // Without times when the sets fill the session.
    expect(newSetFormValues(session('2026-11-15T02:00:00.000Z', 120, sets))).toMatchObject({ unplaced: false, start: '', end: '', offset: { hours: '', minutes: '' } })
  })

  // Clocks fall back from 2:00 to 1:00 on November 1st, 2026, so that night's times from 1:00 to 2:00 happen twice.
  it('stays where it was while its times are unchanged, even at the second 1:00 of the night clocks fall back', () => {
    // From 23:00 in summer time, for 4 hours, with a set until the second 1:00.
    const night = session('2026-11-01T03:00:00.000Z', 240, [studioSet({ offsetMinutes: 0, durationMinutes: 180 })])
    const form = { ...newSetFormValues(night), performers: [{ id: 'artist-1', name: 'Aurore' }] }
    expect(form).toMatchObject({ start: '01:00', end: '02:00' })
    expect(sent(form, night)).toEqual({ offsetMinutes: 180, durationMinutes: 60 })
    // Changing the end keeps the start at the second 1:00.
    expect(sent({ ...form, end: '01:30' }, night)).toEqual({ offsetMinutes: 180, durationMinutes: 30 })
    // A start that's typed is the first time after the session's start when clocks show it.
    expect(sent({ ...form, start: '00:30' }, night)).toEqual({ offsetMinutes: 90, durationMinutes: 150 })

    const set = studioSet({ offsetMinutes: 150, durationMinutes: 60 })
    expect(sent({ ...setFormValues(set, night), youtubeVideo: 'dQw4w9WgXcQ' }, night)).toEqual({ offsetMinutes: 150, durationMinutes: 60 })
  })
})

describe('checkSet', () => {
  const SESSION = session('2026-11-15T02:00:00.000Z', 240)
  const FORM: SetFormValues = {
    ...newSetFormValues(SESSION),
    performers: [
      { id: 'artist-1', name: 'Aurore' },
      { id: 'artist-2', name: 'Brume' },
    ],
    performanceTypes: ['live-performance', 'dj'],
    otherPerformanceType: '  Synthé   modulaire ',
    genres: ['ambient', 'techno'],
    soundcloudTrack: ' https://soundcloud.com/parkingdotradio/3tons ',
    youtubeVideo: '',
  }

  it('returns what the server is sent: the ids, the offset and duration, the performance types in order, the other one cleaned up, and the links trimmed', () => {
    expect(checkSet(FORM, SESSION)).toEqual({
      fields: {
        performers: [{ id: 'artist-1' }, { id: 'artist-2' }],
        offsetMinutes: 0,
        durationMinutes: 60,
        performanceTypes: ['dj', 'live-performance'],
        otherPerformanceType: 'Synthé modulaire',
        genres: ['ambient', 'techno'],
        soundcloudTrack: 'https://soundcloud.com/parkingdotradio/3tons',
        youtubeVideo: null,
      },
    })
  })

  it('says what is wrong with each field', () => {
    expect(
      checkSet(
        {
          ...FORM,
          performers: [],
          opened: undefined,
          start: '',
          otherPerformanceType: 'x'.repeat(61),
          soundcloudTrack: 'https://on.soundcloud.com/AbCdE',
          youtubeVideo: 'https://www.youtube.com/@parkingradio',
        },
        SESSION,
      ).errors,
    ).toEqual({
      performers: 'Choisissez au moins un artiste.',
      start: "Indiquez l'heure de début.",
      otherPerformanceType: 'La prestation « Autre » dépasse 60 caractères.',
      soundcloudTrack: 'Le lien SoundCloud doit mener à la piste sur soundcloud.com, p. ex. « https://soundcloud.com/parkingdotradio/3tons ».',
      youtubeVideo: 'Le lien YouTube est invalide : collez le lien de la vidéo, ou son identifiant.',
    })
  })
})
