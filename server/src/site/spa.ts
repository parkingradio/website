import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import { NOT_FOUND } from '../api/errors.js'
import { notFoundRoutes } from './not-found.js'

// Vite emits the build's files under /assets, with a hash of their content in their names. A given URL
// therefore always has the same content, so browsers and Cloudflare can keep it forever instead of
// checking with the server on every request. Everything else, index.html in particular since it names
// the current build's files, keeps the default of being revalidated so that deploys are picked up at once.
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'

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
  await app.register(fastifyStatic, {
    root,
    wildcard: false,
    setHeaders: (reply, filePath) => {
      if (path.relative(root, filePath).startsWith(`assets${path.sep}`)) {
        reply.header('cache-control', IMMUTABLE_CACHE_CONTROL)
      }
    },
  })

  // Vite emits the build's files under /assets, so a miss there is a missing file (e.g. a stale bundle
  // requested by a tab opened before a deploy), not a client-side route.
  await app.register(notFoundRoutes, { prefix: '/assets' })

  app.setNotFoundHandler((request, reply) => {
    if (request.method === 'GET' || request.method === 'HEAD') {
      return reply.sendFile('index.html')
    }
    return reply.code(404).send(NOT_FOUND)
  })
}
