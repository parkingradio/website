import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { multipartBody } from '../api/test-multipart.js'
import { sessionCookies } from '../admins/test-sessions.js'
import type { TestDatabase } from '../db/test-database.js'
import type { TrackRead } from './soundcloud.js'
import { rotationStore } from './rotation-store.js'
import { resetRotation, rotationTestApp } from './test-rotation.js'
import type { RotationTestApp } from './test-rotation.js'
import type { TrackReads } from './track-reads.js'

// The rotation of sets, against a real database (see "The rotation of sets" in docs/design/server/radio.md): its sets are
// added and changed through the admin routes of sessions, and SoundCloud is faked.

const HOUR = 60 * 60 * 1000
const MINUTE = 60 * 1000

// What SoundCloud says of the tracks, by link: by default, that they're playable, last an hour, and that a private link's
// secret is its last segment.
const answers = new Map<string, TrackRead | Error>()
const readTrack = vi.fn(async (link: string): Promise<TrackRead> => {
  const answer = answers.get(link)
  if (answer instanceof Error) throw answer
  return answer ?? { state: 'playable', durationMs: HOUR, secretToken: /\/(s-[^/]+)$/.exec(link)?.[1] ?? null }
})
let testApp: RotationTestApp
let database: TestDatabase
let app: FastifyInstance
let reads: TrackReads

beforeAll(async () => {
  testApp = await rotationTestApp(readTrack)
  ;({ database, app, reads } = testApp)
})

afterAll(async () => {
  await app?.close()
  await database?.drop()
})

beforeEach(async () => {
  await resetRotation(testApp)
  answers.clear()
  readTrack.mockClear()
})

async function request(method: 'GET' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) {
  return app.inject({ method, url, payload, cookies: url.startsWith('/api/admin/') ? await sessionCookies() : undefined })
}

// A request that has to succeed.
async function ok(method: 'GET' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) {
  const response = await request(method, url, payload)
  expect(response.statusCode, response.body).toBe(200)
  return response.json()
}

let created = 0
// The link of a set's track, private unless told otherwise, so that the tests check that private links stay private.
const trackLink = (n: number, { private: secret = true } = {}) => `https://soundcloud.com/parking/set-${n}${secret ? `/s-SeCrEt${n}` : ''}`
const video = (n: number) => `vid${String(n).padStart(8, '0')}`

type Session = { id: string; title: string; start: string; sets: { id: string; soundcloudTrack: { id: string; url: string } | null }[] }

// Adds an announced session of `count` sets, unless told otherwise, each by its own artist, with a track, private for every
// other set, from the first, and a video.
async function createSession(count: number, { announced = true, fields = {} as Record<string, unknown>, day = 1 } = {}): Promise<Session> {
  const sets = []
  for (let i = 0; i < count; i++) {
    const n = ++created
    const artist = JSON.stringify({ name: `Artist ${n}`, country: 'CA', city: 'Québec', genres: ['techno'], bio: '', links: {}, phone: '', email: null })
    const response = await app.inject({ method: 'POST', url: '/api/admin/artists', ...multipartBody({ artist }), cookies: await sessionCookies() })
    expect(response.statusCode, response.body).toBe(200)
    sets.push({
      performers: [{ id: response.json().artist.id }],
      durationMinutes: 60,
      performanceTypes: ['dj'],
      otherPerformanceType: '',
      genres: ['techno'],
      soundcloudTrack: trackLink(n, { private: i % 2 === 0 }),
      youtubeVideo: video(n),
      application: null,
      ...fields,
    })
  }
  const session = JSON.stringify({
    start: `2026-10-${String(day).padStart(2, '0')}T21:00-04:00`,
    durationMinutes: 600,
    type: 'guest-mixes',
    takeover: null,
    application: null,
    name: '',
    raEvent: null,
    description: '',
    sets,
  })
  const response = await app.inject({ method: 'POST', url: '/api/admin/sessions', ...multipartBody({ session }), cookies: await sessionCookies() })
  expect(response.statusCode, response.body).toBe(200)
  const added: Session = response.json().session
  if (announced) await ok('PUT', `/api/admin/sessions/${added.id}/announced`, { announced: true })
  return added
}

const setIds = (session: Session) => session.sets.map(({ id }) => id)
const linkOf = (session: Session, index: number) => session.sets[index].soundcloudTrack!.url
const putRotation = (sets: string[]) => request('PUT', '/api/admin/radio/rotation', { sets })
const rotation = () => ok('GET', '/api/admin/radio/rotation')
const onAir = (query = '') => ok('GET', `/api/on-air${query}`)
const onAirId = async () => (await onAir()).current?.set.id ?? null

// Makes the set on air have started `ms` earlier than it did.
async function rewind(ms: number) {
  await database.db.execute(sql`update radio_rotation set on_air_started_at = on_air_started_at - ${`${ms} milliseconds`}::interval`)
}

describe('the rotation of sets', () => {
  it('is empty at first, and the radio off air', async () => {
    expect(await onAir()).toEqual({ ok: true, current: null, upcoming: [] })
    expect(await rotation()).toEqual({ ok: true, updatedBy: null, updatedAt: null, current: null, sets: [] })
  })

  it('puts its first set on air once it is filled, and its tracks read, and gives its sets as their events do', async () => {
    const session = await createSession(3)
    const [a, b, c] = setIds(session)
    const before = Date.now()
    const changed = (await putRotation([b, a, c])).json()

    expect(readTrack).toHaveBeenCalledTimes(3)
    expect(changed).toMatchObject({ ok: true, updatedBy: 'admin@example.com', current: { setId: b } })
    expect(changed.sets.map(({ id, skipped, durationMs }: { id: string; skipped: string[]; durationMs: number }) => [id, skipped, durationMs])).toEqual([
      [b, [], HOUR],
      [a, [], HOUR],
      [c, [], HOUR],
    ])
    const starts = changed.sets.map(({ startsAt }: { startsAt: string }) => Date.parse(startsAt))
    expect(starts[0]).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000)
    expect(starts.slice(1)).toEqual([starts[0] + HOUR, starts[0] + 2 * HOUR])
    // The admin endpoints give the private link.
    expect(changed.sets[1].soundcloudTrack.url).toBe(linkOf(session, 0))
    expect(linkOf(session, 0)).toContain('/s-SeCrEt')

    const now = await onAir('?upcoming=4')
    expect(now.current).toEqual({
      set: {
        id: b,
        performers: [{ id: expect.any(String), name: `Artist ${created - 1}` }],
        durationMinutes: 60,
        performanceTypes: ['dj'],
        otherPerformanceType: '',
        genres: ['techno'],
        cancelled: false,
        soundcloudTrack: { id: session.sets[1].soundcloudTrack!.id, url: linkOf(session, 1) },
        youtubeVideo: { id: video(created - 1), url: `https://www.youtube.com/watch?v=${video(created - 1)}` },
        session: { id: session.id, title: 'GUEST MIXES', start: '2026-10-01T21:00:00-04:00', takeover: null },
      },
      startedAt: changed.current.startedAt,
      durationMs: HOUR,
    })
    expect(now.upcoming.map(({ set, startsAt }: { set: { id: string }; startsAt: string }) => [set.id, Date.parse(startsAt) - starts[0]])).toEqual([
      [a, HOUR],
      [c, 2 * HOUR],
      [b, 3 * HOUR],
      [a, 4 * HOUR],
    ])
    // Private links, and their secrets, are never public.
    expect(now.upcoming[0].set.soundcloudTrack.url).toBeNull()
    expect(JSON.stringify(await onAir('?upcoming=100'))).not.toContain('SeCrEt')
  })

  it('moves along as sets end', async () => {
    const [a, b] = setIds(await createSession(2))
    await putRotation([a, b])
    await rewind(HOUR + MINUTE)
    expect(await onAirId()).toBe(b)
    const moved = await rotation()
    expect(moved.current.setId).toBe(b)
    // From the set on air.
    expect(moved.sets.map(({ id }: { id: string }) => id)).toEqual([b, a])
  })

  it('refuses a set twice, a set that does not exist, and one that cannot be added, saying why, and changes nothing then', async () => {
    const [a, b] = setIds(await createSession(2))
    const [hidden] = setIds(await createSession(1, { announced: false, day: 2, fields: { youtubeVideo: null } }))
    const cancelled = setIds(await createSession(1, { day: 3 }))[0]
    await ok('PUT', `/api/admin/sets/${cancelled}/status`, { status: 'cancelled' })
    await putRotation([a])
    const before = await rotation()

    const cases: [string[], number, object][] = [
      [[a, b, a.toUpperCase()], 400, { error: 'A set is only once in the rotation', setIndex: 2 }],
      [[a, 'not-an-id'], 400, { error: 'No such set', setIndex: 1 }],
      [[a, '00000000-0000-4000-8000-000000000000'], 400, { error: 'No such set', setIndex: 1 }],
      [[a, b, hidden], 409, { error: "This set can't be added to the rotation", setIndex: 2, reasons: ['no-youtube-video', 'not-announced'] }],
      [[cancelled], 409, { setIndex: 0, reasons: ['cancelled'] }],
    ]
    for (const [sets, status, body] of cases) {
      const response = await putRotation(sets)
      expect(response.statusCode, JSON.stringify(sets)).toBe(status)
      expect(response.json()).toMatchObject({ ok: false, ...body })
    }
    for (const payload of [{}, { sets: a }, { sets: [a], extra: 1 }]) {
      const response = await request('PUT', '/api/admin/radio/rotation', payload)
      expect(response.statusCode, JSON.stringify(payload)).toBe(400)
    }
    expect(await rotation()).toEqual(before)
    // The candidates are the sets that can be added, and aren't in the rotation.
    expect(await ok('GET', '/api/admin/radio/rotation/candidates')).toMatchObject({ ok: true, total: 1, sets: [{ id: b }] })
  })

  it('keeps a set that cannot be added anymore in its place, skipped, saying why, and puts the next set on air', async () => {
    const session = await createSession(3)
    const [a, b, c] = setIds(session)
    await putRotation([a, b, c])
    const announced = (value: boolean) => ok('PUT', `/api/admin/sessions/${session.id}/announced`, { announced: value })
    await announced(false)
    // Nothing is public anymore.
    expect(await onAir()).toEqual({ ok: true, current: null, upcoming: [] })
    // From where it comes back on air: after a, the set that was on air last.
    expect((await rotation()).sets.map(({ id, skipped }: { id: string; skipped: string[] }) => [id, skipped])).toEqual([
      [b, ['not-announced']],
      [c, ['not-announced']],
      [a, ['not-announced']],
    ])
    await announced(true)
    expect(await onAirId()).toBe(b)
    await announced(false)
    // The rotation can still be changed without taking them out, and comes back at its first set.
    expect((await putRotation([c, b, a])).statusCode).toBe(200)
    await announced(true)
    expect(await onAirId()).toBe(c)

    await ok('PUT', `/api/admin/sets/${c}/status`, { status: 'cancelled' })
    expect(await onAirId()).toBe(b)
    await ok('PATCH', `/api/admin/sets/${b}`, { youtubeVideo: null })
    expect(await onAirId()).toBe(a)
    expect((await rotation()).sets.map(({ id, skipped, startsAt }: { id: string; skipped: string[]; startsAt: string | null }) => [id, skipped, startsAt !== null])).toEqual([
      [a, [], true],
      [c, ['cancelled'], false],
      [b, ['no-youtube-video'], false],
    ])
  })

  it('takes a deleted set, or the sets of a deleted session, out of the rotation, and puts the next one on air', async () => {
    const [a, b] = setIds(await createSession(2))
    const other = await createSession(1, { day: 2 })
    const [c] = setIds(other)
    await putRotation([a, b, c])
    await ok('DELETE', `/api/admin/sets/${a}`)
    expect(await onAirId()).toBe(b)
    expect((await rotation()).sets.map(({ id }: { id: string }) => id)).toEqual([b, c])
    await ok('DELETE', `/api/admin/sessions/${other.id}`)
    expect((await rotation()).sets.map(({ id }: { id: string }) => id)).toEqual([b])
  })

  it('keeps the set on air on air when it stays first, and puts another first set on air from its start', async () => {
    const [a, b, c, d] = setIds(await createSession(4))
    await putRotation([a, b, c, d])
    const { startedAt } = (await rotation()).current
    expect((await putRotation([a, d, c])).json().current).toEqual({ setId: a, startedAt })
    // Given back as it's given, nothing changes.
    const given = await rotation()
    expect((await putRotation(given.sets.map(({ id }: { id: string }) => id))).json()).toMatchObject({ current: { setId: a, startedAt }, sets: given.sets })
    const before = Date.now()
    const other = (await putRotation([c, a, d])).json()
    expect(other.current.setId).toBe(c)
    expect(Date.parse(other.current.startedAt)).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000)
    // Taken out: the set after it goes on air.
    expect((await putRotation([a, d])).json().current.setId).toBe(a)
  })

  it('puts a set just added first on air once its track is read, by the time it responds', async () => {
    const [a, b] = setIds(await createSession(2))
    const [x, y] = setIds(await createSession(2, { day: 2 }))
    await putRotation([a, b])
    // a, which comes after it, stays on air until x is read.
    const added = (await putRotation([x, a, b])).json()
    expect(added.current.setId).toBe(x)
    expect(added.sets.map(({ id, skipped }: { id: string; skipped: string[] }) => [id, skipped])).toEqual([
      [x, []],
      [a, []],
      [b, []],
    ])
    // b, which comes after it, goes on air until y is read.
    expect((await putRotation([y, b, a, x])).json().current.setId).toBe(y)
    expect(await onAirId()).toBe(y)
  })

  it('skips a set whose track cannot be played in full, or has not been read through its new link, and only streams the others', async () => {
    const session = await createSession(2)
    const [a, b] = setIds(session)
    const [c] = setIds(await createSession(1, { day: 2 }))
    answers.set(linkOf(session, 0), { state: 'preview', durationMs: 30_000, secretToken: 's-SeCrEt' })
    await putRotation([a, b])
    // From b, on air.
    expect((await rotation()).sets.map(({ id, skipped }: { id: string; skipped: string[] }) => [id, skipped])).toEqual([
      [b, []],
      [a, ['preview']],
    ])

    expect((await request('GET', `/api/radio/sets/${a}/stream`)).statusCode).toBe(404)
    expect((await request('GET', `/api/radio/sets/${c}/stream`)).statusCode).toBe(404)
    const stream = await request('GET', `/api/radio/sets/${b.toUpperCase()}/stream`)
    expect(stream.statusCode, stream.body).toBe(200)
    expect(stream.json()).toEqual({ ok: true, url: expect.stringContaining('https://cdn.test/'), expiresAt: expect.any(String) })

    // Another link: unread until it's read, and its read failing is kept, with why.
    const link = trackLink(999)
    answers.set(link, new Error(`Something quoting ${link}`))
    await ok('PATCH', `/api/admin/sets/${b}`, { soundcloudTrack: link })
    const [, changed] = (await rotation()).sets
    expect(changed).toMatchObject({ skipped: ['unread'], durationMs: null, readError: null })
    await reads.readDue()
    const [, failed] = (await rotation()).sets
    expect(failed).toMatchObject({ skipped: ['unread'], readError: "SoundCloud can't be reached, or answered unexpectedly" })
    expect(JSON.stringify(await rotation())).not.toContain('Something quoting')
    expect(await onAir()).toEqual({ ok: true, current: null, upcoming: [] })
  })

  it('changes the rotation at a time taken once nothing else can change what is on air', async () => {
    const [a, b] = setIds(await createSession(2))
    await putRotation([a, b])
    const clock = vi.fn(() => Date.now())
    let locked!: () => void
    let release!: () => void
    const isLocked = new Promise<void>((resolve) => (locked = resolve))
    const released = new Promise<void>((resolve) => (release = resolve))
    // As a request that's keeping what's on air would.
    const holding = database.db.transaction(async (tx) => {
      await tx.execute(sql`select id from radio_rotation for update`)
      locked()
      await released
    })
    await isLocked
    // Taking a out puts b on air, from then on.
    const replacing = rotationStore(database.db).replace([b], 'admin@example.com', clock)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(clock).not.toHaveBeenCalled()
    release()
    await holding
    const { updatedAt, saved } = await replacing
    expect(clock).toHaveBeenCalledTimes(1)
    const now = clock.mock.results[0].value as number
    expect(updatedAt!.getTime()).toBe(now)
    expect(saved).toMatchObject({ setId: b, startedAt: now })
  })

  it('keeps what was read of a track when reading it again fails', async () => {
    const session = await createSession(1)
    const [a] = setIds(session)
    await putRotation([a])
    answers.set(linkOf(session, 0), new Error('SoundCloud is down'))
    await database.db.execute(sql`update soundcloud_track_reads set read_at = read_at - interval '2 hours'`)
    await reads.readDue()
    const [set] = (await rotation()).sets
    expect(set).toMatchObject({ skipped: [], durationMs: HOUR, readError: "SoundCloud can't be reached, or answered unexpectedly" })
    expect(await onAirId()).toBe(a)
  })

  it('stays consistent when the rotation changes while sets are deleted and what is on air is asked for', async () => {
    const sessions = await Promise.all([1, 2, 3].map((day) => createSession(3, { day })))
    const all = sessions.flatMap(setIds)
    await putRotation(all)
    const results = await Promise.all([
      ...all.slice(0, 6).map((id, i) => putRotation(i % 2 === 0 ? all.slice(i) : all.toReversed())),
      ...all.slice(6).map((id) => request('DELETE', `/api/admin/sets/${id}`)),
      ...all.map(() => request('GET', '/api/on-air')),
    ])
    // A PUT can find that a set it sends was deleted, but nothing fails otherwise, e.g. with a deadlock.
    for (const response of results) expect([200, 400], response.body).toContain(response.statusCode)
    const final = await rotation()
    expect(final.sets.every(({ id }: { id: string }) => !all.slice(6).includes(id))).toBe(true)
    if (final.current) expect(final.sets.map(({ id }: { id: string }) => id)).toContain(final.current.setId)
  })
})
