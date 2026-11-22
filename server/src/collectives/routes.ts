import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import multipart from '@fastify/multipart'
import { z } from 'zod'
import { ApiError, ById, Ok, Reference, Timestamp, Total, changesTo, firstIssue, zodRoutes } from '../api/schemas.js'
import { PhotoForm, PublicSizes, photoRoute, publicSizeRoute, publicSizes, readImageForm, readProfileForm, sendPhoto, sendPublicSize } from '../artists/photo-form.js'
import { ArtistLinks, Country, PhotoFile } from '../artists/profile.js'
import { EmailTaken, PHOTO_ERRORS, forgetPhoto, storePhoto } from '../artists/store.js'
import type { NewPhoto, Photos } from '../artists/store.js'
import { AdminCollectiveProfile } from './profile.js'
import type { CollectiveProfile } from './profile.js'
import { ConflictError, conflictBody } from '../sessions/routes.js'
import { Conflict } from '../sessions/store.js'
import { InvalidMember } from './store.js'
import type { CollectivesStore, StoredCollective } from './store.js'

// The admin pages' side of collectives: adding, viewing, changing and deleting them, and the public profiles of the
// collectives that are public (see docs/design/server/collectives.md). They work like artists' (see artists/routes.ts).

// A collective, as the endpoints return it: its profile, as it was saved, and what the server knows of it.
const Collective = z
  .object({
    id: z.string(),
    createdAt: Timestamp,
    createdBy: z.string().nullable(),
    name: z.string(),
    members: z.array(Reference).meta({ description: 'In order' }),
    country: z.union([Country, z.literal('')]),
    city: z.string(),
    description: z.string(),
    links: ArtistLinks,
    email: z.string().nullable(),
    phone: z.string(),
    updatedBy: z.string().nullable(),
    updatedAt: Timestamp.nullable(),
    hasPhoto: z.boolean(),
  })
  .meta({ id: 'Collective' })
type Collective = z.infer<typeof Collective>

const CollectiveResponse = z.object({ ok: z.literal(true), collective: Collective })

// A public collective's profile, as the public sees it, with its members, who are public through it.
const PublicCollective = Collective.pick({ id: true, name: true, country: true, city: true, description: true, links: true, members: true })
  .extend({ photo: PublicSizes.nullable().meta({ description: 'Where the sizes of its photo are, by width, or null when it has none' }) })
  .meta({ id: 'PublicCollective' })
type PublicCollective = z.infer<typeof PublicCollective>

// What adding a collective sends, as multipart/form-data. The route reads it itself (see `readProfileForm`): only the
// profile is checked against its schema here.
const NewCollectiveForm = z.object({ collective: AdminCollectiveProfile, photo: PhotoFile.optional() })

// What changing some of a collective's fields sends, as JSON.
const CollectiveChanges = changesTo(AdminCollectiveProfile.shape)

const NO_SUCH_COLLECTIVE: z.infer<typeof ApiError> = { ok: false, error: 'No such collective' }
const EMAIL_TAKEN: z.infer<typeof ApiError> = { ok: false, error: 'Another collective has this email address' }

function collective(row: StoredCollective): Collective {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    name: row.name,
    members: row.members,
    country: row.country,
    city: row.city,
    description: row.description,
    links: row.links,
    email: row.email,
    phone: row.phone,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt?.toISOString() ?? null,
    hasPhoto: row.photoKey !== null,
  }
}

// Where the public gets the sizes of collectives' photos.
const PHOTOS = '/api/collectives/photos'

// The fields are listed one by one, so that nothing else the admin endpoints give ends up public unless it's added here.
function publicCollective(row: StoredCollective): PublicCollective {
  return {
    id: row.id,
    name: row.name,
    country: row.country,
    city: row.city,
    description: row.description,
    links: row.links,
    members: row.members,
    photo: publicSizes(PHOTOS, row.photoKey),
  }
}

type CollectivesOptions = {
  store: CollectivesStore
  photos: Photos
}

export async function collectivesRoutes(app: FastifyInstance, { store, photos }: CollectivesOptions) {
  // Needed by `readProfileForm`, which sets its own limits.
  await app.register(multipart)

  const api = zodRoutes(app)

  api.get(
    '/api/admin/collectives',
    {
      config: { admin: true, tool: { title: 'Lister les collectifs' } },
      schema: {
        operationId: 'list_collectives',
        summary: 'Every collective, by name',
        tags: ['Collectives'],
        response: { 200: z.object({ ok: z.literal(true), total: Total, collectives: z.array(Collective) }) },
      },
    },
    async () => {
      const collectives = (await store.list()).map(collective)
      return { ok: true as const, total: collectives.length, collectives }
    },
  )

  api.get(
    '/api/admin/collectives/:id',
    {
      config: { admin: true, tool: { title: 'Voir un collectif' } },
      schema: {
        operationId: 'get_collective',
        summary: 'A collective',
        tags: ['Collectives'],
        params: ById,
        response: { 200: CollectiveResponse, 404: ApiError },
      },
    },
    async (request, reply) => {
      const row = await store.get(request.params.id)
      if (!row) return reply.status(404).send(NO_SUCH_COLLECTIVE)
      return { ok: true as const, collective: collective(row) }
    },
  )

  api.get(
    '/api/admin/collectives/:id/photo',
    photoRoute('collective', { summary: "A collective's photo, as it was sent, or one of its sizes", tags: ['Collectives'] }),
    async (request, reply) => {
      const row = await store.get(request.params.id)
      if (!row) return reply.status(404).send(NO_SUCH_COLLECTIVE)
      return sendPhoto(reply, photos, row, 'collective', request.query.width)
    },
  )

  api.post(
    '/api/admin/collectives',
    {
      config: { admin: true, tool: { title: 'Ajouter un collectif' } },
      schema: {
        operationId: 'create_collective',
        summary: 'Adds a collective, with or without a photo, and the members it names',
        tags: ['Collectives'],
        multipart: NewCollectiveForm,
        response: { 200: CollectiveResponse, 400: ApiError, 409: ApiError, 413: ApiError },
      },
    },
    async (request, reply) => {
      const sent = await readProfileForm(request, 'collective', AdminCollectiveProfile)
      if ('error' in sent) return reply.status(sent.status).send({ ok: false, error: sent.error })

      const photo = await storePhoto(photos, sent.photo, 'collectives')
      try {
        const row = await store.create({ ...sent.profile, photo, createdBy: request.user!.email })
        return { ok: true as const, collective: collective(row) }
      } catch (error) {
        await forgetPhoto(photos, request.log, photo?.key)
        if (error instanceof EmailTaken) return reply.status(409).send(EMAIL_TAKEN)
        if (error instanceof InvalidMember) return reply.status(400).send({ ok: false, error: error.message })
        throw error
      }
    },
  )

  // Saves `changes` to the collective with the id of `request`, some of its profile's fields, or its photo, `photo`, a
  // new one or none, and responds with the collective as it is then.
  async function update(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
    changes: Partial<CollectiveProfile>,
    photo?: NewPhoto | null,
  ) {
    let changed: Awaited<ReturnType<CollectivesStore['update']>>
    try {
      changed = await store.update(request.params.id, { ...changes, photo, updatedBy: request.user!.email, updatedAt: new Date() })
    } catch (error) {
      await forgetPhoto(photos, request.log, photo?.key)
      if (error instanceof EmailTaken) return reply.status(409).send(EMAIL_TAKEN)
      if (error instanceof InvalidMember) return reply.status(400).send({ ok: false, error: error.message })
      throw error
    }
    if (!changed) {
      await forgetPhoto(photos, request.log, photo?.key)
      return reply.status(404).send(NO_SUCH_COLLECTIVE)
    }

    // The photo the collective had, which was replaced or removed.
    if (photo !== undefined) await forgetPhoto(photos, request.log, changed.before.photoKey)
    return { ok: true as const, collective: collective(changed.after) }
  }

  api.patch(
    '/api/admin/collectives/:id',
    {
      config: { admin: true, tool: { title: 'Modifier un collectif' } },
      schema: {
        operationId: 'update_collective',
        summary: "Changes a collective's profile and members, only the fields it's given, but not its photo",
        tags: ['Collectives'],
        params: ById,
        body: CollectiveChanges,
        response: { 200: CollectiveResponse, 400: ApiError, 404: ApiError, 409: ApiError },
      },
      // The profile's errors are whole sentences, in French, like those of `readProfileForm`.
      schemaErrorFormatter: firstIssue,
    },
    async (request, reply) => update(request, reply, request.body),
  )

  // Not a tool, like PUT /api/admin/artists/:id/photo (see artists/routes.ts).
  api.put(
    '/api/admin/collectives/:id/photo',
    {
      config: { admin: true, tool: null },
      schema: {
        summary: 'Gives a collective a photo, or replaces its photo, which is deleted, and changes nothing else',
        tags: ['Collectives'],
        params: ById,
        multipart: PhotoForm,
        response: { 200: CollectiveResponse, 400: ApiError, 404: ApiError, 413: ApiError },
      },
    },
    async (request, reply) => {
      const sent = await readImageForm(request, 'photo', PHOTO_ERRORS)
      if ('error' in sent) return reply.status(sent.status).send({ ok: false, error: sent.error })
      return update(request, reply, {}, await photos.store(sent.image, 'collectives'))
    },
  )

  api.delete(
    '/api/admin/collectives/:id/photo',
    {
      config: { admin: true, tool: { title: "Retirer la photo d'un collectif" } },
      schema: {
        operationId: 'delete_collective_photo',
        summary: "Removes a collective's photo, which is deleted, and changes nothing else",
        tags: ['Collectives'],
        params: ById,
        response: { 200: CollectiveResponse, 404: ApiError },
      },
    },
    async (request, reply) => update(request, reply, {}, null),
  )

  api.delete(
    '/api/admin/collectives/:id',
    {
      config: { admin: true, tool: { title: 'Supprimer un collectif' } },
      schema: {
        operationId: 'delete_collective',
        summary:
          "Deletes a collective, its photo and its applications, but not its members. Fails while it has takeovers, one of which the error names: give them another collective, or another type, first",
        tags: ['Collectives'],
        params: ById,
        response: { 200: Ok, 404: ApiError, 409: ConflictError },
      },
    },
    async (request, reply) => {
      let row: Awaited<ReturnType<CollectivesStore['delete']>>
      try {
        row = await store.delete(request.params.id)
      } catch (error) {
        if (error instanceof Conflict) return reply.status(409).send(conflictBody({ error: error.message, session: error.session, set: error.set }))
        throw error
      }
      if (!row) return reply.status(404).send(NO_SUCH_COLLECTIVE)
      // The collective is gone either way.
      await forgetPhoto(photos, request.log, row.photoKey)
      return { ok: true as const }
    },
  )

  api.get(
    '/api/collectives/:id',
    {
      config: { tool: { title: "Voir le profil public d'un collectif" } },
      schema: {
        operationId: 'get_public_collective',
        summary: "A public collective's profile, as the public sees it, with its members: a collective that isn't public is not found",
        tags: ['Collectives'],
        params: ById,
        response: { 200: z.object({ ok: z.literal(true), collective: PublicCollective }), 404: ApiError },
      },
    },
    async (request, reply) => {
      // A private collective is not found, like one that doesn't exist.
      const row = await store.getPublic(request.params.id)
      if (!row) return reply.status(404).send(NO_SUCH_COLLECTIVE)
      return { ok: true as const, collective: publicCollective(row) }
    },
  )

  api.get(
    `${PHOTOS}/:image/:size`,
    publicSizeRoute('photo', { summary: 'One of the sizes of a photo that a public collective has', tags: ['Collectives'] }),
    (request, reply) => sendPublicSize(reply, photos, 'photo', request.params, store.getPublicPhoto),
  )
}
