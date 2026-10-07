import type { FastifyInstance } from 'fastify'
import { APPLICATION_STATUSES } from 'shared/applications'
import type {
  Application,
  ApplicationFields,
  ApplicationResponse,
  ApplicationStatusRequest,
  ApplicationsResponse,
  CreateApplicationRequest,
  DeleteApplicationResponse,
  UpdateApplicationRequest,
} from 'shared/applications'
import type { ApiError } from 'shared/error'
import { InvalidApplication, NoSuchArtist, validateApplication } from '../applications.js'
import type { ApplicationsStore, StoredApplication } from '../applications.js'
import { requireAuth } from '../auth.js'
import { keepQueryValuesPrivate } from '../query-errors.js'

// Admin routes for applications: create, view, change, accept or reject, and delete them.

const NO_SUCH_APPLICATION: ApiError = { ok: false, error: 'No such application' }
const NO_SUCH_ARTIST: ApiError = { ok: false, error: 'No such artist' }

// The fields are listed one by one, so that a column added to the table doesn't end up in the API unless it's added here.
function application(row: StoredApplication): Application {
  return {
    id: row.id,
    artistId: row.artistId,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    dates: row.dates,
    timeSlots: row.timeSlots,
    prestations: row.prestations,
    details: row.details,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt?.toISOString() ?? null,
    status: row.status,
    statusUpdatedBy: row.statusUpdatedBy,
    statusUpdatedAt: row.statusUpdatedAt?.toISOString() ?? null,
  }
}

// Returns the checked fields of the application that was sent (see `validateApplication`), or the error to send back.
function validated(sent: unknown): ApplicationFields | ApiError {
  try {
    return validateApplication(sent)
  } catch (error) {
    if (!(error instanceof InvalidApplication)) throw error
    return { ok: false, error: error.message }
  }
}

type ApplicationsOptions = {
  store: ApplicationsStore
}

type ById = { Params: { id: string } }

export async function applicationsRoutes(app: FastifyInstance, { store }: ApplicationsOptions) {
  // An application's details can contain the artist's personal data.
  keepQueryValuesPrivate(app, 'Failed to handle a request about applications')

  app.get<{ Querystring: { artist?: string }; Reply: ApplicationsResponse }>(
    '/api/admin/applications',
    { preHandler: requireAuth },
    async (request) => {
      return { ok: true, applications: (await store.list(request.query.artist)).map(application) }
    },
  )

  app.get<ById & { Reply: ApplicationResponse | ApiError }>('/api/admin/applications/:id', { preHandler: requireAuth }, async (request, reply) => {
    const row = await store.get(request.params.id)
    if (!row) return reply.status(404).send(NO_SUCH_APPLICATION)
    return { ok: true, application: application(row) }
  })

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
