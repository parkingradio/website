import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { DrizzleQueryError } from 'drizzle-orm'
import { logWithRequest } from '../core/logger.js'
import type { ApiError } from './schemas.js'

// The parts of an error that are safe to log: for a failed query, everything but its values.
export function withoutValues(error: unknown): unknown {
  if (!(error instanceof DrizzleQueryError)) return error
  const cause: { message?: string; code?: string } | undefined = error.cause
  return { type: 'DrizzleQueryError', query: error.query, cause: { message: cause?.message, code: cause?.code } }
}

export const INTERNAL_ERROR = 'Internal server error'

// What requests for paths that don't exist get.
export const NOT_FOUND = { ok: false, error: 'Not found' } satisfies ApiError

type ErrorOptions = {
  // The message of a 4xx that Fastify or a plugin raises, e.g. because a body is too large.
  clientError?: (error: FastifyError) => string
  // The message of unexpected errors.
  internalError?: string
  // How an error is sent, as an `ApiError` unless said otherwise, e.g. in OAuth's format, which can also give it another
  // status than the error's.
  send?: (reply: FastifyReply, status: number, message: string) => FastifyReply
}

// Sends every error of the routes of `app` as an `ApiError`, including those of the requests that no route matches. Those
// get a 404 when their body can't be read, e.g. because it isn't valid JSON, since Fastify reads it before its
// not-found handler runs.
//
// When a query fails, Drizzle's error includes the query's values, e.g. an artist's personal data. Those values must
// not end up in the logs, or in the response, where Fastify would put the error's message. So unexpected errors are
// logged with only the query and Postgres's error, and their response only says that something went wrong.
//
// The messages can be chosen, e.g. to have them in French for a plugin whose errors the public sees, and so can how errors
// are sent.
export function useApiErrors(app: FastifyInstance, options: ErrorOptions = {}) {
  const { clientError = (error: FastifyError) => error.message, internalError = INTERNAL_ERROR, send = sendError } = options
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const status = error.statusCode ?? 500
    if (status >= 400 && status < 500) {
      // Only for the errors of reading the body: those of a not-found handler itself, e.g. a 416 for a `Range` header
      // while sending the client's index.html, are its own.
      const unreadBody = request.is404 && error.code?.startsWith('FST_ERR_CTP_')
      return unreadBody ? send(reply, 404, NOT_FOUND.error) : send(reply, status, clientError(error))
    }
    const where = request.is404
      ? `a ${request.method} request that matched no route`
      : `${request.method} ${request.routeOptions.url}`
    request.log.error({ err: withoutValues(error) }, `Failed to handle ${where}`)
    return send(reply, 500, internalError)
  })
}

// Logs why requests that fail with a 4xx failed: the message of their `ApiError`, however it's sent, e.g. by a route itself
// rather than by the error handler (see Logs in docs/design/server/README.md). Errors sent in another format, e.g.
// OAuth's, are logged where they're sent. Once for the whole app, since its plugins have its hooks.
export function logApiErrors(app: FastifyInstance) {
  app.addHook('preSerialization', async (request, reply, payload: unknown) => {
    const failed = reply.statusCode >= 400 && reply.statusCode < 500 && typeof payload === 'object' && payload !== null
    if (failed && 'ok' in payload && payload.ok === false && 'error' in payload && typeof payload.error === 'string') {
      logWithRequest(request, { error: payload.error })
    }
    return payload
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
// handler sees, e.g. for a URL that isn't valid, as an `ApiError`. Fastify doesn't log these requests once they're
// answered, as it does the others, so it's done here, the same way, with why they failed (see `logApiErrors`).
export function frameworkErrors(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  const known = error.statusCode ? ROUTING_ERRORS[error.code] : undefined
  if (!known) request.log.error({ err: error }, 'Failed to route a request')
  const sent = known ? sendError(reply, error.statusCode!, known) : sendError(reply, 500, INTERNAL_ERROR)
  reply.log.info({ res: reply, responseTime: reply.elapsedTime, error: known }, 'request completed')
  return sent
}

// What went wrong, for an error that may not be an Error, e.g. in a message that says why a service couldn't be reached.
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Whether a query failed because it broke the constraint `name`, e.g. a unique index. Drizzle wraps the database's
// error, which names the constraint.
export function violatesConstraint(error: unknown, name: string): boolean {
  const cause: unknown = error instanceof Error ? error.cause : undefined
  return cause instanceof Error && 'constraint' in cause && cause.constraint === name
}
