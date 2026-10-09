import type { FastifyInstance } from 'fastify'
import type { ConfigResponse } from 'shared/config'
import { config } from '../config.js'
import type { FeaturesStore } from '../features.js'

// Environment-specific values the client needs, and which features are on. Public on purpose: none of this is
// sensitive, and the client has to be able to read it before it has a session.
export async function configRoutes(app: FastifyInstance, { store }: { store: Pick<FeaturesStore, 'load'> }) {
  app.get<{ Reply: ConfigResponse }>('/api/config', async (request, reply) => {
    // Feature flags are read again for every request, and never cached, so that turning one off takes effect for every
    // page loaded after that.
    reply.header('Cache-Control', 'no-store')
    // Off is the safe option for every flag, and the rest of the configuration is needed for the site to work at all,
    // e.g. for its images. So when the flags can't be read, they're all off rather than this request failing.
    const stored = await store.load().catch((error: unknown) => {
      request.log.error({ err: error }, 'Failed to load the feature flags: they are all off')
      return []
    })
    const features = Object.fromEntries(stored.map(({ id, enabled }) => [id, enabled]))
    return { assetsDomain: config.assetsDomain, turnstileSiteKey: config.turnstileSiteKey, features }
  })
}
