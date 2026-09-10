import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'

// Environment-specific values the client needs. Public on purpose: none of this is sensitive, and
// the client has to be able to read it before it has a session.
export async function configRoutes(app: FastifyInstance) {
  app.get('/api/config', async () => {
    return { assetsDomain: config.assetsDomain }
  })
}
