import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { DrizzleQueryError } from 'drizzle-orm'
import type { ApiError } from './schemas.js'

// The parts of an error that are safe to log: for a failed query, everything but its values.
function withoutValues(error: Error): object {
  if (!(error instanceof DrizzleQueryError)) return error
  const cause: { message?: string; code?: string } | undefined = error.cause
  return { type: 'DrizzleQueryError', query: error.query, cause: { message: cause?.message, code: cause?.code } }
}

const INTERNAL_ERROR = 'Internal server error'

// What requests for paths that don't exist get.
export const NOT_FOUND = { ok: false, error: 'Not found' } satisfies ApiError

type ErrorMessages = {
  // The message of a 4xx that Fastify or a plugin raises, e.g. because a body is too large.
  clientError?: (error: FastifyError) => string
  // The message of unexpected errors.
  internalError?: string
}

// Sends every error of the routes of `app` as an `ApiError`, including those of the requests that no route matches. Those
// get a 404 when their body can't be read, e.g. because it isn't valid JSON, since Fastify reads it before its
// not-found handler runs.
//
// When a query fails, Drizzle's error includes the query's values, e.g. an artist's personal data. Those values must
// not end up in the logs, or in the response, where Fastify would put the error's message. So unexpected errors are
// logged with only the query and Postgres's error, and their response only says that something went wrong.
//
// The messages can be chosen, e.g. to have them in French for a plugin whose errors the public sees.
export function useApiErrors(app: FastifyInstance, messages: ErrorMessages = {}) {
  const { clientError = (error: FastifyError) => error.message, internalError = INTERNAL_ERROR } = messages
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const status = error.statusCode ?? 500
    if (status >= 400 && status < 500) {
      // Only for the errors of reading the body: those of a not-found handler itself, e.g. a 416 for a `Range` header
      // while sending the client's index.html, are its own.
      const unreadBody = request.is404 && error.code?.startsWith('FST_ERR_CTP_')
      return unreadBody ? sendError(reply, 404, NOT_FOUND.error) : sendError(reply, status, clientError(error))
    }
    const where = request.is404
      ? `a ${request.method} request that matched no route`
      : `${request.method} ${request.routeOptions.url}`
    request.log.error({ err: withoutValues(error) }, `Failed to handle ${where}`)
    return sendError(reply, 500, internalError)
  })
}

// As JSON, even when the error happened while sending a file, after the reply was given the file's type, and headers that
// would let it be cached as the file.
function sendError(reply: FastifyReply, status: number, error: string) {
  for (const header of ['cache-control', 'etag', 'last-modified']) reply.removeHeader(header)
  return reply.status(status).type('application/json; charset=utf-8').send({ ok: false, error } satisfies ApiError)
}

// Fastify's messages for these quote the request's path.
const ROUTING_ERRORS: Record<string, string> = { FST_ERR_BAD_URL: 'Invalid URL', FST_ERR_MAX_PARAM_LENGTH: 'URL too long' }

// For `Fastify({ frameworkErrors })`: sends the errors that Fastify raises before routing a request, which no error
// handler sees, e.g. for a URL that isn't valid, as an `ApiError`.
export function frameworkErrors(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  const known = ROUTING_ERRORS[error.code]
  if (known && error.statusCode) return sendError(reply, error.statusCode, known)
  request.log.error({ err: error }, 'Failed to route a request')
  return sendError(reply, 500, INTERNAL_ERROR)
}

// Whether a query failed because it broke the constraint `name`, e.g. a unique index. Drizzle wraps the database's
// error, which names the constraint.
export function violatesConstraint(error: unknown, name: string): boolean {
  const cause: unknown = error instanceof Error ? error.cause : undefined
  return cause instanceof Error && 'constraint' in cause && cause.constraint === name
}
