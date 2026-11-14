import { Readable } from 'node:stream'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { DrizzleQueryError } from 'drizzle-orm'
import fastifyCookie from '@fastify/cookie'
import { acceptSessions, sessionCookies } from '../admins/test-sessions.js'
import { useZodSchemas } from '../api/schemas.js'
import { PHOTO_MAX_BYTES } from './profile.js'
import type { Profile } from './profile.js'
import { artistsRoutes } from './routes.js'
import { EmailTaken } from './store.js'
import type { ArtistsStore, PhotoFolder, SentPhoto, StoredArtist } from './store.js'
import { inQuebecTime } from '../api/formats.js'

// The artists, as the database would keep them, the ids of each collective's members, in order, and the photos, as the
// bucket would keep them.
let rows: StoredArtist[] = []
let members = new Map<string, string[]>()
const stored = new Map<string, Buffer>()
let nextId = 0
let nextPhoto = 0

// Like the database, where two artists can't have the same email whatever its case, but any number can have none.
function emailTaken(email: string | null, except?: string) {
  return email !== null && rows.some((row) => row.id !== except && row.email?.toLowerCase() === email.toLowerCase())
}

const store: ArtistsStore = {
  list: async (collectiveId) =>
    collectiveId === undefined
      ? [...rows].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
      : (members.get(collectiveId) ?? []).map((id) => rows.find((row) => row.id === id)!),
  get: async (id) => rows.find((row) => row.id === id) ?? null,
  create: vi.fn<ArtistsStore['create']>(async (artist) => {
    if (emailTaken(artist.email)) throw new EmailTaken()
    const row: StoredArtist = { id: `artist-${++nextId}`, createdAt: new Date(), updatedBy: null, updatedAt: null, collectives: [], ...artist }
    rows.push(row)
    return row
  }),
  update: vi.fn<ArtistsStore['update']>(async (id, changes) => {
    const before = rows.find((row) => row.id === id)
    if (!before) return null
    if (emailTaken(changes.email ?? null, id)) throw new EmailTaken()
    const after = { ...before, ...Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)) }
    rows = rows.map((row) => (row.id === id ? after : row))
    return { before, after }
  }),
  delete: async (id) => {
    const row = rows.find((row) => row.id === id)
    rows = rows.filter((other) => other.id !== id)
    return row ?? null
  },
}

const photos = {
  store: vi.fn(async ({ body, type }: SentPhoto, folder: PhotoFolder) => {
    const key = `${folder}/photo-${++nextPhoto}.${type.split('/')[1]}`
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

function profile(changes: Partial<Profile> = {}): Profile {
  return {
    name: 'DJ Test',
    country: 'CA',
    city: 'Québec',
    genres: ['techno', 'acid'],
    bio: 'Une bio.',
    links: { soundcloud: 'https://soundcloud.com/parkingdotradio/wobbla', instagram: '@parking.radio' },
    email: 'artiste@example.com',
    phone: '418 555-0123',
    ...changes,
  }
}

// What admins can leave out of a profile, as it's saved when they do.
const LEFT_OUT: Partial<Profile> = { country: '', city: '', genres: [], bio: '', links: {}, email: null, phone: '' }

// A multipart/form-data body, as adding or changing an artist takes it: the profile as JSON, the photo, and whether to
// remove the photo.
function multipart(artist: object | string, photo: Buffer | null = JPEG, removePhoto = false) {
  const boundary = 'test-boundary'
  const chunks: Buffer[] = [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="artist"\r\n\r\n`),
    Buffer.from(typeof artist === 'string' ? artist : JSON.stringify(artist)),
    Buffer.from('\r\n'),
  ]
  if (removePhoto) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="removePhoto"\r\n\r\ntrue\r\n`))
  if (photo) {
    chunks.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="photo"\r\nContent-Type: image/jpeg\r\n\r\n`),
      photo,
      Buffer.from('\r\n'),
    )
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } }
}

// `logs`, when given, gets every line the app logs.
async function buildApp(logs?: string[]) {
  const app = Fastify(logs ? { logger: { stream: { write: (line: string) => logs.push(line) } } } : {})
  useZodSchemas(app)
  await app.register(fastifyCookie)
  acceptSessions(app)
  await app.register(artistsRoutes, { store, photos })
  return app
}

type App = Awaited<ReturnType<typeof buildApp>>

async function send(app: App, method: 'POST' | 'PUT', url: string, artist: object | string, photo?: Buffer | null, removePhoto?: boolean) {
  return app.inject({ method, url, ...multipart(artist, photo, removePhoto), cookies: await sessionCookies() })
}

async function create(app: App, artist: object | string = profile(), photo?: Buffer | null) {
  return send(app, 'POST', '/api/admin/artists', artist, photo)
}

// Changes some of the artist's fields, as JSON.
async function patch(app: App, url: string, changes: unknown) {
  return app.inject({ method: 'PATCH', url, payload: JSON.stringify(changes), headers: { 'content-type': 'application/json' }, cookies: await sessionCookies() })
}

async function get(app: App, url: string, headers: Record<string, string> = {}) {
  return app.inject({ method: 'GET', url, headers, cookies: await sessionCookies() })
}

describe('artists routes', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
    rows = []
    members = new Map()
    stored.clear()
    nextId = 0
    nextPhoto = 0
    vi.clearAllMocks()
  })

  afterEach(() => {
    delete process.env.JWT_SECRET
  })

  it('requires a session', async () => {
    const app = await buildApp()
    const requests = [
      app.inject({ method: 'GET', url: '/api/admin/artists' }),
      app.inject({ method: 'GET', url: '/api/admin/artists/artist-1' }),
      app.inject({ method: 'GET', url: '/api/admin/artists/artist-1/photo' }),
      app.inject({ method: 'POST', url: '/api/admin/artists', ...multipart(profile()) }),
      app.inject({ method: 'PUT', url: '/api/admin/artists/artist-1', ...multipart(profile()) }),
      app.inject({ method: 'PATCH', url: '/api/admin/artists/artist-1', payload: { name: 'X' } }),
      app.inject({ method: 'DELETE', url: '/api/admin/artists/artist-1' }),
    ]
    for (const response of await Promise.all(requests)) {
      expect(response.statusCode).toBe(401)
    }
    expect(photos.store).not.toHaveBeenCalled()
  })

  it('requires a session before reading the request, whatever it sends', async () => {
    const app = await buildApp()
    for (const [method, url] of [
      ['POST', '/api/admin/artists'],
      ['PUT', '/api/admin/artists/artist-1'],
    ] as const) {
      for (const sent of [multipart('{not json'), { payload: 'null', headers: { 'content-type': 'application/json' } }, { payload: '{', headers: { 'content-type': 'application/json' } }]) {
        const response = await app.inject({ method, url, ...sent })
        expect(response.statusCode).toBe(401)
        expect(response.json()).toEqual({ ok: false, error: 'Unauthorized' })
      }
    }
  })

  it('refuses the requests that change artists from another origin', async () => {
    const app = await buildApp()
    const cookies = await sessionCookies()
    const headers = { 'sec-fetch-site': 'cross-site' }
    const requests = [
      app.inject({ method: 'POST', url: '/api/admin/artists', ...multipart(profile()), headers: { ...multipart(profile()).headers, ...headers }, cookies }),
      app.inject({ method: 'PUT', url: '/api/admin/artists/artist-1', ...multipart(profile()), headers: { ...multipart(profile()).headers, ...headers }, cookies }),
      app.inject({ method: 'PATCH', url: '/api/admin/artists/artist-1', payload: { name: 'X' }, headers, cookies }),
      app.inject({ method: 'DELETE', url: '/api/admin/artists/artist-1', headers, cookies }),
    ]
    for (const response of await Promise.all(requests)) {
      expect(response.statusCode).toBe(403)
      expect(response.json()).toEqual({ ok: false, error: 'Cross-origin request refused' })
    }
    expect(photos.store).not.toHaveBeenCalled()
  })

  describe('POST /api/admin/artists', () => {
    it('adds the artist with their photo, and returns them', async () => {
      const app = await buildApp()
      const response = await create(app)

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        ok: true,
        artist: {
          ...profile(),
          // Only the profile names are kept.
          links: { soundcloud: 'parkingdotradio', instagram: 'parking.radio' },
          id: 'artist-1',
          hasPhoto: true,
          createdAt: inQuebecTime(rows[0].createdAt),
          createdBy: 'admin@example.com',
          updatedBy: null,
          updatedAt: null,
          collectives: [],
        },
      })
      expect(photos.store).toHaveBeenCalledWith({ body: JPEG, type: 'image/jpeg' }, 'artists')
      expect(rows[0]).toMatchObject({ photoKey: 'artists/photo-1.jpeg', photoType: 'image/jpeg' })
    })

    it('adds an artist without a photo', async () => {
      const app = await buildApp()
      const response = await create(app, profile(), null)
      expect(response.statusCode).toBe(200)
      expect(response.json().artist).toMatchObject({ id: 'artist-1', hasPhoto: false })
      expect(rows[0]).toMatchObject({ photoKey: null, photoType: null })
      expect(photos.store).not.toHaveBeenCalled()
    })

    it('adds an artist without a country, city, genres, bio, links, email or phone, e.g. one who applied through the original Google Form', async () => {
      const app = await buildApp()
      const response = await create(app, profile(LEFT_OUT), null)
      expect(response.statusCode).toBe(200)
      expect(response.json().artist).toMatchObject(LEFT_OUT)
      expect(rows[0]).toMatchObject(LEFT_OUT)
    })

    it('adds any number of artists without an email, whether it is left out, null or blank', async () => {
      const app = await buildApp()
      // JSON leaves out undefined fields.
      for (const sent of [{ ...profile(), email: undefined }, profile({ email: null }), { ...profile(), email: '  ' }]) {
        const response = await create(app, sent, null)
        expect(response.statusCode).toBe(200)
        expect(response.json().artist.email).toBeNull()
      }
      expect(rows.map((row) => row.email)).toEqual([null, null, null])
    })

    it('refuses an email another artist has, whatever its case, and forgets the photo', async () => {
      const app = await buildApp()
      expect((await create(app)).statusCode).toBe(200)
      const response = await create(app, profile({ email: 'Artiste@Example.com' }), PNG)
      expect(response.statusCode).toBe(409)
      expect(rows).toHaveLength(1)
      expect([...stored.keys()]).toEqual(['artists/photo-1.jpeg'])
    })

    it('explains, in French, what is wrong with an invalid profile, without storing the photo', async () => {
      const app = await buildApp()
      const response = await create(app, profile({ links: { soundcloud: 'https://instagram.com/foo' } }))
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error: "SoundCloud : ce n'est pas une adresse SoundCloud." })
      expect(photos.store).not.toHaveBeenCalled()
      expect(rows).toHaveLength(0)
    })

    it('explains what is wrong with a profile that is not one, or has a field of the wrong type, as before', async () => {
      const app = await buildApp()
      const errors = async (artist: unknown) => (await create(app, JSON.stringify(artist), null)).json()
      for (const artist of [null, 'DJ Test', 42, [], {}]) {
        expect(await errors(artist)).toEqual({ ok: false, error: "Indiquez le nom d'artiste." })
      }
      expect(await errors(profile({ name: 42 as never }))).toEqual({ ok: false, error: "Indiquez le nom d'artiste." })
      expect(await errors(profile({ phone: 4185550123 as never }))).toEqual({ ok: false, error: 'Indiquez votre numéro de téléphone.' })
      expect(await errors(profile({ links: { myspace: 'dj' } as never }))).toEqual({ ok: false, error: 'Un des liens est invalide.' })
      expect(rows).toHaveLength(0)
    })

    it('checks that a photo really is an image', async () => {
      const app = await buildApp()
      const notAnImage = await create(app, profile(), Buffer.from('%PDF-1.7'))
      expect(notAnImage.statusCode).toBe(400)
      expect(notAnImage.json()).toEqual({ ok: false, error: 'La photo doit être en JPEG, PNG ou WebP.' })
      expect(photos.store).not.toHaveBeenCalled()
      expect(rows).toHaveLength(0)
    })

    it('refuses photos over the size limit', async () => {
      const app = await buildApp()
      const response = await create(app, profile(), Buffer.concat([JPEG, Buffer.alloc(PHOTO_MAX_BYTES)]))
      expect(response.statusCode).toBe(413)
      expect(response.json()).toEqual({ ok: false, error: 'La photo dépasse 10 Mo.' })
      expect(rows).toHaveLength(0)
    })

    it('takes photos up to the size limit, beyond the default limit on bodies', async () => {
      const app = await buildApp()
      const response = await create(app, profile(), Buffer.concat([JPEG, Buffer.alloc(PHOTO_MAX_BYTES - JPEG.length)]))
      expect(response.statusCode).toBe(200)
    })

    it('ignores fields other than the profile, e.g. a submit button', async () => {
      const app = await buildApp()
      const { payload, headers } = multipart(profile())
      const extra = Buffer.from('--test-boundary\r\nContent-Disposition: form-data; name="submit"\r\n\r\nEnregistrer\r\n')
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/artists',
        payload: Buffer.concat([extra, payload]),
        headers,
        cookies: await sessionCookies(),
      })
      expect(response.statusCode).toBe(200)
    })

    it("refuses the profile's fields it doesn't take, naming them, without storing the photo", async () => {
      const app = await buildApp()
      const response = await create(app, { ...profile(), id: 'artist-9', hasPhoto: true })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error: 'Unknown fields: `id`, `hasPhoto`' })
      expect(photos.store).not.toHaveBeenCalled()
    })

    it('refuses more than one photo, without storing any', async () => {
      const app = await buildApp()
      const { payload, headers } = multipart(profile())
      const second = Buffer.from('--test-boundary\r\nContent-Disposition: form-data; name="photo"; filename="photo"\r\nContent-Type: image/png\r\n\r\n')
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/artists',
        payload: Buffer.concat([second, PNG, Buffer.from('\r\n'), payload]),
        headers,
        cookies: await sessionCookies(),
      })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error: 'Invalid request' })
      expect(photos.store).not.toHaveBeenCalled()
      expect(rows).toHaveLength(0)
    })

    it('treats an empty photo, as a form sends when no file was chosen, as no photo', async () => {
      const app = await buildApp()
      const response = await create(app, profile(), Buffer.alloc(0))
      expect(response.statusCode).toBe(200)
      expect(response.json().artist).toMatchObject({ hasPhoto: false })
      expect(photos.store).not.toHaveBeenCalled()
    })

    it('rejects malformed requests', async () => {
      const app = await buildApp()
      const cookies = await sessionCookies()
      const multipartHeaders = { 'content-type': 'multipart/form-data; boundary=test-boundary' }
      const malformed = [
        await create(app, '{not json'),
        await app.inject({ method: 'POST', url: '/api/admin/artists', payload: profile(), cookies }),
        // A body that ends early.
        await app.inject({
          method: 'POST',
          url: '/api/admin/artists',
          payload: '--test-boundary\r\nContent-Disposition: form-data; name="artist"\r\n\r\n{"name":',
          headers: multipartHeaders,
          cookies,
        }),
        // Without a boundary.
        await app.inject({ method: 'POST', url: '/api/admin/artists', payload: 'x', headers: { 'content-type': 'multipart/form-data' }, cookies }),
        // Without the profile.
        await app.inject({ method: 'POST', url: '/api/admin/artists', payload: '--test-boundary--\r\n', headers: multipartHeaders, cookies }),
      ]
      for (const response of malformed) {
        expect(response.statusCode).toBe(400)
        expect(response.json()).toMatchObject({ ok: false })
      }
      expect(rows).toHaveLength(0)
    })

    it('forgets the photo when the artist cannot be saved', async () => {
      vi.mocked(store.create).mockRejectedValueOnce(new Error('database is down'))
      const app = await buildApp()
      expect((await create(app)).statusCode).toBe(500)
      expect(stored.size).toBe(0)
    })

    it("keeps the artist's personal data out of the logs and the response when the database fails", async () => {
      const cause = Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' })
      const query = 'insert into "artists" ("email", "phone") values ($1, $2)'
      vi.mocked(store.create).mockRejectedValueOnce(new DrizzleQueryError(query, ['artiste@example.com', '418 555-0123'], cause))
      const logs: string[] = []
      const app = await buildApp(logs)
      const response = await create(app)
      expect(response.statusCode).toBe(500)
      expect(response.json()).toEqual({ ok: false, error: 'Internal server error' })
      expect(logs.join('')).toContain('terminating connection due to administrator command')
      expect(logs.join('')).toContain('57P01')
      expect(logs.join('')).not.toContain('artiste@example.com')
      expect(logs.join('')).not.toContain('418 555-0123')
    })
  })

  describe('GET /api/admin/artists', () => {
    it('lists the artists by name', async () => {
      const app = await buildApp()
      await create(app, profile({ name: 'zoé', email: 'zoe@example.com' }))
      await create(app, profile({ name: 'Ana', email: 'ana@example.com' }))
      const response = await get(app, '/api/admin/artists')
      expect(response.statusCode).toBe(200)
      expect(response.json().artists.map((artist: { name: string }) => artist.name)).toEqual(['Ana', 'zoé'])
      expect(response.json().total).toBe(2)
    })

    it("lists a collective's members, in its order, or none for an unknown collective", async () => {
      const app = await buildApp()
      await create(app, profile({ name: 'Ana', email: 'ana@example.com' }))
      await create(app, profile({ name: 'zoé', email: 'zoe@example.com' }))
      await create(app, profile({ name: 'Brume', email: 'brume@example.com' }))
      members.set('collective-1', ['artist-2', 'artist-1'])
      const response = await get(app, '/api/admin/artists?collective=collective-1')
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ ok: true, total: 2, artists: [rows[1], rows[0]].map((row) => expect.objectContaining({ id: row.id, name: row.name })) })
      expect((await get(app, '/api/admin/artists?collective=collective-2')).json()).toEqual({ ok: true, total: 0, artists: [] })
    })

    it('refuses more than one collective', async () => {
      const app = await buildApp()
      const response = await get(app, '/api/admin/artists?collective=collective-1&collective=collective-2')
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error: '`collective`: Must be a single id' })
    })
  })

  describe('GET /api/admin/artists/:id', () => {
    it('returns the artist', async () => {
      const app = await buildApp()
      const created = (await create(app)).json().artist
      const response = await get(app, `/api/admin/artists/${created.id}`)
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ ok: true, artist: created })
    })

    it('returns the collectives the artist is in', async () => {
      const app = await buildApp()
      await create(app)
      const collectives = [{ id: 'collective-1', name: 'Ondes' }]
      rows[0].collectives = collectives
      expect((await get(app, '/api/admin/artists/artist-1')).json().artist.collectives).toEqual(collectives)
    })

    it('responds 404 for an artist that does not exist', async () => {
      const app = await buildApp()
      expect((await get(app, '/api/admin/artists/nobody')).statusCode).toBe(404)
    })
  })

  describe('GET /api/admin/artists/:id/photo', () => {
    const PHOTO = '/api/admin/artists/artist-1/photo'

    it('returns the photo with the type it was checked to have, which browsers keep for the admin, and check again', async () => {
      const app = await buildApp()
      await create(app, profile(), PNG)
      const response = await get(app, PHOTO)
      expect(response.statusCode).toBe(200)
      expect(response.rawPayload).toEqual(PNG)
      expect(response.headers['content-type']).toBe('image/png')
      expect(response.headers['x-content-type-options']).toBe('nosniff')
      expect(response.headers['cache-control']).toBe('private, no-cache')
      expect(response.headers.etag).toMatch(/^"[^"]+"$/)
    })

    it('responds 304 without the photo when the request has its ETag, even weakened or in a list', async () => {
      const app = await buildApp()
      await create(app, profile(), PNG)
      const etag = (await get(app, PHOTO)).headers.etag as string
      photos.read.mockClear()
      for (const ifNoneMatch of [etag, `W/${etag}`, `"other", ${etag}`, `W/"other",W/${etag}`]) {
        const response = await get(app, PHOTO, { 'if-none-match': ifNoneMatch })
        expect(response.statusCode).toBe(304)
        expect(response.rawPayload).toHaveLength(0)
        expect(response.headers).toMatchObject({ etag, 'cache-control': 'private, no-cache' })
        expect(response.headers).not.toHaveProperty('content-type')
      }
      expect(photos.read).not.toHaveBeenCalled()

      const other = await get(app, PHOTO, { 'if-none-match': '"other"' })
      expect(other.statusCode).toBe(200)
      expect(other.rawPayload).toEqual(PNG)
    })

    it('gives a new photo another ETag, and the replaced or removed one no longer gets a 304', async () => {
      const app = await buildApp()
      await create(app, profile(), PNG)
      const etag = (await get(app, PHOTO)).headers.etag as string
      await send(app, 'PUT', '/api/admin/artists/artist-1', profile(), JPEG)
      const replaced = await get(app, PHOTO, { 'if-none-match': etag })
      expect(replaced.statusCode).toBe(200)
      expect(replaced.rawPayload).toEqual(JPEG)
      expect(replaced.headers.etag).not.toBe(etag)

      await patch(app, '/api/admin/artists/artist-1', { removePhoto: true })
      const removed = await get(app, PHOTO, { 'if-none-match': replaced.headers.etag as string })
      expect(removed.statusCode).toBe(404)
      expect(removed.json()).toEqual({ ok: false, error: 'This artist has no photo' })
    })

    it('responds 404 for an artist that does not exist, or whose photo is missing, unless the request has its ETag', async () => {
      const logs: string[] = []
      const app = await buildApp(logs)
      expect((await get(app, '/api/admin/artists/nobody/photo')).statusCode).toBe(404)
      await create(app)
      const etag = (await get(app, PHOTO)).headers.etag as string
      stored.clear()
      const kept = await get(app, PHOTO, { 'if-none-match': etag })
      expect(kept.statusCode).toBe(304)
      expect(logs.join('')).not.toContain('"level":50')

      const missing = await get(app, PHOTO)
      expect(missing.statusCode).toBe(404)
      expect(missing.json()).toEqual({ ok: false, error: 'The photo of this artist is missing' })
      expect(missing.headers).not.toHaveProperty('etag')
      expect(logs.join('')).toContain('"level":50')
    })

    it('responds 404 for an artist who has no photo, which is not an error worth logging, whatever the request has', async () => {
      const logs: string[] = []
      const app = await buildApp(logs)
      await create(app, profile(), null)
      const response = await get(app, PHOTO)
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ ok: false, error: 'This artist has no photo' })
      expect((await get(app, PHOTO, { 'if-none-match': '"anything"' })).statusCode).toBe(404)
      expect(photos.read).not.toHaveBeenCalled()
      expect(logs.join('')).not.toContain('"level":50')
    })
  })

  describe('PUT /api/admin/artists/:id', () => {
    it('replaces the profile, keeps the photo when none is sent, and says who changed it', async () => {
      const app = await buildApp()
      await create(app)
      const response = await send(app, 'PUT', '/api/admin/artists/artist-1', profile({ bio: 'Une nouvelle bio.', city: 'Lévis' }), null)

      expect(response.statusCode).toBe(200)
      expect(response.json().artist).toMatchObject({ id: 'artist-1', bio: 'Une nouvelle bio.', city: 'Lévis', updatedBy: 'admin@example.com' })
      expect(response.json().artist.updatedAt).toEqual(expect.any(String))
      expect(rows[0]).toMatchObject({ bio: 'Une nouvelle bio.', photoKey: 'artists/photo-1.jpeg' })
      expect(photos.delete).not.toHaveBeenCalled()
    })

    it("takes out the artist's country, city, genres, bio, links, email and phone", async () => {
      const app = await buildApp()
      await create(app)
      const response = await send(app, 'PUT', '/api/admin/artists/artist-1', profile(LEFT_OUT), null)
      expect(response.statusCode).toBe(200)
      expect(response.json().artist).toMatchObject(LEFT_OUT)
    })

    it('frees the email it takes out for another artist', async () => {
      const app = await buildApp()
      await create(app, profile(), null)
      expect((await send(app, 'PUT', '/api/admin/artists/artist-1', { ...profile(), email: ' ' }, null)).json().artist.email).toBeNull()
      const response = await create(app, profile({ name: 'Autre DJ' }), null)
      expect(response.statusCode).toBe(200)
      expect(response.json().artist.email).toBe('artiste@example.com')
    })

    it('keeps the photo when the photo sent is empty, as a form sends when no file was chosen', async () => {
      const app = await buildApp()
      await create(app)
      const response = await send(app, 'PUT', '/api/admin/artists/artist-1', profile({ bio: 'Une nouvelle bio.' }), Buffer.alloc(0))
      expect(response.statusCode).toBe(200)
      expect(rows[0]).toMatchObject({ bio: 'Une nouvelle bio.', photoKey: 'artists/photo-1.jpeg' })
      expect(photos.store).toHaveBeenCalledTimes(1)
    })

    it('ignores files sent as anything but the photo, with or without a photo', async () => {
      const app = await buildApp()
      await create(app)
      const file = Buffer.from('--test-boundary\r\nContent-Disposition: form-data; name="other"; filename="x"\r\n\r\nxyz\r\n')
      const put = async (photo: Buffer | null) => {
        const { payload, headers } = multipart(profile({ bio: 'Une nouvelle bio.' }), photo)
        return app.inject({ method: 'PUT', url: '/api/admin/artists/artist-1', payload: Buffer.concat([file, payload]), headers, cookies: await sessionCookies() })
      }
      expect((await put(null)).statusCode).toBe(200)
      expect(rows[0]).toMatchObject({ bio: 'Une nouvelle bio.', photoKey: 'artists/photo-1.jpeg' })
      expect((await put(PNG)).statusCode).toBe(200)
      expect(rows[0]).toMatchObject({ photoKey: 'artists/photo-2.png' })
    })

    it('takes the profile in a part that says it is JSON', async () => {
      const app = await buildApp()
      await create(app)
      const { payload, headers } = multipart(profile({ bio: 'Une nouvelle bio.' }), null)
      const json = Buffer.from(payload.toString('latin1').replace('name="artist"\r\n', 'name="artist"\r\nContent-Type: application/json\r\n'), 'latin1')
      const response = await app.inject({ method: 'PUT', url: '/api/admin/artists/artist-1', payload: json, headers, cookies: await sessionCookies() })
      expect(response.statusCode).toBe(200)
      expect(rows[0]).toMatchObject({ bio: 'Une nouvelle bio.' })
    })

    it('replaces the photo when one is sent, and deletes the previous one', async () => {
      const app = await buildApp()
      await create(app)
      const response = await send(app, 'PUT', '/api/admin/artists/artist-1', profile(), PNG)
      expect(response.statusCode).toBe(200)
      expect(rows[0]).toMatchObject({ photoKey: 'artists/photo-2.png', photoType: 'image/png' })
      expect([...stored.keys()]).toEqual(['artists/photo-2.png'])
    })

    it('gives a photo to an artist who had none', async () => {
      const app = await buildApp()
      await create(app, profile(), null)
      const response = await send(app, 'PUT', '/api/admin/artists/artist-1', profile(), PNG)
      expect(response.statusCode).toBe(200)
      expect(response.json().artist).toMatchObject({ hasPhoto: true })
      expect(rows[0]).toMatchObject({ photoKey: 'artists/photo-1.png', photoType: 'image/png' })
      expect(photos.delete).not.toHaveBeenCalled()
    })

    it('removes the photo when asked to, and deletes it', async () => {
      const app = await buildApp()
      await create(app)
      const response = await send(app, 'PUT', '/api/admin/artists/artist-1', profile(), null, true)
      expect(response.statusCode).toBe(200)
      expect(response.json().artist).toMatchObject({ hasPhoto: false, updatedBy: 'admin@example.com' })
      expect(rows[0]).toMatchObject({ photoKey: null, photoType: null })
      expect(stored.size).toBe(0)
    })

    it('removes nothing from an artist who has no photo', async () => {
      const app = await buildApp()
      await create(app, profile(), null)
      expect((await send(app, 'PUT', '/api/admin/artists/artist-1', profile(), null, true)).statusCode).toBe(200)
      expect(rows[0]).toMatchObject({ photoKey: null, photoType: null })
      expect(photos.delete).not.toHaveBeenCalled()
    })

    it('keeps the photo when it cannot be removed, e.g. for an email that is taken, or an artist who does not exist', async () => {
      const app = await buildApp()
      await create(app)
      await create(app, profile({ email: 'other@example.com' }), null)
      const taken = await send(app, 'PUT', '/api/admin/artists/artist-1', profile({ email: 'other@example.com' }), null, true)
      expect(taken.statusCode).toBe(409)
      expect((await send(app, 'PUT', '/api/admin/artists/nobody', profile(), null, true)).statusCode).toBe(404)
      expect(rows[0]).toMatchObject({ photoKey: 'artists/photo-1.jpeg', photoType: 'image/jpeg' })
      expect([...stored.keys()]).toEqual(['artists/photo-1.jpeg'])
      expect(photos.delete).not.toHaveBeenCalled()
    })

    it('refuses both a photo and removing it, without storing anything', async () => {
      const app = await buildApp()
      await create(app)
      const response = await send(app, 'PUT', '/api/admin/artists/artist-1', profile(), PNG, true)
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error: 'Invalid request' })
      expect(photos.store).toHaveBeenCalledTimes(1)
      expect(rows[0]).toMatchObject({ photoKey: 'artists/photo-1.jpeg', updatedBy: null })
    })

    it("changes the email, unless it's another artist's", async () => {
      const app = await buildApp()
      await create(app)
      await create(app, profile({ email: 'other@example.com' }))

      // The artist's own email, in another case, is fine.
      expect((await send(app, 'PUT', '/api/admin/artists/artist-1', profile({ email: 'ARTISTE@example.com' }), null)).statusCode).toBe(200)
      const taken = await send(app, 'PUT', '/api/admin/artists/artist-1', profile({ email: 'Other@Example.com' }), PNG)
      expect(taken.statusCode).toBe(409)
      expect(rows[0].email).toBe('ARTISTE@example.com')
      // The photo that came with it is forgotten, and the artist keeps theirs.
      expect([...stored.keys()]).toEqual(['artists/photo-1.jpeg', 'artists/photo-2.jpeg'])
    })

    it('forgets the new photo when the artist cannot be saved, and keeps theirs', async () => {
      const app = await buildApp()
      await create(app)
      vi.mocked(store.update).mockRejectedValueOnce(new Error('database is down'))
      expect((await send(app, 'PUT', '/api/admin/artists/artist-1', profile(), PNG)).statusCode).toBe(500)
      expect([...stored.keys()]).toEqual(['artists/photo-1.jpeg'])
    })

    it('changes the artist even when their previous photo cannot be deleted', async () => {
      const app = await buildApp()
      await create(app)
      photos.delete.mockRejectedValueOnce(new Error('S3 is down'))
      const response = await send(app, 'PUT', '/api/admin/artists/artist-1', profile(), PNG)
      expect(response.statusCode).toBe(200)
      expect(rows[0]).toMatchObject({ photoKey: 'artists/photo-2.png' })
    })

    it('responds 404 for an artist that does not exist, and forgets the photo', async () => {
      const app = await buildApp()
      const response = await send(app, 'PUT', '/api/admin/artists/nobody', profile(), JPEG)
      expect(response.statusCode).toBe(404)
      expect(stored.size).toBe(0)
    })

    it('checks the profile and photo like when adding an artist', async () => {
      const app = await buildApp()
      await create(app)
      expect((await send(app, 'PUT', '/api/admin/artists/artist-1', profile({ genres: ['polka' as never] }), null)).statusCode).toBe(400)
      expect((await send(app, 'PUT', '/api/admin/artists/artist-1', profile(), Buffer.from('%PDF-1.7'))).statusCode).toBe(400)
      expect(rows[0].updatedBy).toBeNull()
    })
  })

  describe('PATCH /api/admin/artists/:id', () => {
    it('changes only the fields it is sent, keeps the others and the photo, and says who changed it', async () => {
      const app = await buildApp()
      await create(app)
      const response = await patch(app, '/api/admin/artists/artist-1', { bio: '  Une nouvelle bio. ', links: { web: 'example.com' } })
      expect(response.statusCode).toBe(200)
      expect(response.json().artist).toMatchObject({
        ...profile({ bio: 'Une nouvelle bio.', links: { web: 'https://example.com' } }),
        hasPhoto: true,
        updatedBy: 'admin@example.com',
      })
      expect(response.json().artist.updatedAt).toEqual(expect.any(String))
      expect(store.update).toHaveBeenCalledWith('artist-1', { bio: 'Une nouvelle bio.', links: { web: 'https://example.com' }, updatedBy: 'admin@example.com', updatedAt: expect.any(Date) })
      expect(photos.store).toHaveBeenCalledTimes(1)
    })

    it('removes the fields sent as null or blank, as when they are left out of a profile', async () => {
      const app = await buildApp()
      await create(app)
      const response = await patch(app, '/api/admin/artists/artist-1', { country: null, city: ' ', genres: null, bio: '', links: {}, email: null, phone: '' })
      expect(response.statusCode).toBe(200)
      expect(response.json().artist).toMatchObject({ name: 'DJ Test', ...LEFT_OUT })
    })

    it('removes the photo when asked to, and deletes it, or keeps it', async () => {
      const app = await buildApp()
      await create(app)
      expect((await patch(app, '/api/admin/artists/artist-1', { removePhoto: false })).json().artist.hasPhoto).toBe(true)
      expect(stored.size).toBe(1)
      const response = await patch(app, '/api/admin/artists/artist-1', { removePhoto: true })
      expect(response.statusCode).toBe(200)
      expect(response.json().artist).toMatchObject({ name: 'DJ Test', bio: 'Une bio.', hasPhoto: false })
      expect(stored.size).toBe(0)
    })

    it("refuses an email that's another artist's, and an artist that doesn't exist, keeping the photo", async () => {
      const app = await buildApp()
      await create(app)
      await create(app, profile({ email: 'other@example.com' }), null)
      const taken = await patch(app, '/api/admin/artists/artist-1', { email: 'Other@example.com', removePhoto: true })
      expect(taken.statusCode).toBe(409)
      expect(taken.json()).toEqual({ ok: false, error: 'Another artist has this email address' })
      expect((await patch(app, '/api/admin/artists/nobody', { name: 'X' })).statusCode).toBe(404)
      expect(stored.size).toBe(1)
    })

    it('explains what is wrong, the profile in French, without changing the artist', async () => {
      const app = await buildApp()
      await create(app)
      const invalid = [
        [{ name: '' }, "Indiquez le nom d'artiste."],
        [{ genres: ['polka'] }, "Un des genres n'est pas dans la liste."],
        [{ name: 'X\u0000' }, "Le nom d'artiste contient un caractère invalide."],
        [{ name: 'X', hasPhoto: false }, 'Unknown field: `hasPhoto`'],
        [{ removePhoto: 'true' }, '« removePhoto » doit être true ou false.'],
        [{}, 'There must be at least one field to change'],
        [null, 'The changes must be an object with the fields to change'],
      ] as const
      for (const [changes, error] of invalid) {
        const response = await patch(app, '/api/admin/artists/artist-1', changes)
        expect(response.statusCode, JSON.stringify(changes)).toBe(400)
        expect(response.json()).toEqual({ ok: false, error })
      }
      expect(rows[0].updatedBy).toBeNull()
    })

    it('refuses a multipart request, which only PUT takes', async () => {
      const app = await buildApp()
      await create(app)
      const response = await app.inject({ method: 'PATCH', url: '/api/admin/artists/artist-1', ...multipart(profile(), PNG), cookies: await sessionCookies() })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error: 'The changes must be an object with the fields to change' })
      expect(photos.store).toHaveBeenCalledTimes(1)
    })
  })

  describe('DELETE /api/admin/artists/:id', () => {
    it('deletes the artist and their photo', async () => {
      const app = await buildApp()
      await create(app)
      const response = await app.inject({ method: 'DELETE', url: '/api/admin/artists/artist-1', cookies: await sessionCookies() })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ ok: true })
      expect(rows).toHaveLength(0)
      expect(stored.size).toBe(0)
    })

    it('deletes an artist who has no photo', async () => {
      const app = await buildApp()
      await create(app, profile(), null)
      const response = await app.inject({ method: 'DELETE', url: '/api/admin/artists/artist-1', cookies: await sessionCookies() })
      expect(response.statusCode).toBe(200)
      expect(rows).toHaveLength(0)
      expect(photos.delete).not.toHaveBeenCalled()
    })

    it('deletes the artist even when their photo cannot be deleted', async () => {
      photos.delete.mockRejectedValueOnce(new Error('S3 is down'))
      const app = await buildApp()
      await create(app)
      const response = await app.inject({ method: 'DELETE', url: '/api/admin/artists/artist-1', cookies: await sessionCookies() })
      expect(response.statusCode).toBe(200)
      expect(rows).toHaveLength(0)
    })

    it('responds 404 for an artist that does not exist', async () => {
      const app = await buildApp()
      const response = await app.inject({ method: 'DELETE', url: '/api/admin/artists/nobody', cookies: await sessionCookies() })
      expect(response.statusCode).toBe(404)
    })
  })
})
