import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Artist } from '../../artist-profile'
import type { Collective } from '../../collective-profile'
import { collectiveOption, deletedWith, membersGenres, sessionDay, sessionHours, sessionName, sessionWhen, setDuration, sessionPerformers, setInSentence, setName, setTitle } from './describe'
import type { Session } from '../../session-fields'

describe('membersGenres', () => {
  const artists = new Map(
    (
      [
        ['a', ['techno', 'acid', 'ambient']],
        ['b', ['house']],
        ['c', ['acid', 'house', 'disco', 'jazz']],
        ['d', []],
      ] as const
    ).map(([id, genres]) => [id, { id, genres: [...genres] } as unknown as Artist]),
  )

  it("reads every member's first genre, in the order of the members, then every member's second, and so on, each once", () => {
    expect(membersGenres([{ id: 'a' }, { id: 'b' }, { id: 'c' }], artists)).toEqual(['techno', 'house', 'acid', 'ambient', 'disco', 'jazz'])
    expect(membersGenres([{ id: 'c' }, { id: 'a' }], artists)).toEqual(['acid', 'techno', 'house', 'disco', 'ambient', 'jazz'])
  })

  it('has none for members without genres, or who are unknown, and none without members', () => {
    expect(membersGenres([{ id: 'd' }, { id: 'unknown' }, { id: 'b' }], artists)).toEqual(['house'])
    expect(membersGenres([{ id: 'd' }], artists)).toEqual([])
    expect(membersGenres([], artists)).toEqual([])
  })
})

describe('collectiveOption', () => {
  const collective = (changes: Partial<Collective>) =>
    ({ id: 'collective-1', name: 'Ondes', email: null, city: '', country: '', members: [], ...changes }) as Collective

  it("tells a collective apart by its email, or else where it's from, or else its artists, like an artist", () => {
    expect(collectiveOption(collective({ email: 'ondes@example.com', city: 'Québec', country: 'CA' })).detail).toBe('ondes@example.com')
    expect(collectiveOption(collective({ city: 'Québec', country: 'CA' })).detail).toBe('Québec, Canada')
    expect(collectiveOption(collective({ country: 'CA' })).detail).toBe('Canada')
    const members = [
      { id: 'artist-1', name: 'Aurore' },
      { id: 'artist-2', name: 'Brume' },
    ]
    expect(collectiveOption(collective({ members })).detail).toBe('Aurore, Brume')
    expect(collectiveOption(collective({})).detail).toBeNull()
  })
})

describe('deletedWith', () => {
  it('lists the photo and the applications, with how many there are when that is known, unless there are none', () => {
    expect(deletedWith('Aurore', true, 2)).toBe('Aurore, sa photo et ses candidatures (2)')
    expect(deletedWith('Aurore', true, null)).toBe('Aurore, sa photo et ses candidatures')
    expect(deletedWith('Aurore', true, 0)).toBe('Aurore et sa photo')
    expect(deletedWith('Aurore', false, 1)).toBe('Aurore et ses candidatures (1)')
    expect(deletedWith('Aurore', false, 0)).toBe('Aurore')
  })
})

describe("sessions' days and times", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("are in Québec time, whatever the browser's time zone", async () => {
    // Loaded again in Tokyo's time zone, since formatters keep the one they're created in.
    vi.stubEnv('TZ', 'Asia/Tokyo')
    vi.resetModules()
    const { sessionDay, sessionHours, sessionWhen } = await import('./describe')
    const session = { start: '2026-11-15T04:00:00.000Z', end: '2026-11-15T06:30:00.000Z', durationMinutes: 150 }
    expect(sessionDay(session)).toBe('sam. 14 nov. 2026')
    expect(sessionHours(session)).toBe('23 h – 1 h 30')
    expect(sessionWhen(session)).toBe('samedi 14 novembre 2026, de 23 h à 1 h 30 le lendemain')
  })

  it("say the day a session ends, when its times alone don't say it", () => {
    // Times in Québec, from November 13th, 2026, a Friday.
    const at = (day: number, time: string) => new Date(`2026-11-${day}T${time}:00-05:00`).toISOString()
    const times = (start: string, end: string) => {
      const session = { start, end, durationMinutes: (Date.parse(end) - Date.parse(start)) / 60000 }
      return [sessionHours(session), sessionWhen(session)]
    }
    expect(times(at(14, '21:00'), at(14, '23:00'))).toEqual(['21 h – 23 h', 'samedi 14 novembre 2026, de 21 h à 23 h'])
    expect(times(at(14, '21:00'), at(15, '01:00'))).toEqual(['21 h – 1 h', 'samedi 14 novembre 2026, de 21 h à 1 h le lendemain'])
    // The next day at an earlier time, at most 12 hours after it starts, or at 00:00.
    expect(times(at(14, '21:00'), at(15, '09:00'))).toEqual(['21 h – 9 h', 'samedi 14 novembre 2026, de 21 h à 9 h le lendemain'])
    expect(times(at(14, '10:00'), at(15, '00:00'))).toEqual(['10 h – 0 h', 'samedi 14 novembre 2026, de 10 h à 0 h le lendemain'])
    // Or later than 12 hours after it starts, which only the full form says without the day it ends.
    expect(times(at(14, '21:00'), at(15, '09:30'))).toEqual(['21 h – dim. 15 nov., 9 h 30', 'samedi 14 novembre 2026, de 21 h à 9 h 30 le lendemain'])
    expect(times(at(14, '15:00'), at(15, '11:00'))).toEqual(['15 h – dim. 15 nov., 11 h', 'samedi 14 novembre 2026, de 15 h à 11 h le lendemain'])
    // 12 hours as they pass, over the night the clocks go back.
    expect(times('2026-10-31T21:00:00-04:00', '2026-11-01T08:00:00-05:00')[0]).toBe('21 h – 8 h')
    expect(times('2026-10-31T21:00:00-04:00', '2026-11-01T09:00:00-05:00')[0]).toBe('21 h – dim. 1 nov., 9 h')
    // The next day, at the same time or later.
    expect(times(at(14, '21:00'), at(15, '21:00'))).toEqual(['21 h – dim. 15 nov., 21 h', 'samedi 14 novembre 2026, de 21 h à 21 h le lendemain'])
    expect(times(at(14, '18:00'), at(15, '20:00'))).toEqual(['18 h – dim. 15 nov., 20 h', 'samedi 14 novembre 2026, de 18 h à 20 h le lendemain'])
    // From 00:00 to 00:00, which isn't earlier.
    expect(times(at(14, '00:00'), at(15, '00:00'))[0]).toBe('0 h – dim. 15 nov., 0 h')
    // Later.
    expect(times(at(13, '18:00'), at(15, '02:00'))).toEqual([
      '18 h – dim. 15 nov., 2 h',
      'du vendredi 13 novembre 2026 à 18 h au dimanche 15 novembre 2026 à 2 h',
    ])
    // Across a new year, without its year.
    expect(times('2027-12-30T23:00:00.000Z', '2028-01-02T01:00:00.000Z')).toEqual([
      '18 h – sam. 1 janv., 20 h',
      'du jeudi 30 décembre 2027 à 18 h au samedi 1 janvier 2028 à 20 h',
    ])
  })
})

describe('dates and times', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("are in Québec time, whatever the browser's time zone", async () => {
    vi.stubEnv('TZ', 'Asia/Tokyo')
    vi.resetModules()
    const { byWhom, dateFormat } = await import('./describe')
    expect(dateFormat.format(new Date('2026-10-05T23:30:00-04:00'))).toBe('5 octobre 2026')
    expect(byWhom('Modifiée', 'admin@example.com', '2026-10-05T23:30:00-04:00')).toBe('Modifiée par admin@example.com le 5 octobre 2026 à 23 h 30.')
  })
})

describe('names and times of sessions and sets', () => {
  const session = { start: null, end: null, durationMinutes: 150, title: 'GUEST MIXES' }

  it("are a session's duration while its date isn't known, and a set's duration, which sets have rather than times", () => {
    expect(sessionDay(session)).toBe('date à déterminer')
    expect(sessionHours(session)).toBe('2 h 30')
    expect(sessionWhen(session)).toBe('date à déterminer')
    expect(setDuration({ durationMinutes: 45 })).toBe('45 min')
    expect(setDuration({ durationMinutes: 90 })).toBe('1 h 30')
    expect(setDuration({ durationMinutes: null })).toBe('à déterminer')
  })

  it('name a session by its title, with its day, where it is named along with others', () => {
    expect(sessionName({ start: '2026-11-15T02:00:00.000Z', title: 'HAUTE RIVE TAKEOVER' })).toBe('HAUTE RIVE TAKEOVER, sam. 14 nov. 2026')
    expect(sessionName(session)).toBe('GUEST MIXES, date à déterminer')
  })

  it('name a set by its performers, with its session where it is named outside of it', () => {
    const set = { performers: [{ id: 'a', name: 'Aurore' }, { id: 'b', name: 'Brume' }] }
    expect(setTitle(set)).toBe('Set de Aurore et Brume')
    expect(setTitle({ performers: [] })).toBe('Set')
    expect(setName(set)).toBe('Set de Aurore et Brume')
    expect(setName(set, { start: '2026-11-15T02:00:00.000Z', title: 'HAUTE RIVE' })).toBe('Set de Aurore et Brume, HAUTE RIVE, sam. 14 nov. 2026')
    expect(setInSentence(set)).toBe('le set de Aurore et Brume')
    expect(setInSentence({ performers: [] })).toBe('le set')
  })

  it("list a session's performers, set by set, leaving out the sets without any", () => {
    const performers = (...names: string[]) => ({ performers: names.map((name) => ({ id: name, name })) })
    expect(sessionPerformers({ sets: [performers('Aurore', 'Brume'), performers(), performers('Cyan')] as Session['sets'] })).toBe('Aurore, Brume · Cyan')
    expect(sessionPerformers({ sets: [] })).toBe('')
  })
})
