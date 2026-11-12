import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { ApiError, ById, Day, Ok, Timestamp, Total, changesTo, firstIssue, objectError, zodRoutes } from '../api/schemas.js'
import { EMAIL_MAX_LENGTH, isEmailAddress } from '../artists/profile.js'
import { ApplicationFields, ApplicationStatus, BAD_STATUS, NO_DATE, PerformanceTypeId, ReceivedAt, TimeSlot } from './fields.js'
import { ApplicationLinks, NO_LINKS, linksByApplication } from '../sessions/routes.js'
import type { SessionsStore, StoredSession } from '../sessions/store.js'
import type { ApplicationsSettings, ApplicationsSettingsStore } from './settings.js'
import { NoSuchArtist, NoSuchCollective } from './store.js'
import type { ApplicationChange, ApplicationOwner, ApplicationsStore, StoredApplication } from './store.js'

// Admin routes for applications: create, view, change, accept or reject, and delete them, and choose who the ones artists
// send are emailed to (see docs/design/server/applications.md).

// An application, as the endpoints return it: its fields, as they were saved, and what the server knows of it.
const Application = z
  .object({
    id: z.string(),
    artistId: z.string().nullable().meta({ description: "The artist who applied, or null for a collective's application" }),
    collectiveId: z.string().nullable().meta({ description: "The collective that applied, or null for an artist's application" }),
    receivedAt: Timestamp,
    createdAt: Timestamp,
    createdBy: z.string().nullable(),
    dates: z.array(Day),
    timeSlots: z.array(TimeSlot),
    performanceTypes: z.array(PerformanceTypeId),
    otherPerformanceType: z.string(),
    details: z.string(),
    updatedBy: z.string().nullable(),
    updatedAt: Timestamp.nullable(),
    status: ApplicationStatus,
    statusUpdatedBy: z.string().nullable(),
    statusUpdatedAt: Timestamp.nullable(),
    ...ApplicationLinks,
  })
  .meta({ id: 'Application' })
type Application = z.infer<typeof Application>

const ApplicationResponse = z.object({ ok: z.literal(true), application: Application })

const NO_SUCH_APPLICATION: z.infer<typeof ApiError> = { ok: false, error: 'No such application' }
const NO_SUCH_ARTIST: z.infer<typeof ApiError> = { ok: false, error: 'No such artist' }
const NO_SUCH_COLLECTIVE: z.infer<typeof ApiError> = { ok: false, error: 'No such collective' }
const ONE_OWNER = 'An application belongs to either an artist or a collective: send either artistId or collectiveId'

// What admins send to replace an application's fields, to change some of them, and to create one, with the artist or
// the collective it's for. Their errors are those of the first field that's wrong (see `firstIssue`), in the order the
// fields are checked in: the application's, when it was received, in French like the application's, then the artist or
// the collective, in English, since only admins send ids. Unlike artists applying, admins can't send other fields (see
// `objectError`), which are in English too. Anything that isn't an object gets the error of the dates, which it doesn't
// have, like `ApplicationFields`.
const APPLICATION_FIELDS = { ...ApplicationFields.shape, receivedAt: ReceivedAt.optional() }
const ApplicationReplacement = z.strictObject(APPLICATION_FIELDS, { error: objectError(NO_DATE) })
const ApplicationChanges = changesTo(APPLICATION_FIELDS)
const NewApplication = ApplicationReplacement.extend({
  artistId: z.string({ error: NO_SUCH_ARTIST.error }).optional().meta({ description: 'The artist who applies. Not with `collectiveId`' }),
  collectiveId: z
    .string({ error: NO_SUCH_COLLECTIVE.error })
    .optional()
    .meta({ description: 'The collective that applies. Not with `artistId`' }),
}).refine((sent) => (sent.artistId === undefined) !== (sent.collectiveId === undefined), ONE_OWNER)

// Who an application is for, from the ids that were sent, of which there's at most one, or nobody.
function ownerOf(artistId: string | undefined, collectiveId: string | undefined): ApplicationOwner | undefined {
  if (artistId !== undefined) return { artistId }
  return collectiveId !== undefined ? { collectiveId } : undefined
}

// The fields are listed one by one, so that a column added to the table doesn't end up in the API unless it's added here.
// With the sets and the sessions that come from it, which a new application doesn't have.
function application(row: StoredApplication, links: ApplicationLinks = NO_LINKS): Application {
  return {
    id: row.id,
    artistId: row.artistId,
    collectiveId: row.collectiveId,
    receivedAt: row.receivedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    dates: row.dates,
    timeSlots: row.timeSlots,
    performanceTypes: row.performanceTypes,
    otherPerformanceType: row.otherPerformanceType,
    details: row.details,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt?.toISOString() ?? null,
    status: row.status,
    statusUpdatedBy: row.statusUpdatedBy,
    statusUpdatedAt: row.statusUpdatedAt?.toISOString() ?? null,
    ...links,
  }
}

// The client has its own copy, for its form (see client/src/pages/admin/configuration/recipients.tsx).
const MAX_RECIPIENTS = 10
const NOT_RECIPIENTS = 'The recipients must be a list of email addresses'

// The recipients that were sent: trimmed, without blank entries or duplicates, ignoring case, keeping the first spelling
// of each. What's wrong is about the first of them that's wrong, which is either not an email address, or one too many.
// It says which one by its position in the list, rather than repeating it, since it can be someone's address.
const Recipients = z
  .array(z.string({ error: NOT_RECIPIENTS }), { error: NOT_RECIPIENTS })
  .transform((sent, context) => {
    const recipients = new Map<string, string>()
    for (const [index, sentRecipient] of sent.entries()) {
      const recipient = sentRecipient.trim()
      if (!recipient) continue
      // Like an artist's email (see artists/profile.ts).
      if (!isEmailAddress(recipient) || recipient.length > EMAIL_MAX_LENGTH) {
        context.addIssue({ code: 'custom', message: `Recipient ${index + 1} isn't an email address` })
        return z.NEVER
      }
      if (!recipients.has(recipient.toLowerCase())) recipients.set(recipient.toLowerCase(), recipient)
      if (recipients.size > MAX_RECIPIENTS) {
        context.addIssue({ code: 'custom', message: `There can be at most ${MAX_RECIPIENTS} recipients` })
        return z.NEVER
      }
    }
    return [...recipients.values()]
  })
  .meta({
    description:
      'Email addresses, which are trimmed, and blank ones and duplicates, whatever their case, are dropped. Then up to ' +
      `${MAX_RECIPIENTS}, each up to ${EMAIL_MAX_LENGTH} characters`,
  })

const ApplicationRecipients = z
  .object({
    ok: z.literal(true),
    recipients: z.array(z.string()),
    updatedBy: z.string().nullable(),
    updatedAt: Timestamp.nullable(),
  })
  .meta({ id: 'ApplicationRecipients' })
type ApplicationRecipients = z.infer<typeof ApplicationRecipients>

function recipientsResponse(settings: ApplicationsSettings | null): ApplicationRecipients {
  return {
    ok: true,
    recipients: settings?.recipients ?? [],
    updatedBy: settings?.updatedBy ?? null,
    updatedAt: settings?.updatedAt.toISOString() ?? null,
  }
}

type ApplicationsOptions = {
  store: ApplicationsStore
  settings: ApplicationsSettingsStore
  // Where the sets and the sessions that come from applications are found.
  sessions: Pick<SessionsStore, 'ofApplications'>
}

export async function applicationsRoutes(app: FastifyInstance, { store, settings, sessions }: ApplicationsOptions) {
  const api = zodRoutes(app)
  // The messages of these routes' schemas are whole sentences, e.g. in French for applications, which are sent as they are.
  app.setSchemaErrorFormatter(firstIssue)

  // The applications `rows`, as the endpoints return them, with their sets and sessions, which are found in `linked`.
  function withLinks(rows: StoredApplication[], linked: StoredSession[]): Application[] {
    const links = linksByApplication(linked)
    return rows.map((row) => application(row, links.get(row.id)))
  }

  // Responds with the application `id` that `found` finds, or changes, or 404 when there's none. Its sets and sessions are
  // found at the same time, since changing an application doesn't change them.
  async function respond(reply: FastifyReply, id: string, found: Promise<StoredApplication | null>) {
    const [row, linked] = await Promise.all([found, sessions.ofApplications([id])])
    if (!row) return reply.status(404).send(NO_SUCH_APPLICATION)
    return { ok: true as const, application: withLinks([row], linked)[0] }
  }

  api.get(
    '/api/admin/applications',
    {
      config: { admin: true, tool: { title: 'Lister les candidatures' } },
      schema: {
        operationId: 'list_applications',
        summary: "Every application, or an artist's or a collective's, the most recently received first",
        tags: ['Applications'],
        querystring: z
          .object({
            artist: z
              .string({ error: 'The artist must be a single id' })
              .optional()
              .meta({ description: "Only this artist's applications. An unknown artist has none. Not with `collective`" }),
            collective: z
              .string({ error: 'The collective must be a single id' })
              .optional()
              .meta({ description: "Only this collective's applications. An unknown collective has none. Not with `artist`" }),
          })
          .refine((query) => query.artist === undefined || query.collective === undefined, 'Only one of artist and collective can be given'),
        response: { 200: z.object({ ok: z.literal(true), total: Total, applications: z.array(Application) }) },
      },
    },
    async (request) => {
      const owner = ownerOf(request.query.artist, request.query.collective)
      const rows = await store.list(owner)
      const applications = withLinks(rows, await sessions.ofApplications(rows.map(({ id }) => id)))
      return { ok: true as const, total: applications.length, applications }
    },
  )

  // Fastify matches this path before `/api/admin/applications/:id`, and `recipients` isn't an application's id anyway.
  api.get(
    '/api/admin/applications/recipients',
    {
      config: { admin: true, tool: { title: 'Voir les destinataires des candidatures' } },
      schema: {
        operationId: 'get_application_recipients',
        summary: 'Who applications from artists are emailed to',
        tags: ['Applications'],
        response: { 200: ApplicationRecipients },
      },
    },
    async () => recipientsResponse(await settings.load()),
  )

  api.put(
    '/api/admin/applications/recipients',
    {
      config: { admin: true, tool: null },
      schema: {
        summary: 'Chooses who applications from artists are emailed to',
        tags: ['Applications'],
        body: z.strictObject({ recipients: Recipients }, { error: objectError(NOT_RECIPIENTS) }),
        response: { 200: ApplicationRecipients },
      },
    },
    async (request) => {
      const saved = { recipients: request.body.recipients, updatedBy: request.user!.email, updatedAt: new Date() }
      await settings.save(saved)
      return recipientsResponse(saved)
    },
  )

  api.get(
    '/api/admin/applications/:id',
    {
      config: { admin: true, tool: { title: 'Voir une candidature' } },
      schema: {
        operationId: 'get_application',
        summary: 'An application',
        tags: ['Applications'],
        params: ById,
        response: { 200: ApplicationResponse, 404: ApiError },
      },
    },
    async (request, reply) => respond(reply, request.params.id, store.get(request.params.id)),
  )

  // Unlike applications that artists send, these aren't emailed to the recipients, nor confirmed to the artist: the admin
  // who creates one already knows about it, and may be bringing in an old one.
  api.post(
    '/api/admin/applications',
    {
      config: { admin: true, tool: { title: 'Ajouter une candidature' } },
      schema: {
        operationId: 'create_application',
        summary: 'Creates an application for an artist or a collective',
        tags: ['Applications'],
        body: NewApplication,
        response: { 200: ApplicationResponse, 400: ApiError },
      },
    },
    async (request, reply) => {
      const { artistId, collectiveId, ...fields } = request.body
      // There's exactly one of them (see `NewApplication`).
      const owner = ownerOf(artistId, collectiveId)!
      try {
        const row = await store.create({ ...fields, ...owner, createdBy: request.user!.email })
        return { ok: true as const, application: application(row) }
      } catch (error) {
        if (error instanceof NoSuchArtist) return reply.status(400).send(NO_SUCH_ARTIST)
        if (error instanceof NoSuchCollective) return reply.status(400).send(NO_SUCH_COLLECTIVE)
        throw error
      }
    },
  )

  // Saves the changes to the application `id`, all of its fields or some of them, as `by`, and responds with it.
  async function update(id: string, changes: ApplicationChange, by: string, reply: FastifyReply) {
    return respond(reply, id, store.update(id, { ...changes, updatedBy: by, updatedAt: new Date() }))
  }

  // Not a tool: tools change applications with PATCH, which only sends what it changes (see docs/design/server/mcp.md).
  api.put(
    '/api/admin/applications/:id',
    {
      config: { admin: true, tool: null },
      schema: {
        summary: "Replaces an application's fields",
        tags: ['Applications'],
        params: ById,
        body: ApplicationReplacement,
        response: { 200: ApplicationResponse, 404: ApiError },
      },
    },
    async (request, reply) => update(request.params.id, request.body, request.user!.email, reply),
  )

  api.patch(
    '/api/admin/applications/:id',
    {
      config: { admin: true, tool: { title: 'Modifier une candidature' } },
      schema: {
        operationId: 'update_application',
        summary: "Changes an application, only the fields it's given",
        tags: ['Applications'],
        params: ById,
        body: ApplicationChanges,
        response: { 200: ApplicationResponse, 404: ApiError },
      },
    },
    async (request, reply) => update(request.params.id, request.body, request.user!.email, reply),
  )

  api.put(
    '/api/admin/applications/:id/status',
    {
      config: { admin: true, tool: { title: "Changer le statut d'une candidature" } },
      schema: {
        operationId: 'update_application_status',
        summary: 'Accepts or rejects an application, or gives it another status',
        tags: ['Applications'],
        params: ById,
        body: z.strictObject({ status: ApplicationStatus }, { error: objectError(BAD_STATUS) }),
        response: { 200: ApplicationResponse, 404: ApiError },
      },
    },
    async (request, reply) => {
      const change = { status: request.body.status, statusUpdatedBy: request.user!.email, statusUpdatedAt: new Date() }
      return respond(reply, request.params.id, store.setStatus(request.params.id, change))
    },
  )

  api.delete(
    '/api/admin/applications/:id',
    {
      config: { admin: true, tool: { title: 'Supprimer une candidature' } },
      schema: {
        operationId: 'delete_application',
        summary: 'Deletes an application, but not its sets and sessions, which stay without it',
        tags: ['Applications'],
        params: ById,
        response: { 200: Ok, 404: ApiError },
      },
    },
    async (request, reply) => {
      if (!(await store.delete(request.params.id))) return reply.status(404).send(NO_SUCH_APPLICATION)
      return { ok: true as const }
    },
  )
}
