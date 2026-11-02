import { describe, expect, it } from 'vitest'
import { SessionFields, SetFields } from './fields.js'

// The rules in sessions/fields.ts, which every session and set has to follow. The server answers with the first error.

function sessionFields(changes: Record<string, unknown> = {}) {
  return {
    start: '2026-11-14T21:00-05:00',
    durationMinutes: 240,
    takeover: null,
    name: 'HAUTE RIVE TAKEOVER',
    raEvent: null,
    ...changes,
  }
}

function setFields(changes: Record<string, unknown> = {}) {
  return {
    performers: [{ id: 'artist-1' }, { id: 'artist-2' }],
    offsetMinutes: 60,
    durationMinutes: 60,
    prestations: ['dj'],
    otherPrestation: '',
    genres: [],
    soundcloudTrack: null,
    youtubeVideo: null,
    ...changes,
  }
}

function error(schema: typeof SessionFields | typeof SetFields, sent: unknown) {
  const result = schema.safeParse(sent)
  return result.success ? null : result.error.issues[0].message
}

const START = 'The start must be a date and time with its offset from UTC, e.g. "2026-11-14T21:00-05:00", from the year 2000 to 2999, or null'

describe('SessionFields', () => {
  const parse = (changes: Record<string, unknown> = {}) => SessionFields.parse(sessionFields(changes))
  const sessionError = (sent: unknown) => error(SessionFields, sent)

  it('keeps what was sent, with its start as a date and its links reduced', () => {
    expect(parse({ takeover: ' Collective-1 ', raEvent: ' https://ra.co/events/6683745 ' })).toEqual({
      start: new Date('2026-11-15T02:00:00Z'),
      durationMinutes: 240,
      takeover: 'collective-1',
      name: 'HAUTE RIVE TAKEOVER',
      raEvent: '6683745',
    })
  })

  it('takes null, or a blank string, for no start, no takeover and no RA event', () => {
    expect(parse({ start: null, takeover: ' ', raEvent: '' })).toMatchObject({ start: null, takeover: null, raEvent: null })
    expect(parse({ start: ' ' }).start).toBeNull()
  })

  it('takes a start with its offset from UTC, with or without seconds, in the past too', () => {
    expect(parse({ start: '2026-11-15T02:00:30.5Z' }).start).toEqual(new Date('2026-11-15T02:00:30.500Z'))
    // The night the clocks go back an hour, 01:30 happens twice, told apart by its offset.
    expect(parse({ start: '2026-11-01T01:30-04:00' }).start).toEqual(new Date('2026-11-01T05:30:00Z'))
    expect(parse({ start: '2026-11-01T01:30-05:00' }).start).toEqual(new Date('2026-11-01T06:30:00Z'))
    expect(parse({ start: '2000-01-01T00:00Z' }).start).toEqual(new Date('2000-01-01T00:00:00Z'))
  })

  it('refuses a start that is not a date and time with an offset, or that is out of range, or left out', () => {
    for (const start of ['2026-11-14T21:00', '2026-11-14', '2026-02-30T21:00Z', '2026-11-14T24:00Z', 1789437600000, '1999-12-31T23:59:59Z', undefined]) {
      expect(sessionError(sessionFields({ start })), String(start)).toBe(START)
    }
    // That's the year 3000 in UTC, whose dates and times couldn't be written as a response's.
    expect(sessionError(sessionFields({ start: '2999-12-31T22:30-05:00' }))).toBe(START)
    expect(sessionError(sessionFields({ start: '2026-11-14T21:00-05:00\0' }))).toBe(START)
  })

  it('takes a duration of whole minutes, from 1 minute to 24 hours, even without a start', () => {
    expect(parse({ durationMinutes: 1 }).durationMinutes).toBe(1)
    expect(parse({ start: null, durationMinutes: 1440 }).durationMinutes).toBe(1440)
    for (const durationMinutes of [0, 1441, 60.5, -60, '60', null, undefined]) {
      expect(sessionError(sessionFields({ durationMinutes })), String(durationMinutes)).toBe('The duration must be a whole number of minutes, from 1 to 1440')
    }
  })

  it('refuses a takeover that is not an id, or that is left out', () => {
    expect(sessionError(sessionFields({ takeover: 42 }))).toBe("The takeover must be a collective's id, or null")
    expect(sessionError(sessionFields({ takeover: undefined }))).toBe("The takeover must be a collective's id, or null")
  })

  it('cleans up the name, which can be empty', () => {
    expect(parse({ name: '  HAUTE \n RIVE\tTAKEOVER ' }).name).toBe('HAUTE RIVE TAKEOVER')
    expect(parse({ name: '' }).name).toBe('')
    expect(parse({ name: `${'x'.repeat(100)}  ` }).name).toHaveLength(100)
    expect(sessionError(sessionFields({ name: 'x'.repeat(101) }))).toBe('The name must be text, up to 100 characters')
    expect(sessionError(sessionFields({ name: null }))).toBe('The name must be text, up to 100 characters')
  })

  it('refuses an RA event that is not its id or a link to it, even with the NUL character where parsing would drop it', () => {
    const message = 'The RA event must be its id, or a link to it, e.g. "https://ra.co/events/6683745"'
    for (const raEvent of ['https://ra.co/promoters/1', 6683745, '\0https://ra.co/events/6683745', undefined]) {
      expect(sessionError(sessionFields({ raEvent })), String(raEvent)).toBe(message)
    }
  })

  it('refuses what is not an object', () => {
    for (const sent of ['not a session', null, []]) expect(sessionError(sent)).toBe('A session must be an object with its fields')
  })
})

describe('SetFields', () => {
  const parse = (changes: Record<string, unknown> = {}) => SetFields.parse(setFields(changes))
  const setError = (sent: unknown) => error(SetFields, sent)

  it('keeps what was sent, with its links reduced', () => {
    expect(
      parse({
        prestations: ['live-performance', 'dj', 'dj'],
        otherPrestation: '  Synthé \n modulaire ',
        genres: ['ambient', 'techno', 'ambient'],
        soundcloudTrack: 'https://soundcloud.com/parkingdotradio/3tons?si=x',
        youtubeVideo: 'https://youtu.be/dQw4w9WgXcQ',
      }),
    ).toEqual({
      performers: [{ id: 'artist-1' }, { id: 'artist-2' }],
      offsetMinutes: 60,
      durationMinutes: 60,
      // In the order of the list, without duplicates.
      prestations: ['dj', 'live-performance'],
      otherPrestation: 'Synthé modulaire',
      // In the order they were sent, without duplicates.
      genres: ['ambient', 'techno'],
      soundcloudTrack: 'https://soundcloud.com/parkingdotradio/3tons',
      youtubeVideo: 'dQw4w9WgXcQ',
    })
  })

  it('drops performers that are there twice, whatever the case of their ids, and ignores their other fields', () => {
    const performers = [{ id: 'A', name: 'Ignored' }, { id: 'a' }, { id: 'b' }]
    expect(parse({ performers }).performers).toEqual([{ id: 'a' }, { id: 'b' }])
  })

  it('requires at least one performer, each with an id', () => {
    expect(setError(setFields({ performers: [] }))).toBe('A set has at least one performer')
    expect(setError(setFields({ performers: undefined }))).toBe('A set has at least one performer')
    for (const sent of ['not a set', null, []]) expect(setError(sent)).toBe('A set must be an object with its fields')
    for (const performer of [{ name: 'Ana' }, { id: 1 }, 'a', null]) {
      expect(setError(setFields({ performers: [performer] }))).toBe('No such artist')
    }
  })

  it('takes a set without an offset, or without an offset or a duration', () => {
    expect(parse({ offsetMinutes: null })).toMatchObject({ offsetMinutes: null, durationMinutes: 60 })
    expect(parse({ offsetMinutes: null, durationMinutes: null })).toMatchObject({ offsetMinutes: null, durationMinutes: null })
  })

  it('refuses an offset without a duration', () => {
    expect(setError(setFields({ durationMinutes: null }))).toBe('A set with an offset also has a duration')
  })

  it('takes offsets and durations of whole minutes, within 24 hours', () => {
    expect(parse({ offsetMinutes: 0, durationMinutes: 1440 })).toMatchObject({ offsetMinutes: 0, durationMinutes: 1440 })
    expect(parse({ offsetMinutes: 1439, durationMinutes: 1 })).toMatchObject({ offsetMinutes: 1439, durationMinutes: 1 })
    for (const offsetMinutes of [-1, 1440, 0.5, '0', undefined]) {
      expect(setError(setFields({ offsetMinutes })), String(offsetMinutes)).toBe('The offset must be a whole number of minutes, from 0 to 1439, or null')
    }
    for (const durationMinutes of [0, 1441, 0.5, '60', undefined]) {
      expect(setError(setFields({ durationMinutes })), String(durationMinutes)).toBe('The duration must be a whole number of minutes, from 1 to 1440, or null')
    }
  })

  it('refuses prestations and genres that are not in their lists, or not lists', () => {
    const prestations = 'The prestations must be ids among dj, vinyl, live-performance, rap, full-band'
    for (const sent of [['dj', 'karaoke'], 'dj', null, undefined]) expect(setError(setFields({ prestations: sent }))).toBe(prestations)
    const genres = 'The genres must be ids of artists\' genres, e.g. "techno"'
    for (const sent of [['techno', 'polka'], 'techno', null, undefined]) expect(setError(setFields({ genres: sent }))).toBe(genres)
    expect(parse({ prestations: [], genres: [] })).toMatchObject({ prestations: [], genres: [] })
  })

  it('cleans up the other prestation, which can be empty', () => {
    expect(parse({ otherPrestation: `${'x'.repeat(60)} ` }).otherPrestation).toHaveLength(60)
    for (const otherPrestation of ['x'.repeat(61), null, undefined]) {
      expect(setError(setFields({ otherPrestation }))).toBe('The other prestation must be text, up to 60 characters')
    }
  })

  it('takes null, or a blank string, for no link, and refuses links that are not those it takes', () => {
    expect(parse({ soundcloudTrack: ' ', youtubeVideo: '' })).toMatchObject({ soundcloudTrack: null, youtubeVideo: null })
    expect(setError(setFields({ soundcloudTrack: 'https://on.soundcloud.com/AbC' }))).toBe(
      'The SoundCloud track must be a link to it on soundcloud.com, e.g. "https://soundcloud.com/parkingdotradio/3tons"',
    )
    for (const youtubeVideo of ['https://example.com', 'https://youtu.be/dQw4w9WgXcQ\0', undefined]) {
      expect(setError(setFields({ youtubeVideo })), String(youtubeVideo)).toBe('The YouTube video must be a link to it, or its id')
    }
  })
})
