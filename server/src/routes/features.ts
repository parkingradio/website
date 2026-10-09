import type { FastifyInstance } from 'fastify'
import type { ApiError } from 'shared/error'
import type { Feature, FeatureRequest, FeatureResponse, FeaturesResponse } from 'shared/features'
import { requireAuth } from '../auth.js'
import { NoSuchFeature } from '../features.js'
import type { FeaturesStore, StoredFeature } from '../features.js'

// Admin routes for feature flags: see them, and turn them on or off. Visitors read them through `GET /api/config`.

const NO_SUCH_FEATURE: ApiError = { ok: false, error: 'No such feature' }

function feature({ id, enabled, updatedBy, updatedAt }: StoredFeature): Feature {
  return { id, enabled, updatedBy, updatedAt: updatedAt?.toISOString() ?? null }
}

export async function featuresRoutes(app: FastifyInstance, { store }: { store: FeaturesStore }) {
  app.get<{ Reply: FeaturesResponse }>('/api/admin/features', { preHandler: requireAuth }, async () => {
    return { ok: true, features: (await store.load()).map(feature) }
  })

  app.put<{ Params: { id: string }; Body: Partial<FeatureRequest> | null; Reply: FeatureResponse | ApiError }>(
    '/api/admin/features/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const enabled = request.body?.enabled
      if (typeof enabled !== 'boolean') return reply.status(400).send({ ok: false, error: '`enabled` must be true or false' })
      try {
        return { ok: true, feature: feature(await store.save(request.params.id, enabled, request.user!.email)) }
      } catch (error) {
        if (error instanceof NoSuchFeature) return reply.status(404).send(NO_SUCH_FEATURE)
        throw error
      }
    },
  )
}
