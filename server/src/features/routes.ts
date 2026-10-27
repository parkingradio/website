import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { ApiError, Timestamp, zodRoutes } from '../api/schemas.js'
import { FeatureId, NoSuchFeature } from './store.js'
import type { FeaturesStore, StoredFeature } from './store.js'

// Admin routes for feature flags: see them, and turn them on or off. Visitors read them through `GET /api/config`.

const Feature = z
  .object({
    id: FeatureId,
    enabled: z.boolean(),
    updatedBy: z.string().nullable(),
    updatedAt: Timestamp.nullable(),
  })
  .meta({ id: 'Feature' })

const NO_SUCH_FEATURE: z.infer<typeof ApiError> = { ok: false, error: 'No such feature' }

function feature({ id, enabled, updatedBy, updatedAt }: StoredFeature): z.infer<typeof Feature> {
  return { id, enabled, updatedBy, updatedAt: updatedAt?.toISOString() ?? null }
}

export async function featuresRoutes(app: FastifyInstance, { store }: { store: FeaturesStore }) {
  const api = zodRoutes(app, 'Failed to handle a request about feature flags')

  api.get(
    '/api/admin/features',
    {
      config: { admin: true },
      schema: {
        summary: 'Every feature flag, and whether it is on',
        tags: ['Features'],
        response: { 200: z.object({ ok: z.literal(true), features: z.array(Feature) }) },
      },
    },
    async () => ({ ok: true as const, features: (await store.load()).map(feature) }),
  )

  api.put(
    '/api/admin/features/:id',
    {
      config: { admin: true },
      schema: {
        summary: 'Turns a feature flag on or off',
        tags: ['Features'],
        // Any id, so that one that isn't a flag gets a 404.
        params: z.object({ id: z.string() }),
        body: z.object({ enabled: z.boolean() }),
        response: { 200: z.object({ ok: z.literal(true), feature: Feature }), 404: ApiError },
      },
    },
    async (request, reply) => {
      try {
        return { ok: true as const, feature: feature(await store.save(request.params.id, request.body.enabled, request.user!.email)) }
      } catch (error) {
        if (error instanceof NoSuchFeature) return reply.status(404).send(NO_SUCH_FEATURE)
        throw error
      }
    },
  )
}
