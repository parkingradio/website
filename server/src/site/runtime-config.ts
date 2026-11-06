import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { zodRoutes } from '../api/schemas.js'
import { config } from '../core/config.js'
import { FEATURES } from '../features/store.js'
import type { FeatureId, FeaturesStore } from '../features/store.js'

const Config = z
  .object({
    assetsDomain: z.string(),
    turnstileSiteKey: z.string(),
    // Which deployment the server is, e.g. "production" (see config.environment).
    environment: z.string(),
    // Whether each flag is on, by id. A flag that isn't there is off, and any other id fails the response's validation.
    // An object rather than a record, so that the client's types have the ids.
    features: z.strictObject(
      Object.fromEntries(FEATURES.map((id) => [id, z.boolean().optional()])) as Record<FeatureId, z.ZodOptional<z.ZodBoolean>>,
    ),
  })
  .meta({ id: 'Config' })

// Environment-specific values the client needs, and which features are on. Public on purpose: none of this is
// sensitive, and the client has to be able to read it before it has a session.
export async function configRoutes(
  app: FastifyInstance,
  { store, environment }: { store: Pick<FeaturesStore, 'load'>; environment: string },
) {
  const api = zodRoutes(app)

  api.get(
    '/api/config',
    {
      schema: {
        summary: 'Environment-specific values the client needs',
        tags: ['Config'],
        response: { 200: Config },
      },
    },
    async (request, reply) => {
      // Feature flags are read again for every request, and never cached, so that turning one off takes effect for
      // every page loaded after that.
      reply.header('Cache-Control', 'no-store')
      // Off is the safe option for every flag, and the rest of the configuration is needed for the site to work at all,
      // e.g. for its images. So when the flags can't be read, they're all off rather than this request failing.
      const stored = await store.load().catch((error: unknown) => {
        request.log.error({ err: error }, 'Failed to load the feature flags: they are all off')
        return []
      })
      // A cast, since `fromEntries` loses the ids, and the type allows no property at all while there are no flags. The
      // ids are those of FEATURES, which are the only ones `load` returns.
      const features = Object.fromEntries(stored.map(({ id, enabled }) => [id, enabled])) as z.infer<typeof Config>['features']
      return { assetsDomain: config.assetsDomain, turnstileSiteKey: config.turnstileSiteKey, environment, features }
    },
  )
}
