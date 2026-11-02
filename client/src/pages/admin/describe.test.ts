import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Artist } from '../../artist-profile'
import type { Collective } from '../../collective-profile'
import { collectiveOption, deletedWith, membersGenres, sessionDay, sessionHours, sessionName, sessionTitle, sessionWhen, setHours, setName, setTitle } from './describe'

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

describe("sessions' and sets' days and times", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("are in Québec time, whatever the browser's time zone", async () => {
    // Loaded again in Tokyo's time zone, since formatters keep the one they're created in.
    vi.stubEnv('TZ', 'Asia/Tokyo')
    vi.resetModules()
    const { sessionDay, sessionHours, sessionWhen, setHours } = await import('./describe')
    const session = { start: '2026-11-15T04:00:00.000Z', end: '2026-11-15T06:30:00.000Z', durationMinutes: 150 }
    expect(sessionDay(session)).toBe('sam. 14 nov. 2026')
    expect(sessionHours(session)).toBe('23 h – 1 h 30')
    expect(sessionWhen(session)).toBe('samedi 14 novembre 2026, de 23 h à 1 h 30 le lendemain')
    expect(setHours({ ...session, offsetMinutes: 0 })).toBe('23 h – 1 h 30')
  })
})

describe('names and times of sessions and sets', () => {
  const session = { start: null, end: null, durationMinutes: 150, name: '', takeover: null }

  it("are counted from a session's start while its date isn't known", () => {
    expect(sessionDay(session)).toBe('date à déterminer')
    expect(sessionHours(session)).toBe('2 h 30')
    expect(sessionWhen(session)).toBe('date à déterminer')
    expect(setHours({ start: null, end: null, offsetMinutes: 0, durationMinutes: 45 })).toBe('+0 h – +0 h 45')
    expect(setHours({ start: null, end: null, offsetMinutes: 90, durationMinutes: 60 })).toBe('+1 h 30 – +2 h 30')
    expect(setHours({ start: null, end: null, offsetMinutes: null, durationMinutes: 45 })).toBe('horaire à déterminer (45 min)')
    expect(setHours({ start: null, end: null, offsetMinutes: null, durationMinutes: null })).toBe('horaire à déterminer')
  })

  it('name a session by its name, its takeover or its day, with its day where it is named along with others', () => {
    const dated = { start: '2026-11-15T02:00:00.000Z', name: '', takeover: null }
    expect(sessionTitle({ ...dated, name: 'HAUTE RIVE' })).toBe('HAUTE RIVE')
    expect(sessionName({ ...dated, name: 'HAUTE RIVE' })).toBe('HAUTE RIVE, sam. 14 nov. 2026')
    expect(sessionName({ ...session, takeover: { id: 'c', name: 'Ondes' } })).toBe('Takeover de Ondes, date à déterminer')
    expect(sessionName(dated)).toBe('Session du samedi 14 novembre 2026')
    expect(sessionName(session)).toBe('Session sans date')
  })

  it('name a set by its performers, with its session where it is named outside of it', () => {
    const set = { performers: [{ id: 'a', name: 'Aurore' }, { id: 'b', name: 'Brume' }], start: null, end: null, offsetMinutes: 60, durationMinutes: 60 }
    expect(setTitle(set)).toBe('Set de Aurore et Brume')
    expect(setTitle({ performers: [] })).toBe('Set')
    expect(setName(set as never)).toBe('Set de Aurore et Brume, +1 h – +2 h')
    expect(setName(set as never, { ...session, name: 'HAUTE RIVE' })).toBe('Set de Aurore et Brume, HAUTE RIVE, date à déterminer, +1 h – +2 h')
  })
})
