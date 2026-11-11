import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import multipart from '@fastify/multipart'
import { z } from 'zod'
import { ApiError, ById, Ok, Reference, Timestamp, Total, changesTo, firstIssue, zodRoutes } from '../api/schemas.js'
import { INVALID_REQUEST, PhotoResponse, readProfileForm, sendPhoto } from './photo-form.js'
import { AdminArtistProfile, ArtistLinks, Country, GenreId, PhotoFile } from './profile.js'
import type { Profile } from './profile.js'
import { EmailTaken, forgetPhoto, storePhoto } from './store.js'
import type { ArtistsStore, Photos, SentPhoto, StoredArtist } from './store.js'

// The admin pages' side of artists: adding, viewing, changing and deleting them (see docs/design/server/artists.md).

// An artist, as the endpoints return them: their profile, as it was saved, and what the server knows of them.
const Artist = z
  .object({
    id: z.string(),
    createdAt: Timestamp,
    createdBy: z.string().nullable(),
    name: z.string(),
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

// What changing some of an artist's fields sends, as JSON.
const ArtistChanges = changesTo({
  ...AdminArtistProfile.shape,
  removePhoto: z.boolean().meta({ description: "`true` removes the artist's photo, and deletes it. `false` keeps it, like leaving it out" }),
})

const NO_SUCH_ARTIST: z.infer<typeof ApiError> = { ok: false, error: 'No such artist' }
const EMAIL_TAKEN: z.infer<typeof ApiError> = { ok: false, error: 'Another artist has this email address' }

function artist(row: StoredArtist): Artist {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    name: row.name,
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
      config: { admin: true, tool: { title: 'Lister les artistes' } },
      schema: {
        operationId: 'list_artists',
        summary: "Every artist, by name, or a collective's, in its order",
        tags: ['Artists'],
        querystring: z.object({
          collective: z
            // The field's name comes before the message (see `useZodSchemas`).
            .string({ error: 'Must be a single id' })
            .optional()
            .meta({ description: "Only this collective's members, in its order. An unknown collective has none" }),
        }),
        response: { 200: z.object({ ok: z.literal(true), total: Total, artists: z.array(Artist) }) },
      },
    },
    async (request) => {
      const artists = (await store.list(request.query.collective)).map(artist)
      return { ok: true as const, total: artists.length, artists }
    },
  )

  api.get(
    '/api/admin/artists/:id',
    {
      config: { admin: true, tool: { title: 'Voir un artiste' } },
      schema: {
        operationId: 'get_artist',
        summary: 'An artist',
        tags: ['Artists'],
        params: ById,
        response: { 200: ArtistResponse, 404: ApiError },
      },
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
      config: { admin: true, tool: null },
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
      config: { admin: true, tool: { title: 'Ajouter un artiste' } },
      schema: {
        operationId: 'create_artist',
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

  // Saves `changes` to the artist with the id of `request`, the whole profile or some of its fields, with `photo`, which
  // replaces theirs, or none when `removePhoto`, and responds with the artist as they are then.
  async function update(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
    changes: Partial<Profile>,
    sentPhoto: SentPhoto | null,
    removePhoto: boolean,
  ) {
    // The artist's new photo, or none if it's removed. Otherwise, the artist keeps theirs.
    const photo = sentPhoto || removePhoto ? await storePhoto(photos, sentPhoto, 'artists') : null
    let changed: Awaited<ReturnType<ArtistsStore['update']>>
    try {
      changed = await store.update(request.params.id, { ...changes, ...photo, updatedBy: request.user!.email, updatedAt: new Date() })
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
  }

  // Not a tool: tools change artists with PATCH, which only sends what it changes, and so keeps the email and phone they
  // never see (see docs/design/server/mcp.md).
  api.put(
    '/api/admin/artists/:id',
    {
      config: { admin: true, tool: null },
      schema: {
        summary: "Replaces an artist's profile, and replaces or removes their photo",
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
      return update(request, reply, sent.profile, sent.photo, sent.removePhoto)
    },
  )

  api.patch(
    '/api/admin/artists/:id',
    {
      config: { admin: true, tool: { title: 'Modifier un artiste' } },
      schema: {
        operationId: 'update_artist',
        summary: "Changes an artist's profile, only the fields it's given, or removes their photo",
        tags: ['Artists'],
        params: ById,
        body: ArtistChanges,
        response: { 200: ArtistResponse, 400: ApiError, 404: ApiError, 409: ApiError },
      },
      // The profile's errors are whole sentences, in French, like those of `readProfileForm`.
      schemaErrorFormatter: firstIssue,
    },
    async (request, reply) => {
      const { removePhoto, ...changes } = request.body
      return update(request, reply, changes, null, removePhoto === true)
    },
  )

  api.delete(
    '/api/admin/artists/:id',
    {
      config: { admin: true, tool: { title: 'Supprimer un artiste' } },
      schema: {
        operationId: 'delete_artist',
        summary: 'Deletes an artist, their photo and their applications, and takes them out of their collectives and their sets',
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
