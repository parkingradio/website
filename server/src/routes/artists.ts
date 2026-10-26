import { Readable } from 'node:stream'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import multipart from '@fastify/multipart'
import { z } from 'zod'
import { ApiError, Ok, Timestamp, zodRoutes } from '../api-schemas.js'
import { AdminArtistProfile, ArtistKind, ArtistLinks, Country, GenreId, PHOTO_MAX_BYTES, PHOTO_TOO_LARGE, PHOTO_TYPES } from '../artist-profile.js'
import type { Profile } from '../artist-profile.js'
import { EmailTaken, InvalidProfile, forgetPhoto, storePhoto, validatePhoto, validateProfile } from '../artists.js'
import type { ArtistsStore, Photos, SentPhoto, StoredArtist } from '../artists.js'
import { jsonField, readPhotoForm } from '../photo-form.js'

// The admin pages' side of artists: adding, viewing, changing and deleting them (see docs/design/server/artists.md).

// An artist, as the endpoints return them: their profile, as it was saved, and what the server knows of them.
const Artist = z
  .object({
    id: z.string(),
    createdAt: Timestamp,
    createdBy: z.string().nullable(),
    kind: ArtistKind,
    name: z.string(),
    members: z.array(z.string()),
    country: z.union([Country, z.literal('')]),
    city: z.string(),
    genres: z.array(GenreId),
    bio: z.string(),
    links: ArtistLinks,
    email: z.string(),
    phone: z.string(),
    updatedBy: z.string().nullable(),
    updatedAt: Timestamp.nullable(),
    hasPhoto: z.boolean(),
  })
  .meta({ id: 'Artist' })
type Artist = z.infer<typeof Artist>

const ArtistResponse = z.object({ ok: z.literal(true), artist: Artist })

// What adding an artist sends, as multipart/form-data, and changing one with `removePhoto`. The route reads it itself
// (see `readArtist`): only the profile is checked against its schema here.
const photo = z.file().meta({
  description: `A JPEG, PNG or WebP image of up to ${PHOTO_MAX_BYTES / 1024 / 1024} MB, whose type is told from its contents. An empty file is no photo`,
})
const NewArtistForm = z.object({ artist: AdminArtistProfile, photo: photo.optional() })
const ArtistForm = NewArtistForm.extend({
  removePhoto: z
    .string()
    .optional()
    .meta({ description: '"true" removes the artist\'s photo, when there\'s no new one. Anything else keeps it' }),
})

// The photo, as it's read from where it's kept. Streams are sent as they are, rather than serialized, so it isn't
// checked against this schema, which only says it's a file.
const Photo = z.instanceof(Readable).meta({ type: 'string', format: 'binary' })

const NO_SUCH_ARTIST: z.infer<typeof ApiError> = { ok: false, error: 'No such artist' }
const EMAIL_TAKEN: z.infer<typeof ApiError> = { ok: false, error: 'Another artist has this email address' }
const ARTIST_HAS_NO_PHOTO: z.infer<typeof ApiError> = { ok: false, error: 'This artist has no photo' }
const INVALID_REQUEST = { status: 400, error: 'Invalid request' } as const

function artist(row: StoredArtist): Artist {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    kind: row.kind,
    name: row.name,
    members: row.members,
    country: row.country,
    city: row.city,
    genres: row.genres,
    bio: row.bio,
    links: row.links,
    email: row.email,
    phone: row.phone,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt?.toISOString() ?? null,
    hasPhoto: row.photoKey !== null,
  }
}

// Reads the profile and photo from a request that adds or changes an artist, and checks them, along with the
// "removePhoto" field, which only changing an artist reads. Only admins add and change artists here, so the profile is
// an admin's (see `AdminArtistProfile`). Returns the checked profile and photo (null when there's none), or the error
// to reply with when the request is malformed or invalid.
async function readArtist(
  request: FastifyRequest,
): Promise<{ profile: Profile; photo: SentPhoto | null; removePhoto: boolean } | { status: 400 | 413; error: string }> {
  const form = await readPhotoForm(request)
  if (form === 'too-large') return { status: 413, error: PHOTO_TOO_LARGE }
  if (form === 'malformed') return INVALID_REQUEST
  const sent = jsonField(form.fields.artist)
  if (sent === undefined) return INVALID_REQUEST
  try {
    return { profile: validateProfile(sent, AdminArtistProfile), photo: validatePhoto(form.photo), removePhoto: form.fields.removePhoto === 'true' }
  } catch (error) {
    if (!(error instanceof InvalidProfile)) throw error
    return { status: 400, error: error.message }
  }
}

type ArtistsOptions = {
  store: ArtistsStore
  photos: Photos
}

const ById = z.object({ id: z.string() })

export async function artistsRoutes(app: FastifyInstance, { store, photos }: ArtistsOptions) {
  // Needed by `readPhotoForm`, which sets its own limits.
  await app.register(multipart)

  const api = zodRoutes(app, 'Failed to handle a request about artists')

  api.get(
    '/api/admin/artists',
    {
      config: { admin: true },
      schema: {
        summary: 'Every artist, by name',
        tags: ['Artists'],
        response: { 200: z.object({ ok: z.literal(true), artists: z.array(Artist) }) },
      },
    },
    async () => ({ ok: true as const, artists: (await store.list()).map(artist) }),
  )

  api.get(
    '/api/admin/artists/:id',
    {
      config: { admin: true },
      schema: { summary: 'An artist', tags: ['Artists'], params: ById, response: { 200: ArtistResponse, 404: ApiError } },
    },
    async (request, reply) => {
      const row = await store.get(request.params.id)
      if (!row) return reply.status(404).send(NO_SUCH_ARTIST)
      return { ok: true as const, artist: artist(row) }
    },
  )

  api.get(
    '/api/admin/artists/:id/photo',
    {
      config: { admin: true },
      schema: {
        summary: "An artist's photo",
        tags: ['Artists'],
        params: ById,
        response: {
          200: {
            description:
              'The photo, with the type it was checked to have. Browsers are told not to guess another ' +
              '(`X-Content-Type-Options: nosniff`) or to keep it (`Cache-Control: private, no-store`)',
            content: Object.fromEntries(PHOTO_TYPES.map((type) => [type, { schema: Photo }])),
          },
          404: ApiError,
        },
      },
    },
    async (request, reply) => {
      const row = await store.get(request.params.id)
      if (!row) return reply.status(404).send(NO_SUCH_ARTIST)
      if (!row.photoKey) return reply.status(404).send(ARTIST_HAS_NO_PHOTO)
      const photo = await photos.read(row.photoKey)
      if (!photo) {
        request.log.error({ key: row.photoKey }, 'The photo of an artist is missing')
        return reply.status(404).send({ ok: false, error: 'The photo of this artist is missing' })
      }
      // The type was checked from the photo's contents when it was sent, and browsers mustn't guess another.
      return reply
        .header('Content-Type', row.photoType!)
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control', 'private, no-store')
        .send(photo)
    },
  )

  api.post(
    '/api/admin/artists',
    {
      config: { admin: true },
      schema: {
        summary: 'Adds an artist, with or without a photo',
        tags: ['Artists'],
        multipart: NewArtistForm,
        response: { 200: ArtistResponse, 400: ApiError, 409: ApiError, 413: ApiError },
      },
    },
    async (request, reply) => {
      const sent = await readArtist(request)
      if ('error' in sent) return reply.status(sent.status).send({ ok: false, error: sent.error })

      const photo = await storePhoto(photos, sent.photo)
      try {
        const row = await store.create({ ...sent.profile, ...photo, createdBy: request.user!.email })
        return { ok: true as const, artist: artist(row) }
      } catch (error) {
        await forgetPhoto(photos, request.log, photo.photoKey)
        if (error instanceof EmailTaken) return reply.status(409).send(EMAIL_TAKEN)
        throw error
      }
    },
  )

  api.put(
    '/api/admin/artists/:id',
    {
      config: { admin: true },
      schema: {
        summary: "Changes an artist's profile, and replaces or removes their photo",
        tags: ['Artists'],
        params: ById,
        multipart: ArtistForm,
        response: { 200: ArtistResponse, 400: ApiError, 404: ApiError, 409: ApiError, 413: ApiError },
      },
    },
    async (request, reply) => {
      const sent = await readArtist(request)
      if ('error' in sent) return reply.status(sent.status).send({ ok: false, error: sent.error })
      if (sent.photo && sent.removePhoto) return reply.status(400).send({ ok: false, error: INVALID_REQUEST.error })

      // The artist's new photo, or none if it's removed. Otherwise, the artist keeps theirs.
      const photo = sent.photo || sent.removePhoto ? await storePhoto(photos, sent.photo) : null
      let changed: Awaited<ReturnType<ArtistsStore['update']>>
      try {
        changed = await store.update(request.params.id, { ...sent.profile, ...photo, updatedBy: request.user!.email, updatedAt: new Date() })
      } catch (error) {
        await forgetPhoto(photos, request.log, photo?.photoKey ?? null)
        if (error instanceof EmailTaken) return reply.status(409).send(EMAIL_TAKEN)
        throw error
      }
      if (!changed) {
        await forgetPhoto(photos, request.log, photo?.photoKey ?? null)
        return reply.status(404).send(NO_SUCH_ARTIST)
      }

      // The photo the artist had, which was replaced or removed.
      if (photo) await forgetPhoto(photos, request.log, changed.before.photoKey)
      return { ok: true as const, artist: artist(changed.after) }
    },
  )

  api.delete(
    '/api/admin/artists/:id',
    {
      config: { admin: true },
      schema: {
        summary: 'Deletes an artist, their photo and their applications',
        tags: ['Artists'],
        params: ById,
        response: { 200: Ok, 404: ApiError },
      },
    },
    async (request, reply) => {
      const row = await store.delete(request.params.id)
      if (!row) return reply.status(404).send(NO_SUCH_ARTIST)
      // The artist is gone either way.
      await forgetPhoto(photos, request.log, row.photoKey)
      return { ok: true as const }
    },
  )
}
