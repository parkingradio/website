import type { FastifyInstance, FastifyRequest } from 'fastify'
import multipart from '@fastify/multipart'
import { PHOTO_TOO_LARGE } from 'shared/artists'
import type { Artist, ArtistProfile, ArtistResponse, ArtistsResponse, DeleteArtistResponse } from 'shared/artists'
import type { ApiError } from 'shared/error'
import { EmailTaken, InvalidProfile, forgetPhoto, storePhoto, validatePhoto, validateProfile } from '../artists.js'
import type { ArtistsStore, Photos, SentPhoto, StoredArtist } from '../artists.js'
import { requireAuth } from '../auth.js'
import { jsonField, readPhotoForm } from '../photo-form.js'
import { keepQueryValuesPrivate } from '../query-errors.js'

// The admin pages' side of artists: adding, viewing, changing and deleting them.

const NO_SUCH_ARTIST: ApiError = { ok: false, error: 'No such artist' }
const EMAIL_TAKEN: ApiError = { ok: false, error: 'Another artist has this email address' }
const ARTIST_HAS_NO_PHOTO: ApiError = { ok: false, error: 'This artist has no photo' }
const INVALID_REQUEST = { status: 400, error: 'Invalid request' }

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
// "removePhoto" field, which only changing an artist reads. Profiles are checked leniently, since only admins add and
// change artists here (see `checkProfile`). Returns the checked profile and photo (null when there's none), or the error
// to reply with when the request is malformed or invalid.
async function readArtist(
  request: FastifyRequest,
): Promise<{ profile: ArtistProfile; photo: SentPhoto | null; removePhoto: boolean } | { status: number; error: string }> {
  const form = await readPhotoForm(request)
  if (form === 'too-large') return { status: 413, error: PHOTO_TOO_LARGE }
  if (form === 'malformed') return INVALID_REQUEST
  const sent = jsonField(form.fields.artist)
  if (sent === undefined) return INVALID_REQUEST
  try {
    return { profile: validateProfile(sent, { lenient: true }), photo: validatePhoto(form.photo), removePhoto: form.fields.removePhoto === 'true' }
  } catch (error) {
    if (!(error instanceof InvalidProfile)) throw error
    return { status: 400, error: error.message }
  }
}

type ArtistsOptions = {
  store: ArtistsStore
  photos: Photos
}

type ById = { Params: { id: string } }

export async function artistsRoutes(app: FastifyInstance, { store, photos }: ArtistsOptions) {
  // Needed by `readPhotoForm`, which sets its own limits.
  await app.register(multipart)

  keepQueryValuesPrivate(app, 'Failed to handle a request about artists')

  app.get<{ Reply: ArtistsResponse }>('/api/admin/artists', { preHandler: requireAuth }, async () => {
    return { ok: true, artists: (await store.list()).map(artist) }
  })

  app.get<ById & { Reply: ArtistResponse | ApiError }>('/api/admin/artists/:id', { preHandler: requireAuth }, async (request, reply) => {
    const row = await store.get(request.params.id)
    if (!row) return reply.status(404).send(NO_SUCH_ARTIST)
    return { ok: true, artist: artist(row) }
  })

  app.get<ById>('/api/admin/artists/:id/photo', { preHandler: requireAuth }, async (request, reply) => {
    const row = await store.get(request.params.id)
    if (!row) return reply.status(404).send(NO_SUCH_ARTIST)
    if (!row.photoKey) return reply.status(404).send(ARTIST_HAS_NO_PHOTO)
    const photo = await photos.read(row.photoKey)
    if (!photo) {
      request.log.error({ key: row.photoKey }, 'The photo of an artist is missing')
      return reply.status(404).send({ ok: false, error: 'The photo of this artist is missing' } satisfies ApiError)
    }
    // The type was checked from the photo's contents when it was sent, and browsers mustn't guess another.
    return reply
      .header('Content-Type', row.photoType!)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store')
      .send(photo)
  })

  app.post<{ Reply: ArtistResponse | ApiError }>('/api/admin/artists', { preHandler: requireAuth }, async (request, reply) => {
    const sent = await readArtist(request)
    if ('error' in sent) return reply.status(sent.status).send({ ok: false, error: sent.error })

    const photo = await storePhoto(photos, sent.photo)
    try {
      const row = await store.create({ ...sent.profile, ...photo, createdBy: request.user!.email })
      return { ok: true, artist: artist(row) }
    } catch (error) {
      await forgetPhoto(photos, request.log, photo.photoKey)
      if (error instanceof EmailTaken) return reply.status(409).send(EMAIL_TAKEN)
      throw error
    }
  })

  app.put<ById & { Reply: ArtistResponse | ApiError }>('/api/admin/artists/:id', { preHandler: requireAuth }, async (request, reply) => {
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
    return { ok: true, artist: artist(changed.after) }
  })

  app.delete<ById & { Reply: DeleteArtistResponse | ApiError }>('/api/admin/artists/:id', { preHandler: requireAuth }, async (request, reply) => {
    const row = await store.delete(request.params.id)
    if (!row) return reply.status(404).send(NO_SUCH_ARTIST)
    // The artist is gone either way.
    await forgetPhoto(photos, request.log, row.photoKey)
    return { ok: true }
  })
}
