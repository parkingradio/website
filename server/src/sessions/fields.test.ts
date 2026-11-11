import { describe, expect, it } from 'vitest'
import { SESSION_TYPES, SessionFields, SetFields, brokenSessionRule, brokenSetRule, sessionTitle } from './fields.js'

// The rules in sessions/fields.ts, which every session and set has to follow. The server answers with the first error.

function sessionFields(changes: Record<string, unknown> = {}) {
  return {
    start: '2026-11-14T21:00-05:00',
    durationMinutes: 240,
    type: 'guest-mixes',
    takeover: null,
    name: 'GUEST MIXES SPÉCIAL',
    raEvent: null,
    description: '',
    ...changes,
  }
}

function setFields(changes: Record<string, unknown> = {}) {
  return {
    performers: [{ id: 'artist-1' }, { id: 'artist-2' }],
    offsetMinutes: 60,
    durationMinutes: 60,
    performanceTypes: ['dj'],
    otherPerformanceType: '',
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

const START =
  'The start must be a date and time in Québec time, with the offset from UTC in effect then (-05:00, or -04:00 from the second Sunday of March at 2:00 to the first Sunday of November at 2:00), except a time the clocks skip in spring, e.g. "2026-11-14T21:00-05:00", from the year 2000 to 2999, or null'

describe('sessionTitle', () => {
  const session = (type: (typeof SESSION_TYPES)[number], name = '', takeover: { name: string } | null = null) => sessionTitle({ type, name, takeover })

  it("is the session's own name, or else the one its type gives it", () => {
    expect(session('guest-mixes')).toBe('GUEST MIXES')
    expect(session('live-performance')).toBe('LIVE PERFORMANCE')
    expect(session('synth-meetup')).toBe('SYNTH MEETUPS')
    expect(session('takeover', '', { name: 'Spectralis' })).toBe('SPECTRALIS TAKEOVER')
    for (const type of SESSION_TYPES) {
      expect(session(type, 'SPECIAL HALLOWEEN — MINIMALTIDE TAKEOVER', { name: 'MinimalTide' })).toBe('SPECIAL HALLOWEEN — MINIMALTIDE TAKEOVER')
    }
    expect(session('other', 'LISTENING PARTY')).toBe('LISTENING PARTY')
  })

  it("puts the collective's name in upper case, as Unicode's default case mapping has it", () => {
    expect(session('takeover', '', { name: 'Saut de Clôture' })).toBe('SAUT DE CLÔTURE TAKEOVER')
    expect(session('takeover', '', { name: 'Les Sœurs Ondes' })).toBe('LES SŒURS ONDES TAKEOVER')
    expect(session('takeover', '', { name: 'Straße' })).toBe('STRASSE TAKEOVER')
  })

  it('is never empty for a session that follows the rules', () => {
    const named = (type: (typeof SESSION_TYPES)[number]) => (type === 'other' ? 'X' : '')
    for (const type of SESSION_TYPES) {
      const fields = SessionFields.parse(sessionFields({ type, takeover: type === 'takeover' ? 'collective-1' : null, name: named(type) }))
      // A collective's name isn't empty (see collectives/profile.ts).
      expect(sessionTitle({ ...fields, takeover: fields.takeover === null ? null : { name: 'A' } }), type).not.toBe('')
    }
  })
})

describe('SessionFields', () => {
  const parse = (changes: Record<string, unknown> = {}) => SessionFields.parse(sessionFields(changes))
  const sessionError = (sent: unknown) => error(SessionFields, sent)

  it('keeps what was sent, with its start as a date and its links reduced', () => {
    expect(parse({ type: 'takeover', takeover: ' Collective-1 ', name: 'VKT TAKEOVER', raEvent: ' https://ra.co/events/6683745 ' })).toEqual({
      start: new Date('2026-11-15T02:00:00Z'),
      durationMinutes: 240,
      type: 'takeover',
      takeover: 'collective-1',
      name: 'VKT TAKEOVER',
      raEvent: '6683745',
      description: '',
    })
  })

  it('takes null, or a blank string, for no start, no takeover and no RA event', () => {
    expect(parse({ start: null, takeover: ' ', raEvent: '' })).toMatchObject({ start: null, takeover: null, raEvent: null })
    expect(parse({ start: ' ' }).start).toBeNull()
  })

  it("takes a start with Québec's offset then, with or without seconds, in the past too", () => {
    expect(parse({ start: '2026-11-14T21:00:30.5-05:00' }).start).toEqual(new Date('2026-11-15T02:00:30.500Z'))
    expect(parse({ start: '2026-07-01T21:00-04:00' }).start).toEqual(new Date('2026-07-02T01:00:00Z'))
    expect(parse({ start: '2000-01-01T00:00-05:00' }).start).toEqual(new Date('2000-01-01T05:00:00Z'))
    // Before 2007, the clocks went forward on the first Sunday of April.
    expect(parse({ start: '2006-03-20T21:00-05:00' }).start).toEqual(new Date('2006-03-21T02:00:00Z'))
  })

  it('takes either offset the night the clocks go back, when the hour before 2:00 happens twice', () => {
    expect(parse({ start: '2026-11-01T00:59:59.999-04:00' }).start).toEqual(new Date('2026-11-01T04:59:59.999Z'))
    expect(parse({ start: '2026-11-01T01:30-04:00' }).start).toEqual(new Date('2026-11-01T05:30:00Z'))
    expect(parse({ start: '2026-11-01T01:59:59.999-04:00' }).start).toEqual(new Date('2026-11-01T05:59:59.999Z'))
    expect(parse({ start: '2026-11-01T01:00-05:00' }).start).toEqual(new Date('2026-11-01T06:00:00Z'))
    expect(parse({ start: '2026-11-01T01:30-05:00' }).start).toEqual(new Date('2026-11-01T06:30:00Z'))
    expect(parse({ start: '2026-11-01T02:00-05:00' }).start).toEqual(new Date('2026-11-01T07:00:00Z'))
    for (const start of ['2026-11-01T00:59:59.999-05:00', '2026-11-01T02:00-04:00', '2026-11-01T02:00:00.001-04:00']) {
      expect(sessionError(sessionFields({ start })), start).toBe(START)
    }
  })

  it('refuses a start the night the clocks go forward between 2:00 and 3:00, which never happens', () => {
    expect(parse({ start: '2027-03-14T01:59:59.999-05:00' }).start).toEqual(new Date('2027-03-14T06:59:59.999Z'))
    expect(parse({ start: '2027-03-14T03:00-04:00' }).start).toEqual(new Date('2027-03-14T07:00:00Z'))
    for (const start of ['2027-03-14T02:00-05:00', '2027-03-14T02:00-04:00', '2027-03-14T02:30-05:00', '2027-03-14T02:30-04:00', '2027-03-14T03:00-05:00', '2027-03-14T01:59-04:00']) {
      expect(sessionError(sessionFields({ start })), start).toBe(START)
    }
  })

  it("refuses a start with another offset than Québec's then", () => {
    for (const start of ['2026-11-15T02:00Z', '2026-11-15T02:00+00:00', '2026-11-15T02:00-00:00', '2026-11-15T03:00+01:00', '2026-11-14T22:00-04:00', '2026-07-01T20:00-05:00']) {
      expect(sessionError(sessionFields({ start })), start).toBe(START)
    }
  })

  it('refuses a start that is not a date and time with an offset, or that is out of range, or left out', () => {
    for (const start of ['2026-11-14T21:00', '2026-11-14', '2026-02-30T21:00-05:00', '2026-11-14T24:00-05:00', 1789437600000, '1999-12-31T18:59:59-05:00', undefined]) {
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

  it('takes one of the types, and refuses any other value, or none', () => {
    for (const type of SESSION_TYPES) {
      const takeover = type === 'takeover' ? 'collective-1' : null
      expect(parse({ type, takeover }).type).toBe(type)
    }
    for (const type of ['guest mixes', 'GUEST-MIXES', 'takeovers', '', null, undefined, ['guest-mixes']]) {
      expect(sessionError(sessionFields({ type })), String(type)).toBe('The type must be one of guest-mixes, live-performance, takeover, synth-meetup, other')
    }
  })

  it('refuses a takeover that is not an id, or that is left out', () => {
    for (const type of ['takeover', 'guest-mixes']) {
      expect(sessionError(sessionFields({ type, takeover: 42 }))).toBe("The takeover must be a collective's id, or null")
      expect(sessionError(sessionFields({ type, takeover: undefined }))).toBe("The takeover must be a collective's id, or null")
    }
  })

  it('takes a collective for a takeover, which needs one, and none for the other types', () => {
    expect(sessionError(sessionFields({ type: 'takeover', takeover: null }))).toBe('A takeover has a collective')
    expect(sessionError(sessionFields({ type: 'takeover', takeover: ' ' }))).toBe('A takeover has a collective')
    for (const type of SESSION_TYPES.filter((type) => type !== 'takeover')) {
      expect(sessionError(sessionFields({ type, takeover: 'collective-1' })), type).toBe('Only a takeover has a collective')
    }
  })

  it('takes a name for every type, which a session of type other needs, kept in its case', () => {
    for (const type of SESSION_TYPES) {
      const takeover = type === 'takeover' ? 'collective-1' : null
      expect(parse({ type, takeover, name: 'ATELIER DE DJing POUR FEMMES & OPEN DECKS' }).name).toBe('ATELIER DE DJing POUR FEMMES & OPEN DECKS')
      if (type !== 'other') expect(parse({ type, takeover, name: '' }).name).toBe('')
    }
    expect(sessionError(sessionFields({ type: 'other', name: '' }))).toBe('A session of type other has a name')
    expect(sessionError(sessionFields({ type: 'other', name: ' \n ' }))).toBe('A session of type other has a name')
  })

  it('cleans up the name, which can be empty', () => {
    expect(parse({ name: '  HAUTE \n RIVE\tTAKEOVER ' }).name).toBe('HAUTE RIVE TAKEOVER')
    expect(parse({ name: '' }).name).toBe('')
    expect(parse({ name: `${'x'.repeat(100)}  ` }).name).toHaveLength(100)
    expect(sessionError(sessionFields({ name: 'x'.repeat(101) }))).toBe('The name must be text, up to 100 characters')
    expect(sessionError(sessionFields({ name: null }))).toBe('The name must be text, up to 100 characters')
  })

  it('cleans up the description, keeping its spaces and line breaks, which can be empty', () => {
    expect(parse({ description: ' \r\n Ligne 1\r\n\r\nLigne  2\rLigne\t3 \n' }).description).toBe('Ligne 1\n\nLigne  2\nLigne\t3')
    expect(parse({ description: '' }).description).toBe('')
    expect(parse({ description: `${'x'.repeat(5000)} \r\n` }).description).toHaveLength(5000)
    // Its length counts once each line break is \n.
    expect(parse({ description: 'x\r\n'.repeat(2500) }).description).toHaveLength(4999)
    for (const description of ['x'.repeat(5001), null, undefined, 42]) {
      expect(sessionError(sessionFields({ description })), String(description)).toBe('The description must be text, up to 5000 characters')
    }
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
        performanceTypes: ['live-performance', 'dj', 'dj'],
        otherPerformanceType: '  Synthé \n modulaire ',
        genres: ['ambient', 'techno', 'ambient'],
        soundcloudTrack: 'https://soundcloud.com/parkingdotradio/3tons?si=x',
        youtubeVideo: 'https://youtu.be/dQw4w9WgXcQ',
      }),
    ).toEqual({
      performers: [{ id: 'artist-1' }, { id: 'artist-2' }],
      offsetMinutes: 60,
      durationMinutes: 60,
      // In the order of the list, without duplicates.
      performanceTypes: ['dj', 'live-performance'],
      otherPerformanceType: 'Synthé modulaire',
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

  it('refuses performance types and genres that are not in their lists, or not lists', () => {
    const performanceTypes = 'The performance types must be ids among dj, vinyl, live-performance, rap, full-band'
    for (const sent of [['dj', 'karaoke'], 'dj', null, undefined]) expect(setError(setFields({ performanceTypes: sent }))).toBe(performanceTypes)
    const genres = 'The genres must be ids of artists\' genres, e.g. "techno"'
    for (const sent of [['techno', 'polka'], 'techno', null, undefined]) expect(setError(setFields({ genres: sent }))).toBe(genres)
    expect(parse({ performanceTypes: [], genres: [] })).toMatchObject({ performanceTypes: [], genres: [] })
  })

  it('cleans up the other performance type, which can be empty', () => {
    expect(parse({ otherPerformanceType: `${'x'.repeat(60)} ` }).otherPerformanceType).toHaveLength(60)
    for (const otherPerformanceType of ['x'.repeat(61), null, undefined]) {
      expect(setError(setFields({ otherPerformanceType }))).toBe('The other performance type must be text, up to 60 characters')
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

describe('the rules that involve several fields', () => {
  it("are those of a session's type, its takeover and its name, which a change checks on the session it would make", () => {
    expect(brokenSessionRule({ type: 'takeover', takeover: 'c', name: '' })).toBeNull()
    expect(brokenSessionRule({ type: 'other', takeover: null, name: 'ATELIER' })).toBeNull()
    expect(brokenSessionRule({ type: 'takeover', takeover: null, name: 'X' })).toEqual({ message: 'A takeover has a collective', field: 'takeover' })
    expect(brokenSessionRule({ type: 'guest-mixes', takeover: 'c', name: '' })).toEqual({ message: 'Only a takeover has a collective', field: 'takeover' })
    expect(brokenSessionRule({ type: 'other', takeover: null, name: '' })).toEqual({ message: 'A session of type other has a name', field: 'name' })
  })

  it("are those of a set's place", () => {
    expect(brokenSetRule({ offsetMinutes: null, durationMinutes: null })).toBeNull()
    expect(brokenSetRule({ offsetMinutes: 0, durationMinutes: 60 })).toBeNull()
    expect(brokenSetRule({ offsetMinutes: 0, durationMinutes: null })).toEqual({ message: 'A set with an offset also has a duration', field: 'durationMinutes' })
  })

  it('are checked by the schemas too, after the fields', () => {
    expect(SessionFields.safeParse(sessionFields({ type: 'takeover' })).error?.issues[0]).toMatchObject({ message: 'A takeover has a collective', path: ['takeover'] })
    expect(SetFields.safeParse(setFields({ offsetMinutes: 0, durationMinutes: null })).error?.issues[0]).toMatchObject({
      message: 'A set with an offset also has a duration',
      path: ['durationMinutes'],
    })
  })

  it("refuse the fields they don't take, naming them", () => {
    expect(SessionFields.safeParse({ ...sessionFields(), title: 'X' }).error?.issues[0].message).toBe('Unknown field: `title`')
    expect(SetFields.safeParse({ ...setFields(), id: 'set-1' }).error?.issues[0].message).toBe('Unknown field: `id`')
  })
})
