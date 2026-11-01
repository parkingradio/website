import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { z } from 'zod'
import { ApiError, ById, Ok, Reference, Timestamp, zodRoutes } from '../api/schemas.js'
import { INVALID_REQUEST, PhotoResponse, readProfileForm, sendPhoto } from './photo-form.js'
import { AdminArtistProfile, ArtistKind, ArtistLinks, Country, GenreId, PhotoFile } from './profile.js'
import { EmailTaken, MemberCantBeCollective, forgetPhoto, storePhoto } from './store.js'
import type { ArtistsStore, Photos, StoredArtist } from './store.js'

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
    email: z.string().nullable(),
    phone: z.string(),
    updatedBy: z.string().nullable(),
    updatedAt: Timestamp.nullable(),
    hasPhoto: z.boolean(),
    collectives: z.array(Reference).meta({ description: 'The collectives the artist is in, by name, whatever its case' }),
  })
  .meta({ id: 'Artist' })
type Artist = z.infer<typeof Artist>

const ArtistResponse = z.object({ ok: z.literal(true), artist: Artist })

// What adding an artist sends, as multipart/form-data, and changing one with `removePhoto`. The route reads it itself
// (see `readProfileForm`): only the profile is checked against its schema here.
const NewArtistForm = z.object({ artist: AdminArtistProfile, photo: PhotoFile.optional() })
const ArtistForm = NewArtistForm.extend({
  removePhoto: z
    .string()
    .optional()
    .meta({ description: '"true" removes the artist\'s photo, when there\'s no new one. Anything else keeps it' }),
})

const NO_SUCH_ARTIST: z.infer<typeof ApiError> = { ok: false, error: 'No such artist' }
const EMAIL_TAKEN: z.infer<typeof ApiError> = { ok: false, error: 'Another artist has this email address' }
const MEMBER_CANT_BECOME_COLLECTIVE: z.infer<typeof ApiError> = {
  ok: false,
  error: "An artist who is a member of a collective can't become a collective",
}

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
    collectives: row.collectives,
  }
}

type ArtistsOptions = {
  store: ArtistsStore
  photos: Photos
}

export async function artistsRoutes(app: FastifyInstance, { store, photos }: ArtistsOptions) {
  // Needed by `readProfileForm`, which sets its own limits.
  await app.register(multipart)

  const api = zodRoutes(app)

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
        response: { 200: PhotoResponse, 404: ApiError },
      },
    },
    async (request, reply) => {
      const row = await store.get(request.params.id)
      if (!row) return reply.status(404).send(NO_SUCH_ARTIST)
      return sendPhoto(reply, request.log, photos, row, 'artist')
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
      // Only admins add and change artists here, so the profile is an admin's.
      const sent = await readProfileForm(request, 'artist', AdminArtistProfile)
      if ('error' in sent) return reply.status(sent.status).send({ ok: false, error: sent.error })

      const photo = await storePhoto(photos, sent.photo, 'artists')
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
      // Only admins add and change artists here, so the profile is an admin's.
      const sent = await readProfileForm(request, 'artist', AdminArtistProfile)
      if ('error' in sent) return reply.status(sent.status).send({ ok: false, error: sent.error })
      if (sent.photo && sent.removePhoto) return reply.status(400).send({ ok: false, error: INVALID_REQUEST.error })

      // The artist's new photo, or none if it's removed. Otherwise, the artist keeps theirs.
      const photo = sent.photo || sent.removePhoto ? await storePhoto(photos, sent.photo, 'artists') : null
      let changed: Awaited<ReturnType<ArtistsStore['update']>>
      try {
        changed = await store.update(request.params.id, { ...sent.profile, ...photo, updatedBy: request.user!.email, updatedAt: new Date() })
      } catch (error) {
        await forgetPhoto(photos, request.log, photo?.photoKey ?? null)
        if (error instanceof EmailTaken) return reply.status(409).send(EMAIL_TAKEN)
        if (error instanceof MemberCantBeCollective) return reply.status(400).send(MEMBER_CANT_BECOME_COLLECTIVE)
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
        summary: 'Deletes an artist, their photo and their applications, and takes them out of their collectives',
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
