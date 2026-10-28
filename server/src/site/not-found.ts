import type { FastifyInstance } from 'fastify'
import { NOT_FOUND } from '../api/errors.js'

// Registered under a prefix (e.g. `prefix: '/api'`): Fastify scopes not-found handlers by prefix, so
// unknown paths under it get a JSON 404 here instead of falling through to the SPA's index.html.
export async function notFoundRoutes(app: FastifyInstance) {
  app.setNotFoundHandler((_request, reply) => {
    return reply.code(404).send(NOT_FOUND)
  })
}
