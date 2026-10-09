import { beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { DrizzleQueryError } from 'drizzle-orm'
import type { ApplicationFields } from 'shared/applications'
import { PHOTO_MAX_BYTES } from 'shared/artists'
import type { ArtistProfile } from 'shared/artists'
import type { StoredApplication } from '../applications.js'
import type { ApplicationsSettingsStore } from '../applications-settings.js'
import type { ApplyStore } from '../apply.js'
import { EmailTaken } from '../artists.js'
import type { SentPhoto, StoredArtist } from '../artists.js'
import { EmailNotSent } from '../email.js'
import type { SendEmail } from '../email.js'
import type { TurnstileVerifier } from '../turnstile.js'
import { APPLICATIONS_PER_WINDOW, applyRoutes } from './apply.js'

// The artists and applications, as the database would keep them, and the photos, as the bucket would.
let artists: StoredArtist[] = []
let applications: StoredApplication[] = []
const stored = new Map<string, Buffer>()
let nextId = 0
let nextPhoto = 0

// Like the database, which knows artists by their email whatever its case.
const store: ApplyStore = {
  apply: vi.fn<ApplyStore['apply']>(async (artist, fields) => {
    if (artists.some((other) => other.email.toLowerCase() === artist.email.toLowerCase())) throw new EmailTaken()
    const applicant: StoredArtist = { id: `artist-${++nextId}`, createdAt: new Date(), createdBy: null, updatedBy: null, updatedAt: null, ...artist }
    artists.push(applicant)
    const application: StoredApplication = {
      id: `application-${++nextId}`,
      createdAt: new Date(),
      createdBy: null,
      artistId: applicant.id,
      updatedBy: null,
      updatedAt: null,
      status: 'new',
      statusUpdatedBy: null,
      statusUpdatedAt: null,
      ...fields,
    }
    applications.push(application)
    return { artistId: applicant.id, applicationId: application.id }
  }),
}

const photos = {
  store: vi.fn(async ({ body, type }: SentPhoto) => {
    const key = `artists/photo-${++nextPhoto}.${type.split('/')[1]}`
    stored.set(key, body)
    return key
  }),
  delete: vi.fn(async (key: string) => {
    stored.delete(key)
  }),
}

// Vouches for every token but "refused".
const verifyTurnstile = vi.fn<TurnstileVerifier>(async (token) =>
  token && token !== 'refused' ? { success: true } : { success: false, errorCodes: ['invalid-input-response'] },
)

// Who applications are emailed to, as chosen on the admin pages.
let recipients: string[] | null = null
const settings: Pick<ApplicationsSettingsStore, 'load'> = {
  load: vi.fn(async () => (recipients ? { recipients, updatedBy: 'admin@example.com', updatedAt: new Date() } : null)),
}
const sendEmail = vi.fn<SendEmail>(async () => {})

// The smallest things that start like a JPEG and a PNG file.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])

function profile(changes: Partial<ArtistProfile> = {}): ArtistProfile {
  return {
    kind: 'artist',
    name: 'DJ Test',
    members: [],
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

function fields(changes: Partial<ApplicationFields> = {}): ApplicationFields {
  return {
    dates: ['2027-01-15', '2027-01-08'],
    timeSlots: [{ start: '18:00', end: '22:00' }],
    prestations: ['dj'],
    otherPrestation: '',
    details: 'Une question.',
    ...changes,
  }
}

// Other parts, after the usual ones: fields, or files when they have a file name.
type ExtraPart = { name: string; value: string | Buffer; filename?: string }
type Parts = { artist?: object | string; application?: object | string; turnstileToken?: string; photo?: Buffer | null; extra?: ExtraPart[] }

// A multipart/form-data body, as applying takes it: the profile and the application as JSON, the token, and the photo.
// Parts set to undefined are left out.
function multipart(parts: Parts = {}) {
  const { artist, application, turnstileToken, photo, extra } = {
    artist: profile(),
    application: fields(),
    turnstileToken: 'token',
    photo: JPEG,
    extra: [],
    ...parts,
  }
  const boundary = 'test-boundary'
  const chunks: Buffer[] = []
  const field = (name: string, value: object | string | undefined) => {
    if (value === undefined) return
    chunks.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n`),
      Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)),
      Buffer.from('\r\n'),
    )
  }
  field('artist', artist)
  field('application', application)
  field('turnstileToken', turnstileToken)
  if (photo) {
    chunks.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="photo"\r\nContent-Type: image/jpeg\r\n\r\n`),
      photo,
      Buffer.from('\r\n'),
    )
  }
  for (const { name, value, filename } of extra) {
    const file = filename ? `; filename="${filename}"\r\nContent-Type: application/octet-stream` : ''
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"${file}\r\n\r\n`), Buffer.from(value), Buffer.from('\r\n'))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } }
}

// `logs`, when given, gets every line the app logs. Without `canEmail`, the server can't send emails, like without
// MAIL_DOMAIN.
async function buildApp(logs?: string[], { canEmail = true } = {}) {
  const app = Fastify(logs ? { logger: { stream: { write: (line: string) => logs.push(line) } } } : {})
  await app.register(applyRoutes, { store, photos, verifyTurnstile, settings, sendEmail: canEmail ? sendEmail : null })
  return app
}

type App = Awaited<ReturnType<typeof buildApp>>

// Each request comes from its own address by default, so that tests aren't rate limited.
let nextAddress = 0

async function apply(app: App, parts?: Parts, address = `203.0.113.${++nextAddress}`) {
  const { payload, headers } = multipart(parts)
  return app.inject({ method: 'POST', url: '/api/applications', payload, headers: { ...headers, 'cf-connecting-ip': address } })
}

describe('POST /api/applications', () => {
  beforeEach(() => {
    artists = []
    applications = []
    stored.clear()
    nextId = 0
    nextPhoto = 0
    recipients = null
    vi.clearAllMocks()
  })

  it('adds the artist, who added themselves, with their photo and their application', async () => {
    const app = await buildApp()
    const response = await apply(app)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true })
    expect(artists).toEqual([
      expect.objectContaining({
        ...profile(),
        // Only the profile names are kept.
        links: { soundcloud: 'parkingdotradio', instagram: 'parking.radio' },
        photoKey: 'artists/photo-1.jpeg',
        photoType: 'image/jpeg',
        createdBy: null,
      }),
    ])
    expect(applications).toEqual([
      // The dates are sorted.
      expect.objectContaining({ ...fields({ dates: ['2027-01-08', '2027-01-15'] }), artistId: artists[0].id, createdBy: null }),
    ])
    expect([...stored.keys()]).toEqual(['artists/photo-1.jpeg'])
  })

  it('checks the token with Turnstile, with the address Cloudflare reports', async () => {
    const app = await buildApp()
    await apply(app, { turnstileToken: 'the-token' }, '198.51.100.7')
    expect(verifyTurnstile).toHaveBeenCalledWith('the-token', '198.51.100.7')
  })

  it('refuses, in French, an artist who already exists, whatever the case of their email, and forgets the photo', async () => {
    const app = await buildApp()
    expect((await apply(app)).statusCode).toBe(200)
    const response = await apply(app, { artist: profile({ email: 'Artiste@Example.com', name: 'Someone Else' }), photo: PNG })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ ok: false, error: 'Un artiste est déjà inscrit avec cette adresse e-mail.' })
    expect(artists).toHaveLength(1)
    expect(artists[0]).toMatchObject({ name: 'DJ Test', photoKey: 'artists/photo-1.jpeg' })
    expect(applications).toHaveLength(1)
    expect([...stored.keys()]).toEqual(['artists/photo-1.jpeg'])
  })

  it('only checks whether the artist already exists once Turnstile vouches for the token', async () => {
    const app = await buildApp()
    await apply(app)
    const response = await apply(app, { turnstileToken: 'refused' })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ ok: false, error: 'La vérification anti-robot a échoué. Réessaie.' })
  })

  it('ignores other fields and files, e.g. a submit button', async () => {
    const app = await buildApp()
    const extra = [
      { name: 'submit', value: 'Envoyer' },
      { name: 'attachment', value: Buffer.alloc(1024), filename: 'attachment.bin' },
    ]
    expect((await apply(app, { extra })).statusCode).toBe(200)
    expect(artists).toHaveLength(1)
  })

  it('refuses more than one photo, so that a request cannot make the server keep several in memory', async () => {
    const app = await buildApp()
    const response = await apply(app, { extra: [{ name: 'photo', value: PNG, filename: 'photo.png' }] })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ ok: false, error: 'Candidature invalide.' })
    expect(verifyTurnstile).not.toHaveBeenCalled()
    expect(store.apply).not.toHaveBeenCalled()
  })

  it('explains, in French, what is wrong with an invalid profile, photo or application, without checking the token or storing anything', async () => {
    const app = await buildApp()
    const invalid = [
      { parts: { artist: profile({ links: { soundcloud: 'https://instagram.com/foo' } }) }, error: "SoundCloud : ce n'est pas une adresse SoundCloud." },
      { parts: { artist: profile({ email: 'pas une adresse' }) }, error: 'Indique une adresse e-mail valide.' },
      { parts: { photo: null }, error: 'Ajoute une photo en JPEG, PNG ou WebP.' },
      { parts: { photo: Buffer.from('%PDF-1.7') }, error: 'Ajoute une photo en JPEG, PNG ou WebP.' },
      { parts: { application: fields({ dates: [] }) }, error: 'Choisis au moins une date.' },
      { parts: { application: fields({ timeSlots: [{ start: '22:00', end: '18:00' }] }) }, error: 'Une des plages horaires est invalide.' },
    ]
    for (const { parts, error } of invalid) {
      const response = await apply(app, parts)
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error })
    }
    expect(verifyTurnstile).not.toHaveBeenCalled()
    expect(photos.store).not.toHaveBeenCalled()
    expect(store.apply).not.toHaveBeenCalled()
  })

  it('refuses photos over the size limit', async () => {
    const app = await buildApp()
    const response = await apply(app, { photo: Buffer.concat([JPEG, Buffer.alloc(PHOTO_MAX_BYTES)]) })
    expect(response.statusCode).toBe(413)
    expect(response.json()).toEqual({ ok: false, error: 'La photo dépasse 10 Mo.' })
    expect(verifyTurnstile).not.toHaveBeenCalled()
    expect(store.apply).not.toHaveBeenCalled()
  })

  it('rejects malformed requests', async () => {
    const app = await buildApp()
    const malformed = [
      await apply(app, { artist: '{not json' }),
      await apply(app, { application: '{not json' }),
      await apply(app, { artist: undefined }),
      await apply(app, { application: undefined }),
      await app.inject({ method: 'POST', url: '/api/applications', payload: { artist: profile(), application: fields() } }),
      // A body that ends early.
      await app.inject({
        method: 'POST',
        url: '/api/applications',
        payload: '--test-boundary\r\nContent-Disposition: form-data; name="artist"\r\n\r\n{"kind":',
        headers: { 'content-type': 'multipart/form-data; boundary=test-boundary' },
      }),
    ]
    for (const response of malformed) {
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error: 'Candidature invalide.' })
    }
    expect(verifyTurnstile).not.toHaveBeenCalled()
    expect(store.apply).not.toHaveBeenCalled()
  })

  it('says what is wrong in French even when Fastify refuses the request itself', async () => {
    const app = await buildApp()
    const refused = [
      await app.inject({ method: 'POST', url: '/api/applications', payload: 'a=b', headers: { 'content-type': 'application/x-www-form-urlencoded' } }),
      await app.inject({ method: 'POST', url: '/api/applications', payload: { bio: 'x'.repeat(2 * 1024 * 1024) } }),
    ]
    expect(refused.map((response) => response.statusCode)).toEqual([415, 413])
    for (const response of refused) {
      expect(response.json()).toEqual({ ok: false, error: 'Candidature invalide.' })
    }
  })

  it('refuses an application without a token, or with one Turnstile does not vouch for, without storing anything', async () => {
    const app = await buildApp()
    for (const turnstileToken of [undefined, 'refused']) {
      const response = await apply(app, { turnstileToken })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error: 'La vérification anti-robot a échoué. Réessaie.' })
    }
    expect(photos.store).not.toHaveBeenCalled()
    expect(store.apply).not.toHaveBeenCalled()
  })

  it('logs an error when Turnstile refuses tokens because of the secret key, since it then refuses every application', async () => {
    verifyTurnstile.mockResolvedValueOnce({ success: false, errorCodes: ['invalid-input-secret'] })
    const logs: string[] = []
    const app = await buildApp(logs)
    expect((await apply(app)).statusCode).toBe(400)
    const line = JSON.parse(logs.find((line) => line.includes('Turnstile refused an application'))!)
    expect(line.level).toBe(50)
  })

  it('responds 502, without storing anything, when Turnstile cannot be reached', async () => {
    verifyTurnstile.mockRejectedValueOnce(new Error('fetch failed'))
    const app = await buildApp()
    const response = await apply(app)
    expect(response.statusCode).toBe(502)
    expect(response.json()).toEqual({ ok: false, error: "La vérification anti-robot n'a pas pu être faite. Réessaie dans quelques minutes." })
    expect(photos.store).not.toHaveBeenCalled()
  })

  it('forgets the photo when the application cannot be saved', async () => {
    vi.mocked(store.apply).mockRejectedValueOnce(new Error('database is down'))
    const app = await buildApp()
    expect((await apply(app)).statusCode).toBe(500)
    expect(stored.size).toBe(0)
  })

  it("keeps the artist's personal data out of the logs and the response when the database fails", async () => {
    const cause = Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' })
    const query = 'insert into "artists" ("email", "phone") values ($1, $2)'
    vi.mocked(store.apply).mockRejectedValueOnce(new DrizzleQueryError(query, ['artiste@example.com', '418 555-0123'], cause))
    const logs: string[] = []
    const app = await buildApp(logs)
    const response = await apply(app)
    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ ok: false, error: 'Internal server error' })
    expect(logs.join('')).toContain('57P01')
    expect(logs.join('')).not.toContain('artiste@example.com')
    expect(logs.join('')).not.toContain('418 555-0123')
  })

  describe('emails', () => {
    // What's in the emails is checked in application-emails.test.ts. Here, it's what the route passes on.
    it('emails the application to the recipients, with the photo, and confirms it to the artist', async () => {
      recipients = ['equipe@example.com', 'booking@example.com']
      const app = await buildApp()
      expect((await apply(app)).statusCode).toBe(200)

      expect(sendEmail).toHaveBeenCalledTimes(2)
      const [toRecipients, confirmation] = sendEmail.mock.calls.map(([email]) => email)
      expect(toRecipients).toMatchObject({ to: recipients, attachments: [{ fileName: 'photo-1.jpeg', body: JPEG }] })
      expect(confirmation).toMatchObject({ to: ['artiste@example.com'], replyTo: recipients })
      // What's described is what was saved, e.g. links reduced to profile names.
      expect(toRecipients.text).toContain('SoundCloud : https://soundcloud.com/parkingdotradio')
    })

    it.each([null, []])('only confirms the application to the artist when the recipients are %j', async (chosen) => {
      recipients = chosen
      const logs: string[] = []
      const app = await buildApp(logs)
      expect((await apply(app)).statusCode).toBe(200)
      expect(sendEmail).toHaveBeenCalledTimes(1)
      expect(sendEmail.mock.calls[0][0]).toMatchObject({ to: ['artiste@example.com'], replyTo: undefined })
      expect(logs.join('')).toContain('no recipients were chosen')
    })

    it('still confirms the application to the artist when the recipients cannot be loaded', async () => {
      vi.mocked(settings.load).mockRejectedValueOnce(new Error('database is down'))
      const logs: string[] = []
      const app = await buildApp(logs)
      expect((await apply(app)).statusCode).toBe(200)
      expect(sendEmail).toHaveBeenCalledTimes(1)
      expect(sendEmail.mock.calls[0][0]).toMatchObject({ to: ['artiste@example.com'] })
      expect(logs.join('')).toContain('Failed to load who applications are emailed to')
      // Nobody may have been chosen, but that isn't known.
      expect(logs.join('')).not.toContain('no recipients were chosen')
    })

    it("saves the application when emails can't be sent, and logs why", async () => {
      recipients = ['equipe@example.com']
      sendEmail.mockRejectedValueOnce(new EmailNotSent('MessageRejected: one')).mockRejectedValueOnce(new EmailNotSent('MessageRejected: two'))
      const logs: string[] = []
      const app = await buildApp(logs)
      expect((await apply(app)).statusCode).toBe(200)
      expect(applications).toHaveLength(1)
      const failures = logs.map((line) => JSON.parse(line)).filter((line) => line.err?.message.startsWith('MessageRejected'))
      expect(failures.map((line) => line.msg).sort()).toEqual([
        'Failed to confirm an application to the artist',
        'Failed to email an application to its recipients',
      ])
      expect(failures[0]).toMatchObject({ level: 50, applicationId: applications[0].id })
    })

    it("doesn't email anything when the server can't send emails", async () => {
      recipients = ['equipe@example.com']
      const logs: string[] = []
      const app = await buildApp(logs, { canEmail: false })
      expect((await apply(app)).statusCode).toBe(200)
      expect(settings.load).not.toHaveBeenCalled()
      expect(logs.join('')).toContain('MAIL_DOMAIN is not set')
    })

    it("doesn't email anything about applications that weren't saved", async () => {
      recipients = ['equipe@example.com']
      const app = await buildApp()
      await apply(app)
      sendEmail.mockClear()
      expect((await apply(app)).statusCode).toBe(409)
      expect((await apply(app, { turnstileToken: 'refused' })).statusCode).toBe(400)
      expect((await apply(app, { application: fields({ dates: [] }) })).statusCode).toBe(400)
      expect(sendEmail).not.toHaveBeenCalled()
    })
  })

  describe('rate limiting', () => {
    // Each application from another artist, so that they would all be added.
    let nextArtist = 0
    const another = () => ({ artist: profile({ email: `artiste-${++nextArtist}@example.com` }) })

    it('refuses applications, in French, once an address has sent too many', async () => {
      const app = await buildApp()
      for (let i = 0; i < APPLICATIONS_PER_WINDOW; ++i) {
        expect((await apply(app, another(), '203.0.113.200')).statusCode).toBe(200)
      }
      const response = await apply(app, another(), '203.0.113.200')
      expect(response.statusCode).toBe(429)
      expect(response.json()).toEqual({ ok: false, error: 'Trop de candidatures envoyées depuis ta connexion. Réessaie plus tard.' })
      expect(applications).toHaveLength(APPLICATIONS_PER_WINDOW)
    })

    it('limits each address reported by Cloudflare separately', async () => {
      const app = await buildApp()
      for (let i = 0; i < APPLICATIONS_PER_WINDOW; ++i) await apply(app, another(), '203.0.113.200')
      expect((await apply(app, another(), '203.0.113.200')).statusCode).toBe(429)
      expect((await apply(app, another(), '203.0.113.201')).statusCode).toBe(200)
    })
  })
})
