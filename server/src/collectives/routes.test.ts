import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import { acceptSessions, sessionCookies } from '../admins/test-sessions.js'
import { useZodSchemas } from '../api/schemas.js'
import { multipartBody } from '../api/test-multipart.js'
import { EmailTaken, photoColumns } from '../artists/store.js'
import { sizeKey } from '../artists/sizes.js'
import { JPEG, PNG, UNREADABLE_JPEG, memoryPhotos } from '../artists/test-photos.js'
import { NO_SUCH_MEMBER } from './profile.js'
import { collectivesRoutes } from './routes.js'
import { Conflict } from '../sessions/store.js'
import type { StoredSession } from '../sessions/store.js'
import { HAS_TAKEOVERS, InvalidMember } from './store.js'
import type { CollectivesStore, StoredCollective } from './store.js'
import { inQuebecTime } from '../api/formats.js'

// The collectives, as the database would keep them, the artists they can have as members, and the photos, as the bucket
// would. How a profile and its photo are read from the request is shared with artists, and tested with them (see
// artists/routes.test.ts).
let rows: StoredCollective[] = []
let artists: { id: string; name: string }[] = []
const photos = memoryPhotos()
const stored = photos.stored
let nextId = 0

// Like the database, where two collectives can't have the same email whatever its case, but any number can have none.
function emailTaken(email: string | null, except?: string) {
  return email !== null && rows.some((row) => row.id !== except && row.email?.toLowerCase() === email.toLowerCase())
}

// The members, as the store saves them: artists who exist, and new ones for those sent by name.
function members(sent: Parameters<CollectivesStore['create']>[0]['members']) {
  for (const member of sent) {
    const artist = 'id' in member ? artists.find((artist) => artist.id === member.id) : undefined
    if ('id' in member && !artist) throw new InvalidMember(NO_SUCH_MEMBER)
  }
  return sent.map((member) => {
    if ('id' in member) return { id: member.id, name: artists.find((artist) => artist.id === member.id)!.name }
    const artist = { id: `artist-${++nextId}`, name: member.name }
    artists.push(artist)
    return { id: artist.id, name: artist.name }
  })
}

const store: CollectivesStore = {
  list: async () => [...rows].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())),
  get: async (id) => rows.find((row) => row.id === id) ?? null,
  // Who's public is worked out by the database, which the public routes are tested against (see
  // events/public.db.test.ts).
  getPublic: async () => null,
  create: vi.fn<CollectivesStore['create']>(async ({ photo, ...collective }) => {
    if (emailTaken(collective.email)) throw new EmailTaken()
    const row: StoredCollective = {
      id: `collective-${++nextId}`,
      createdAt: new Date(),
      updatedBy: null,
      updatedAt: null,
      ...collective,
      ...photoColumns(photo),
      members: members(collective.members),
    }
    rows.push(row)
    return row
  }),
  update: vi.fn<CollectivesStore['update']>(async (id, { photo, ...changes }) => {
    const before = rows.find((row) => row.id === id)
    if (!before) return null
    if (emailTaken(changes.email ?? null, id)) throw new EmailTaken()
    // Its members stay as they are when they're left out.
    const after = {
      ...before,
      ...changes,
      ...(photo === undefined ? {} : photoColumns(photo)),
      members: changes.members ? members(changes.members) : before.members,
    }
    rows = rows.map((row) => (row.id === id ? after : row))
    return { before, after }
  }),
  delete: vi.fn<CollectivesStore['delete']>(async (id) => {
    const row = rows.find((row) => row.id === id)
    rows = rows.filter((other) => other.id !== id)
    return row ?? null
  }),
}

function profile(changes: Record<string, unknown> = {}) {
  return {
    name: 'Les Ondes',
    members: [{ id: 'artist-ana' }, { id: 'artist-brume' }],
    country: 'CA',
    city: 'Québec',
    description: 'Une description.',
    links: { soundcloud: 'https://soundcloud.com/lesondes' },
    email: 'contact@example.com',
    phone: '418 555-0123',
    ...changes,
  }
}

// A multipart/form-data body, as adding a collective takes it: the profile as JSON, and the photo.
function multipart(collective: object, photo: Buffer | null = JPEG) {
  return multipartBody({ collective: JSON.stringify(collective), photo: photo ?? undefined })
}

async function buildApp() {
  const app = Fastify()
  useZodSchemas(app)
  await app.register(fastifyCookie)
  acceptSessions(app)
  await app.register(collectivesRoutes, { store, photos })
  return app
}

type App = Awaited<ReturnType<typeof buildApp>>

async function create(app: App, collective: object = profile(), photo?: Buffer | null) {
  return app.inject({ method: 'POST', url: '/api/admin/collectives', ...multipart(collective, photo), cookies: await sessionCookies() })
}

// Gives the collective a photo, or replaces its own, with these parts.
async function putPhoto(app: App, url: string, parts: Parameters<typeof multipartBody>[0] = { photo: PNG }) {
  return app.inject({ method: 'PUT', url, ...multipartBody(parts), cookies: await sessionCookies() })
}

async function request(app: App, method: 'GET' | 'DELETE', url: string, headers: Record<string, string> = {}) {
  return app.inject({ method, url, headers, cookies: await sessionCookies() })
}

// Changes some of the collective's fields, as JSON.
async function patch(app: App, url: string, changes: unknown) {
  return app.inject({ method: 'PATCH', url, payload: JSON.stringify(changes), headers: { 'content-type': 'application/json' }, cookies: await sessionCookies() })
}

describe('collectives routes', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
    rows = []
    artists = [
      { id: 'artist-ana', name: 'Ana' },
      { id: 'artist-brume', name: 'Brume' },
    ]
    photos.reset()
    nextId = 0
    vi.clearAllMocks()
  })

  afterEach(() => {
    delete process.env.JWT_SECRET
  })

  it('requires a session, and refuses changes from another origin', async () => {
    const app = await buildApp()
    const requests = [
      app.inject({ method: 'GET', url: '/api/admin/collectives' }),
      app.inject({ method: 'GET', url: '/api/admin/collectives/collective-1' }),
      app.inject({ method: 'GET', url: '/api/admin/collectives/collective-1/photo' }),
      app.inject({ method: 'POST', url: '/api/admin/collectives', ...multipart(profile()) }),
      app.inject({ method: 'PATCH', url: '/api/admin/collectives/collective-1', payload: { name: 'X' } }),
      app.inject({ method: 'PUT', url: '/api/admin/collectives/collective-1/photo', ...multipartBody({ photo: PNG }) }),
      app.inject({ method: 'DELETE', url: '/api/admin/collectives/collective-1/photo' }),
      app.inject({ method: 'DELETE', url: '/api/admin/collectives/collective-1' }),
    ]
    for (const response of await Promise.all(requests)) expect(response.statusCode).toBe(401)

    await create(app)
    const cookies = await sessionCookies()
    const crossSite = { 'sec-fetch-site': 'cross-site' }
    const refused = [
      app.inject({ method: 'POST', url: '/api/admin/collectives', ...multipart(profile()), headers: { ...multipart(profile()).headers, ...crossSite }, cookies }),
      app.inject({ method: 'PATCH', url: '/api/admin/collectives/collective-1', payload: { name: 'X' }, headers: crossSite, cookies }),
      app.inject({ method: 'PUT', url: '/api/admin/collectives/collective-1/photo', ...multipartBody({ photo: PNG }), headers: { ...multipartBody({}).headers, ...crossSite }, cookies }),
      app.inject({ method: 'DELETE', url: '/api/admin/collectives/collective-1/photo', headers: crossSite, cookies }),
      app.inject({ method: 'DELETE', url: '/api/admin/collectives/collective-1', headers: crossSite, cookies }),
    ]
    for (const response of await Promise.all(refused)) expect(response.statusCode).toBe(403)
    expect(photos.store).toHaveBeenCalledTimes(1)
    expect(rows[0]).toMatchObject({ name: 'Les Ondes', photoKey: 'collectives/photo-1.jpeg' })
  })

  describe('POST /api/admin/collectives', () => {
    it('adds the collective with its photo and members, in order, and returns it', async () => {
      const app = await buildApp()
      const response = await create(app, profile({ members: [{ id: 'artist-brume' }, { id: 'artist-ana' }] }))

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        ok: true,
        collective: {
          ...profile(),
          members: [
            { id: 'artist-brume', name: 'Brume' },
            { id: 'artist-ana', name: 'Ana' },
          ],
          // Only the profile names are kept.
          links: { soundcloud: 'lesondes' },
          id: 'collective-1',
          hasPhoto: true,
          createdAt: inQuebecTime(rows[0].createdAt),
          createdBy: 'admin@example.com',
          updatedBy: null,
          updatedAt: null,
        },
      })
      expect(photos.store).toHaveBeenCalledWith({ body: JPEG, type: 'image/jpeg', sizes: expect.any(Map) }, 'collectives')
      expect(stored.has(sizeKey('collectives/photo-1.jpeg', 320))).toBe(true)
      expect(stored.has(sizeKey('collectives/photo-1.jpeg', 1280))).toBe(true)
      expect(rows[0]).toMatchObject({ photoKey: 'collectives/photo-1.jpeg', photoType: 'image/jpeg' })
    })

    it('creates the members sent by name', async () => {
      const app = await buildApp()
      const response = await create(app, profile({ members: [{ id: 'artist-ana' }, { name: 'Cyan' }] }), null)
      expect(response.statusCode).toBe(200)
      expect(response.json().collective.members).toEqual([
        { id: 'artist-ana', name: 'Ana' },
        { id: 'artist-2', name: 'Cyan' },
      ])
      expect(vi.mocked(store.create).mock.calls[0][0].members).toEqual([{ id: 'artist-ana' }, { name: 'Cyan' }])
    })

    it('adds a collective without a photo, country, city, description, links, email or phone', async () => {
      const app = await buildApp()
      const leftOut = { country: '', city: '', description: '', links: {}, email: null, phone: '' }
      const response = await create(app, profile(leftOut), null)
      expect(response.statusCode).toBe(200)
      expect(response.json().collective).toMatchObject({ ...leftOut, hasPhoto: false })
      expect(rows[0]).toMatchObject(leftOut)
      expect(photos.store).not.toHaveBeenCalled()
    })

    it('adds any number of collectives without an email, whether it is left out, null or blank', async () => {
      const app = await buildApp()
      // JSON leaves out undefined fields.
      for (const email of [undefined, null, '  ']) {
        const response = await create(app, profile({ email }), null)
        expect(response.statusCode).toBe(200)
        expect(response.json().collective.email).toBeNull()
      }
      expect(rows.map((row) => row.email)).toEqual([null, null, null])
    })

    it('explains, in French, what is wrong with an invalid profile, without storing the photo', async () => {
      const app = await buildApp()
      for (const [changes, error] of [
        [{ email: 'pas-une-adresse' }, 'Indiquez une adresse e-mail valide.'],
        [{ members: [] }, 'Indiquez au moins un artiste du collectif.'],
        [{ description: 'x'.repeat(5001) }, 'La description dépasse 5000 caractères.'],
      ] as const) {
        const response = await create(app, profile(changes))
        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ ok: false, error })
      }
      const response = await create(app, profile(), Buffer.from('%PDF-1.7'))
      expect(response.json()).toEqual({ ok: false, error: 'La photo doit être en JPEG, PNG ou WebP.' })
      const unreadable = await create(app, profile(), UNREADABLE_JPEG)
      expect(unreadable.statusCode).toBe(400)
      expect(unreadable.json()).toEqual({ ok: false, error: 'La photo ne peut pas être lue : elle est endommagée, ou dépasse 100 millions de pixels.' })
      expect(photos.store).not.toHaveBeenCalled()
      expect(rows).toHaveLength(0)
    })

    it('refuses an email another collective has, whatever its case, and forgets the photo', async () => {
      const app = await buildApp()
      expect((await create(app)).statusCode).toBe(200)
      const response = await create(app, profile({ email: 'Contact@Example.com' }), PNG)
      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ ok: false, error: 'Another collective has this email address' })
      expect(photos.photos()).toEqual(['collectives/photo-1.jpeg'])
    })

    it('refuses a member who is not an artist, in English, and forgets the photo', async () => {
      const app = await buildApp()
      const response = await create(app, profile({ members: [{ id: 'artist-ana' }, { id: 'artist-nobody' }] }), PNG)
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error: NO_SUCH_MEMBER })
      expect(rows).toHaveLength(0)
      expect(stored.size).toBe(0)
    })

    it('rejects a request without the collective', async () => {
      const app = await buildApp()
      const { payload, headers } = multipart(profile())
      const renamed = Buffer.from(payload.toString('latin1').replace('name="collective"', 'name="artist"'), 'latin1')
      const malformed = await app.inject({ method: 'POST', url: '/api/admin/collectives', payload: renamed, headers, cookies: await sessionCookies() })
      expect(malformed.statusCode).toBe(400)
      expect(malformed.json()).toEqual({ ok: false, error: 'Invalid request' })
    })
  })

  describe('GET /api/admin/collectives', () => {
    it('lists the collectives by name', async () => {
      const app = await buildApp()
      await create(app, profile({ name: 'zébus', email: 'zebus@example.com' }))
      await create(app, profile({ name: 'Ondes', email: 'ondes@example.com' }))
      const response = await request(app, 'GET', '/api/admin/collectives')
      expect(response.statusCode).toBe(200)
      expect(response.json().collectives.map((collective: { name: string }) => collective.name)).toEqual(['Ondes', 'zébus'])
      expect(response.json().total).toBe(2)
    })
  })

  describe('GET /api/admin/collectives/:id', () => {
    it('returns the collective, or 404 when there is no such collective', async () => {
      const app = await buildApp()
      const created = (await create(app)).json().collective
      expect((await request(app, 'GET', `/api/admin/collectives/${created.id}`)).json()).toEqual({ ok: true, collective: created })
      const response = await request(app, 'GET', '/api/admin/collectives/nobody')
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ ok: false, error: 'No such collective' })
    })
  })

  describe('GET /api/admin/collectives/:id/photo', () => {
    it('returns the photo like an artist\'s, or a 304 without it when the request has its ETag', async () => {
      const app = await buildApp()
      await create(app, profile(), PNG)
      const response = await request(app, 'GET', '/api/admin/collectives/collective-1/photo')
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toBe('image/png')
      expect(response.headers['x-content-type-options']).toBe('nosniff')
      expect(response.headers['cache-control']).toBe('private, no-cache')
      expect(response.rawPayload).toEqual(PNG)

      const kept = await request(app, 'GET', '/api/admin/collectives/collective-1/photo', { 'if-none-match': response.headers.etag as string })
      expect(kept.statusCode).toBe(304)
    })

    it('serves the sizes of the photo, with `width`', async () => {
      const app = await buildApp()
      await create(app, profile(), PNG)
      const served = await request(app, 'GET', '/api/admin/collectives/collective-1/photo?width=1280')
      expect(served.statusCode).toBe(200)
      expect(served.rawPayload).toEqual(photos.size('collectives/photo-1.png', 1280))
      expect(served.headers).toMatchObject({ 'content-type': 'image/webp', 'cache-control': 'private, no-cache' })
      expect((await request(app, 'GET', '/api/admin/collectives/collective-1/photo?width=12')).json()).toEqual({ ok: false, error: '`width` must be 320 or 1280.' })
    })

    it('responds 404 for a collective that does not exist, has no photo, or whose photo is missing', async () => {
      const app = await buildApp()
      expect((await request(app, 'GET', '/api/admin/collectives/nobody/photo')).json()).toEqual({ ok: false, error: 'No such collective' })
      await create(app, profile(), null)
      expect((await request(app, 'GET', '/api/admin/collectives/collective-1/photo')).json()).toEqual({ ok: false, error: 'This collective has no photo' })
      await create(app, profile({ email: 'autre@example.com' }))
      stored.clear()
      const missing = await request(app, 'GET', '/api/admin/collectives/collective-2/photo')
      expect(missing.statusCode).toBe(404)
      expect(missing.json()).toEqual({ ok: false, error: 'The photo of this collective is missing' })
      await create(app, profile({ email: 'troisieme@example.com' }))
      stored.delete(sizeKey('collectives/photo-2.jpeg', 320))
      const noSize = await request(app, 'GET', '/api/admin/collectives/collective-3/photo?width=320')
      expect(noSize.statusCode).toBe(404)
      expect(noSize.json()).toEqual({ ok: false, error: 'The photo of this collective has no size 320 pixels wide' })
    })
  })

  describe('PUT /api/admin/collectives/:id/photo', () => {
    const PHOTO = '/api/admin/collectives/collective-1/photo'

    it('replaces the photo, deletes the previous one, keeps the profile, and says who changed it', async () => {
      const app = await buildApp()
      await create(app)
      const response = await putPhoto(app, PHOTO)
      expect(response.statusCode).toBe(200)
      expect(response.json().collective).toMatchObject({ name: 'Les Ondes', description: 'Une description.', hasPhoto: true, updatedBy: 'admin@example.com' })
      expect(photos.photos()).toEqual(['collectives/photo-2.png'])
    })

    it('refuses a request without a photo, or one that can\'t be read, in French, leaving the collective as it was', async () => {
      const app = await buildApp()
      await create(app)
      expect((await putPhoto(app, PHOTO, {})).json()).toEqual({ ok: false, error: 'The request has no photo' })
      const unreadable = await putPhoto(app, PHOTO, { photo: UNREADABLE_JPEG })
      expect(unreadable.statusCode).toBe(400)
      expect(unreadable.json().error).toBe('La photo ne peut pas être lue : elle est endommagée, ou dépasse 100 millions de pixels.')
      expect(photos.photos()).toEqual(['collectives/photo-1.jpeg'])
      expect(rows[0]).toMatchObject({ photoKey: 'collectives/photo-1.jpeg', updatedBy: null })
    })

    it('responds 404 for a collective that does not exist, and forgets the photo', async () => {
      const app = await buildApp()
      const response = await putPhoto(app, '/api/admin/collectives/nobody/photo')
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ ok: false, error: 'No such collective' })
      expect(stored.size).toBe(0)
    })
  })

  describe('DELETE /api/admin/collectives/:id/photo', () => {
    it('removes the photo, deletes it, keeps the profile, and says who changed it, even without a photo', async () => {
      const app = await buildApp()
      await create(app)
      await create(app, profile({ name: 'Autres', email: 'autre@example.com' }), null)
      for (const id of ['collective-1', 'collective-2']) {
        const response = await request(app, 'DELETE', `/api/admin/collectives/${id}/photo`)
        expect(response.statusCode).toBe(200)
        expect(response.json().collective).toMatchObject({ hasPhoto: false, updatedBy: 'admin@example.com' })
      }
      expect(rows[0]).toMatchObject({ name: 'Les Ondes', photoKey: null, photoType: null })
      expect(stored.size).toBe(0)
    })

    it('responds 404 for a collective that does not exist', async () => {
      const app = await buildApp()
      expect((await request(app, 'DELETE', '/api/admin/collectives/nobody/photo')).json()).toEqual({ ok: false, error: 'No such collective' })
    })
  })

  describe('PATCH /api/admin/collectives/:id', () => {
    it('changes only the fields it is sent, keeps its members and its photo, and says who changed it', async () => {
      const app = await buildApp()
      await create(app)
      const response = await patch(app, '/api/admin/collectives/collective-1', { description: 'Autre.', email: null })
      expect(response.statusCode).toBe(200)
      expect(response.json().collective).toMatchObject({
        name: 'Les Ondes',
        description: 'Autre.',
        email: null,
        phone: '418 555-0123',
        members: [{ id: 'artist-ana', name: 'Ana' }, { id: 'artist-brume', name: 'Brume' }],
        hasPhoto: true,
        updatedBy: 'admin@example.com',
      })
      expect(store.update).toHaveBeenLastCalledWith('collective-1', { description: 'Autre.', email: null, updatedBy: 'admin@example.com', updatedAt: expect.any(Date) })
    })

    it('replaces its members when they are sent, creating those sent by name', async () => {
      const app = await buildApp()
      await create(app)
      const response = await patch(app, '/api/admin/collectives/collective-1', { members: [{ name: 'Cyan' }, { id: 'artist-ana' }] })
      expect(response.json().collective.members.map(({ name }: { name: string }) => name)).toEqual(['Cyan', 'Ana'])
      expect((await patch(app, '/api/admin/collectives/collective-1', { members: [] })).json()).toEqual({ ok: false, error: 'Indiquez au moins un artiste du collectif.' })
      expect((await patch(app, '/api/admin/collectives/collective-1', { members: [{ id: 'nobody' }] })).json()).toEqual({ ok: false, error: NO_SUCH_MEMBER })
    })

    it("changes every field, as the admin pages' form sends them, keeping the photo", async () => {
      const app = await buildApp()
      await create(app)
      const response = await patch(app, '/api/admin/collectives/collective-1', profile({ description: 'Autre.', members: [{ id: 'artist-brume' }] }))
      expect(response.statusCode).toBe(200)
      expect(response.json().collective).toMatchObject({ description: 'Autre.', members: [{ id: 'artist-brume', name: 'Brume' }], hasPhoto: true })
      expect(rows[0].photoKey).toBe('collectives/photo-1.jpeg')
    })

    it("takes out the contact's email, which frees it for another collective", async () => {
      const app = await buildApp()
      await create(app, profile(), null)
      const response = await patch(app, '/api/admin/collectives/collective-1', { email: ' ' })
      expect(response.statusCode).toBe(200)
      expect(response.json().collective.email).toBeNull()
      const taker = await create(app, profile({ name: 'Autres Ondes' }), null)
      expect(taker.statusCode).toBe(200)
      expect(taker.json().collective.email).toBe('contact@example.com')
    })

    it('takes the members as the collective returns them, ignoring their other fields', async () => {
      const app = await buildApp()
      const created = (await create(app)).json().collective
      const response = await patch(app, '/api/admin/collectives/collective-1', { members: created.members })
      expect(response.json().collective.members).toEqual(created.members)
      const extra = await patch(app, '/api/admin/collectives/collective-1', { members: [{ id: 'artist-ana', name: 'Ana', extra: true }] })
      expect(extra.statusCode).toBe(200)
      expect(extra.json().collective.members).toEqual([{ id: 'artist-ana', name: 'Ana' }])
    })

    it('explains what is wrong, or responds 404 or 409, without changing the collective', async () => {
      const app = await buildApp()
      await create(app)
      await create(app, profile({ name: 'Autres', email: 'autre@example.com' }), null)
      expect((await patch(app, '/api/admin/collectives/collective-1', { email: 'Autre@example.com' })).statusCode).toBe(409)
      expect((await patch(app, '/api/admin/collectives/nobody', { name: 'X' })).statusCode).toBe(404)
      for (const [changes, error] of [
        [{ name: ' ' }, 'Indiquez le nom du collectif.'],
        [{ genres: [] }, 'Unknown field: `genres`'],
        [{ removePhoto: true }, 'Unknown field: `removePhoto`'],
        [{}, 'There must be at least one field to change'],
      ] as const) {
        expect((await patch(app, '/api/admin/collectives/collective-1', changes)).json()).toEqual({ ok: false, error })
      }
      expect(rows[0]).toMatchObject({ updatedBy: null, photoKey: 'collectives/photo-1.jpeg' })
    })
  })

  describe('DELETE /api/admin/collectives/:id', () => {
    it('deletes the collective and its photo, or responds 404 when there is no such collective', async () => {
      const app = await buildApp()
      await create(app)
      const response = await request(app, 'DELETE', '/api/admin/collectives/collective-1')
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ ok: true })
      expect(rows).toHaveLength(0)
      expect(stored.size).toBe(0)
      expect((await request(app, 'DELETE', '/api/admin/collectives/collective-1')).statusCode).toBe(404)
    })

    it('responds 409 while the collective has takeovers, with one of them, and keeps its photo', async () => {
      const app = await buildApp()
      await create(app)
      const takeover: StoredSession = {
        id: 'session-1',
        createdAt: new Date('2026-11-01T12:00:00Z'),
        createdBy: 'admin@example.com',
        startAt: null,
        durationMinutes: 240,
        type: 'takeover',
        name: '',
        takeoverId: 'collective-1',
        takeover: { id: 'collective-1', name: 'Les Ondes' },
        applicationId: null,
        application: null,
        raEventId: null,
        description: '',
        flyerKey: null,
        flyerType: null,
        updatedBy: null,
        updatedAt: null,
        status: 'planned',
        statusUpdatedBy: null,
        statusUpdatedAt: null,
        announced: false,
        announcedUpdatedBy: null,
        announcedUpdatedAt: null,
        sets: [],
      }
      vi.mocked(store.delete).mockRejectedValueOnce(new Conflict(HAS_TAKEOVERS, takeover))
      const response = await request(app, 'DELETE', '/api/admin/collectives/collective-1')
      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({
        ok: false,
        error: 'This collective has takeovers: give them another collective, or another type, first',
        session: expect.objectContaining({ id: 'session-1', type: 'takeover', title: 'LES ONDES TAKEOVER', takeover: { id: 'collective-1', name: 'Les Ondes' } }),
        set: null,
      })
      expect(rows).toHaveLength(1)
      expect(photos.photos()).toHaveLength(1)
    })
  })
})
