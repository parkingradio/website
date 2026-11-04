import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import { useZodSchemas } from '../api/schemas.js'
import { acceptSessions, sessionCookies } from '../admins/test-sessions.js'
import { NoSoundCloudCredentials } from '../radio/soundcloud-app.js'
import { Conflict, NoSuchReference } from './store.js'
import type { SessionsStore, StoredSession, StoredSet } from './store.js'
import { sessionsRoutes } from './routes.js'

// A fake database: the sessions, with their sets, and the artists and collectives that exist, by id. It doesn't check the
// rules of sessions, which the integration tests cover against a real database (see integration-tests/021-sessions.sh):
// the tests below make it throw what the real one would.
let rows: StoredSession[] = []
const NAMES: Record<string, string> = { 'artist-1': 'Ana', 'artist-2': 'Brume', 'collective-1': 'Les Ondes' }
let nextId = 0
const CREATED_AT = new Date('2026-11-01T12:00:00Z')

// An artist or a collective that a session or a set refers to, with its name, as the database would find it.
function find(kind: 'artist' | 'collective', id: string) {
  if (!id.startsWith(kind) || !NAMES[id]) throw new NoSuchReference(kind === 'artist' ? 'No such artist' : 'No such collective')
  return { id, name: NAMES[id] }
}

const takeover = (takeoverId: string | null) => ({ takeover: takeoverId === null ? null : find('collective', takeoverId) })
const performers = (sent: { id: string }[]) => ({ performers: sent.map(({ id }) => find('artist', id)) })

// Like the database, which leaves a column as it is when it's given undefined.
function defined<T extends object>(changes: T): Partial<T> {
  return Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)) as Partial<T>
}

function sessionOf(setId: string) {
  return rows.find((session) => session.sets.some((set) => set.id === setId)) ?? null
}

function changeSet(id: string, changes: Partial<StoredSet>) {
  const session = sessionOf(id)
  if (!session) return null
  session.sets = session.sets.map((set) => (set.id === id ? { ...set, ...defined(changes) } : set))
  return session
}

const NEW = { updatedBy: null, updatedAt: null, status: 'planned' as const, statusUpdatedBy: null, statusUpdatedAt: null }

const store: SessionsStore = {
  list: vi.fn<SessionsStore['list']>(async (filter) =>
    rows.filter(
      (session) =>
        (filter?.artist === undefined || session.sets.some((set) => set.performers.some(({ id }) => id === filter.artist))) &&
        (filter?.takeover === undefined || session.takeoverId === filter.takeover),
    ),
  ),
  get: async (id) => rows.find((session) => session.id === id) ?? null,
  create: vi.fn<SessionsStore['create']>(async (session) => {
    const row: StoredSession = { id: `session-${++nextId}`, createdAt: CREATED_AT, ...NEW, ...session, ...takeover(session.takeoverId), sets: [] }
    rows.push(row)
    return row
  }),
  update: vi.fn<SessionsStore['update']>(async (id, changes) => {
    const before = rows.find((session) => session.id === id)
    if (!before) return null
    Object.assign(before, changes, takeover(changes.takeoverId))
    return before
  }),
  setStatus: vi.fn<SessionsStore['setStatus']>(async (id, change) => {
    const session = rows.find((row) => row.id === id)
    if (!session) return null
    Object.assign(session, change)
    return session
  }),
  delete: async (id) => {
    const before = rows.length
    rows = rows.filter((session) => session.id !== id)
    return rows.length < before
  },
  getSet: async (id) => sessionOf(id)?.sets.find((set) => set.id === id) ?? null,
  addSet: vi.fn<SessionsStore['addSet']>(async (sessionId, { performers: sent, ...set }) => {
    const session = rows.find((row) => row.id === sessionId)
    if (!session) return null
    session.sets.push({ id: `set-${++nextId}`, createdAt: CREATED_AT, ...NEW, ...set, sessionId, ...performers(sent) })
    return session
  }),
  updateSet: vi.fn<SessionsStore['updateSet']>(async (id, { performers: sent, ...changes }) => changeSet(id, { ...changes, ...performers(sent) })),
  setSetStatus: vi.fn<SessionsStore['setSetStatus']>(async (id, change) => changeSet(id, change)),
  deleteSet: async (id) => {
    const session = sessionOf(id)
    if (!session) return false
    session.sets = session.sets.filter((set) => set.id !== id)
    return true
  },
}

// SoundCloud, through the SoundCloud app.
const resolveTrack = vi.fn<(link: string) => Promise<string | null>>()

function session(changes: object = {}) {
  return { start: '2026-11-14T21:00-05:00', durationMinutes: 240, takeover: 'collective-1', name: 'HAUTE RIVE TAKEOVER', raEvent: '6683745', ...changes }
}

function set(changes: object = {}) {
  return {
    performers: [{ id: 'artist-1' }, { id: 'artist-2' }],
    offsetMinutes: 60,
    durationMinutes: 60,
    performanceTypes: ['live-performance', 'dj'],
    otherPerformanceType: 'Synthé modulaire',
    genres: ['ambient'],
    soundcloudTrack: 'https://soundcloud.com/parkingdotradio/3tons?si=abc',
    youtubeVideo: 'https://www.youtube.com/live/dQw4w9WgXcQ',
    ...changes,
  }
}

// If `logs` is given, every line the app logs is added to it.
async function buildApp(logs?: string[]) {
  const app = Fastify(logs ? { logger: { stream: { write: (line: string) => logs.push(line) } } } : {})
  useZodSchemas(app)
  await app.register(fastifyCookie)
  acceptSessions(app)
  await app.register(sessionsRoutes, { store, resolveTrack })
  return app
}

type App = Awaited<ReturnType<typeof buildApp>>

async function send(app: App, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) {
  return app.inject({ method, url, payload, cookies: await sessionCookies() })
}

async function createSession(app: App, changes: object = {}) {
  return send(app, 'POST', '/api/admin/sessions', session(changes))
}

async function addSet(app: App, sessionId: string, changes: object = {}) {
  return send(app, 'POST', `/api/admin/sessions/${sessionId}/sets`, set(changes))
}

// A session, with a set, as they're added by `createSession` and `addSet` above.
async function sessionWithSet(app: App, changes: object = {}) {
  await createSession(app)
  return addSet(app, 'session-1', changes)
}

describe('sessions routes', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
    rows = []
    nextId = 0
    vi.clearAllMocks()
    resolveTrack.mockImplementation(async (link) => (link.startsWith('https://soundcloud.com/parkingdotradio/') ? '42' : null))
  })

  afterEach(() => {
    delete process.env.JWT_SECRET
  })

  it('requires a session, before reading the request', async () => {
    const app = await buildApp()
    const requests = [
      app.inject({ method: 'GET', url: '/api/admin/sessions' }),
      app.inject({ method: 'GET', url: '/api/admin/sessions?artist=a&artist=b' }),
      app.inject({ method: 'GET', url: '/api/admin/sessions/session-1' }),
      app.inject({ method: 'POST', url: '/api/admin/sessions', payload: { start: 'x' } }),
      app.inject({ method: 'PUT', url: '/api/admin/sessions/session-1', payload: session() }),
      app.inject({ method: 'PUT', url: '/api/admin/sessions/session-1/status', payload: { status: 'maybe' } }),
      app.inject({ method: 'DELETE', url: '/api/admin/sessions/session-1' }),
      app.inject({ method: 'POST', url: '/api/admin/sessions/session-1/sets', payload: set() }),
      app.inject({ method: 'PUT', url: '/api/admin/sets/set-1', payload: set() }),
      app.inject({ method: 'PUT', url: '/api/admin/sets/set-1/status', payload: { status: 'done' } }),
      app.inject({ method: 'DELETE', url: '/api/admin/sets/set-1' }),
    ]
    for (const response of await Promise.all(requests)) {
      expect(response.statusCode).toBe(401)
      expect(response.json()).toEqual({ ok: false, error: 'Unauthorized' })
    }
    expect(store.create).not.toHaveBeenCalled()
    expect(resolveTrack).not.toHaveBeenCalled()
  })

  it('refuses the requests that change sessions and sets from another origin', async () => {
    const app = await buildApp()
    await sessionWithSet(app)
    const options = { headers: { 'sec-fetch-site': 'cross-site' }, cookies: await sessionCookies() }
    const requests = [
      app.inject({ method: 'POST', url: '/api/admin/sessions', payload: session(), ...options }),
      app.inject({ method: 'PUT', url: '/api/admin/sessions/session-1', payload: session(), ...options }),
      app.inject({ method: 'PUT', url: '/api/admin/sessions/session-1/status', payload: { status: 'done' }, ...options }),
      app.inject({ method: 'DELETE', url: '/api/admin/sessions/session-1', ...options }),
      app.inject({ method: 'POST', url: '/api/admin/sessions/session-1/sets', payload: set(), ...options }),
      app.inject({ method: 'PUT', url: '/api/admin/sets/set-2', payload: set(), ...options }),
      app.inject({ method: 'PUT', url: '/api/admin/sets/set-2/status', payload: { status: 'done' }, ...options }),
      app.inject({ method: 'DELETE', url: '/api/admin/sets/set-2', ...options }),
    ]
    for (const response of await Promise.all(requests)) {
      expect(response.statusCode).toBe(403)
    }
    expect(rows).toEqual([expect.objectContaining({ status: 'planned', updatedBy: null, sets: [expect.objectContaining({ status: 'planned', updatedBy: null })] })])
  })

  it('refuses the NUL character in whatever sessions and sets keep or look up, before saving or asking SoundCloud', async () => {
    const app = await buildApp()
    await sessionWithSet(app, { soundcloudTrack: null, youtubeVideo: null })
    vi.clearAllMocks()
    for (const changes of [{ name: 'HAUTE\0RIVE' }, { takeover: 'collective-1\0' }, { raEvent: '6683745\0' }, { start: '2026-11-14T21:00-05:00\0' }]) {
      for (const [method, url] of [
        ['POST', '/api/admin/sessions'],
        ['PUT', '/api/admin/sessions/session-1'],
      ] as const) {
        const response = await send(app, method, url, session(changes))
        expect(response.statusCode, JSON.stringify(changes)).toBe(400)
      }
    }
    for (const changes of [
      { performers: [{ id: 'artist-1\0' }] },
      { otherPerformanceType: 'Synthé\0' },
      { soundcloudTrack: 'https://soundcloud.com/parkingdotradio/2t\0ne' },
      { youtubeVideo: 'https://youtu.be/dQw4w9WgXcQ\0' },
    ]) {
      for (const [method, url] of [
        ['POST', '/api/admin/sessions/session-1/sets'],
        ['PUT', '/api/admin/sets/set-2'],
      ] as const) {
        const response = await send(app, method, url, set(changes))
        expect(response.statusCode, JSON.stringify(changes)).toBe(400)
      }
    }
    for (const url of ['/api/admin/sessions?artist=a%00', '/api/admin/sessions?takeover=a%00', '/api/admin/sessions/session-1%00']) {
      expect((await send(app, 'GET', url)).statusCode, url).toBe(400)
    }
    expect((await send(app, 'PUT', '/api/admin/sessions/session-1/status', { status: 'done\0' })).statusCode).toBe(400)
    expect((await send(app, 'PUT', '/api/admin/sets/set-2/status', { status: 'done\0' })).statusCode).toBe(400)
    expect(store.create).not.toHaveBeenCalled()
    expect(store.update).not.toHaveBeenCalled()
    expect(store.addSet).not.toHaveBeenCalled()
    expect(store.updateSet).not.toHaveBeenCalled()
    expect(resolveTrack).not.toHaveBeenCalled()
  })

  describe('POST /api/admin/sessions', () => {
    it('adds the session, as planned, without sets, and returns it, with its end', async () => {
      const app = await buildApp()
      const response = await createSession(app)

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        ok: true,
        session: {
          id: 'session-1',
          start: '2026-11-15T02:00:00.000Z',
          end: '2026-11-15T06:00:00.000Z',
          durationMinutes: 240,
          takeover: { id: 'collective-1', name: 'Les Ondes' },
          name: 'HAUTE RIVE TAKEOVER',
          raEvent: { id: '6683745', url: 'https://ra.co/events/6683745' },
          sets: [],
          createdAt: '2026-11-01T12:00:00.000Z',
          createdBy: 'admin@example.com',
          updatedBy: null,
          updatedAt: null,
          status: 'planned',
          statusUpdatedBy: null,
          statusUpdatedAt: null,
        },
      })
    })

    it('adds a session without a start, which has no end', async () => {
      const app = await buildApp()
      const response = await createSession(app, { start: null, takeover: '', name: '', raEvent: null })

      expect(response.statusCode).toBe(200)
      expect(response.json().session).toMatchObject({ start: null, end: null, durationMinutes: 240, takeover: null, name: '', raEvent: null })
    })

    it('ends a session after the minutes that actually pass, whatever the clocks say', async () => {
      const app = await buildApp()
      // From midnight, the night the clocks go back an hour: 4 hours later, they say 3:00.
      const response = await createSession(app, { start: '2026-11-01T00:00-04:00' })
      expect(response.json().session).toMatchObject({ start: '2026-11-01T04:00:00.000Z', end: '2026-11-01T08:00:00.000Z' })
    })

    it('refuses an invalid session, saying what is wrong, or a takeover that does not exist', async () => {
      const app = await buildApp()
      let response = await createSession(app, { durationMinutes: 0 })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error: 'The duration must be a whole number of minutes, from 1 to 1440' })
      response = await createSession(app, { takeover: 'artist-1' })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error: 'No such collective' })
      expect(rows).toEqual([])
    })

    it('responds 409 when the session would overlap another one, with that one', async () => {
      const app = await buildApp()
      const other = (await createSession(app)).json().session
      vi.mocked(store.create).mockRejectedValueOnce(new Conflict('Another session overlaps this one', rows[0]))
      let response = await createSession(app)

      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ ok: false, error: 'Another session overlaps this one', session: other, set: null })

      // Unless it can't be found anymore, which only something outside the server could cause.
      vi.mocked(store.create).mockRejectedValueOnce(new Conflict('Another session overlaps this one', null))
      response = await createSession(app)
      expect(response.json()).toEqual({ ok: false, error: 'Another session overlaps this one', session: null, set: null })
    })
  })

  describe('GET /api/admin/sessions', () => {
    it("lists every session, or those with a set an artist played, or a collective's takeovers", async () => {
      const app = await buildApp()
      await sessionWithSet(app, { performers: [{ id: 'artist-1' }], soundcloudTrack: null })
      await createSession(app, { takeover: null, start: null })

      const ids = async (query: string) => {
        const { total, sessions } = (await send(app, 'GET', `/api/admin/sessions${query}`)).json()
        expect(total).toBe(sessions.length)
        return sessions.map((row: { id: string }) => row.id)
      }
      expect(await ids('')).toEqual(['session-1', 'session-3'])
      expect(await ids('?artist=artist-1')).toEqual(['session-1'])
      expect((await send(app, 'GET', '/api/admin/sessions?artist=artist-1')).json().total).toBe(1)
      expect(await ids('?artist=artist-2')).toEqual([])
      expect(await ids('?takeover=collective-1')).toEqual(['session-1'])
      expect(store.list).toHaveBeenLastCalledWith({ takeover: 'collective-1' })
    })

    it('refuses an artist or a takeover given more than once, or both', async () => {
      const app = await buildApp()
      for (const [query, error] of [
        ['artist=a&artist=b', 'The artist must be a single id'],
        ['takeover=a&takeover=b', 'The takeover must be a single id'],
        ['artist=a&takeover=b', 'Only one of artist and takeover can be given'],
      ]) {
        const response = await send(app, 'GET', `/api/admin/sessions?${query}`)
        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ ok: false, error })
      }
    })
  })

  describe('GET /api/admin/sessions/:id', () => {
    it('returns the session, with its sets, or 404', async () => {
      const app = await buildApp()
      await sessionWithSet(app)
      const found = (await send(app, 'GET', '/api/admin/sessions/session-1')).json().session
      expect(found.id).toBe('session-1')
      expect(found.sets.map((row: { id: string }) => row.id)).toEqual(['set-2'])
      const response = await send(app, 'GET', '/api/admin/sessions/session-9')
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ ok: false, error: 'No such session' })
    })
  })

  describe('PUT /api/admin/sessions/:id', () => {
    it('replaces the session, but not its status, says who changed it, and moves its sets with its start', async () => {
      const app = await buildApp()
      await sessionWithSet(app)
      await send(app, 'PUT', '/api/admin/sessions/session-1/status', { status: 'done' })
      const response = await send(app, 'PUT', '/api/admin/sessions/session-1', session({ start: '2026-11-21T20:00-05:00', takeover: null, name: '' }))

      expect(response.statusCode).toBe(200)
      expect(response.json().session).toMatchObject({
        start: '2026-11-22T01:00:00.000Z',
        end: '2026-11-22T05:00:00.000Z',
        takeover: null,
        name: '',
        status: 'done',
        updatedBy: 'admin@example.com',
        updatedAt: expect.any(String),
        sets: [{ id: 'set-2', start: '2026-11-22T02:00:00.000Z', end: '2026-11-22T03:00:00.000Z', updatedBy: null }],
      })
      expect(store.update).toHaveBeenCalledWith('session-1', expect.objectContaining({ startAt: new Date('2026-11-22T01:00:00Z'), durationMinutes: 240 }))
    })

    it('responds 404 for a session that does not exist', async () => {
      const app = await buildApp()
      const response = await send(app, 'PUT', '/api/admin/sessions/session-9', session())
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ ok: false, error: 'No such session' })
    })

    it('responds 409 when one of its sets would not fit anymore, with that set and its session', async () => {
      const app = await buildApp()
      const { session: before } = (await sessionWithSet(app)).json()
      vi.mocked(store.update).mockRejectedValueOnce(new Conflict('One of the sets of this session would end after it', rows[0], rows[0].sets[0]))
      const response = await send(app, 'PUT', '/api/admin/sessions/session-1', session({ durationMinutes: 90 }))

      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ ok: false, error: 'One of the sets of this session would end after it', session: before, set: before.sets[0] })
    })
  })

  describe('PUT /api/admin/sessions/:id/status', () => {
    it('changes the status, and says who changed it, without changing the session', async () => {
      const app = await buildApp()
      await createSession(app)
      const response = await send(app, 'PUT', '/api/admin/sessions/session-1/status', { status: 'cancelled' })

      expect(response.statusCode).toBe(200)
      expect(response.json().session).toMatchObject({
        status: 'cancelled',
        statusUpdatedBy: 'admin@example.com',
        statusUpdatedAt: expect.any(String),
        updatedBy: null,
        updatedAt: null,
      })
    })

    it('refuses other statuses, and responds 404 or 409', async () => {
      const app = await buildApp()
      await createSession(app)
      let response = await send(app, 'PUT', '/api/admin/sessions/session-1/status', { status: 'scheduled' })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error: 'The status must be one of planned, done, cancelled' })
      response = await send(app, 'PUT', '/api/admin/sessions/session-9/status', { status: 'done' })
      expect(response.statusCode).toBe(404)
      vi.mocked(store.setStatus).mockRejectedValueOnce(new Conflict('Another session overlaps this one', rows[0]))
      response = await send(app, 'PUT', '/api/admin/sessions/session-1/status', { status: 'planned' })
      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ ok: false, error: 'Another session overlaps this one', session: expect.objectContaining({ id: 'session-1' }), set: null })
    })
  })

  describe('DELETE /api/admin/sessions/:id', () => {
    it('deletes the session, or responds 404', async () => {
      const app = await buildApp()
      await sessionWithSet(app)
      expect((await send(app, 'DELETE', '/api/admin/sessions/session-1')).json()).toEqual({ ok: true })
      expect(rows).toEqual([])
      const response = await send(app, 'DELETE', '/api/admin/sessions/session-1')
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ ok: false, error: 'No such session' })
    })
  })

  describe('POST /api/admin/sessions/:id/sets', () => {
    it('adds the set, as planned, with its track resolved through SoundCloud, and returns its session', async () => {
      const app = await buildApp()
      const response = await sessionWithSet(app)

      expect(response.statusCode).toBe(200)
      expect(response.json().session).toMatchObject({ id: 'session-1', start: '2026-11-15T02:00:00.000Z' })
      expect(response.json().session.sets).toEqual([
        {
          id: 'set-2',
          performers: [
            { id: 'artist-1', name: 'Ana' },
            { id: 'artist-2', name: 'Brume' },
          ],
          offsetMinutes: 60,
          durationMinutes: 60,
          start: '2026-11-15T03:00:00.000Z',
          end: '2026-11-15T04:00:00.000Z',
          performanceTypes: ['dj', 'live-performance'],
          otherPerformanceType: 'Synthé modulaire',
          genres: ['ambient'],
          soundcloudTrack: { id: '42', url: 'https://soundcloud.com/parkingdotradio/3tons' },
          youtubeVideo: { id: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
          createdAt: '2026-11-01T12:00:00.000Z',
          createdBy: 'admin@example.com',
          updatedBy: null,
          updatedAt: null,
          status: 'planned',
          statusUpdatedBy: null,
          statusUpdatedAt: null,
        },
      ])
      // The link is reduced before it's resolved.
      expect(resolveTrack).toHaveBeenCalledWith('https://soundcloud.com/parkingdotradio/3tons')
    })

    it("has no start or end for a set without an offset, or in a session without a start, nor asks SoundCloud without a track", async () => {
      const app = await buildApp()
      let response = await sessionWithSet(app, { offsetMinutes: null, soundcloudTrack: '', youtubeVideo: ' ' })
      expect(response.json().session.sets[0]).toMatchObject({ offsetMinutes: null, start: null, end: null, soundcloudTrack: null, youtubeVideo: null })
      await createSession(app, { start: null })
      response = await addSet(app, 'session-3', { soundcloudTrack: null, youtubeVideo: null })
      expect(response.json().session.sets[0]).toMatchObject({ offsetMinutes: 60, start: null, end: null })
      expect(resolveTrack).not.toHaveBeenCalled()
    })

    it('responds 404 for a session that does not exist, before asking SoundCloud', async () => {
      const app = await buildApp()
      const response = await addSet(app, 'session-9')
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ ok: false, error: 'No such session' })
      expect(resolveTrack).not.toHaveBeenCalled()
    })

    it('responds 409 for a cancelled session, before asking SoundCloud', async () => {
      const app = await buildApp()
      await createSession(app)
      await send(app, 'PUT', '/api/admin/sessions/session-1/status', { status: 'cancelled' })
      const response = await addSet(app, 'session-1')
      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({
        ok: false,
        error: 'This session is cancelled',
        session: expect.objectContaining({ id: 'session-1', status: 'cancelled' }),
        set: null,
      })
      expect(resolveTrack).not.toHaveBeenCalled()
      expect(store.addSet).not.toHaveBeenCalled()
    })

    it('refuses an invalid set, saying what is wrong, before asking SoundCloud, or performers who do not exist', async () => {
      const app = await buildApp()
      await createSession(app)
      let response = await addSet(app, 'session-1', { durationMinutes: null })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error: 'A set with an offset also has a duration' })
      expect(resolveTrack).not.toHaveBeenCalled()
      for (const performer of ['artist-9', 'collective-1']) {
        response = await addSet(app, 'session-1', { performers: [{ id: performer }] })
        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ ok: false, error: 'No such artist' })
      }
      expect(rows[0].sets).toEqual([])
    })

    it('refuses a link where SoundCloud shows no track', async () => {
      const app = await buildApp()
      await createSession(app)
      const response = await addSet(app, 'session-1', { soundcloudTrack: 'https://soundcloud.com/someone/else' })

      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error: 'SoundCloud shows no track at this link' })
      expect(store.addSet).not.toHaveBeenCalled()
    })

    it('responds 409 until the credentials of the SoundCloud app are entered', async () => {
      const app = await buildApp()
      await createSession(app)
      resolveTrack.mockRejectedValue(new NoSoundCloudCredentials())
      const response = await addSet(app, 'session-1')

      expect(response.statusCode).toBe(409)
      // It isn't about a session or a set.
      expect(response.json()).toEqual({ ok: false, error: 'The credentials of the SoundCloud app have not been entered yet', session: null, set: null })
      expect(store.addSet).not.toHaveBeenCalled()
    })

    it('responds 502 when SoundCloud cannot be reached, and logs why', async () => {
      const logs: string[] = []
      const app = await buildApp(logs)
      await createSession(app)
      resolveTrack.mockRejectedValue(new Error('fetch failed'))
      const response = await addSet(app, 'session-1')

      expect(response.statusCode).toBe(502)
      expect(response.json()).toEqual({ ok: false, error: 'The track cannot be resolved through SoundCloud: fetch failed' })
      expect(logs.join('')).toContain('Failed to resolve a track through SoundCloud')
      expect(store.addSet).not.toHaveBeenCalled()
    })

    it('responds 409 when the set breaks one of the rules of sessions, with what is in the way', async () => {
      const app = await buildApp()
      const { session: other } = (await sessionWithSet(app)).json()
      await createSession(app, { start: null })

      // Another set, with its session, whose start the set's start and end are from.
      vi.mocked(store.addSet).mockRejectedValueOnce(new Conflict("This YouTube video is another set's", rows[0], rows[0].sets[0]))
      let response = await addSet(app, 'session-3')
      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ ok: false, error: "This YouTube video is another set's", session: other, set: other.sets[0] })
      expect(response.json().set.start).toBe('2026-11-15T03:00:00.000Z')

      // The set's own session.
      vi.mocked(store.addSet).mockRejectedValueOnce(new Conflict('This session is cancelled', rows[1]))
      response = await addSet(app, 'session-3')
      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ ok: false, error: 'This session is cancelled', session: expect.objectContaining({ id: 'session-3' }), set: null })
    })
  })

  describe('PUT /api/admin/sets/:id', () => {
    it('replaces the set, but not its status, says who changed it, and returns its session', async () => {
      const app = await buildApp()
      await sessionWithSet(app)
      await send(app, 'PUT', '/api/admin/sets/set-2/status', { status: 'done' })
      const response = await send(app, 'PUT', '/api/admin/sets/set-2', set({ performers: [{ id: 'artist-2' }], offsetMinutes: 0, performanceTypes: [], genres: [] }))

      expect(response.statusCode).toBe(200)
      expect(response.json().session.id).toBe('session-1')
      expect(response.json().session.sets[0]).toMatchObject({
        performers: [{ id: 'artist-2', name: 'Brume' }],
        offsetMinutes: 0,
        start: '2026-11-15T02:00:00.000Z',
        performanceTypes: [],
        genres: [],
        status: 'done',
        updatedBy: 'admin@example.com',
        updatedAt: expect.any(String),
      })
    })

    it("doesn't resolve the set's own track again, so that it can be changed without SoundCloud", async () => {
      const app = await buildApp()
      await sessionWithSet(app)
      resolveTrack.mockClear()
      resolveTrack.mockRejectedValue(new NoSoundCloudCredentials())

      // The link it returned, or one that reduces to it.
      for (const soundcloudTrack of ['https://soundcloud.com/parkingdotradio/3tons', 'https://m.soundcloud.com/parkingdotradio/3tons?si=x']) {
        const response = await send(app, 'PUT', '/api/admin/sets/set-2', set({ soundcloudTrack }))
        expect(response.statusCode).toBe(200)
        expect(response.json().session.sets[0].soundcloudTrack).toEqual({ id: '42', url: 'https://soundcloud.com/parkingdotradio/3tons' })
      }
      expect(resolveTrack).not.toHaveBeenCalled()

      // Another one is.
      const response = await send(app, 'PUT', '/api/admin/sets/set-2', set({ soundcloudTrack: 'https://soundcloud.com/parkingdotradio/other' }))
      expect(response.statusCode).toBe(409)
      expect(rows[0].sets[0].soundcloudTrackUrl).toBe('https://soundcloud.com/parkingdotradio/3tons')
    })

    it('resolves a new track, and removes the track', async () => {
      const app = await buildApp()
      await sessionWithSet(app, { soundcloudTrack: null })
      resolveTrack.mockResolvedValueOnce('43')
      let response = await send(app, 'PUT', '/api/admin/sets/set-2', set({ soundcloudTrack: 'https://soundcloud.com/parkingdotradio/b2b/s-AbC' }))
      expect(response.json().session.sets[0].soundcloudTrack).toEqual({ id: '43', url: 'https://soundcloud.com/parkingdotradio/b2b/s-AbC' })
      response = await send(app, 'PUT', '/api/admin/sets/set-2', set({ soundcloudTrack: null }))
      expect(response.json().session.sets[0].soundcloudTrack).toBeNull()
    })

    it('responds 404 for a set that does not exist, before asking SoundCloud', async () => {
      const app = await buildApp()
      const response = await send(app, 'PUT', '/api/admin/sets/set-9', set())
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ ok: false, error: 'No such set' })
      expect(resolveTrack).not.toHaveBeenCalled()
    })

    it('fails like POST', async () => {
      const app = await buildApp()
      await sessionWithSet(app)
      let response = await send(app, 'PUT', '/api/admin/sets/set-2', set({ performers: [] }))
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error: 'A set has at least one performer' })
      response = await send(app, 'PUT', '/api/admin/sets/set-2', set({ performers: [{ id: 'artist-9' }] }))
      expect(response.statusCode).toBe(400)
      vi.mocked(store.updateSet).mockRejectedValueOnce(new Conflict('This set ends after its session', rows[0]))
      response = await send(app, 'PUT', '/api/admin/sets/set-2', set({ offsetMinutes: 230 }))
      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ ok: false, error: 'This set ends after its session', session: expect.objectContaining({ id: 'session-1' }), set: null })
    })
  })

  describe('PUT /api/admin/sets/:id/status', () => {
    it('changes the status, says who changed it, without changing the set, and returns its session', async () => {
      const app = await buildApp()
      await sessionWithSet(app)
      const response = await send(app, 'PUT', '/api/admin/sets/set-2/status', { status: 'cancelled' })

      expect(response.statusCode).toBe(200)
      expect(response.json().session.sets[0]).toMatchObject({
        status: 'cancelled',
        statusUpdatedBy: 'admin@example.com',
        statusUpdatedAt: expect.any(String),
        updatedBy: null,
        updatedAt: null,
      })
    })

    it('refuses other statuses, and responds 404 or 409', async () => {
      const app = await buildApp()
      await sessionWithSet(app)
      let response = await send(app, 'PUT', '/api/admin/sets/set-2/status', { status: 'scheduled' })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error: 'The status must be one of planned, done, cancelled' })
      response = await send(app, 'PUT', '/api/admin/sets/set-9/status', { status: 'done' })
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ ok: false, error: 'No such set' })
      vi.mocked(store.setSetStatus).mockRejectedValueOnce(new Conflict('This session is cancelled', rows[0]))
      response = await send(app, 'PUT', '/api/admin/sets/set-2/status', { status: 'planned' })
      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ ok: false, error: 'This session is cancelled', session: expect.objectContaining({ id: 'session-1' }), set: null })
    })
  })

  describe('DELETE /api/admin/sets/:id', () => {
    it('deletes the set, or responds 404', async () => {
      const app = await buildApp()
      await sessionWithSet(app)
      expect((await send(app, 'DELETE', '/api/admin/sets/set-2')).json()).toEqual({ ok: true })
      expect(rows[0].sets).toEqual([])
      const response = await send(app, 'DELETE', '/api/admin/sets/set-2')
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ ok: false, error: 'No such set' })
    })
  })
})
