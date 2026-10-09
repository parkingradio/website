import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { DrizzleQueryError } from 'drizzle-orm'
import fastifyCookie from '@fastify/cookie'
import { NoSuchArtist } from '../applications.js'
import type { ApplicationsStore, StoredApplication } from '../applications.js'
import type { ApplicationsSettings, ApplicationsSettingsStore } from '../applications-settings.js'
import { SESSION_COOKIE, signSessionToken } from '../auth.js'
import { applicationsRoutes } from './applications.js'

// A fake database: the applications, and the ids of the artists who exist.
let rows: StoredApplication[] = []
const ARTISTS = ['artist-1', 'artist-2']
let nextId = 0
// Each application is created a minute after the previous one, so that the tests can check "newest first".
let clock = Date.parse('2026-10-07T16:00:00Z')

function change(id: string, changes: Partial<StoredApplication>) {
  const before = rows.find((row) => row.id === id)
  if (!before) return null
  const after = { ...before, ...changes }
  rows = rows.map((row) => (row.id === id ? after : row))
  return after
}

const store: ApplicationsStore = {
  list: async (artistId) => rows.filter((row) => artistId === undefined || row.artistId === artistId).toReversed(),
  get: async (id) => rows.find((row) => row.id === id) ?? null,
  create: vi.fn<ApplicationsStore['create']>(async (application) => {
    if (!ARTISTS.includes(application.artistId)) throw new NoSuchArtist()
    const row: StoredApplication = {
      id: `application-${++nextId}`,
      createdAt: new Date((clock += 60_000)),
      updatedBy: null,
      updatedAt: null,
      status: 'new',
      statusUpdatedBy: null,
      statusUpdatedAt: null,
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
  await app.register(fastifyCookie)
  await app.register(applicationsRoutes, { store, settings })
  return app
}

type App = Awaited<ReturnType<typeof buildApp>>

// An admin's session cookie.
async function asAdmin() {
  return { [SESSION_COOKIE]: await signSessionToken({ id: 'admin-id', email: 'admin@example.com' }) }
}

async function send(app: App, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) {
  return app.inject({ method, url, payload, cookies: await asAdmin() })
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

    it('requires an artist that exists', async () => {
      const app = await buildApp()
      for (const artistId of ['nobody', undefined, 42]) {
        const response = await create(app, { artistId })
        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ ok: false, error: 'No such artist' })
      }
      expect(rows).toHaveLength(0)
    })

    it('rejects malformed requests', async () => {
      const app = await buildApp()
      const cookies = await asAdmin()
      const malformed = [
        await app.inject({ method: 'POST', url: '/api/admin/applications', payload: '{not json', headers: { 'content-type': 'application/json' }, cookies }),
        await app.inject({ method: 'POST', url: '/api/admin/applications', cookies }),
        await app.inject({ method: 'POST', url: '/api/admin/applications', payload: 'null', headers: { 'content-type': 'application/json' }, cookies }),
      ]
      for (const response of malformed) {
        expect(response.statusCode).toBe(400)
        expect(response.json()).toMatchObject({ ok: false })
      }
      expect(rows).toHaveLength(0)
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

      const theirs = await send(app, 'GET', '/api/admin/applications?artist=artist-1')
      expect(theirs.json().applications.map((row: { id: string }) => row.id)).toEqual(['application-3', 'application-1'])
      expect((await send(app, 'GET', '/api/admin/applications?artist=nobody')).json()).toEqual({ ok: true, applications: [] })
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
        ...application({ artistId: 'artist-2', timeSlots: [], prestations: ['live-performance'], otherPrestation: 'Visuels', details: '' }),
        status: 'rejected',
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().application).toMatchObject({
        artistId: 'artist-1',
        timeSlots: [],
        prestations: ['live-performance'],
        otherPrestation: 'Visuels',
        details: '',
        status: 'accepted',
        updatedBy: 'admin@example.com',
      })
      expect(response.json().application.updatedAt).toEqual(expect.any(String))
    })

    it('explains what is wrong with an invalid application, without changing it', async () => {
      const app = await buildApp()
      await create(app)
      const response = await send(app, 'PUT', '/api/admin/applications/application-1', application({ dates: [] }))
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error: 'Choisis au moins une date.' })
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
      for (const payload of [{ status: 'maybe' }, {}, { status: 'toString' }]) {
        const response = await send(app, 'PUT', '/api/admin/applications/application-1/status', payload)
        expect(response.statusCode).toBe(400)
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
        { body: { recipients: ['equipe@example.com', 'pas une adresse'] }, error: 'Not an email address: pas une adresse' },
        { body: { recipients: ['Équipe <equipe@example.com>'] }, error: 'Not an email address: Équipe <equipe@example.com>' },
        { body: { recipients: [`${'x'.repeat(190)}@example.com`] }, error: `Not an email address: ${'x'.repeat(190)}@example.com` },
        { body: { recipients: 'equipe@example.com' }, error: 'The recipients must be a list of email addresses' },
        { body: { recipients: [42] }, error: 'The recipients must be a list of email addresses' },
        { body: {}, error: 'The recipients must be a list of email addresses' },
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
