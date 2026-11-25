import { buffer } from 'node:stream/consumers'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { bearerToken } from '../api/bearer.js'
import { ApiError, ById, zodRoutes } from '../api/schemas.js'
import { NO_SUCH_SESSION_ERROR, sessionBody } from '../sessions/routes.js'
import { SESSION_CANCELLED } from '../sessions/store.js'
import type { SessionsStore } from '../sessions/store.js'
import type { Photos } from '../artists/store.js'
import { nosniff, sendMissingPhoto, sendNoPhoto } from '../artists/photo-form.js'
import { raEventInput } from './event.js'
import { RA_FLYER_MAX_BYTES, RA_FLYER_MAX_DIMENSION, raFlyer } from './flyer.js'
import { signRaPublicationToken, verifyRaPublicationToken } from './token.js'
import type { RaPublication } from './token.js'

declare module 'fastify' {
  interface FastifyRequest {
    // What the token of a request to the endpoints that take one is for.
    raPublication: RaPublication | null
  }
}

// What the bookmarklet that creates a session's event on RA gets from the server, from RA's pages, with a token that the
// session's page gets for it (see docs/design/server/ra-publication.md). Not tools of the MCP server, since the token is a
// secret.

// Whether the request comes from RA's site, or one of its subdomains, e.g. its site in French, https://fr.ra.co: the only
// pages that can read the responses of the endpoints that take the token.
const fromRa = ({ headers: { origin } }: FastifyRequest) => origin !== undefined && /^https:\/\/([a-z0-9-]+\.)*ra\.co$/.test(origin)

const INVALID_TOKEN: ApiError = { ok: false, error: "The token isn't valid, or has expired" }
const NO_START: ApiError = { ok: false, error: 'The session has no start' }
const CANCELLED: ApiError = { ok: false, error: SESSION_CANCELLED }

const RaPublishedEvent = z
  .object({
    title: z.string(),
    startTime: z.string().meta({ description: 'Its start, in Québec time without its offset, e.g. "2026-11-20T21:00:00.000"' }),
    endTime: z.string().meta({ description: 'Its end, in Québec time without its offset' }),
    lineup: z.string().meta({
      description:
        "One performer per line: those of its sets that aren't cancelled, in order, each artist once, or else OPEN JAM for a synth meetup, or its title",
    }),
    venueId: z.string().meta({ description: "Parking Radio's venue on RA" }),
    promoterIds: z.array(z.string()).meta({ description: "Parking Radio's promoter page on RA" }),
    content: z.string().meta({ description: "The session's effective description" }),
    promotionalLinks: z
      .array(z.object({ title: z.string(), url: z.string() }))
      .meta({ description: "The event's promotional links on RA: Parking Radio's site and Instagram, each with its title" }),
    playerLinks: z.array(z.object({ sourceId: z.string() })).meta({ description: "The event's media links on RA: Parking Radio's YouTube and SoundCloud" }),
    submissionSource: z.literal('SUBMITEVENTPAGE'),
  })
  .meta({ id: 'RaPublishedEvent', description: "The session's event, as RA's `EventInput`" })

const RaPublicationResponse = z
  .object({
    ok: z.literal(true),
    environment: z.string().meta({ description: "The server's environment, as GET /api/config gives it" }),
    session: z.string().meta({ description: "The session's id" }),
    hasFlyer: z.boolean().meta({ description: 'Whether the session has a flyer, which GET /api/ra-publication/flyer gives' }),
    event: RaPublishedEvent,
  })
  .meta({ id: 'RaPublication' })

type Options = {
  store: SessionsStore
  // Where sessions' flyers are kept.
  photos: Pick<Photos, 'read'>
  // The server's environment, which the bookmarklet warns about outside production.
  environment: string
}

export async function raPublicationRoutes(app: FastifyInstance, options: Options) {
  zodRoutes(app).post(
    '/api/admin/sessions/:id/ra-publication',
    {
      config: { admin: true, tool: null },
      schema: {
        summary: "A token for publishing a session's event on Resident Advisor with the bookmarklet, which lasts an hour",
        tags: ['Publishing on RA'],
        params: ById,
        response: { 200: z.object({ ok: z.literal(true), token: z.string() }).meta({ id: 'RaPublicationToken' }), 404: ApiError },
      },
    },
    async (request, reply) => {
      if (!(await options.store.get(request.params.id))) return reply.status(404).send(NO_SUCH_SESSION_ERROR)
      const { id: admin, sessionVersion } = request.user!
      return { ok: true as const, token: await signRaPublicationToken({ session: request.params.id, admin, sessionVersion }) }
    },
  )

  await app.register(tokenRoutes, options)
}

// The endpoints that take the token, which the bookmarklet calls from RA's pages.
async function tokenRoutes(app: FastifyInstance, { store, photos, environment }: Options) {
  app.decorateRequest('raPublication', null)

  // Every response, whether it succeeds or fails, unexpectedly too, is never kept, and RA's pages can read it, without
  // cookies. In onSend, since the error handler removes the headers set before.
  app.addHook('onSend', async (request, reply) => {
    reply.header('cache-control', 'no-store')
    reply.header('vary', 'Origin')
    if (fromRa(request)) reply.header('access-control-allow-origin', request.headers.origin)
  })

  // The token is checked before anything else is read, e.g. a body. It's only valid while its admin's sessions have its
  // version: revoking them, or their choosing a new password, ends it.
  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'OPTIONS') return
    const token = bearerToken(request)
    const publication = token ? await verifyRaPublicationToken(token) : null
    if (!publication || (await app.adminSessions.sessionVersion(publication.admin)) !== publication.sessionVersion) {
      return reply.code(403).send(INVALID_TOKEN)
    }
    request.raPublication = publication
  })

  // Browsers ask whether RA's pages may send the token, since it's in a header (a preflight).
  const preflight = async (request: FastifyRequest, reply: FastifyReply) => {
    if (fromRa(request)) reply.header('access-control-allow-methods', 'GET').header('access-control-allow-headers', 'Authorization')
    return reply.code(204).send()
  }
  app.options('/api/ra-publication', preflight)
  app.options('/api/ra-publication/flyer', preflight)

  zodRoutes(app).get(
    '/api/ra-publication',
    {
      schema: {
        summary: "The event that the bookmarklet creates on Resident Advisor for the session of the token in `Authorization: Bearer <token>`",
        tags: ['Publishing on RA'],
        response: { 200: RaPublicationResponse, 403: ApiError, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const row = await store.get(request.raPublication!.session)
      if (!row) return reply.status(404).send(NO_SUCH_SESSION_ERROR)
      const session = sessionBody(row)
      if (session.start === null || session.end === null) return reply.status(409).send(NO_START)
      // E.g. since the token was given.
      if (session.status === 'cancelled') return reply.status(409).send(CANCELLED)
      return { ok: true as const, environment, session: session.id, hasFlyer: session.hasFlyer, event: raEventInput(session, session.start, session.end) }
    },
  )

  zodRoutes(app).get(
    '/api/ra-publication/flyer',
    {
      schema: {
        summary: "The flyer of the session of the token in `Authorization: Bearer <token>`, as a JPEG within RA's limits, which the bookmarklet uploads to Resident Advisor",
        tags: ['Publishing on RA'],
        response: {
          200: {
            description: `The session's flyer, as a JPEG of at most ${RA_FLYER_MAX_DIMENSION} × ${RA_FLYER_MAX_DIMENSION} pixels and ${RA_FLYER_MAX_BYTES.toLocaleString('en')} bytes. ${nosniff}`,
            content: { 'image/jpeg': { schema: z.instanceof(Buffer).meta({ type: 'string', format: 'binary' }) } },
          },
          403: ApiError,
          404: ApiError,
        },
      },
    },
    async (request, reply) => {
      const row = await store.get(request.raPublication!.session)
      if (!row) return reply.status(404).send(NO_SUCH_SESSION_ERROR)
      if (!row.flyerKey) return sendNoPhoto(reply, 'session')
      const flyer = await photos.read(row.flyerKey)
      if (!flyer) return sendMissingPhoto(reply, row.flyerKey, 'session')
      return reply
        .header('Content-Type', 'image/jpeg')
        .header('X-Content-Type-Options', 'nosniff')
        .send(await raFlyer(await buffer(flyer)))
    },
  )
}
