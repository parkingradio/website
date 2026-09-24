import type { FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import { notFoundRoutes } from './routes/not-found.js'

type SpaOptions = {
  root: string
}

/**
 * Serves the client build from `root`, falling back to index.html for unmatched GET and HEAD requests
 * so client-side routes work on reload. Unknown /api paths never get here: they're handled by
 * notFoundRoutes.
 */
export async function spaRoutes(app: FastifyInstance, { root }: SpaOptions) {
  // Without a wildcard route, unmatched paths reach the not-found handler for their prefix, which is
  // what lets notFoundRoutes take over under /api and /assets.
  await app.register(fastifyStatic, { root, wildcard: false })

  // Vite emits the build's files under /assets, so a miss there is a missing file (e.g. a stale bundle
  // requested by a tab opened before a deploy), not a client-side route.
  await app.register(notFoundRoutes, { prefix: '/assets' })

  app.setNotFoundHandler((request, reply) => {
    if (request.method === 'GET' || request.method === 'HEAD') {
      return reply.sendFile('index.html')
    }
    return reply.code(404).send({ ok: false, error: 'Not found' })
  })
}
