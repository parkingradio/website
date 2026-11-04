import { beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { DrizzleQueryError } from 'drizzle-orm'
import { useZodSchemas } from '../api/schemas.js'
import { PHOTO_MAX_BYTES } from '../artists/profile.js'
import type { ApplicantProfile } from '../artists/profile.js'
import { EmailTaken } from '../artists/store.js'
import type { PhotoFolder, SentPhoto, StoredArtist } from '../artists/store.js'
import type { CollectiveRow } from '../collectives/store.js'
import { EmailNotSent } from '../core/email.js'
import type { SendEmail } from '../core/email.js'
import { APPLICATIONS_PER_WINDOW, applyRoutes } from './apply-routes.js'
import type { ApplyStore } from './apply-store.js'
import type { ApplicationFields } from './fields.js'
import type { ApplicationsSettingsStore } from './settings.js'
import type { StoredApplication } from './store.js'
import type { TurnstileVerifier } from './turnstile.js'

// The artists, collectives and applications, as the database would keep them, with each collective's artists, and the
// photos, as the bucket would.
let artists: StoredArtist[] = []
let collectives: (CollectiveRow & { members: string[] })[] = []
let applications: StoredApplication[] = []
const stored = new Map<string, Buffer>()
let nextId = 0
let nextPhoto = 0

function addApplication(fields: ApplicationFields, owner: { artistId: string } | { collectiveId: string }): StoredApplication {
  const now = new Date()
  const application: StoredApplication = {
    id: `application-${++nextId}`,
    receivedAt: now,
    createdAt: now,
    createdBy: null,
    artistId: null,
    collectiveId: null,
    updatedBy: null,
    updatedAt: null,
    status: 'new',
    statusUpdatedBy: null,
    statusUpdatedAt: null,
    ...fields,
    ...owner,
  }
  applications.push(application)
  return application
}

function addArtist(artist: Parameters<ApplyStore['applyAsCollective']>[1][number]): StoredArtist {
  const added: StoredArtist = { id: `artist-${++nextId}`, createdAt: new Date(), createdBy: null, updatedBy: null, updatedAt: null, collectives: [], ...artist }
  artists.push(added)
  return added
}

// Like the database, where two artists can't have the same email, whatever its case, nor two collectives.
const store: ApplyStore = {
  apply: vi.fn<ApplyStore['apply']>(async (artist, fields) => {
    if (artists.some((other) => other.email?.toLowerCase() === artist.email.toLowerCase())) throw new EmailTaken()
    const applicant = addArtist(artist)
    return { artistId: applicant.id, applicationId: addApplication(fields, { artistId: applicant.id }).id }
  }),
  applyAsCollective: vi.fn<ApplyStore['applyAsCollective']>(async (collective, members, fields) => {
    if (collectives.some((other) => other.email?.toLowerCase() === collective.email.toLowerCase())) throw new EmailTaken()
    const id = `collective-${++nextId}`
    const added = members.map(addArtist).map((artist) => artist.id)
    collectives.push({ id, createdAt: new Date(), createdBy: null, updatedBy: null, updatedAt: null, ...collective, members: added })
    return { collectiveId: id, applicationId: addApplication(fields, { collectiveId: id }).id }
  }),
}

const photos = {
  store: vi.fn(async ({ body, type }: SentPhoto, folder: PhotoFolder) => {
    const key = `${folder}/photo-${++nextPhoto}.${type.split('/')[1]}`
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

function profile(changes: Partial<ApplicantProfile> = {}): ApplicantProfile {
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

// An artist applying alone, as the form sends them.
function asArtist(changes: Partial<ApplicantProfile> = {}) {
  return { kind: 'artist', ...profile(changes) }
}

// One of a collective's artists, as the form sends them.
function member(name: string, changes: object = {}) {
  return { name, country: 'FR', city: 'Lyon', genres: ['house'], bio: `La bio de ${name}.`, links: { instagram: `@${name.toLowerCase()}` }, ...changes }
}

// A collective applying, as the form sends it, with its artists.
function asCollective(changes: object = {}) {
  const { name, country, city, bio, links, email, phone } = profile({ name: 'Le Collectif', email: 'collectif@example.com' })
  return { kind: 'collective', name, country, city, description: bio, links, email, phone, members: [member('Une'), member('Deux')], ...changes }
}

function fields(changes: Partial<ApplicationFields> = {}): ApplicationFields {
  return {
    dates: ['2027-01-15', '2027-01-08'],
    timeSlots: [{ start: '18:00', end: '22:00' }],
    performanceTypes: ['dj'],
    otherPerformanceType: '',
    details: 'Une question.',
    ...changes,
  }
}

// Other parts, after the usual ones: fields, or files when they have a file name.
type ExtraPart = { name: string; value: string | Buffer; filename?: string }
type Parts = {
  artist?: object | string
  application?: object | string
  turnstileToken?: string
  photo?: Buffer | null
  // The "memberPhoto" parts, in order, where null is an empty part.
  memberPhotos?: (Buffer | null)[]
  extra?: ExtraPart[]
}

// A multipart/form-data body, as applying takes it: the profile and the application as JSON, the token, and the photos.
// Parts set to undefined are left out.
function multipart(parts: Parts = {}) {
  const { artist, application, turnstileToken, photo, memberPhotos, extra } = {
    artist: asArtist(),
    application: fields(),
    turnstileToken: 'token',
    photo: JPEG,
    memberPhotos: [],
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
  const file = (name: string, body: Buffer) =>
    chunks.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="photo"\r\nContent-Type: image/jpeg\r\n\r\n`),
      body,
      Buffer.from('\r\n'),
    )
  if (photo) file('photo', photo)
  for (const memberPhoto of memberPhotos) file('memberPhoto', memberPhoto ?? Buffer.alloc(0))
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
  useZodSchemas(app)
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
    collectives = []
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

  it('adds the artist without a photo, which is optional', async () => {
    const app = await buildApp()
    const response = await apply(app, { photo: null })
    expect(response.statusCode).toBe(200)
    expect(artists).toEqual([expect.objectContaining({ email: 'artiste@example.com', photoKey: null, photoType: null })])
    expect(applications).toHaveLength(1)
    expect(photos.store).not.toHaveBeenCalled()
  })

  it('checks the token with Turnstile, with the address Cloudflare reports', async () => {
    const app = await buildApp()
    await apply(app, { turnstileToken: 'the-token' }, '198.51.100.7')
    expect(verifyTurnstile).toHaveBeenCalledWith('the-token', '198.51.100.7')
  })

  it('refuses, in French, an artist who already exists, whatever the case of their email, and forgets the photo', async () => {
    const app = await buildApp()
    expect((await apply(app)).statusCode).toBe(200)
    const response = await apply(app, { artist: asArtist({ email: 'Artiste@Example.com', name: 'Someone Else' }), photo: PNG })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ ok: false, error: 'Un artiste est déjà inscrit avec cette adresse e-mail.' })
    expect(artists).toHaveLength(1)
    expect(artists[0]).toMatchObject({ name: 'DJ Test', photoKey: 'artists/photo-1.jpeg' })
    expect(applications).toHaveLength(1)
    expect([...stored.keys()]).toEqual(['artists/photo-1.jpeg'])
  })

  it('adds the collective, which added itself, with its photo, its artists, with their profiles and photos, in order, and its application', async () => {
    const app = await buildApp()
    const members = [member('Une'), member('Deux'), member('Trois', { links: { soundcloud: 'https://soundcloud.com/trois/sets/x' } })]
    // Only the second artist has a photo, and the third one's part is left out.
    const response = await apply(app, { artist: asCollective({ members }), memberPhotos: [null, PNG] })

    expect(response.statusCode).toBe(200)
    const { name, country, city, bio, email, phone } = profile({ name: 'Le Collectif', email: 'collectif@example.com' })
    expect(collectives).toEqual([
      expect.objectContaining({
        name,
        country,
        city,
        description: bio,
        links: { soundcloud: 'parkingdotradio', instagram: 'parking.radio' },
        email,
        phone,
        photoKey: 'collectives/photo-1.jpeg',
        photoType: 'image/jpeg',
        createdBy: null,
      }),
    ])
    const saved = (name: string, photo: object, links: object) =>
      expect.objectContaining({ ...member(name), links, email: null, phone: '', ...photo, createdBy: null })
    const noPhoto = { photoKey: null, photoType: null }
    expect(artists).toEqual([
      saved('Une', noPhoto, { instagram: 'une' }),
      saved('Deux', { photoKey: 'artists/photo-2.png', photoType: 'image/png' }, { instagram: 'deux' }),
      saved('Trois', noPhoto, { soundcloud: 'trois' }),
    ])
    expect(collectives[0].members).toEqual(artists.map((artist) => artist.id))
    expect(applications).toEqual([expect.objectContaining({ artistId: null, collectiveId: collectives[0].id, createdBy: null })])
    expect([...stored.keys()]).toEqual(['collectives/photo-1.jpeg', 'artists/photo-2.png'])
  })

  it('takes any number of artists, but at least one', async () => {
    const app = await buildApp()
    const members = ['Une', 'Deux', 'Trois', 'Quatre', 'Cinq'].map((name) => member(name))
    expect((await apply(app, { artist: asCollective({ members }) })).statusCode).toBe(200)
    expect(artists).toHaveLength(5)

    for (const none of [[], undefined, 'Une']) {
      const response = await apply(app, { artist: asCollective({ email: 'autre@example.com', members: none }) })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error: 'Indiquez au moins un artiste du collectif.' })
    }
  })

  it("refuses, in French, a collective whose email another collective has, whatever its case, and forgets every photo, but not one with an artist's", async () => {
    const app = await buildApp()
    expect((await apply(app, { artist: asCollective() })).statusCode).toBe(200)
    const response = await apply(app, { artist: asCollective({ name: 'Un Autre', email: 'Collectif@Example.com' }), photo: PNG, memberPhotos: [JPEG, PNG] })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ ok: false, error: 'Un collectif est déjà inscrit avec cette adresse e-mail.' })
    expect(collectives).toHaveLength(1)
    expect(artists).toHaveLength(2)
    expect([...stored.keys()]).toEqual(['collectives/photo-1.jpeg'])
    expect(photos.delete).toHaveBeenCalledTimes(3)

    expect((await apply(app, { artist: asArtist({ email: 'collectif@example.com' }) })).statusCode).toBe(200)
    expect((await apply(app, { artist: asCollective({ email: 'artiste@example.com' }) })).statusCode).toBe(200)
  })

  it("says what is wrong with a collective's profile, and which of its artists is wrong, without checking the token", async () => {
    const app = await buildApp()
    const invalid = [
      { parts: { artist: asCollective({ name: '' }) }, error: 'Indiquez le nom du collectif.' },
      { parts: { artist: asCollective({ name: 'x'.repeat(101) }) }, error: 'Le nom du collectif dépasse 100 caractères.' },
      // Which admins can leave out, but a collective that applies can't.
      { parts: { artist: asCollective({ country: '' }) }, error: 'Choisissez le pays.' },
      { parts: { artist: asCollective({ description: '' }) }, error: 'Écrivez quelques lignes de description.' },
      { parts: { artist: asCollective({ links: {} }) }, error: 'Ajoutez au moins un lien.' },
      { parts: { artist: asCollective({ phone: '' }) }, error: 'Indiquez votre numéro de téléphone.' },
      { parts: { artist: asCollective({ email: '' }) }, error: 'Indiquez votre adresse e-mail.' },
      { parts: { artist: asCollective({ email: null }) }, error: 'Indiquez votre adresse e-mail.' },
      { parts: { artist: asCollective({ email: undefined }) }, error: 'Indiquez votre adresse e-mail.' },
      // An artist's errors say which one it is, counting from 1.
      { parts: { artist: asCollective({ members: [member('Une'), member('Deux', { city: ' ' })] }) }, error: 'Artiste 2 : Indiquez la ville.' },
      { parts: { artist: asCollective({ members: [member('Une', { genres: [] })] }) }, error: 'Artiste 1 : Choisissez au moins un genre.' },
      { parts: { artist: asCollective({ members: [member('Une'), 'Deux'] }) }, error: "Artiste 2 : Indiquez le nom d'artiste." },
      {
        parts: { artist: asCollective({ members: [member('Une'), member('Deux', { links: { soundcloud: 'https://instagram.com/x' } })] }) },
        error: "Artiste 2 : SoundCloud : ce n'est pas une adresse SoundCloud.",
      },
      { parts: { artist: asCollective(), memberPhotos: [JPEG, Buffer.from('%PDF-1.7')] }, error: 'Artiste 2 : La photo doit être en JPEG, PNG ou WebP.' },
      { parts: { artist: asCollective(), photo: Buffer.from('%PDF-1.7') }, error: 'La photo doit être en JPEG, PNG ou WebP.' },
      { parts: { artist: { ...asCollective(), kind: 'duo' } }, error: 'Indiquez si vous postulez comme artiste ou comme collectif.' },
    ]
    for (const { parts, error } of invalid) {
      const response = await apply(app, parts)
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error })
    }
    expect(verifyTurnstile).not.toHaveBeenCalled()
    expect(store.applyAsCollective).not.toHaveBeenCalled()
  })

  it("refuses more photos of artists than the collective has, and an artist's, as malformed", async () => {
    const app = await buildApp()
    for (const parts of [{ artist: asCollective(), memberPhotos: [null, null, JPEG] }, { artist: asCollective(), memberPhotos: [null, null, null] }, { memberPhotos: [JPEG] }]) {
      const response = await apply(app, parts)
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error: 'Candidature invalide.' })
    }
    expect(verifyTurnstile).not.toHaveBeenCalled()
  })

  it("ignores an artist's other fields, e.g. those an older form sent", async () => {
    const app = await buildApp()
    expect((await apply(app, { artist: { ...asArtist(), members: [] } })).statusCode).toBe(200)
    expect(artists).toHaveLength(1)
    expect(artists[0]).not.toHaveProperty('members')
    expect(collectives).toHaveLength(0)
  })

  it('forgets the photos already stored when one of them cannot be', async () => {
    photos.store.mockImplementationOnce(photos.store.getMockImplementation()!).mockRejectedValueOnce(new Error('S3 is down'))
    const app = await buildApp()
    expect((await apply(app, { artist: asCollective(), memberPhotos: [JPEG, PNG] })).statusCode).toBe(500)
    expect(photos.store).toHaveBeenCalledTimes(2)
    expect(stored.size).toBe(0)
    expect(store.applyAsCollective).not.toHaveBeenCalled()
  })

  it('only checks whether the artist already exists once Turnstile vouches for the token', async () => {
    const app = await buildApp()
    await apply(app)
    const response = await apply(app, { turnstileToken: 'refused' })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ ok: false, error: 'La vérification anti-robot a échoué. Réessayez.' })
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
      { parts: { artist: asArtist({ links: { soundcloud: 'https://instagram.com/foo' } }) }, error: "SoundCloud : ce n'est pas une adresse SoundCloud." },
      { parts: { artist: asArtist({ email: 'pas une adresse' }) }, error: 'Indiquez une adresse e-mail valide.' },
      // Which admins can leave out, but artists can't.
      { parts: { artist: asArtist({ country: '' }) }, error: 'Choisissez le pays.' },
      { parts: { artist: asArtist({ city: '' }) }, error: 'Indiquez la ville.' },
      { parts: { artist: asArtist({ genres: [] }) }, error: 'Choisissez au moins un genre.' },
      { parts: { artist: asArtist({ links: {} }) }, error: 'Ajoutez au moins un lien.' },
      { parts: { artist: asArtist({ phone: '' }) }, error: 'Indiquez votre numéro de téléphone.' },
      { parts: { artist: asArtist({ bio: '' }) }, error: 'Écrivez quelques lignes de bio.' },
      { parts: { artist: asArtist({ email: '' }) }, error: 'Indiquez votre adresse e-mail.' },
      { parts: { photo: Buffer.from('%PDF-1.7') }, error: 'La photo doit être en JPEG, PNG ou WebP.' },
      { parts: { application: fields({ dates: [] }) }, error: 'Choisissez au moins une date.' },
      { parts: { application: fields({ timeSlots: [{ start: '22:00', end: '18:00' }] }) }, error: 'Une des plages horaires est invalide.' },
      // Which the database can't store.
      { parts: { application: fields({ details: 'Une\0question' }) }, error: 'Le champ « Questions ou détails » contient un caractère invalide.' },
      // Malformed, rather than only invalid, which the form never sends, but still explained in French.
      { parts: { artist: 'null' }, error: 'Indiquez si vous postulez comme artiste ou comme collectif.' },
      { parts: { application: 'null' }, error: 'Choisissez au moins une date.' },
      { parts: { application: { ...fields(), timeSlots: '18:00-22:00' } }, error: 'Les plages horaires sont invalides.' },
      { parts: { application: { ...fields(), performanceTypes: undefined } }, error: 'Les prestations sont invalides.' },
      { parts: { application: { ...fields(), otherPerformanceType: 42 } }, error: 'La prestation « Autre » est invalide.' },
      { parts: { application: { ...fields(), details: null } }, error: 'Le champ « Questions ou détails » est invalide.' },
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

  it("says which artist's photo is over the size limit", async () => {
    const app = await buildApp()
    const response = await apply(app, { artist: asCollective(), memberPhotos: [JPEG, Buffer.concat([JPEG, Buffer.alloc(PHOTO_MAX_BYTES)])] })
    expect(response.statusCode).toBe(413)
    expect(response.json()).toEqual({ ok: false, error: 'Artiste 2 : La photo dépasse 10 Mo.' })
    expect(verifyTurnstile).not.toHaveBeenCalled()
  })

  it('refuses more files or fields than it reads, and a field that is too long', async () => {
    const app = await buildApp()
    const refused = [
      await apply(app, { extra: Array.from({ length: 10 }, (_, i) => ({ name: `file${i}`, value: 'x', filename: 'x.bin' })) }),
      await apply(app, { extra: Array.from({ length: 8 }, (_, i) => ({ name: `field${i}`, value: 'x' })) }),
      await apply(app, { artist: asArtist({ bio: 'x'.repeat(256 * 1024) }) }),
    ]
    for (const response of refused) {
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error: 'Candidature invalide.' })
    }
    // Room for 4 artists with the longest bios, of characters of 3 bytes each.
    const members = ['Une', 'Deux', 'Trois', 'Quatre'].map((name) => member(name, { bio: '€'.repeat(5000) }))
    expect((await apply(app, { artist: asCollective({ members, description: '€'.repeat(5000) }) })).statusCode).toBe(200)
  })

  it('rejects malformed requests', async () => {
    const app = await buildApp()
    const malformed = [
      await apply(app, { artist: '{not json' }),
      await apply(app, { application: '{not json' }),
      await apply(app, { artist: undefined }),
      await apply(app, { application: undefined }),
      await app.inject({ method: 'POST', url: '/api/applications', payload: { artist: asArtist(), application: fields() } }),
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
      expect(response.json()).toEqual({ ok: false, error: 'La vérification anti-robot a échoué. Réessayez.' })
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
    expect(response.json()).toEqual({ ok: false, error: "La vérification anti-robot n'a pas pu être faite. Réessayez dans quelques minutes." })
    expect(photos.store).not.toHaveBeenCalled()
  })

  it('forgets the photo when the application cannot be saved', async () => {
    vi.mocked(store.apply).mockRejectedValueOnce(new Error('database is down'))
    const app = await buildApp()
    expect((await apply(app)).statusCode).toBe(500)
    expect(stored.size).toBe(0)
  })

  it("keeps the artist's personal data out of the logs and the response when the database fails, saying so in French", async () => {
    const cause = Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' })
    const query = 'insert into "artists" ("email", "phone") values ($1, $2)'
    vi.mocked(store.apply).mockRejectedValueOnce(new DrizzleQueryError(query, ['artiste@example.com', '418 555-0123'], cause))
    const logs: string[] = []
    const app = await buildApp(logs)
    const response = await apply(app)
    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ ok: false, error: 'Une erreur est survenue. Réessayez plus tard.' })
    expect(logs.join('')).toContain('57P01')
    expect(logs.join('')).toContain('Failed to handle POST /api/applications')
    expect(logs.join('')).not.toContain('artiste@example.com')
    expect(logs.join('')).not.toContain('418 555-0123')
  })

  describe('emails', () => {
    // What's in the emails is checked in applications/emails.test.ts. Here, it's what the route passes on.
    it('emails the application to the recipients, without the photo, and confirms it to the artist', async () => {
      recipients = ['equipe@example.com', 'booking@example.com']
      const app = await buildApp()
      expect((await apply(app)).statusCode).toBe(200)

      expect(sendEmail).toHaveBeenCalledTimes(2)
      const [toRecipients, confirmation] = sendEmail.mock.calls.map(([email]) => email)
      expect(toRecipients).toMatchObject({ to: recipients })
      expect(toRecipients).not.toHaveProperty('attachments')
      expect(confirmation).toMatchObject({ to: ['artiste@example.com'], replyTo: recipients })
      // What's described is what was saved, e.g. links reduced to profile names.
      expect(toRecipients.text).toContain('SoundCloud : https://soundcloud.com/parkingdotradio')
    })

    it("emails a collective's application as it was saved, and confirms it to its contact", async () => {
      recipients = ['equipe@example.com']
      const app = await buildApp()
      expect((await apply(app, { artist: asCollective() })).statusCode).toBe(200)

      const [toRecipients, confirmation] = sendEmail.mock.calls.map(([email]) => email)
      expect(toRecipients).toMatchObject({ to: recipients, replyTo: ['collectif@example.com'], subject: 'Nouvelle candidature : Le Collectif' })
      expect(toRecipients.text).toContain('Artistes du collectif : Une, Deux')
      expect(toRecipients.text).toContain('Artiste 2 : Deux\nVille : Lyon, France\nGenres : house\nLiens :\n  Instagram : https://instagram.com/deux\nBio :\nLa bio de Deux.')
      expect(confirmation).toMatchObject({ to: ['collectif@example.com'], replyTo: recipients })
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
    const another = () => ({ artist: asArtist({ email: `artiste-${++nextArtist}@example.com` }) })

    it('refuses applications, in French, once an address has sent too many', async () => {
      const app = await buildApp()
      for (let i = 0; i < APPLICATIONS_PER_WINDOW; ++i) {
        expect((await apply(app, another(), '203.0.113.200')).statusCode).toBe(200)
      }
      const response = await apply(app, another(), '203.0.113.200')
      expect(response.statusCode).toBe(429)
      expect(response.json()).toEqual({ ok: false, error: 'Trop de candidatures envoyées depuis votre connexion. Réessayez plus tard.' })
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
