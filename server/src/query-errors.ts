import type { FastifyError, FastifyInstance } from 'fastify'
import { DrizzleQueryError } from 'drizzle-orm'
import type { ApiError } from './api-schemas.js'

// The parts of an error that are safe to log: for a failed query, everything but its values.
function withoutValues(error: Error): object {
  if (!(error instanceof DrizzleQueryError)) return error
  const cause: { message?: string; code?: string } | undefined = error.cause
  return { type: 'DrizzleQueryError', query: error.query, cause: { message: cause?.message, code: cause?.code } }
}

// When a query fails, Drizzle's error includes the query's values, e.g. an artist's personal data. Those values must
// not end up in the logs, or in the response, where Fastify would put the error's message. This error handler, for the
// routes of `app`, logs only the query and Postgres's error, along with `message`. The response only says that
// something went wrong.
//
// When Fastify or a plugin rejects a request with a 4xx status, e.g. because its body is too large, the response uses
// the error's message. Routes whose errors must be in French can pass `clientError` to choose the message instead.
export function keepQueryValuesPrivate(app: FastifyInstance, message: string, clientError = (error: FastifyError) => error.message) {
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ ok: false, error: clientError(error) } satisfies ApiError)
    }
    request.log.error({ err: withoutValues(error) }, message)
    return reply.status(500).send({ ok: false, error: 'Internal server error' } satisfies ApiError)
  })
}

// Whether a query failed because it broke the constraint `name`, e.g. a unique index. Drizzle wraps the database's
// error, which names the constraint.
export function violatesConstraint(error: unknown, name: string): boolean {
  const cause: unknown = error instanceof Error ? error.cause : undefined
  return cause instanceof Error && 'constraint' in cause && cause.constraint === name
}
