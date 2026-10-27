import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { ApiError, ById, Day, Ok, Timestamp, firstIssue, zodRoutes } from '../api/schemas.js'
import { EMAIL_MAX_LENGTH, isEmailAddress } from '../artists/profile.js'
import { ApplicationFields, ApplicationStatus, BAD_STATUS, PrestationId, ReceivedAt, TimeSlot } from './fields.js'
import type { ApplicationsSettings, ApplicationsSettingsStore } from './settings.js'
import { NoSuchArtist } from './store.js'
import type { ApplicationsStore, StoredApplication } from './store.js'

// Admin routes for applications: create, view, change, accept or reject, and delete them, and choose who the ones artists
// send are emailed to (see docs/design/server/applications.md).

// An application, as the endpoints return it: its fields, as they were saved, and what the server knows of it.
const Application = z
  .object({
    id: z.string(),
    artistId: z.string(),
    receivedAt: Timestamp,
    createdAt: Timestamp,
    createdBy: z.string().nullable(),
    dates: z.array(Day),
    timeSlots: z.array(TimeSlot),
    prestations: z.array(PrestationId),
    otherPrestation: z.string(),
    details: z.string(),
    updatedBy: z.string().nullable(),
    updatedAt: Timestamp.nullable(),
    status: ApplicationStatus,
    statusUpdatedBy: z.string().nullable(),
    statusUpdatedAt: Timestamp.nullable(),
  })
  .meta({ id: 'Application' })
type Application = z.infer<typeof Application>

const ApplicationResponse = z.object({ ok: z.literal(true), application: Application })

// What admins send to change an application, and to create one, with the artist. Their errors are in French, like the
// application's (see `firstIssue`), and are those of the first field that's wrong, in the order the fields are checked
// in: the application's, when it was received, then the artist.
const ApplicationChanges = ApplicationFields.extend({ receivedAt: ReceivedAt.optional() })
const NewApplication = ApplicationChanges.extend({ artistId: z.string({ error: 'No such artist' }) })

const NO_SUCH_APPLICATION: z.infer<typeof ApiError> = { ok: false, error: 'No such application' }
const NO_SUCH_ARTIST: z.infer<typeof ApiError> = { ok: false, error: 'No such artist' }

// The fields are listed one by one, so that a column added to the table doesn't end up in the API unless it's added here.
function application(row: StoredApplication): Application {
  return {
    id: row.id,
    artistId: row.artistId,
    receivedAt: row.receivedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    dates: row.dates,
    timeSlots: row.timeSlots,
    prestations: row.prestations,
    otherPrestation: row.otherPrestation,
    details: row.details,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt?.toISOString() ?? null,
    status: row.status,
    statusUpdatedBy: row.statusUpdatedBy,
    statusUpdatedAt: row.statusUpdatedAt?.toISOString() ?? null,
  }
}

// The client has its own copy, for its form (see client/src/pages/admin/configuration/recipients.tsx).
const MAX_RECIPIENTS = 10
const NOT_RECIPIENTS = 'The recipients must be a list of email addresses'

// The recipients that were sent: trimmed, without blank entries or duplicates, ignoring case, keeping the first spelling
// of each. What's wrong is about the first of them that's wrong, which is either not an email address, or one too many.
const Recipients = z
  .array(z.string({ error: NOT_RECIPIENTS }), { error: NOT_RECIPIENTS })
  .transform((sent, context) => {
    const recipients = new Map<string, string>()
    for (const recipient of sent.map((recipient) => recipient.trim()).filter(Boolean)) {
      // Like an artist's email (see artists/profile.ts).
      if (!isEmailAddress(recipient) || recipient.length > EMAIL_MAX_LENGTH) {
        context.addIssue({ code: 'custom', message: `Not an email address: ${recipient}` })
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
}

export async function applicationsRoutes(app: FastifyInstance, { store, settings }: ApplicationsOptions) {
  // An application's details can contain the artist's personal data.
  const api = zodRoutes(app, 'Failed to handle a request about applications')
  // The messages of these routes' schemas are whole sentences, e.g. in French for applications, which are sent as they are.
  app.setSchemaErrorFormatter(firstIssue)

  api.get(
    '/api/admin/applications',
    {
      config: { admin: true },
      schema: {
        summary: "Every application, or an artist's, the most recently received first",
        tags: ['Applications'],
        querystring: z.object({
          artist: z
            .string({ error: 'The artist must be a single id' })
            .optional()
            .meta({ description: "Only this artist's applications. An unknown artist has none" }),
        }),
        response: { 200: z.object({ ok: z.literal(true), applications: z.array(Application) }) },
      },
    },
    async (request) => ({ ok: true as const, applications: (await store.list(request.query.artist)).map(application) }),
  )

  // Fastify matches this path before `/api/admin/applications/:id`, and `recipients` isn't an application's id anyway.
  api.get(
    '/api/admin/applications/recipients',
    {
      config: { admin: true },
      schema: { summary: 'Who applications from artists are emailed to', tags: ['Applications'], response: { 200: ApplicationRecipients } },
    },
    async () => recipientsResponse(await settings.load()),
  )

  api.put(
    '/api/admin/applications/recipients',
    {
      config: { admin: true },
      schema: {
        summary: 'Chooses who applications from artists are emailed to',
        tags: ['Applications'],
        body: z.object({ recipients: Recipients }, { error: NOT_RECIPIENTS }),
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
      config: { admin: true },
      schema: { summary: 'An application', tags: ['Applications'], params: ById, response: { 200: ApplicationResponse, 404: ApiError } },
    },
    async (request, reply) => {
      const row = await store.get(request.params.id)
      if (!row) return reply.status(404).send(NO_SUCH_APPLICATION)
      return { ok: true as const, application: application(row) }
    },
  )

  // Unlike applications that artists send, these aren't emailed to the recipients, nor confirmed to the artist: the admin
  // who creates one already knows about it, and may be bringing in an old one.
  api.post(
    '/api/admin/applications',
    {
      config: { admin: true },
      schema: {
        summary: 'Creates an application for an artist',
        tags: ['Applications'],
        body: NewApplication,
        response: { 200: ApplicationResponse, 400: ApiError },
      },
    },
    async (request, reply) => {
      try {
        const row = await store.create({ ...request.body, createdBy: request.user!.email })
        return { ok: true as const, application: application(row) }
      } catch (error) {
        if (error instanceof NoSuchArtist) return reply.status(400).send(NO_SUCH_ARTIST)
        throw error
      }
    },
  )

  api.put(
    '/api/admin/applications/:id',
    {
      config: { admin: true },
      schema: {
        summary: 'Changes an application',
        tags: ['Applications'],
        params: ById,
        body: ApplicationChanges,
        response: { 200: ApplicationResponse, 404: ApiError },
      },
    },
    async (request, reply) => {
      const row = await store.update(request.params.id, { ...request.body, updatedBy: request.user!.email, updatedAt: new Date() })
      if (!row) return reply.status(404).send(NO_SUCH_APPLICATION)
      return { ok: true as const, application: application(row) }
    },
  )

  api.put(
    '/api/admin/applications/:id/status',
    {
      config: { admin: true },
      schema: {
        summary: 'Accepts or rejects an application, or gives it another status',
        tags: ['Applications'],
        params: ById,
        body: z.object({ status: ApplicationStatus }, { error: BAD_STATUS }),
        response: { 200: ApplicationResponse, 404: ApiError },
      },
    },
    async (request, reply) => {
      const change = { status: request.body.status, statusUpdatedBy: request.user!.email, statusUpdatedAt: new Date() }
      const row = await store.setStatus(request.params.id, change)
      if (!row) return reply.status(404).send(NO_SUCH_APPLICATION)
      return { ok: true as const, application: application(row) }
    },
  )

  api.delete(
    '/api/admin/applications/:id',
    {
      config: { admin: true },
      schema: { summary: 'Deletes an application', tags: ['Applications'], params: ById, response: { 200: Ok, 404: ApiError } },
    },
    async (request, reply) => {
      if (!(await store.delete(request.params.id))) return reply.status(404).send(NO_SUCH_APPLICATION)
      return { ok: true as const }
    },
  )
}
