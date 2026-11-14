import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import { useZodSchemas } from '../api/schemas.js'
import { multipartBody } from '../api/test-multipart.js'
import { PHOTO_MAX_BYTES } from '../artists/profile.js'
import type { PhotoFolder, SentPhoto } from '../artists/store.js'
import { acceptSessions, sessionCookies } from '../admins/test-sessions.js'
import { NoSoundCloudCredentials } from '../radio/soundcloud-app.js'
import { BrokenFields, Conflict, NoSuchReference } from './store.js'
import type { SessionsStore, StoredSession, StoredSet } from './store.js'
import type { Status } from './fields.js'
import { sessionsRoutes } from './routes.js'

// A fake database: the sessions, with their sets, and the artists and collectives that exist, by id. It doesn't check the
// rules of sessions, which the integration tests and the property-based tests cover against a real database (see
// integration-tests/021-sessions.sh and rules.db.test.ts): the tests below make it throw what the real one would.
let rows: StoredSession[] = []
const NAMES: Record<string, string> = { 'artist-1': 'Ana', 'artist-2': 'Brume', 'artist-3': 'Cyan', 'artist-4': 'Dune', 'collective-1': 'Les Ondes' }
let nextId = 0
const CREATED_AT = new Date('2026-11-01T12:00:00Z')

// An artist or a collective that a session or a set refers to, with its name, as the database would find it.
function find(kind: 'artist' | 'collective', id: string) {
  if (!id.startsWith(kind) || !NAMES[id]) throw new NoSuchReference(kind === 'artist' ? 'No such artist' : 'No such collective')
  return { id, name: NAMES[id] }
}

const takeover = (takeoverId: string | null) => ({ takeover: takeoverId === null ? null : find('collective', takeoverId) })
const performers = (sent: { id: string }[]) => ({ performers: sent.map(({ id }) => find('artist', id)) })

// The application a session or a set comes from, as the database would find it: every id that starts with "application"
// is one, received at RECEIVED_AT.
const RECEIVED_AT = new Date('2026-10-01T16:00:00Z')
function application(applicationId: string | null | undefined) {
  if (applicationId === undefined) return {}
  if (applicationId !== null && !applicationId.startsWith('application')) throw new NoSuchReference('No such application')
  return { application: applicationId === null ? null : { id: applicationId, receivedAt: RECEIVED_AT } }
}

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
    const row: StoredSession = {
      id: `session-${++nextId}`,
      createdAt: CREATED_AT,
      ...NEW,
      ...session,
      ...takeover(session.takeoverId),
      application: null,
      ...application(session.applicationId),
      sets: [],
    }
    rows.push(row)
    return row
  }),
  update: vi.fn<SessionsStore['update']>(async (id, changes) => {
    const row = rows.find((session) => session.id === id)
    if (!row) return null
    const before = { ...row }
    Object.assign(row, defined(changes), changes.takeoverId !== undefined && takeover(changes.takeoverId), application(changes.applicationId))
    return { before, after: row }
  }),
  setStatus: vi.fn<SessionsStore['setStatus']>(async (id, change) => {
    const session = rows.find((row) => row.id === id)
    if (!session) return null
    Object.assign(session, change)
    return session
  }),
  delete: async (id) => {
    const row = rows.find((session) => session.id === id)
    rows = rows.filter((session) => session.id !== id)
    return row ?? null
  },
  getSet: async (id) => sessionOf(id)?.sets.find((set) => set.id === id) ?? null,
  addSet: vi.fn<SessionsStore['addSet']>(async (sessionId, { performers: sent, ...set }) => {
    const session = rows.find((row) => row.id === sessionId)
    if (!session) return null
    session.sets.push({ id: `set-${++nextId}`, createdAt: CREATED_AT, ...NEW, ...set, sessionId, ...performers(sent), application: null, ...application(set.applicationId) })
    return session
  }),
  updateSet: vi.fn<SessionsStore['updateSet']>(async (id, { performers: sent, ...changes }) =>
    changeSet(id, { ...changes, ...(sent && performers(sent)), ...application(changes.applicationId) }),
  ),
  setSetStatus: vi.fn<SessionsStore['setSetStatus']>(async (id, change) => changeSet(id, change)),
  deleteSet: async (id) => {
    const session = sessionOf(id)
    if (!session) return false
    session.sets = session.sets.filter((set) => set.id !== id)
    return true
  },
  ofApplications: async () => [],
}

// Sessions' flyers, as the bucket would keep them.
const stored = new Map<string, Buffer>()
let nextFlyer = 0
const photos = {
  store: vi.fn(async ({ body, type }: SentPhoto, folder: PhotoFolder) => {
    const key = `${folder}/flyer-${++nextFlyer}.${type.split('/')[1]}`
    stored.set(key, body)
    return key
  }),
  read: vi.fn(async (key: string) => (stored.has(key) ? Readable.from([stored.get(key)!]) : null)),
  delete: vi.fn(async (key: string) => {
    stored.delete(key)
  }),
}

// The smallest things that start like a JPEG and a PNG file.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])

// SoundCloud, through the SoundCloud app.
const resolveTrack = vi.fn<(link: string) => Promise<string | null>>()

function session(changes: object = {}) {
  return {
    start: '2026-11-14T21:00-05:00',
    durationMinutes: 240,
    type: 'takeover',
    takeover: 'collective-1',
    name: 'HAUTE RIVE TAKEOVER',
    application: null,
    raEvent: '6683745',
    description: '',
    ...changes,
  }
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
    application: null,
    ...changes,
  }
}

// If `logs` is given, every line the app logs is added to it.
async function buildApp(logs?: string[]) {
  const app = Fastify(logs ? { logger: { stream: { write: (line: string) => logs.push(line) } } } : {})
  useZodSchemas(app)
  await app.register(fastifyCookie)
  acceptSessions(app)
  await app.register(sessionsRoutes, { store, photos, resolveTrack })
  return app
}

type App = Awaited<ReturnType<typeof buildApp>>

async function send(app: App, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) {
  return app.inject({ method, url, payload, cookies: await sessionCookies() })
}

// The multipart/form-data body that adds or changes a session: its fields, as JSON (or as they're given, when they're a
// string), its flyer, and whether to remove it.
type Files = { flyer?: Buffer; removeFlyer?: string }
function sessionForm(fields: object | string, { flyer, removeFlyer }: Files = {}) {
  return multipartBody({ session: typeof fields === 'string' ? fields : JSON.stringify(fields), flyer, removeFlyer })
}

async function sendSession(app: App, method: 'POST' | 'PUT', url: string, fields: object | string, files: Files = {}) {
  return app.inject({ method, url, ...sessionForm(fields, files), cookies: await sessionCookies() })
}

async function createSession(app: App, changes: object = {}, files: Files = {}) {
  return sendSession(app, 'POST', '/api/admin/sessions', session(changes), files)
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
    nextFlyer = 0
    stored.clear()
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
      app.inject({ method: 'GET', url: '/api/admin/sessions?from=x' }),
      app.inject({ method: 'GET', url: '/api/admin/sessions/session-1' }),
      app.inject({ method: 'GET', url: '/api/admin/sessions/session-1/ra-event' }),
      app.inject({ method: 'POST', url: '/api/admin/sessions', payload: { start: 'x' } }),
      app.inject({ method: 'PUT', url: '/api/admin/sessions/session-1', ...sessionForm(session()) }),
      app.inject({ method: 'PATCH', url: '/api/admin/sessions/session-1', payload: { start: 'x' } }),
      app.inject({ method: 'PUT', url: '/api/admin/sessions/session-1/status', payload: { status: 'maybe' } }),
      app.inject({ method: 'DELETE', url: '/api/admin/sessions/session-1' }),
      app.inject({ method: 'POST', url: '/api/admin/sessions/session-1/sets', payload: set() }),
      app.inject({ method: 'PUT', url: '/api/admin/sets/set-1', payload: set() }),
      app.inject({ method: 'PATCH', url: '/api/admin/sets/set-1', payload: set() }),
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
      app.inject({ method: 'POST', url: '/api/admin/sessions', ...sessionForm(session()), ...options }),
      app.inject({ method: 'PUT', url: '/api/admin/sessions/session-1', ...sessionForm(session()), ...options }),
      app.inject({ method: 'PATCH', url: '/api/admin/sessions/session-1', payload: { name: 'X' }, ...options }),
      app.inject({ method: 'PUT', url: '/api/admin/sessions/session-1/status', payload: { status: 'done' }, ...options }),
      app.inject({ method: 'DELETE', url: '/api/admin/sessions/session-1', ...options }),
      app.inject({ method: 'POST', url: '/api/admin/sessions/session-1/sets', payload: set(), ...options }),
      app.inject({ method: 'PUT', url: '/api/admin/sets/set-2', payload: set(), ...options }),
      app.inject({ method: 'PATCH', url: '/api/admin/sets/set-2', payload: { genres: [] }, ...options }),
      app.inject({ method: 'PUT', url: '/api/admin/sets/set-2/status', payload: { status: 'done' }, ...options }),
      app.inject({ method: 'DELETE', url: '/api/admin/sets/set-2', ...options }),
    ]
    for (const response of await Promise.all(requests)) {
      expect(response.statusCode).toBe(403)
    }
    expect(rows).toEqual([expect.objectContaining({ status: 'planned', updatedBy: null, sets: [expect.objectContaining({ status: 'planned', updatedBy: null })] })])
  })

  it("refuses the fields of a session or a set they don't take, naming them, e.g. what the endpoints return", async () => {
    const app = await buildApp()
    await sessionWithSet(app)
    vi.clearAllMocks()
    const responses = [
      await sendSession(app, 'POST', '/api/admin/sessions', { ...session(), title: 'X' }),
      await sendSession(app, 'PUT', '/api/admin/sessions/session-1', { ...session(), title: 'X' }),
      await send(app, 'POST', '/api/admin/sessions/session-1/sets', { ...set(), title: 'X' }),
      await send(app, 'PUT', '/api/admin/sets/set-2', { ...set(), title: 'X' }),
    ]
    for (const response of responses) {
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error: 'Unknown field: `title`' })
    }
    expect(store.create).not.toHaveBeenCalled()
    expect(store.update).not.toHaveBeenCalled()
    expect(resolveTrack).not.toHaveBeenCalled()
    // But not the fields of a set's performers, so that they can be sent back as the set returns them.
    expect((await send(app, 'PUT', '/api/admin/sets/set-2', set({ performers: [{ id: 'artist-1', name: 'Ana' }] }))).statusCode).toBe(200)
  })

  it('refuses the NUL character in whatever sessions and sets keep or look up, before saving or asking SoundCloud', async () => {
    const app = await buildApp()
    await sessionWithSet(app, { soundcloudTrack: null, youtubeVideo: null })
    vi.clearAllMocks()
    for (const changes of [
      { name: 'HAUTE\0RIVE' },
      { takeover: 'collective-1\0' },
      { raEvent: '6683745\0' },
      { start: '2026-11-14T21:00-05:00\0' },
      { description: 'Une\0soirée' },
    ]) {
      for (const [method, url] of [
        ['POST', '/api/admin/sessions'],
        ['PUT', '/api/admin/sessions/session-1'],
      ] as const) {
        const response = await sendSession(app, method, url, session(changes))
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
    for (const url of ['/api/admin/sessions?artist=a%00', '/api/admin/sessions?takeover=a%00', '/api/admin/sessions?from=2026-11-09T00:00-05:00%00', '/api/admin/sessions/session-1%00']) {
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
          start: '2026-11-14T21:00:00-05:00',
          end: '2026-11-15T01:00:00-05:00',
          durationMinutes: 240,
          type: 'takeover',
          takeover: { id: 'collective-1', name: 'Les Ondes' },
          application: null,
          name: 'HAUTE RIVE TAKEOVER',
          title: 'HAUTE RIVE TAKEOVER',
          raEvent: { id: '6683745', url: 'https://ra.co/events/6683745' },
          description: '',
          effectiveDescription: 'LIVE STREAMING FROM QUÉBEC CITY. SPACE OPEN TO PUBLIC',
          hasFlyer: false,
          sets: [],
          createdAt: '2026-11-01T07:00:00-05:00',
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
      const response = await createSession(app, { start: null, type: 'guest-mixes', takeover: '', name: '', raEvent: null })

      expect(response.statusCode).toBe(200)
      expect(response.json().session).toMatchObject({ start: null, end: null, durationMinutes: 240, type: 'guest-mixes', takeover: null, name: '', title: 'GUEST MIXES', raEvent: null })
    })

    it('is called by its own name, or else the one its type gives it, from its collective for a takeover', async () => {
      const app = await buildApp()
      const title = async (changes: object) => (await createSession(app, { start: null, ...changes })).json().session.title
      expect(await title({ name: '' })).toBe('LES ONDES TAKEOVER')
      expect(await title({ name: 'VKT TAKEOVER' })).toBe('VKT TAKEOVER')
      expect(await title({ type: 'live-performance', takeover: null, name: '' })).toBe('LIVE PERFORMANCE')
      expect(await title({ type: 'synth-meetup', takeover: null, name: '' })).toBe('SYNTH MEETUPS')
      expect(await title({ type: 'other', takeover: null, name: 'ATELIER DE DJing POUR FEMMES & OPEN DECKS' })).toBe('ATELIER DE DJing POUR FEMMES & OPEN DECKS')
      expect(store.create).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'other', takeoverId: null, name: 'ATELIER DE DJing POUR FEMMES & OPEN DECKS' }))
    })

    it('ends a session after the minutes that actually pass, whatever the clocks say', async () => {
      const app = await buildApp()
      // From midnight, the night the clocks go back an hour: 4 hours later, they say 3:00.
      const response = await createSession(app, { start: '2026-11-01T00:00-04:00' })
      expect(response.json().session).toMatchObject({ start: '2026-11-01T00:00:00-04:00', end: '2026-11-01T03:00:00-05:00' })
    })

    it('refuses an invalid session, saying what is wrong, or a takeover that does not exist', async () => {
      const app = await buildApp()
      let response = await createSession(app, { durationMinutes: 0 })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error: 'The duration must be a whole number of minutes, from 1 to 1440' })
      response = await createSession(app, { takeover: 'artist-1' })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error: 'No such collective' })
      for (const [changes, error] of [
        [{ type: 'takeovers' }, 'The type must be one of guest-mixes, live-performance, takeover, synth-meetup, other'],
        [{ takeover: null }, 'A takeover has a collective'],
        [{ type: 'guest-mixes' }, 'Only a takeover has a collective'],
        [{ type: 'other', takeover: null, name: '' }, 'A session of type other has a name'],
      ] as const) {
        response = await createSession(app, changes)
        expect(response.statusCode, JSON.stringify(changes)).toBe(400)
        expect(response.json()).toEqual({ ok: false, error })
      }
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

  describe('applications', () => {
    it('saves the application a session or a set comes from, and returns it with when it was received', async () => {
      const app = await buildApp()
      const added = await createSession(app, { application: ' Application-1 ' })
      expect(added.json().session.application).toEqual({ id: 'application-1', receivedAt: '2026-10-01T12:00:00-04:00' })
      expect(store.create).toHaveBeenLastCalledWith(expect.objectContaining({ applicationId: 'application-1' }))
      const set = await addSet(app, 'session-1', { application: 'application-2' })
      expect(set.json().session.sets[0].application).toEqual({ id: 'application-2', receivedAt: '2026-10-01T12:00:00-04:00' })
      expect(store.addSet).toHaveBeenLastCalledWith('session-1', expect.objectContaining({ applicationId: 'application-2' }))
    })

    it('takes it from a session or a set with null, or a blank string, and leaves it as it is when a change does not send it', async () => {
      const app = await buildApp()
      await createSession(app, { application: 'application-1' })
      await addSet(app, 'session-1', { application: 'application-2' })
      expect((await send(app, 'PATCH', '/api/admin/sessions/session-1', { name: '' })).json().session.application).toMatchObject({ id: 'application-1' })
      expect((await send(app, 'PATCH', '/api/admin/sets/set-2', { genres: [] })).json().session.sets[0].application).toMatchObject({ id: 'application-2' })
      expect((await send(app, 'PATCH', '/api/admin/sessions/session-1', { application: ' ' })).json().session.application).toBeNull()
      expect(store.update).toHaveBeenLastCalledWith('session-1', expect.objectContaining({ applicationId: null }))
      expect((await send(app, 'PATCH', '/api/admin/sets/set-2', { application: null })).json().session.sets[0].application).toBeNull()
      expect(store.updateSet).toHaveBeenLastCalledWith('set-2', expect.objectContaining({ applicationId: null }))
    })

    it('needs it, or null, to add a session or a set, or replace their fields', async () => {
      const app = await buildApp()
      await sessionWithSet(app)
      const error = { ok: false, error: "The application must be an application's id, or null" }
      const withoutApplication = { ...session(), application: undefined }
      const setWithoutApplication = { ...set(), application: undefined }
      for (const response of [
        await sendSession(app, 'POST', '/api/admin/sessions', withoutApplication),
        await sendSession(app, 'PUT', '/api/admin/sessions/session-1', withoutApplication),
        await send(app, 'POST', '/api/admin/sessions/session-1/sets', setWithoutApplication),
        await send(app, 'PUT', '/api/admin/sets/set-2', setWithoutApplication),
        await send(app, 'PATCH', '/api/admin/sets/set-2', { application: 42 }),
      ]) {
        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual(error)
      }
      const notATakeover = await createSession(app, { type: 'guest-mixes', takeover: null, application: 'application-1' })
      expect(notATakeover.json()).toEqual({ ok: false, error: 'Only a takeover has an application' })
      expect(rows).toHaveLength(1)
    })

    it("explains why the store refuses an application that doesn't exist or doesn't go with the session or the set", async () => {
      const app = await buildApp()
      await sessionWithSet(app)
      for (const [response, error] of [
        [await createSession(app, { application: 'nothing' }), 'No such application'],
        [await addSet(app, 'session-1', { application: 'nothing' }), 'No such application'],
      ] as const) {
        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ ok: false, error })
      }
      const sessionsApplication = "A session's application is that of the collective whose takeover it is"
      vi.mocked(store.update).mockRejectedValueOnce(new BrokenFields(sessionsApplication))
      const session = await send(app, 'PATCH', '/api/admin/sessions/session-1', { application: 'application-1' })
      expect(session.statusCode).toBe(400)
      expect(session.json()).toEqual({ ok: false, error: sessionsApplication })
      vi.mocked(store.updateSet).mockRejectedValueOnce(new BrokenFields("A set's application is one of its performers'"))
      const set = await send(app, 'PATCH', '/api/admin/sets/set-2', { performers: [{ id: 'artist-3' }] })
      expect(set.statusCode).toBe(400)
      expect(set.json()).toEqual({ ok: false, error: "A set's application is one of its performers'" })
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ application: null, updatedBy: null, sets: [{ application: null, updatedBy: null }] })
    })
  })

  describe('descriptions', () => {
    it('keeps its own description, with its spaces and line breaks, but not \r, and trimmed', async () => {
      const app = await buildApp()
      const response = await createSession(app, { description: '  SPÉCIAL\r\n\r\nDeux  salles,\rtrois   DJs.\n ' })
      expect(response.statusCode).toBe(200)
      expect(response.json().session).toMatchObject({ description: 'SPÉCIAL\n\nDeux  salles,\ntrois   DJs.', effectiveDescription: 'SPÉCIAL\n\nDeux  salles,\ntrois   DJs.' })
    })

    it('is described by its own description, or else the one its type gives it', async () => {
      const app = await buildApp()
      const described = async (changes: object) => (await createSession(app, { start: null, takeover: null, ...changes })).json().session.effectiveDescription
      expect(await described({ type: 'guest-mixes' })).toBe('LIVE STREAMING FROM QUÉBEC CITY. SPACE OPEN TO PUBLIC')
      expect(await described({ type: 'live-performance' })).toBe('LIVE STREAMING FROM QUÉBEC CITY. SPACE OPEN TO PUBLIC')
      expect(await described({ type: 'takeover', takeover: 'collective-1' })).toBe('LIVE STREAMING FROM QUÉBEC CITY. SPACE OPEN TO PUBLIC')
      expect(await described({ type: 'synth-meetup' })).toMatch(/^SYNTH MEETUPS\n\nRencontres hebdomadaires/)
      expect(await described({ type: 'other', name: 'ATELIER' })).toBe('')
      expect(await described({ type: 'other', name: 'ATELIER', description: 'Un atelier.' })).toBe('Un atelier.')
      expect(await described({ type: 'synth-meetup', description: 'Spécial.' })).toBe('Spécial.')
      // The one its type gives it isn't its own.
      expect(rows.map((row) => row.description)).toEqual(['', '', '', '', '', 'Un atelier.', 'Spécial.'])
    })

    it('refuses a description that is too long, or not text', async () => {
      const app = await buildApp()
      expect((await createSession(app, { description: `${'a'.repeat(5000)}\n\n` })).statusCode).toBe(200)
      for (const description of ['a'.repeat(5001), null, undefined]) {
        const response = await createSession(app, { description })
        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ ok: false, error: 'The description must be text, up to 5000 characters' })
      }
    })
  })

  describe('flyers', () => {
    const get = async (app: App, url: string) => app.inject({ method: 'GET', url, cookies: await sessionCookies() })

    it('adds the session with its flyer, whose type is told from its contents, and serves it', async () => {
      const app = await buildApp()
      const response = await createSession(app, {}, { flyer: PNG })
      expect(response.statusCode).toBe(200)
      expect(response.json().session.hasFlyer).toBe(true)
      expect(photos.store).toHaveBeenCalledWith({ body: PNG, type: 'image/png' }, 'sessions')
      expect(rows[0]).toMatchObject({ flyerKey: 'sessions/flyer-1.png', flyerType: 'image/png' })

      const served = await get(app, '/api/admin/sessions/session-1/flyer')
      expect(served.statusCode).toBe(200)
      expect(served.rawPayload).toEqual(PNG)
      expect(served.headers).toMatchObject({ 'content-type': 'image/png', 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store' })
    })

    it('adds the session without a flyer when its part is empty', async () => {
      const app = await buildApp()
      const response = await createSession(app, {}, { flyer: Buffer.alloc(0) })
      expect(response.json().session.hasFlyer).toBe(false)
      expect(photos.store).not.toHaveBeenCalled()
    })

    it('refuses a flyer that is not a JPEG, PNG or WebP image, or too large, and a malformed request, saving nothing', async () => {
      const app = await buildApp()
      let response = await createSession(app, {}, { flyer: Buffer.from('%PDF-1.7') })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error: 'The flyer must be a JPEG, PNG or WebP image' })
      response = await createSession(app, {}, { flyer: Buffer.concat([JPEG, Buffer.alloc(PHOTO_MAX_BYTES)]) })
      expect(response.statusCode).toBe(413)
      expect(response.json()).toEqual({ ok: false, error: 'The flyer is larger than 10 MB' })
      expect((await createSession(app, {}, { flyer: Buffer.concat([JPEG, Buffer.alloc(PHOTO_MAX_BYTES - JPEG.length)]) })).statusCode).toBe(200)
      rows = []
      vi.clearAllMocks()

      const cookies = await sessionCookies()
      for (const sent of [
        sessionForm('{not json'),
        multipartBody({ flyer: JPEG }),
        { payload: JSON.stringify(session()), headers: { 'content-type': 'application/json' } },
      ]) {
        response = await app.inject({ method: 'POST', url: '/api/admin/sessions', ...sent, cookies })
        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ ok: false, error: 'Invalid request' })
      }
      expect(rows).toEqual([])
      expect(photos.store).not.toHaveBeenCalled()
    })

    it('ignores fields other than the session and its flyer, but refuses a second flyer', async () => {
      const app = await buildApp()
      const cookies = await sessionCookies()
      const { payload, headers } = multipartBody({ session: JSON.stringify(session()), submit: 'ajouter' })
      expect((await app.inject({ method: 'POST', url: '/api/admin/sessions', payload, headers, cookies })).statusCode).toBe(200)
      const twice = Buffer.concat([
        sessionForm(session({ start: null })).payload.subarray(0, -'--test-boundary--\r\n'.length),
        multipartBody({ flyer: JPEG }).payload.subarray(0, -'--test-boundary--\r\n'.length),
        multipartBody({ flyer: PNG }).payload,
      ])
      const response = await app.inject({ method: 'POST', url: '/api/admin/sessions', payload: twice, headers, cookies })
      expect(response.statusCode).toBe(400)
      expect(rows).toHaveLength(1)
    })

    it("keeps the session's flyer when none is sent, replaces it, or removes it, deleting the one it had", async () => {
      const app = await buildApp()
      await createSession(app, {}, { flyer: JPEG })
      let response = await sendSession(app, 'PUT', '/api/admin/sessions/session-1', session({ description: 'Nouveau.' }))
      expect(response.json().session).toMatchObject({ hasFlyer: true, description: 'Nouveau.', updatedBy: 'admin@example.com' })
      expect(photos.delete).not.toHaveBeenCalled()

      response = await sendSession(app, 'PUT', '/api/admin/sessions/session-1', session(), { flyer: PNG })
      expect(response.json().session.hasFlyer).toBe(true)
      expect(rows[0].flyerKey).toBe('sessions/flyer-2.png')
      expect(photos.delete).toHaveBeenCalledExactlyOnceWith('sessions/flyer-1.jpeg')

      // Changing only its flyer changes the session.
      rows[0].updatedBy = null
      response = await sendSession(app, 'PUT', '/api/admin/sessions/session-1', session(), { removeFlyer: 'true' })
      expect(response.json().session).toMatchObject({ hasFlyer: false, updatedBy: 'admin@example.com' })
      expect(rows[0]).toMatchObject({ flyerKey: null, flyerType: null })
      expect(photos.delete).toHaveBeenLastCalledWith('sessions/flyer-2.png')
      expect(stored.size).toBe(0)
    })

    it('refuses both a flyer and removing it, and deletes the new flyer when the session is not saved', async () => {
      const app = await buildApp()
      await createSession(app, {}, { flyer: JPEG })
      vi.clearAllMocks()
      let response = await sendSession(app, 'PUT', '/api/admin/sessions/session-1', session(), { flyer: PNG, removeFlyer: 'true' })
      expect(response.statusCode).toBe(400)
      expect(photos.store).not.toHaveBeenCalled()

      response = await sendSession(app, 'PUT', '/api/admin/sessions/session-9', session(), { flyer: PNG })
      expect(response.statusCode).toBe(404)
      vi.mocked(store.update).mockRejectedValueOnce(new Conflict('Another session overlaps this one', null))
      response = await sendSession(app, 'PUT', '/api/admin/sessions/session-1', session(), { flyer: PNG })
      expect(response.statusCode).toBe(409)
      vi.mocked(store.create).mockRejectedValueOnce(new NoSuchReference('No such collective'))
      response = await createSession(app, {}, { flyer: PNG })
      expect(response.statusCode).toBe(400)
      expect(photos.store).toHaveBeenCalledTimes(3)
      expect(photos.delete.mock.calls).toEqual([['sessions/flyer-2.png'], ['sessions/flyer-3.png'], ['sessions/flyer-4.png']])
      expect(rows[0].flyerKey).toBe('sessions/flyer-1.jpeg')
    })

    it('deletes the flyer with its session', async () => {
      const app = await buildApp()
      await createSession(app, {}, { flyer: JPEG })
      expect((await send(app, 'DELETE', '/api/admin/sessions/session-1')).statusCode).toBe(200)
      expect(photos.delete).toHaveBeenCalledExactlyOnceWith('sessions/flyer-1.jpeg')
    })

    it('responds 404 for a session that does not exist, has no flyer, or whose flyer is missing', async () => {
      const app = await buildApp()
      expect((await get(app, '/api/admin/sessions/session-9/flyer')).json()).toEqual({ ok: false, error: 'No such session' })
      await createSession(app)
      let response = await get(app, '/api/admin/sessions/session-1/flyer')
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ ok: false, error: 'This session has no flyer' })
      await sendSession(app, 'PUT', '/api/admin/sessions/session-1', session(), { flyer: JPEG })
      stored.clear()
      response = await get(app, '/api/admin/sessions/session-1/flyer')
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ ok: false, error: 'The flyer of this session is missing' })
    })
  })

  describe('GET /api/admin/sessions', () => {
    it("lists every session, or those with a set an artist played, or a collective's takeovers", async () => {
      const app = await buildApp()
      await sessionWithSet(app, { performers: [{ id: 'artist-1' }], soundcloudTrack: null })
      await createSession(app, { type: 'guest-mixes', takeover: null, start: null })

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

    it('lists the sessions that start at or after `from` and before `to`, with an artist or a takeover too', async () => {
      const app = await buildApp()
      const from = new Date('2026-11-09T05:00:00Z')
      const to = new Date('2026-11-16T05:00:00Z')
      for (const [query, filter] of [
        ['from=2026-11-09T00:00-05:00&to=2026-11-16T00:00:00-05:00', { from, to }],
        ['from=2026-11-09T00:00:00.000-05:00', { from }],
        ['to=2026-11-16T00:00-05:00', { to }],
        ['artist=artist-1&from=2026-11-09T00:00-05:00', { artist: 'artist-1', from }],
        ['takeover=collective-1&to=2026-11-16T00:00:00-05:00', { takeover: 'collective-1', to }],
        // The hour before 2:00 happens twice the night the clocks go back, told apart by its offset.
        ['from=2026-11-01T01:30-04:00&to=2026-11-01T01:30-05:00', { from: new Date('2026-11-01T05:30:00Z'), to: new Date('2026-11-01T06:30:00Z') }],
      ] as const) {
        const response = await send(app, 'GET', `/api/admin/sessions?${query}`)
        expect(response.statusCode, query).toBe(200)
        expect(store.list, query).toHaveBeenLastCalledWith(filter)
      }
    })

    it('refuses bounds that are not instants from 2000 to 2999, or given more than once, or `from` not before `to`', async () => {
      const app = await buildApp()
      const offsets = '-05:00, or -04:00 from the second Sunday of March at 2:00 to the first Sunday of November at 2:00'
      const notFrom = `\`from\` must be a single date and time in Québec time, with the offset from UTC in effect then (${offsets}), except a time the clocks skip in spring, e.g. "2026-11-09T00:00-05:00", from the year 2000 to 2999`
      const notTo = `\`to\` must be a single date and time in Québec time, with the offset from UTC in effect then (${offsets}), except a time the clocks skip in spring, e.g. "2026-11-16T00:00-05:00", from the year 2000 to 2999`
      for (const [query, error] of [
        ['from=next-week', notFrom],
        ['from=2026-11-09', notFrom],
        ['from=2026-11-09T00:00', notFrom],
        ['from=2026-02-30T00:00-05:00', notFrom],
        ['from=', notFrom],
        ['from=1999-12-31T18:59-05:00', notFrom],
        ['from=2026-11-09T00:00-05:00&from=2026-11-10T00:00-05:00', notFrom],
        // Other offsets than Québec's then.
        ['from=2026-11-09T05:00Z', notFrom],
        ['from=2026-11-09T05:00%2B00:00', notFrom],
        ['from=2026-11-09T06:00%2B01:00', notFrom],
        ['from=2026-11-09T01:00-04:00', notFrom],
        // Clocks skip from 2:00 to 3:00 that night.
        ['from=2027-03-14T02:30-05:00', notFrom],
        ['to=2027-03-14T02:30-04:00', notTo],
        ['to=2999-12-31T19:00-05:00', notTo],
        ['from=2026-11-09T00:00-05:00&to=2026-11-09T00:00-05:00', '`from` must be before `to`'],
        ['from=2026-11-01T01:30-05:00&to=2026-11-01T01:30-04:00', '`from` must be before `to`'],
      ]) {
        const response = await send(app, 'GET', `/api/admin/sessions?${query}`)
        expect(response.statusCode, query).toBe(400)
        expect(response.json(), query).toEqual({ ok: false, error })
      }
      expect(store.list).not.toHaveBeenCalled()
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

  describe('GET /api/admin/sessions/:id/ra-event', () => {
    const raEvent = async (app: App, id = 'session-1') => send(app, 'GET', `/api/admin/sessions/${id}/ra-event`)

    it("gives the content of the session's event on RA, with its performers in order, once, from its sets that aren't cancelled", async () => {
      const app = await buildApp()
      await createSession(app, { name: '' })
      const track = { soundcloudTrack: null, youtubeVideo: null }
      await addSet(app, 'session-1', { ...track, performers: [{ id: 'artist-1' }, { id: 'artist-2' }] })
      await addSet(app, 'session-1', { ...track, performers: [{ id: 'artist-2' }, { id: 'artist-3' }] })
      await addSet(app, 'session-1', { ...track, performers: [{ id: 'artist-4' }] })
      await addSet(app, 'session-1', { ...track, performers: [{ id: 'artist-1' }], offsetMinutes: null })
      await send(app, 'PUT', '/api/admin/sets/set-4/status', { status: 'cancelled' })

      const response = await raEvent(app)
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        ok: true,
        event: {
          title: 'LES ONDES TAKEOVER',
          start: '2026-11-14T21:00:00-05:00',
          end: '2026-11-15T01:00:00-05:00',
          lineup: 'Ana\nBrume\nCyan',
          venueId: '288529',
          promoterIds: ['183980'],
          content: 'LIVE STREAMING FROM QUÉBEC CITY. SPACE OPEN TO PUBLIC',
        },
      })
    })

    it('gives its start and end in Québec time, with the offset then, or none without a start', async () => {
      const app = await buildApp()
      await createSession(app, { start: '2026-07-01T21:00-04:00', durationMinutes: 120 })
      // Across the night the clocks go back.
      await createSession(app, { start: '2026-10-31T23:00-04:00', durationMinutes: 240 })
      await createSession(app, { start: null })
      const times = async (id: string) => {
        const { start, end } = (await raEvent(app, id)).json().event
        return [start, end]
      }
      expect(await times('session-1')).toEqual(['2026-07-01T21:00:00-04:00', '2026-07-01T23:00:00-04:00'])
      expect(await times('session-2')).toEqual(['2026-10-31T23:00:00-04:00', '2026-11-01T02:00:00-05:00'])
      expect(await times('session-3')).toEqual([null, null])
    })

    it('has OPEN JAM as the lineup of a synth meetup without performers, or else its title, and its own description', async () => {
      const app = await buildApp()
      await createSession(app, { type: 'synth-meetup', takeover: null, name: '' })
      await createSession(app, { start: null, type: 'other', takeover: null, name: 'LISTENING PARTY', description: 'Une écoute.' })
      // Its only set is cancelled.
      await createSession(app, { start: null, type: 'guest-mixes', takeover: null, name: '' })
      await addSet(app, 'session-3', { soundcloudTrack: null, youtubeVideo: null })
      await send(app, 'PUT', '/api/admin/sets/set-4/status', { status: 'cancelled' })

      const meetup = (await raEvent(app, 'session-1')).json().event
      expect(meetup).toMatchObject({ title: 'SYNTH MEETUPS', lineup: 'OPEN JAM' })
      expect(meetup.content).toMatch(/^SYNTH MEETUPS\n\nRencontres hebdomadaires/)
      expect((await raEvent(app, 'session-2')).json().event).toMatchObject({ title: 'LISTENING PARTY', lineup: 'LISTENING PARTY', content: 'Une écoute.' })
      expect((await raEvent(app, 'session-3')).json().event).toMatchObject({ title: 'GUEST MIXES', lineup: 'GUEST MIXES' })
    })

    it('responds 404 for a session that does not exist', async () => {
      const app = await buildApp()
      const response = await raEvent(app, 'session-9')
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ ok: false, error: 'No such session' })
    })
  })

  describe("sets' places", () => {
    // Sets of a session of 4 hours, by id: their offset, duration and status, and what the server says of them.
    const SETS: [id: string, offset: number | null, duration: number | null, status: Status, fits: boolean, overlapping: string[]][] = [
      ['first', 0, 60, 'planned', true, ['across']],
      // From when the first one ends, which isn't an overlap.
      ['second', 60, 60, 'done', true, ['across']],
      ['across', 30, 60, 'planned', true, ['first', 'second']],
      // Until the session ends, which fits.
      ['last', 180, 60, 'planned', true, ['after']],
      ['after', 200, 60, 'planned', false, ['last']],
      // A cancelled set overlaps those that aren't, but they don't list it, and it doesn't count when it's another set's.
      ['cancelled', 0, 240, 'cancelled', true, ['first', 'second', 'across', 'last', 'after']],
      ['cancelled-after', 230, 120, 'cancelled', false, ['last', 'after']],
      // Without an offset, it overlaps nothing, and its duration alone has to fit.
      ['unplaced', null, 60, 'planned', true, []],
      ['too-long', null, 241, 'planned', false, []],
      ['unknown', null, null, 'planned', true, []],
    ]

    it('says whether each set fits in its session, and which sets that are not cancelled it overlaps, in order', async () => {
      const app = await buildApp()
      await createSession(app)
      rows[0].sets = SETS.map(([id, offsetMinutes, durationMinutes, status]) => ({
        id,
        sessionId: 'session-1',
        createdAt: CREATED_AT,
        createdBy: 'admin@example.com',
        ...NEW,
        status,
        offsetMinutes,
        durationMinutes,
        performers: [],
        application: null,
        applicationId: null,
        performanceTypes: [],
        otherPerformanceType: '',
        genres: [],
        soundcloudTrackId: null,
        soundcloudTrackUrl: null,
        youtubeVideoId: null,
      }))
      const found = (await send(app, 'GET', '/api/admin/sessions/session-1')).json().session
      expect(found.sets.map(({ id, fitsInSession, overlappingSets }: { id: string; fitsInSession: boolean; overlappingSets: string[] }) => [id, fitsInSession, overlappingSets])).toEqual(
        SETS.map(([id, , , , fits, overlapping]) => [id, fits, overlapping]),
      )
    })
  })

  describe('PUT /api/admin/sessions/:id', () => {
    it('replaces the session, but not its status, says who changed it, and moves its sets with its start', async () => {
      const app = await buildApp()
      await sessionWithSet(app)
      await send(app, 'PUT', '/api/admin/sessions/session-1/status', { status: 'done' })
      const response = await sendSession(app, 'PUT', '/api/admin/sessions/session-1', session({ start: '2026-11-21T20:00-05:00', type: 'live-performance', takeover: null, name: '' }))

      expect(response.statusCode).toBe(200)
      expect(response.json().session).toMatchObject({
        start: '2026-11-21T20:00:00-05:00',
        end: '2026-11-22T00:00:00-05:00',
        type: 'live-performance',
        takeover: null,
        name: '',
        title: 'LIVE PERFORMANCE',
        status: 'done',
        updatedBy: 'admin@example.com',
        updatedAt: expect.any(String),
        sets: [{ id: 'set-2', start: '2026-11-21T21:00:00-05:00', end: '2026-11-21T22:00:00-05:00', updatedBy: null }],
      })
      expect(store.update).toHaveBeenCalledWith('session-1', expect.objectContaining({ startAt: new Date('2026-11-22T01:00:00Z'), durationMinutes: 240 }))
    })

    it("can shorten the session so that its sets don't fit in it anymore, which they say", async () => {
      const app = await buildApp()
      await sessionWithSet(app)
      const response = await sendSession(app, 'PUT', '/api/admin/sessions/session-1', session({ durationMinutes: 90 }))
      expect(response.statusCode).toBe(200)
      expect(response.json().session.sets).toEqual([expect.objectContaining({ id: 'set-2', offsetMinutes: 60, durationMinutes: 60, fitsInSession: false })])
    })

    it('responds 404 for a session that does not exist', async () => {
      const app = await buildApp()
      const response = await sendSession(app, 'PUT', '/api/admin/sessions/session-9', session())
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ ok: false, error: 'No such session' })
    })

    it('responds 409 when it would overlap another session, with that one', async () => {
      const app = await buildApp()
      const { session: before } = (await sessionWithSet(app)).json()
      vi.mocked(store.update).mockRejectedValueOnce(new Conflict('Another session overlaps this one', rows[0]))
      const response = await sendSession(app, 'PUT', '/api/admin/sessions/session-1', session({ durationMinutes: 90 }))

      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ ok: false, error: 'Another session overlaps this one', session: before, set: null })
    })
  })

  describe('PATCH /api/admin/sessions/:id', () => {
    it('changes only the fields it is sent, keeps its flyer, says who changed it, and moves its sets with its start', async () => {
      const app = await buildApp()
      await sessionWithSet(app)
      rows[0].flyerKey = 'sessions/flyer.png'
      rows[0].flyerType = 'image/png'
      const response = await send(app, 'PATCH', '/api/admin/sessions/session-1', { start: '2026-11-21T20:00-05:00', raEvent: null })

      expect(response.statusCode).toBe(200)
      expect(response.json().session).toMatchObject({
        start: '2026-11-21T20:00:00-05:00',
        durationMinutes: 240,
        type: 'takeover',
        takeover: { id: 'collective-1' },
        name: 'HAUTE RIVE TAKEOVER',
        raEvent: null,
        hasFlyer: true,
        updatedBy: 'admin@example.com',
        sets: [{ id: 'set-2', start: '2026-11-21T21:00:00-05:00' }],
      })
      expect(store.update).toHaveBeenLastCalledWith('session-1', {
        startAt: new Date('2026-11-22T01:00:00Z'),
        raEventId: null,
        updatedBy: 'admin@example.com',
        updatedAt: expect.any(Date),
      })
    })

    it('removes its flyer when asked to, and deletes it', async () => {
      const app = await buildApp()
      await createSession(app, {}, { flyer: PNG })
      expect((await send(app, 'PATCH', '/api/admin/sessions/session-1', { removeFlyer: false })).json().session.hasFlyer).toBe(true)
      const response = await send(app, 'PATCH', '/api/admin/sessions/session-1', { removeFlyer: true })
      expect(response.json().session).toMatchObject({ hasFlyer: false, name: 'HAUTE RIVE TAKEOVER' })
      expect(stored.size).toBe(0)
    })

    it('explains what is wrong with what it is sent, and with the session it would make, without changing it', async () => {
      const app = await buildApp()
      await createSession(app)
      const invalid = [
        [{ durationMinutes: 0 }, 'The duration must be a whole number of minutes, from 1 to 1440'],
        [{ title: 'X' }, 'Unknown field: `title`'],
        [{ removeFlyer: 'true' }, 'removeFlyer must be true or false'],
        [{}, 'There must be at least one field to change'],
        [[], 'The changes must be an object with the fields to change'],
      ] as const
      for (const [changes, error] of invalid) {
        const response = await send(app, 'PATCH', '/api/admin/sessions/session-1', changes)
        expect(response.statusCode, JSON.stringify(changes)).toBe(400)
        expect(response.json()).toEqual({ ok: false, error })
      }
      // The rules that involve several fields are the store's, which checks them on the session as it is saved.
      vi.mocked(store.update).mockRejectedValueOnce(new BrokenFields('Only a takeover has a collective'))
      const broken = await send(app, 'PATCH', '/api/admin/sessions/session-1', { type: 'guest-mixes' })
      expect(broken.statusCode).toBe(400)
      expect(broken.json()).toEqual({ ok: false, error: 'Only a takeover has a collective' })
      expect(store.update).toHaveBeenCalledTimes(1)
      expect(rows[0].updatedBy).toBeNull()
    })

    it('responds 404 for a session that does not exist, and 409 when it would overlap another one, with that one', async () => {
      const app = await buildApp()
      const { session: before } = (await createSession(app)).json()
      expect((await send(app, 'PATCH', '/api/admin/sessions/session-9', { name: 'X' })).statusCode).toBe(404)
      vi.mocked(store.update).mockRejectedValueOnce(new Conflict('Another session overlaps this one', rows[0]))
      const response = await send(app, 'PATCH', '/api/admin/sessions/session-1', { durationMinutes: 300 })
      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ ok: false, error: 'Another session overlaps this one', session: before, set: null })
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
      expect(response.json().session).toMatchObject({ id: 'session-1', start: '2026-11-14T21:00:00-05:00' })
      expect(response.json().session.sets).toEqual([
        {
          id: 'set-2',
          performers: [
            { id: 'artist-1', name: 'Ana' },
            { id: 'artist-2', name: 'Brume' },
          ],
          offsetMinutes: 60,
          durationMinutes: 60,
          start: '2026-11-14T22:00:00-05:00',
          end: '2026-11-14T23:00:00-05:00',
          fitsInSession: true,
          overlappingSets: [],
          performanceTypes: ['dj', 'live-performance'],
          otherPerformanceType: 'Synthé modulaire',
          genres: ['ambient'],
          soundcloudTrack: { id: '42', url: 'https://soundcloud.com/parkingdotradio/3tons' },
          youtubeVideo: { id: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
          application: null,
          createdAt: '2026-11-01T07:00:00-05:00',
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
      expect(response.json().set.start).toBe('2026-11-14T22:00:00-05:00')

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
        start: '2026-11-14T21:00:00-05:00',
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
      vi.mocked(store.updateSet).mockRejectedValueOnce(new Conflict("This YouTube video is another set's", rows[0], rows[0].sets[0]))
      response = await send(app, 'PUT', '/api/admin/sets/set-2', set())
      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({
        ok: false,
        error: "This YouTube video is another set's",
        session: expect.objectContaining({ id: 'session-1' }),
        set: expect.objectContaining({ id: 'set-2', fitsInSession: true, overlappingSets: [] }),
      })
    })
  })

  describe('PATCH /api/admin/sets/:id', () => {
    it('changes only the fields it is sent, without resolving the track it is not sent, and returns its session', async () => {
      const app = await buildApp()
      await sessionWithSet(app)
      resolveTrack.mockClear()
      const response = await send(app, 'PATCH', '/api/admin/sets/set-2', { genres: ['techno', 'techno'], offsetMinutes: 0 })

      expect(response.statusCode).toBe(200)
      expect(response.json().session.sets[0]).toMatchObject({
        performers: [{ id: 'artist-1' }, { id: 'artist-2' }],
        offsetMinutes: 0,
        durationMinutes: 60,
        genres: ['techno'],
        soundcloudTrack: { id: '42' },
        youtubeVideo: { id: 'dQw4w9WgXcQ' },
        updatedBy: 'admin@example.com',
      })
      expect(store.updateSet).toHaveBeenLastCalledWith('set-2', { genres: ['techno'], offsetMinutes: 0, updatedBy: 'admin@example.com', updatedAt: expect.any(Date) })
      expect(resolveTrack).not.toHaveBeenCalled()
    })

    it('resolves the track when it is sent, and changes the performers and the video when they are', async () => {
      const app = await buildApp()
      await sessionWithSet(app, { soundcloudTrack: null })
      resolveTrack.mockResolvedValueOnce('43')
      const response = await send(app, 'PATCH', '/api/admin/sets/set-2', {
        soundcloudTrack: 'https://soundcloud.com/parkingdotradio/b2b',
        youtubeVideo: null,
        performers: [{ id: 'artist-3' }],
      })
      expect(response.json().session.sets[0]).toMatchObject({
        soundcloudTrack: { id: '43', url: 'https://soundcloud.com/parkingdotradio/b2b' },
        youtubeVideo: null,
        performers: [{ id: 'artist-3', name: 'Cyan' }],
      })
      resolveTrack.mockRejectedValueOnce(new NoSoundCloudCredentials())
      expect((await send(app, 'PATCH', '/api/admin/sets/set-2', { soundcloudTrack: 'https://soundcloud.com/parkingdotradio/c' })).statusCode).toBe(409)
    })

    it('explains what is wrong, or responds 404 before asking SoundCloud', async () => {
      const app = await buildApp()
      await sessionWithSet(app)
      resolveTrack.mockClear()
      const invalid = [
        [{ performers: [] }, 'A set has at least one performer'],
        [{ start: '2026-11-14T21:00-05:00' }, 'Unknown field: `start`'],
        [{}, 'There must be at least one field to change'],
      ] as const
      for (const [changes, error] of invalid) {
        expect((await send(app, 'PATCH', '/api/admin/sets/set-2', changes)).json(), JSON.stringify(changes)).toEqual({ ok: false, error })
      }
      vi.mocked(store.updateSet).mockRejectedValueOnce(new BrokenFields('A set with an offset also has a duration'))
      expect((await send(app, 'PATCH', '/api/admin/sets/set-2', { offsetMinutes: 30 })).json()).toEqual({ ok: false, error: 'A set with an offset also has a duration' })
      const missing = await send(app, 'PATCH', '/api/admin/sets/set-9', { soundcloudTrack: 'https://soundcloud.com/parkingdotradio/x' })
      expect(missing.statusCode).toBe(404)
      expect(resolveTrack).not.toHaveBeenCalled()
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
      response = await send(app, 'PUT', '/api/admin/sets/set-2/status', { status: 'done', by: 'x' })
      expect(response.json()).toEqual({ ok: false, error: 'Unknown field: `by`' })
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
