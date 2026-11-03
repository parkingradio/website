import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { DrizzleQueryError } from 'drizzle-orm'
import { useZodSchemas } from '../api/schemas.js'
import fastifyCookie from '@fastify/cookie'
import { NoSuchArtist, NoSuchCollective } from './store.js'
import type { ApplicationsStore, StoredApplication } from './store.js'
import type { ApplicationsSettings, ApplicationsSettingsStore } from './settings.js'
import { acceptSessions, sessionCookies } from '../admins/test-sessions.js'
import { applicationsRoutes } from './routes.js'

// A fake database: the applications, and the ids of the artists and collectives that exist.
let rows: StoredApplication[] = []
const ARTISTS = ['artist-1', 'artist-2']
const COLLECTIVES = ['collective-1']
let nextId = 0
// Each application is created a minute after the previous one, so that the tests can check "newest first".
let clock = Date.parse('2026-10-07T16:00:00Z')

// Like the database, which leaves a column as it is when it's given undefined.
function change(id: string, changes: Partial<StoredApplication>) {
  const before = rows.find((row) => row.id === id)
  if (!before) return null
  const after = { ...before, ...Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)) }
  rows = rows.map((row) => (row.id === id ? after : row))
  return after
}

const store: ApplicationsStore = {
  list: async (owner) =>
    rows
      .filter((row) => owner === undefined || (owner.artistId !== undefined ? row.artistId === owner.artistId : row.collectiveId === owner.collectiveId))
      .toReversed(),
  get: async (id) => rows.find((row) => row.id === id) ?? null,
  create: vi.fn<ApplicationsStore['create']>(async ({ receivedAt, ...application }) => {
    if (application.artistId !== undefined && !ARTISTS.includes(application.artistId)) throw new NoSuchArtist()
    if (application.collectiveId !== undefined && !COLLECTIVES.includes(application.collectiveId)) throw new NoSuchCollective()
    const createdAt = new Date((clock += 60_000))
    const row: StoredApplication = {
      id: `application-${++nextId}`,
      receivedAt: receivedAt ?? createdAt,
      createdAt,
      updatedBy: null,
      updatedAt: null,
      status: 'new',
      statusUpdatedBy: null,
      statusUpdatedAt: null,
      artistId: null,
      collectiveId: null,
      ...application,
    }
    rows.push(row)
    return row
  }),
  update: async (id, changes) => change(id, changes),
  setStatus: async (id, status) => change(id, status),
  delete: async (id) => {
    const before = rows.length
    rows = rows.filter((row) => row.id !== id)
    return rows.length < before
  },
}

// Who applications are emailed to, as the database would keep them.
let savedSettings: ApplicationsSettings | null = null
const settings: ApplicationsSettingsStore = {
  load: async () => savedSettings,
  save: vi.fn<ApplicationsSettingsStore['save']>(async (changed) => {
    savedSettings = changed
  }),
}

function application(changes: object = {}) {
  return {
    artistId: 'artist-1',
    dates: ['2027-01-15', '2026-12-10'],
    timeSlots: [{ start: '18:00', end: '22:00' }],
    prestations: ['dj'],
    otherPrestation: '',
    details: 'Une question ?',
    ...changes,
  }
}

// If `logs` is given, every line the app logs is added to it.
async function buildApp(logs?: string[]) {
  const app = Fastify(logs ? { logger: { stream: { write: (line: string) => logs.push(line) } } } : {})
  useZodSchemas(app)
  await app.register(fastifyCookie)
  acceptSessions(app)
  await app.register(applicationsRoutes, { store, settings })
  return app
}

type App = Awaited<ReturnType<typeof buildApp>>

async function send(app: App, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) {
  return app.inject({ method, url, payload, cookies: await sessionCookies() })
}

async function create(app: App, changes: object = {}) {
  return send(app, 'POST', '/api/admin/applications', application(changes))
}

describe('applications routes', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
    rows = []
    nextId = 0
    savedSettings = null
    vi.clearAllMocks()
  })

  afterEach(() => {
    delete process.env.JWT_SECRET
  })

  it('requires a session', async () => {
    const app = await buildApp()
    const requests = [
      app.inject({ method: 'GET', url: '/api/admin/applications' }),
      app.inject({ method: 'GET', url: '/api/admin/applications/application-1' }),
      app.inject({ method: 'POST', url: '/api/admin/applications', payload: application() }),
      app.inject({ method: 'PUT', url: '/api/admin/applications/application-1', payload: application() }),
      app.inject({ method: 'PUT', url: '/api/admin/applications/application-1/status', payload: { status: 'accepted' } }),
      app.inject({ method: 'DELETE', url: '/api/admin/applications/application-1' }),
      app.inject({ method: 'GET', url: '/api/admin/applications/recipients' }),
      app.inject({ method: 'PUT', url: '/api/admin/applications/recipients', payload: { recipients: [] } }),
    ]
    for (const response of await Promise.all(requests)) {
      expect(response.statusCode).toBe(401)
    }
    expect(store.create).not.toHaveBeenCalled()
    expect(settings.save).not.toHaveBeenCalled()
  })

  it('requires a session before reading the request, whatever it sends', async () => {
    const app = await buildApp()
    const json = { 'content-type': 'application/json' }
    for (const [method, url] of [
      ['POST', '/api/admin/applications'],
      ['PUT', '/api/admin/applications/application-1'],
      ['PUT', '/api/admin/applications/application-1/status'],
      ['PUT', '/api/admin/applications/recipients'],
    ] as const) {
      for (const sent of [{ payload: { dates: 'x', status: 'maybe', recipients: 42 } }, { payload: 'null', headers: json }, { payload: '{', headers: json }]) {
        const response = await app.inject({ method, url, ...sent })
        expect(response.statusCode).toBe(401)
        expect(response.json()).toEqual({ ok: false, error: 'Unauthorized' })
      }
    }
    expect((await app.inject({ method: 'GET', url: '/api/admin/applications?artist=a&artist=b' })).statusCode).toBe(401)
  })

  it('refuses the requests that change applications from another origin', async () => {
    const app = await buildApp()
    await create(app)
    const options = { headers: { 'sec-fetch-site': 'cross-site' }, cookies: await sessionCookies() }
    const requests = [
      app.inject({ method: 'POST', url: '/api/admin/applications', payload: application(), ...options }),
      app.inject({ method: 'PUT', url: '/api/admin/applications/application-1', payload: application(), ...options }),
      app.inject({ method: 'PUT', url: '/api/admin/applications/application-1/status', payload: { status: 'accepted' }, ...options }),
      app.inject({ method: 'DELETE', url: '/api/admin/applications/application-1', ...options }),
      app.inject({ method: 'PUT', url: '/api/admin/applications/recipients', payload: { recipients: [] }, ...options }),
    ]
    for (const response of await Promise.all(requests)) {
      expect(response.statusCode).toBe(403)
      expect(response.json()).toEqual({ ok: false, error: 'Cross-origin request refused' })
    }
    expect(rows).toEqual([expect.objectContaining({ status: 'new', updatedBy: null })])
    expect(settings.save).not.toHaveBeenCalled()
  })

  it('responds 500 rather than return an application that the API cannot describe, e.g. with a prestation that is not in the list anymore', async () => {
    const app = await buildApp()
    await create(app)
    rows[0] = { ...rows[0], prestations: ['theremin' as StoredApplication['prestations'][number]] }
    expect((await send(app, 'GET', '/api/admin/applications/application-1')).statusCode).toBe(500)
    expect((await send(app, 'GET', '/api/admin/applications')).statusCode).toBe(500)
  })

  describe('POST /api/admin/applications', () => {
    it('creates the application for the artist, as new, and returns it', async () => {
      const app = await buildApp()
      const response = await create(app)

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        ok: true,
        application: {
          ...application(),
          // Sorted.
          dates: ['2026-12-10', '2027-01-15'],
          id: 'application-1',
          collectiveId: null,
          // When it was created, since nothing else was said.
          receivedAt: rows[0].createdAt.toISOString(),
          createdAt: rows[0].createdAt.toISOString(),
          createdBy: 'admin@example.com',
          updatedBy: null,
          updatedAt: null,
          status: 'new',
          statusUpdatedBy: null,
          statusUpdatedAt: null,
        },
      })
    })

    it('explains, in French, what is wrong with an invalid application', async () => {
      const app = await buildApp()
      const response = await create(app, { timeSlots: [{ start: '22:00', end: '18:00' }] })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error: 'Une des plages horaires est invalide.' })
      expect(rows).toHaveLength(0)
    })

    it('takes any day, past or future', async () => {
      const app = await buildApp()
      const response = await create(app, { dates: ['2099-12-31', '2020-02-29'] })
      expect(response.statusCode).toBe(200)
      expect(response.json().application.dates).toEqual(['2020-02-29', '2099-12-31'])
    })

    it('takes when the artist sent the application, if it is not in the future', async () => {
      const app = await buildApp()
      const received = await create(app, { receivedAt: '2026-03-28T10:03:00-04:00' })
      expect(received.statusCode).toBe(200)
      expect(received.json().application).toMatchObject({ receivedAt: '2026-03-28T14:03:00.000Z', createdAt: rows[0].createdAt.toISOString() })

      const now = new Date().toISOString()
      expect((await create(app, { receivedAt: now })).json().application.receivedAt).toBe(now)
    })

    it('explains, in French, what is wrong with when the application was received', async () => {
      const app = await buildApp()
      // The rules are tested with ReceivedAt itself (see applications/store.test.ts).
      const invalid = [
        { receivedAt: new Date(Date.now() + 60_000).toISOString(), error: 'La date de réception ne peut pas être dans le futur.' },
        { receivedAt: '2026-03-28', error: 'La date de réception est invalide.' },
      ]
      for (const { receivedAt, error } of invalid) {
        const response = await create(app, { receivedAt })
        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ ok: false, error })
      }
      expect(rows).toHaveLength(0)
    })

    it('requires an artist that exists', async () => {
      const app = await buildApp()
      for (const artistId of ['nobody', null, 42]) {
        const response = await create(app, { artistId })
        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ ok: false, error: 'No such artist' })
      }
      expect(rows).toHaveLength(0)
    })

    it('creates the application for a collective', async () => {
      const app = await buildApp()
      const response = await create(app, { artistId: undefined, collectiveId: 'collective-1' })
      expect(response.statusCode).toBe(200)
      expect(response.json().application).toMatchObject({ id: 'application-1', artistId: null, collectiveId: 'collective-1' })
      expect(store.create).toHaveBeenCalledWith(expect.not.objectContaining({ artistId: expect.anything() }))
    })

    it('requires a collective that exists', async () => {
      const app = await buildApp()
      for (const collectiveId of ['nobody', null, 42]) {
        const response = await create(app, { artistId: undefined, collectiveId })
        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ ok: false, error: 'No such collective' })
      }
      expect(rows).toHaveLength(0)
    })

    it('requires either an artist or a collective, but not both', async () => {
      const app = await buildApp()
      for (const owner of [{ artistId: undefined }, { collectiveId: 'collective-1' }]) {
        const response = await create(app, owner)
        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({
          ok: false,
          error: 'An application belongs to either an artist or a collective: send either artistId or collectiveId',
        })
      }
      expect(rows).toHaveLength(0)
    })

    it('rejects malformed requests', async () => {
      const app = await buildApp()
      const cookies = await sessionCookies()
      const json = { 'content-type': 'application/json' }
      const invalidJson = await app.inject({ method: 'POST', url: '/api/admin/applications', payload: '{not json', headers: json, cookies })
      expect(invalidJson.statusCode).toBe(400)
      expect(invalidJson.json()).toEqual({ ok: false, error: expect.stringContaining('not valid JSON') })
      // Without an application, the first thing missing is a date.
      for (const sent of [{}, { payload: 'null', headers: json }, { payload: '[]', headers: json }, { payload: '"application"', headers: json }]) {
        const response = await app.inject({ method: 'POST', url: '/api/admin/applications', ...sent, cookies })
        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ ok: false, error: 'Choisissez au moins une date.' })
      }
      expect(rows).toHaveLength(0)
    })

    it('explains, in French, what is wrong with a field that is missing, or of the wrong type', async () => {
      const app = await buildApp()
      const invalid = [
        { changes: { timeSlots: undefined }, error: 'Les plages horaires sont invalides.' },
        { changes: { timeSlots: '18:00-22:00' }, error: 'Les plages horaires sont invalides.' },
        { changes: { timeSlots: [null] }, error: 'Une des plages horaires est invalide.' },
        { changes: { prestations: 'dj' }, error: 'Les prestations sont invalides.' },
        { changes: { prestations: null }, error: 'Les prestations sont invalides.' },
        { changes: { otherPrestation: 42 }, error: 'La prestation « Autre » est invalide.' },
        { changes: { details: ['Une question ?'] }, error: 'Le champ « Questions ou détails » est invalide.' },
        { changes: { receivedAt: null }, error: 'La date de réception est invalide.' },
      ]
      for (const { changes, error } of invalid) {
        const response = await create(app, changes)
        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ ok: false, error })
      }
      expect(rows).toHaveLength(0)
    })

    it('says what is wrong with the application before what is wrong with the artist', async () => {
      const app = await buildApp()
      const response = await create(app, { artistId: 42, receivedAt: '2026-03-28', prestations: ['modular'] })
      expect(response.json()).toEqual({ ok: false, error: "Une des prestations n'est pas dans la liste." })
      expect((await create(app, { artistId: 42, receivedAt: '2026-03-28' })).json()).toEqual({ ok: false, error: 'La date de réception est invalide.' })
      // Then what's wrong with each id, before there being both.
      expect((await create(app, { artistId: 42, collectiveId: 42 })).json()).toEqual({ ok: false, error: 'No such artist' })
      expect((await create(app, { collectiveId: 42 })).json()).toEqual({ ok: false, error: 'No such collective' })
    })

    it("keeps the application's details out of the logs and the response when the database fails", async () => {
      const cause = Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' })
      const query = 'insert into "applications" ("details") values ($1)'
      vi.mocked(store.create).mockRejectedValueOnce(new DrizzleQueryError(query, ['Appelle-moi au 418 555-0123'], cause))
      const logs: string[] = []
      const app = await buildApp(logs)
      const response = await create(app, { details: 'Appelle-moi au 418 555-0123' })
      expect(response.statusCode).toBe(500)
      expect(response.json()).toEqual({ ok: false, error: 'Internal server error' })
      expect(logs.join('')).toContain('57P01')
      expect(logs.join('')).not.toContain('418 555-0123')
    })
  })

  describe('GET /api/admin/applications', () => {
    it('lists the applications newest first, or only those of an artist', async () => {
      const app = await buildApp()
      await create(app)
      await create(app, { artistId: 'artist-2' })
      await create(app)

      const all = await send(app, 'GET', '/api/admin/applications')
      expect(all.statusCode).toBe(200)
      expect(all.json().applications.map((row: { id: string }) => row.id)).toEqual(['application-3', 'application-2', 'application-1'])
      expect(all.json().total).toBe(3)

      const theirs = await send(app, 'GET', '/api/admin/applications?artist=artist-1')
      expect(theirs.json().applications.map((row: { id: string }) => row.id)).toEqual(['application-3', 'application-1'])
      expect(theirs.json().total).toBe(2)
      expect((await send(app, 'GET', '/api/admin/applications?artist=nobody')).json()).toEqual({ ok: true, total: 0, applications: [] })
      const twice = await send(app, 'GET', '/api/admin/applications?artist=artist-1&artist=artist-2')
      expect(twice.statusCode).toBe(400)
      expect(twice.json()).toEqual({ ok: false, error: 'The artist must be a single id' })
    })

    it("lists only a collective's applications", async () => {
      const app = await buildApp()
      await create(app)
      await create(app, { artistId: undefined, collectiveId: 'collective-1' })

      const theirs = await send(app, 'GET', '/api/admin/applications?collective=collective-1')
      expect(theirs.json().applications.map((row: { id: string }) => row.id)).toEqual(['application-2'])
      expect(theirs.json().total).toBe(1)
      expect((await send(app, 'GET', '/api/admin/applications?collective=nobody')).json()).toEqual({ ok: true, total: 0, applications: [] })
      const twice = await send(app, 'GET', '/api/admin/applications?collective=collective-1&collective=collective-2')
      expect(twice.statusCode).toBe(400)
      expect(twice.json()).toEqual({ ok: false, error: 'The collective must be a single id' })
      const both = await send(app, 'GET', '/api/admin/applications?artist=artist-1&collective=collective-1')
      expect(both.statusCode).toBe(400)
      expect(both.json()).toEqual({ ok: false, error: 'Only one of artist and collective can be given' })
    })
  })

  describe('GET /api/admin/applications/:id', () => {
    it('returns the application', async () => {
      const app = await buildApp()
      const created = (await create(app)).json().application
      const response = await send(app, 'GET', `/api/admin/applications/${created.id}`)
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ ok: true, application: created })
    })

    it('responds 404 for an application that does not exist', async () => {
      const app = await buildApp()
      expect((await send(app, 'GET', '/api/admin/applications/nothing')).statusCode).toBe(404)
    })
  })

  describe('PUT /api/admin/applications/:id', () => {
    it('replaces the fields, keeps the artist and the status, and says who changed it', async () => {
      const app = await buildApp()
      await create(app)
      await send(app, 'PUT', '/api/admin/applications/application-1/status', { status: 'accepted' })
      const response = await send(app, 'PUT', '/api/admin/applications/application-1', {
        ...application({ artistId: 'artist-2', collectiveId: 'collective-1', timeSlots: [], prestations: ['live-performance'], otherPrestation: 'Visuels', details: '' }),
        status: 'rejected',
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().application).toMatchObject({
        artistId: 'artist-1',
        collectiveId: null,
        timeSlots: [],
        prestations: ['live-performance'],
        otherPrestation: 'Visuels',
        details: '',
        status: 'accepted',
        updatedBy: 'admin@example.com',
      })
      expect(response.json().application.updatedAt).toEqual(expect.any(String))
    })

    it('changes when the application was received, or keeps it when that is left out', async () => {
      const app = await buildApp()
      await create(app, { receivedAt: '2026-03-28T14:03:00Z' })
      const kept = await send(app, 'PUT', '/api/admin/applications/application-1', application({ details: 'Corrigé.' }))
      expect(kept.json().application).toMatchObject({ receivedAt: '2026-03-28T14:03:00.000Z', details: 'Corrigé.' })

      const changed = await send(app, 'PUT', '/api/admin/applications/application-1', application({ receivedAt: '2026-03-27T04:00:00Z' }))
      expect(changed.json().application.receivedAt).toBe('2026-03-27T04:00:00.000Z')
    })

    it('explains what is wrong with an invalid application, without changing it', async () => {
      const app = await buildApp()
      await create(app)
      for (const [changes, error] of [
        [{ dates: [] }, 'Choisissez au moins une date.'],
        [{ receivedAt: '2099-01-01T00:00:00Z' }, 'La date de réception ne peut pas être dans le futur.'],
      ] as const) {
        const response = await send(app, 'PUT', '/api/admin/applications/application-1', application(changes))
        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ ok: false, error })
      }
      expect(rows[0].updatedBy).toBeNull()
    })

    it('explains, in French, what is wrong with an application that is malformed, without changing it', async () => {
      const app = await buildApp()
      await create(app)
      const cookies = await sessionCookies()
      const json = { 'content-type': 'application/json' }
      const url = '/api/admin/applications/application-1'
      const malformed = [
        { response: await app.inject({ method: 'PUT', url, payload: 'null', headers: json, cookies }), error: 'Choisissez au moins une date.' },
        { response: await app.inject({ method: 'PUT', url, payload: '[]', headers: json, cookies }), error: 'Choisissez au moins une date.' },
        { response: await send(app, 'PUT', url, application({ prestations: undefined })), error: 'Les prestations sont invalides.' },
        { response: await send(app, 'PUT', url, application({ details: 42 })), error: 'Le champ « Questions ou détails » est invalide.' },
      ]
      for (const { response, error } of malformed) {
        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ ok: false, error })
      }
      expect(rows[0].updatedBy).toBeNull()
    })

    it('responds 404 for an application that does not exist', async () => {
      const app = await buildApp()
      expect((await send(app, 'PUT', '/api/admin/applications/nothing', application())).statusCode).toBe(404)
    })
  })

  describe('PUT /api/admin/applications/:id/status', () => {
    it('changes the status, and says who changed it', async () => {
      const app = await buildApp()
      await create(app)
      const response = await send(app, 'PUT', '/api/admin/applications/application-1/status', { status: 'rejected' })
      expect(response.statusCode).toBe(200)
      expect(response.json().application).toMatchObject({ status: 'rejected', statusUpdatedBy: 'admin@example.com', updatedBy: null })
      expect(response.json().application.statusUpdatedAt).toEqual(expect.any(String))
    })

    it('refuses anything but a status', async () => {
      const app = await buildApp()
      await create(app)
      const cookies = await sessionCookies()
      const refused = [
        ...[{ status: 'maybe' }, {}, { status: 'toString' }, { status: 'Accepted' }].map((payload) => send(app, 'PUT', '/api/admin/applications/application-1/status', payload)),
        app.inject({ method: 'PUT', url: '/api/admin/applications/application-1/status', payload: 'null', headers: { 'content-type': 'application/json' }, cookies }),
      ]
      for (const response of await Promise.all(refused)) {
        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ ok: false, error: 'The status must be one of new, accepted, scheduled, done, rejected' })
      }
      expect(rows[0].status).toBe('new')
    })

    it('responds 404 for an application that does not exist', async () => {
      const app = await buildApp()
      expect((await send(app, 'PUT', '/api/admin/applications/nothing/status', { status: 'accepted' })).statusCode).toBe(404)
    })
  })

  describe('DELETE /api/admin/applications/:id', () => {
    it('deletes the application', async () => {
      const app = await buildApp()
      await create(app)
      expect((await send(app, 'DELETE', '/api/admin/applications/application-1')).json()).toEqual({ ok: true })
      expect(rows).toHaveLength(0)
      expect((await send(app, 'DELETE', '/api/admin/applications/application-1')).statusCode).toBe(404)
    })
  })

  describe('/api/admin/applications/recipients', () => {
    const URL = '/api/admin/applications/recipients'

    it('has nobody until recipients are chosen', async () => {
      const app = await buildApp()
      const response = await send(app, 'GET', URL)
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ ok: true, recipients: [], updatedBy: null, updatedAt: null })
    })

    it('replaces the recipients, with who changed them and when, and returns them', async () => {
      const app = await buildApp()
      const before = Date.now()
      const response = await send(app, 'PUT', URL, { recipients: ['equipe@example.com', 'booking@example.com'] })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body).toEqual({
        ok: true,
        recipients: ['equipe@example.com', 'booking@example.com'],
        updatedBy: 'admin@example.com',
        updatedAt: expect.any(String),
      })
      expect(Date.parse(body.updatedAt)).toBeGreaterThanOrEqual(before)
      expect((await send(app, 'GET', URL)).json()).toEqual(body)
    })

    it('trims the recipients, and drops blank entries and duplicates, whatever their case', async () => {
      const app = await buildApp()
      const response = await send(app, 'PUT', URL, { recipients: [' equipe@example.com ', '', '  ', 'Equipe@Example.com', 'booking@example.com'] })
      expect(response.json().recipients).toEqual(['equipe@example.com', 'booking@example.com'])
    })

    it('can be emptied', async () => {
      const app = await buildApp()
      await send(app, 'PUT', URL, { recipients: ['equipe@example.com'] })
      expect((await send(app, 'PUT', URL, { recipients: [] })).json().recipients).toEqual([])
      expect(savedSettings?.recipients).toEqual([])
    })

    it("refuses what isn't a list of email addresses, or too many of them, and keeps the recipients as they were", async () => {
      const app = await buildApp()
      await send(app, 'PUT', URL, { recipients: ['equipe@example.com'] })
      vi.mocked(settings.save).mockClear()
      const invalid = [
        { body: { recipients: ['equipe@example.com', 'pas une adresse'] }, error: "Recipient 2 isn't an email address" },
        { body: { recipients: ['Équipe <equipe@example.com>'] }, error: "Recipient 1 isn't an email address" },
        // By its position in what was sent, blanks included.
        { body: { recipients: [' ', 'pas une adresse'] }, error: "Recipient 2 isn't an email address" },
        { body: { recipients: [`${'x'.repeat(190)}@example.com`] }, error: "Recipient 1 isn't an email address" },
        { body: { recipients: 'equipe@example.com' }, error: 'The recipients must be a list of email addresses' },
        { body: { recipients: [42] }, error: 'The recipients must be a list of email addresses' },
        { body: {}, error: 'The recipients must be a list of email addresses' },
        { body: { recipients: null }, error: 'The recipients must be a list of email addresses' },
        // The first that's wrong.
        { body: { recipients: ['pas une adresse', ...Array.from({ length: 11 }, (_, i) => `admin-${i}@example.com`)] }, error: "Recipient 1 isn't an email address" },
        {
          body: { recipients: [...Array.from({ length: 11 }, (_, i) => `admin-${i}@example.com`), 'pas une adresse'] },
          error: 'There can be at most 10 recipients',
        },
        {
          body: { recipients: Array.from({ length: 11 }, (_, i) => `admin-${i}@example.com`) },
          error: 'There can be at most 10 recipients',
        },
      ]
      for (const { body, error } of invalid) {
        const response = await send(app, 'PUT', URL, body)
        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ ok: false, error })
      }
      const nothing = await app.inject({ method: 'PUT', url: URL, payload: 'null', headers: { 'content-type': 'application/json' }, cookies: await sessionCookies() })
      expect(nothing.statusCode).toBe(400)
      expect(nothing.json()).toEqual({ ok: false, error: 'The recipients must be a list of email addresses' })
      expect(settings.save).not.toHaveBeenCalled()
      expect(savedSettings?.recipients).toEqual(['equipe@example.com'])
    })

    it('counts recipients once blank entries and duplicates are dropped', async () => {
      const app = await buildApp()
      const recipients = [...Array.from({ length: 10 }, (_, i) => `admin-${i}@example.com`), 'ADMIN-0@example.com', '']
      expect((await send(app, 'PUT', URL, { recipients })).statusCode).toBe(200)
    })
  })
})
