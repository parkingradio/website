import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import OAuth2Server from '@node-oauth/oauth2-server'
import { useApiErrors } from '../api/errors.js'
import { SCOPES, isResource, mcpAddress } from './authorization.js'
import { GRANT_TYPES, tokenModel } from './model.js'
import type { OAuthOptions } from './routes.js'

// What apps call for OAuth (see docs/design/server/oauth.md): the metadata documents, and the token and revocation
// endpoints. These follow OAuth's conventions rather than the API's: they take forms, and their errors are OAuth's. The
// token endpoint is the OAuth library's, on top of the store (see model.ts). They aren't declared with zod schemas, so
// openapi.json leaves them out.

const { OAuthError, Request, Response } = OAuth2Server

const ACCESS_TOKEN_LIFETIME_SECONDS = 60 * 60
// A connection ends when its refresh token goes unused for that long, since each refresh gives it a new one.
const CONNECTION_IDLE_SECONDS = 90 * 24 * 60 * 60
// Forms of the token and revocation endpoints are a few short fields.
const FORM_BODY_LIMIT = 16 * 1024

function sendError(reply: FastifyReply, status: number, error: string, description: string) {
  return reply.code(status).header('cache-control', 'no-store').send({ error, error_description: description })
}

// A form's fields, by name, refusing those that are there more than once, as OAuth has it, and text with the NUL
// character, which the database can't store (see Conventions in docs/design/server/README.md).
function parseForm(body: string): Record<string, string> {
  const fields: Record<string, string> = Object.create(null)
  for (const [name, value] of new URLSearchParams(body)) {
    const refused = name in fields ? `\`${name}\` is there more than once` : `${name}${value}`.includes('\0') ? "Text can't contain the NUL character" : null
    if (refused) throw Object.assign(new Error(refused), { statusCode: 400 })
    fields[name] = value
  }
  return fields
}

// Why a request is refused for authenticating the app, which apps don't do: they're public clients, whose codes PKCE
// proves are theirs. The library would otherwise take the app for one that authenticates.
function refusedClient(headers: FastifyRequest['headers'], fields: Record<string, string>): string | null {
  if (headers.authorization !== undefined) return "Apps don't authenticate: the request can't have an `Authorization` header"
  if (fields.client_secret !== undefined) return "Apps don't authenticate: the request can't have a `client_secret`"
  return null
}

export async function oauthAppRoutes(app: FastifyInstance, { store, issuer }: OAuthOptions) {
  const resource = mcpAddress(issuer)
  const server = new OAuth2Server({
    // Its model's type also has what the token endpoint doesn't call (see TokenModel).
    model: tokenModel(store) as unknown as OAuth2Server.AuthorizationCodeModel,
    accessTokenLifetime: ACCESS_TOKEN_LIFETIME_SECONDS,
    refreshTokenLifetime: CONNECTION_IDLE_SECONDS,
    // Apps are public clients, which don't authenticate: PKCE is what proves that a code is theirs.
    requireClientAuthentication: { authorization_code: false, refresh_token: false },
    requirePKCE: true,
  })

  // Requests with a body other than a form fail with 415, which the error handler turns into OAuth's invalid_request.
  app.removeAllContentTypeParsers()
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: FORM_BODY_LIMIT }, (_request, body, done) => {
    try {
      done(null, parseForm(body as string))
    } catch (error) {
      done(error as Error, undefined)
    }
  })

  // In OAuth's format, rather than the API's.
  useApiErrors(app, {
    send: (reply, status, message) =>
      status < 500 ? sendError(reply, 400, 'invalid_request', message) : sendError(reply, 500, 'server_error', message),
  })

  app.get('/.well-known/oauth-authorization-server', async () => ({
    issuer,
    authorization_endpoint: `${issuer}/autoriser`,
    token_endpoint: `${issuer}/api/oauth/token`,
    revocation_endpoint: `${issuer}/api/oauth/revoke`,
    scopes_supported: SCOPES,
    response_types_supported: ['code'],
    grant_types_supported: GRANT_TYPES,
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  }))

  const protectedResource = async () => ({
    resource,
    authorization_servers: [issuer],
    scopes_supported: SCOPES,
    bearer_methods_supported: ['header'],
  })
  // At the path RFC 9728 gives it for the MCP server, and at the root, where some apps look for it.
  app.get('/.well-known/oauth-protected-resource/mcp', protectedResource)
  app.get('/.well-known/oauth-protected-resource', protectedResource)

  app.post('/api/oauth/token', async (request, reply) => {
    const fields = (request.body ?? {}) as Record<string, string>
    const refused = refusedClient(request.headers, fields)
    if (refused) return sendError(reply, 400, 'invalid_request', refused)
    // Before the library, which would otherwise take an app that doesn't say who it is, or asks for another grant, for one
    // that authenticates, and fail with invalid_client.
    if (!fields.grant_type || !fields.client_id) return sendError(reply, 400, 'invalid_request', '`grant_type` and `client_id` are required')
    if (!GRANT_TYPES.includes(fields.grant_type)) {
      return sendError(reply, 400, 'unsupported_grant_type', '`grant_type` has to be `authorization_code` or `refresh_token`')
    }
    if (fields.resource !== undefined && !isResource(fields.resource, resource)) {
      return sendError(reply, 400, 'invalid_target', '`resource` has to be the MCP server')
    }
    const response = new Response()
    try {
      await server.token(new Request({ method: request.method, headers: request.headers, query: request.query as object, body: fields }), response)
    } catch (error) {
      if (!(error instanceof OAuthError)) throw error
      // The library makes its server_error a 503, and wraps the error it got, e.g. the store's.
      if (error.code >= 500) throw error.inner ?? error
      return sendError(reply, error.code, error.name, error.message)
    }
    return reply
      .code(response.status ?? 200)
      .headers(response.headers ?? {})
      .send(response.body)
  })

  app.post('/api/oauth/revoke', async (request, reply) => {
    const fields = (request.body ?? {}) as Record<string, string>
    const refused = refusedClient(request.headers, fields)
    if (refused) return sendError(reply, 400, 'invalid_request', refused)
    const { token, client_id: clientId } = fields
    if (!token || !clientId) return sendError(reply, 400, 'invalid_request', '`token` and `client_id` are required')
    await store.revoke(token, clientId)
    return {}
  })
}
