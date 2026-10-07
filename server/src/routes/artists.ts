import type { FastifyError, FastifyInstance, FastifyRequest } from 'fastify'
import multipart from '@fastify/multipart'
import { DrizzleQueryError } from 'drizzle-orm'
import { PHOTO_MAX_BYTES } from 'shared/artists'
import type { Artist, ArtistProfile, ArtistResponse, ArtistsResponse, DeleteArtistResponse } from 'shared/artists'
import type { ApiError } from 'shared/error'
import { EmailTaken, InvalidProfile, validatePhoto, validateProfile } from '../artists.js'
import type { ArtistsStore, Photos, StoredArtist } from '../artists.js'
import { requireAuth } from '../auth.js'

// The admin pages' side of artists: adding, viewing, changing and deleting them.

const NO_SUCH_ARTIST: ApiError = { ok: false, error: 'No such artist' }
const EMAIL_TAKEN: ApiError = { ok: false, error: 'Another artist has this email address' }
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
  }
}

// Reads the profile and photo from a request that adds or changes an artist, and checks them: the photo with
// `checkPhoto`, which gets undefined when there's none. Returns the checked profile and photo, or the error to reply
// with when the request is malformed or invalid.
async function readArtist<Photo>(
  app: FastifyInstance,
  request: FastifyRequest,
  checkPhoto: (body: Buffer | undefined) => Photo,
): Promise<{ profile: ArtistProfile; photo: Photo } | { status: number; error: string }> {
  if (!request.isMultipart()) return { status: 400, error: 'Expected a multipart/form-data request' }

  let artist: unknown
  let photo: Buffer | undefined
  try {
    for await (const part of request.parts()) {
      if (part.type === 'file' && part.fieldname === 'photo') {
        // A form whose file input was left empty still sends the part, without any content.
        const body = await part.toBuffer()
        if (body.length > 0) photo = body
      } else if (part.type === 'file') {
        part.file.resume() // drain anything unexpected
      } else if (part.fieldname === 'artist') {
        artist = part.value
      }
    }
  } catch (error) {
    if (error instanceof app.multipartErrors.RequestFileTooLargeError) {
      return { status: 413, error: `La photo dépasse ${PHOTO_MAX_BYTES / 1024 / 1024} Mo.` }
    }
    // A body that isn't multipart/form-data after all, or that has more fields or files than the limits allow.
    request.log.info({ err: error }, 'Malformed multipart request')
    return INVALID_REQUEST
  }

  // The profile is JSON, which the multipart parser has already read when its part says it's application/json.
  let sent = artist
  try {
    if (typeof artist !== 'object') sent = JSON.parse(typeof artist === 'string' ? artist : '')
  } catch {
    return INVALID_REQUEST
  }
  try {
    return { profile: validateProfile(sent), photo: checkPhoto(photo) }
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

// What's worth logging of an error, without the values of a query that failed (see `setErrorHandler` below).
function withoutValues(error: Error): object {
  if (!(error instanceof DrizzleQueryError)) return error
  const cause: { message?: string; code?: string } | undefined = error.cause
  return { type: 'DrizzleQueryError', query: error.query, cause: { message: cause?.message, code: cause?.code } }
}

export async function artistsRoutes(app: FastifyInstance, { store, photos }: ArtistsOptions) {
  // Fields and files other than the profile and the photo, e.g. a form's submit button, are ignored, as long as there
  // are only a few.
  await app.register(multipart, { limits: { files: 5, fileSize: PHOTO_MAX_BYTES, fields: 10, fieldSize: 64 * 1024 } })

  // Drizzle's errors list the values of the query that failed, i.e. an artist's personal data, which mustn't end up
  // in the logs, or in the response, where Fastify would put the message. Only the query and what Postgres said are
  // logged, and the response says nothing more than that something went wrong.
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ ok: false, error: error.message } satisfies ApiError)
    }
    request.log.error({ err: withoutValues(error) }, 'Failed to handle a request about artists')
    return reply.status(500).send({ ok: false, error: 'Internal server error' } satisfies ApiError)
  })

  // A photo that was stored but isn't the photo of any artist (anymore) is only worth knowing about if it can't be
  // deleted.
  async function forgetPhoto(request: FastifyRequest, key: string) {
    await photos.delete(key).catch((error: unknown) => {
      request.log.error({ err: error, key }, 'Failed to delete the photo of an artist')
    })
  }

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
    const photo = await photos.read(row.photoKey)
    if (!photo) {
      request.log.error({ key: row.photoKey }, 'The photo of an artist is missing')
      return reply.status(404).send({ ok: false, error: 'The photo of this artist is missing' } satisfies ApiError)
    }
    // The type was checked from the photo's contents when it was sent, and browsers mustn't guess another.
    return reply
      .header('Content-Type', row.photoType)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store')
      .send(photo)
  })

  app.post<{ Reply: ArtistResponse | ApiError }>('/api/admin/artists', { preHandler: requireAuth }, async (request, reply) => {
    const sent = await readArtist(app, request, validatePhoto)
    if ('error' in sent) return reply.status(sent.status).send({ ok: false, error: sent.error })

    const photoKey = await photos.store(sent.photo)
    try {
      const row = await store.create({ ...sent.profile, photoKey, photoType: sent.photo.type, createdBy: request.user!.email })
      return { ok: true, artist: artist(row) }
    } catch (error) {
      await forgetPhoto(request, photoKey)
      if (error instanceof EmailTaken) return reply.status(409).send(EMAIL_TAKEN)
      throw error
    }
  })

  app.put<ById & { Reply: ArtistResponse | ApiError }>('/api/admin/artists/:id', { preHandler: requireAuth }, async (request, reply) => {
    // Without a photo, the artist keeps theirs.
    const sent = await readArtist(app, request, (body) => (body ? validatePhoto(body) : null))
    if ('error' in sent) return reply.status(sent.status).send({ ok: false, error: sent.error })

    const photo = sent.photo ? { photoKey: await photos.store(sent.photo), photoType: sent.photo.type } : {}
    let changed: Awaited<ReturnType<ArtistsStore['update']>>
    try {
      changed = await store.update(request.params.id, { ...sent.profile, ...photo, updatedBy: request.user!.email, updatedAt: new Date() })
    } catch (error) {
      if (photo.photoKey) await forgetPhoto(request, photo.photoKey)
      if (error instanceof EmailTaken) return reply.status(409).send(EMAIL_TAKEN)
      throw error
    }
    if (!changed) {
      if (photo.photoKey) await forgetPhoto(request, photo.photoKey)
      return reply.status(404).send(NO_SUCH_ARTIST)
    }

    if (photo.photoKey) await forgetPhoto(request, changed.before.photoKey)
    return { ok: true, artist: artist(changed.after) }
  })

  app.delete<ById & { Reply: DeleteArtistResponse | ApiError }>('/api/admin/artists/:id', { preHandler: requireAuth }, async (request, reply) => {
    const row = await store.delete(request.params.id)
    if (!row) return reply.status(404).send(NO_SUCH_ARTIST)
    // The artist is gone either way.
    await forgetPhoto(request, row.photoKey)
    return { ok: true }
  })
}
