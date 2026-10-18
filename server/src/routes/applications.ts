import type { FastifyInstance } from 'fastify'
import { APPLICATION_STATUSES, MAX_RECIPIENTS, checkReceivedAt } from 'shared/applications'
import type {
  Application,
  ApplicationFields,
  ApplicationRecipientsRequest,
  ApplicationRecipientsResponse,
  ApplicationResponse,
  ApplicationStatusRequest,
  ApplicationsResponse,
  CreateApplicationRequest,
  DeleteApplicationResponse,
  UpdateApplicationRequest,
} from 'shared/applications'
import { EMAIL_MAX_LENGTH, isEmailAddress } from 'shared/artists'
import type { ApiError } from 'shared/error'
import { InvalidApplication, NoSuchArtist, validateApplication } from '../applications.js'
import type { ApplicationsStore, StoredApplication } from '../applications.js'
import type { ApplicationsSettings, ApplicationsSettingsStore } from '../applications-settings.js'
import { requireAuth } from '../auth.js'
import { keepQueryValuesPrivate } from '../query-errors.js'

// Admin routes for applications: create, view, change, accept or reject, and delete them, and choose who the ones artists
// send are emailed to.

const NO_SUCH_APPLICATION: ApiError = { ok: false, error: 'No such application' }
const NO_SUCH_ARTIST: ApiError = { ok: false, error: 'No such artist' }

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

// Returns the checked fields of the application that was sent (see `validateApplication`), with when it was received if
// that was sent too (see `checkReceivedAt`), or the error to send back.
function validated(sent: Partial<UpdateApplicationRequest> | null): (ApplicationFields & { receivedAt?: Date }) | ApiError {
  let fields
  try {
    fields = validateApplication(sent)
  } catch (error) {
    if (!(error instanceof InvalidApplication)) throw error
    return { ok: false, error: error.message }
  }
  const receivedAt = checkReceivedAt(sent?.receivedAt)
  if (receivedAt.error !== undefined) return { ok: false, error: receivedAt.error }
  return { ...fields, receivedAt: receivedAt.value }
}

function recipientsResponse(settings: ApplicationsSettings | null): ApplicationRecipientsResponse {
  return {
    ok: true,
    recipients: settings?.recipients ?? [],
    updatedBy: settings?.updatedBy ?? null,
    updatedAt: settings?.updatedAt.toISOString() ?? null,
  }
}

// The recipients that were sent, trimmed, without blank entries or duplicates (ignoring case), or the error to send
// back.
function validatedRecipients(sent: unknown): string[] | ApiError {
  if (!Array.isArray(sent) || sent.some((recipient) => typeof recipient !== 'string')) {
    return { ok: false, error: 'The recipients must be a list of email addresses' }
  }
  // By address, ignoring case, the first spelling of each.
  const recipients = new Map<string, string>()
  for (const recipient of sent.map((recipient: string) => recipient.trim()).filter(Boolean)) {
    // Like an artist's email.
    if (!isEmailAddress(recipient) || recipient.length > EMAIL_MAX_LENGTH) return { ok: false, error: `Not an email address: ${recipient}` }
    if (!recipients.has(recipient.toLowerCase())) recipients.set(recipient.toLowerCase(), recipient)
    if (recipients.size > MAX_RECIPIENTS) return { ok: false, error: `There can be at most ${MAX_RECIPIENTS} recipients` }
  }
  return [...recipients.values()]
}

type ApplicationsOptions = {
  store: ApplicationsStore
  settings: ApplicationsSettingsStore
}

type ById = { Params: { id: string } }

export async function applicationsRoutes(app: FastifyInstance, { store, settings }: ApplicationsOptions) {
  // An application's details can contain the artist's personal data.
  keepQueryValuesPrivate(app, 'Failed to handle a request about applications')

  app.get<{ Querystring: { artist?: string }; Reply: ApplicationsResponse }>(
    '/api/admin/applications',
    { preHandler: requireAuth },
    async (request) => {
      return { ok: true, applications: (await store.list(request.query.artist)).map(application) }
    },
  )

  // Fastify matches this path before `/api/admin/applications/:id`, and `recipients` isn't an application's id anyway.
  app.get<{ Reply: ApplicationRecipientsResponse }>('/api/admin/applications/recipients', { preHandler: requireAuth }, async () => {
    return recipientsResponse(await settings.load())
  })

  app.put<{ Body: Partial<ApplicationRecipientsRequest> | null; Reply: ApplicationRecipientsResponse | ApiError }>(
    '/api/admin/applications/recipients',
    { preHandler: requireAuth },
    async (request, reply) => {
      const recipients = validatedRecipients(request.body?.recipients)
      if ('error' in recipients) return reply.status(400).send(recipients)
      const saved = { recipients, updatedBy: request.user!.email, updatedAt: new Date() }
      await settings.save(saved)
      return recipientsResponse(saved)
    },
  )

  app.get<ById & { Reply: ApplicationResponse | ApiError }>('/api/admin/applications/:id', { preHandler: requireAuth }, async (request, reply) => {
    const row = await store.get(request.params.id)
    if (!row) return reply.status(404).send(NO_SUCH_APPLICATION)
    return { ok: true, application: application(row) }
  })

  // Unlike applications that artists send, these aren't emailed to the recipients, nor confirmed to the artist: the admin
  // who creates one already knows about it, and may be bringing in an old one.
  app.post<{ Body: Partial<CreateApplicationRequest> | null; Reply: ApplicationResponse | ApiError }>(
    '/api/admin/applications',
    { preHandler: requireAuth },
    async (request, reply) => {
      const fields = validated(request.body)
      if ('error' in fields) return reply.status(400).send(fields)
      const artistId = request.body?.artistId
      if (typeof artistId !== 'string') return reply.status(400).send(NO_SUCH_ARTIST)
      try {
        const row = await store.create({ ...fields, artistId, createdBy: request.user!.email })
        return { ok: true, application: application(row) }
      } catch (error) {
        if (error instanceof NoSuchArtist) return reply.status(400).send(NO_SUCH_ARTIST)
        throw error
      }
    },
  )

  app.put<ById & { Body: Partial<UpdateApplicationRequest> | null; Reply: ApplicationResponse | ApiError }>(
    '/api/admin/applications/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const fields = validated(request.body)
      if ('error' in fields) return reply.status(400).send(fields)
      const row = await store.update(request.params.id, { ...fields, updatedBy: request.user!.email, updatedAt: new Date() })
      if (!row) return reply.status(404).send(NO_SUCH_APPLICATION)
      return { ok: true, application: application(row) }
    },
  )

  app.put<ById & { Body: Partial<ApplicationStatusRequest> | null; Reply: ApplicationResponse | ApiError }>(
    '/api/admin/applications/:id/status',
    { preHandler: requireAuth },
    async (request, reply) => {
      const status = APPLICATION_STATUSES.find((status) => status === request.body?.status)
      if (!status) {
        return reply.status(400).send({ ok: false, error: `The status must be one of ${APPLICATION_STATUSES.join(', ')}` })
      }
      const row = await store.setStatus(request.params.id, { status, statusUpdatedBy: request.user!.email, statusUpdatedAt: new Date() })
      if (!row) return reply.status(404).send(NO_SUCH_APPLICATION)
      return { ok: true, application: application(row) }
    },
  )

  app.delete<ById & { Reply: DeleteApplicationResponse | ApiError }>(
    '/api/admin/applications/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!(await store.delete(request.params.id))) return reply.status(404).send(NO_SUCH_APPLICATION)
      return { ok: true }
    },
  )
}
