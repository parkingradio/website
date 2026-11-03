import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { ApiError, ById, Ok, Timestamp, zodRoutes } from '../api/schemas.js'
import { checkAuthorization, redirectTo, scopesOf } from './authorization.js'
import type { AuthorizationParams, CheckedAuthorization } from './authorization.js'
import { findClient } from './clients.js'
import type { OAuthStore, StoredConnection } from './store.js'

// The admin routes of OAuth (see docs/design/server/oauth.md): what the authorization page shows, allowing an app or
// refusing, which gives it a code, and the admin's own connections.

const CODE_LIFETIME_MS = 10 * 60 * 1000
// Enough of a `client_id` that isn't one of the clients to tell which app it is, in the logs.
const LOGGED_CLIENT_ID_LENGTH = 200

// A parameter of the authorization request: a list when it's there more than once, which is an error.
const Param = z.union([z.string(), z.array(z.string())]).optional()
const AUTHORIZATION_PARAMS = {
  response_type: Param,
  client_id: Param,
  redirect_uri: Param,
  code_challenge: Param,
  code_challenge_method: Param,
  scope: Param,
  state: Param,
  resource: Param,
}
// The page is opened with the parameters as the app sent them, including those the server doesn't know, which it refuses
// when they're there more than once. Once it has shown the page, it only needs those it knows.
const AuthorizationQuery = z.object(AUTHORIZATION_PARAMS).catchall(Param)
const AuthorizationDecision = z.object({ ...AUTHORIZATION_PARAMS, allow: z.boolean() })

// When the request isn't valid: with where to send the browser to tell the app, when it can be told, and otherwise with
// whether it's because the app isn't one of the clients.
const AuthorizationError = ApiError.extend({ redirect: z.string().optional(), unknownClient: z.boolean().optional() }).meta({
  id: 'AuthorizationError',
})

const Connection = z
  .object({
    id: z.string(),
    // The app's name, e.g. "Claude".
    client: z.string(),
    scopes: z.array(z.string()),
    createdAt: Timestamp,
    lastUsedAt: Timestamp,
  })
  .meta({ id: 'Connection' })

const NO_SUCH_CONNECTION: z.infer<typeof ApiError> = { ok: false, error: 'No such connection' }

function connection({ id, clientId, scopes, createdAt, lastUsedAt }: StoredConnection): z.infer<typeof Connection> {
  return { id, client: findClient(clientId)?.name ?? clientId, scopes, createdAt: createdAt.toISOString(), lastUsedAt: lastUsedAt.toISOString() }
}

// What the routes of OAuth take, the admin ones here, and those apps call (see app-routes.ts).
export type OAuthOptions = {
  store: OAuthStore
  // Where the site is: the authorization server's issuer, whose MCP server tokens are for.
  issuer: string
}

export async function oauthRoutes(app: FastifyInstance, { store, issuer }: OAuthOptions) {
  const api = zodRoutes(app)

  // Checks the request the page was opened with, and logs the `client_id` of an app that isn't one of the clients, so
  // that a new app, or a change of Claude's, doesn't go unnoticed.
  function check(params: AuthorizationParams, log: FastifyInstance['log']): CheckedAuthorization {
    const checked = checkAuthorization(params, { issuer, userScopes: scopesOf() })
    if (!checked.ok && 'unknownClient' in checked && checked.unknownClient) {
      log.warn({ clientId: String(params.client_id).slice(0, LOGGED_CLIENT_ID_LENGTH) }, "An app that the server doesn't know asked to connect")
    }
    return checked
  }

  function failure(checked: Exclude<CheckedAuthorization, { ok: true }>): z.infer<typeof AuthorizationError> {
    if ('redirect' in checked) return { ok: false, error: checked.error, redirect: checked.redirect }
    return { ok: false, error: checked.error, unknownClient: checked.unknownClient }
  }

  api.get(
    '/api/admin/oauth/authorization',
    {
      config: { admin: true },
      schema: {
        summary: 'What allowing an app would grant',
        tags: ['OAuth'],
        querystring: AuthorizationQuery,
        response: {
          200: z.object({
            ok: z.literal(true),
            client: z.string(),
            // The host of the redirect URI, e.g. "claude.ai".
            redirectHost: z.string(),
            // Whether the redirect URI is on the user's computer, where any program could be listening.
            local: z.boolean(),
            scopes: z.array(z.string()),
          }),
          400: AuthorizationError,
        },
      },
    },
    async (request, reply) => {
      const checked = check(request.query, request.log)
      if (!checked.ok) return reply.status(400).send(failure(checked))
      const { client, redirectUri, scopes } = checked
      return { ok: true as const, client: client.name, redirectHost: new URL(redirectUri).hostname, local: client.local, scopes }
    },
  )

  api.post(
    '/api/admin/oauth/authorization',
    {
      config: { admin: true },
      schema: {
        summary: 'Allows an app, which gets a code, or refuses',
        tags: ['OAuth'],
        body: AuthorizationDecision,
        response: { 200: z.object({ ok: z.literal(true), redirect: z.string() }), 400: AuthorizationError },
      },
    },
    async (request, reply) => {
      const { allow, ...params } = request.body
      const checked = check(params, request.log)
      if (!checked.ok) return reply.status(400).send(failure(checked))
      const { client, redirectUri, codeChallenge, scopes, state } = checked
      if (!allow) {
        const refused = { error: 'access_denied', error_description: 'The user refused', state, iss: issuer }
        return { ok: true as const, redirect: redirectTo(redirectUri, refused) }
      }
      const expiresAt = new Date(Date.now() + CODE_LIFETIME_MS)
      const code = await store.createCode({ userId: request.user!.id, clientId: client.id, redirectUri, codeChallenge, scopes, expiresAt })
      return { ok: true as const, redirect: redirectTo(redirectUri, { code, state, iss: issuer }) }
    },
  )

  api.get(
    '/api/admin/connections',
    {
      config: { admin: true },
      schema: {
        summary: "The logged-in admin's connected apps",
        tags: ['OAuth'],
        response: { 200: z.object({ ok: z.literal(true), connections: z.array(Connection) }) },
      },
    },
    async (request) => ({ ok: true as const, connections: (await store.list(request.user!.id)).map(connection) }),
  )

  api.delete(
    '/api/admin/connections/:id',
    {
      config: { admin: true },
      schema: {
        summary: "Disconnects one of the logged-in admin's apps",
        tags: ['OAuth'],
        params: ById,
        response: { 200: Ok, 404: ApiError },
      },
    },
    async (request, reply) => {
      if (!(await store.delete(request.user!.id, request.params.id))) return reply.status(404).send(NO_SUCH_CONNECTION)
      return { ok: true as const }
    },
  )
}
