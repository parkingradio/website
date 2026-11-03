import { beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { DrizzleQueryError } from 'drizzle-orm'
import { useZodSchemas } from '../api/schemas.js'
import { NoSuchConnection } from './store.js'
import type { NewCode, OAuthStore, StoredRefreshToken } from './store.js'
import { oauthAppRoutes } from './app-routes.js'

// The glue around the OAuth library: what's checked before it, how its answers and errors are sent, and what it's given to
// save. What the store does with codes and tokens, e.g. ending a connection when one is used twice, is checked against a
// real database by integration-tests/022-oauth.sh.

const ISSUER = 'https://parking.radio'
const CLAUDE = 'https://claude.ai/oauth/mcp-oauth-client-metadata'
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback'
// RFC 7636's example.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

function code(changes: Partial<NewCode> = {}): NewCode {
  return {
    userId: 'admin-id',
    clientId: CLAUDE,
    redirectUri: CALLBACK,
    codeChallenge: CHALLENGE,
    scopes: ['admin'],
    expiresAt: new Date(Date.now() + 60_000),
    ...changes,
  }
}

function refreshToken(changes: Partial<StoredRefreshToken> = {}): StoredRefreshToken {
  return { connectionId: 'connection-id', userId: 'admin-id', clientId: CLAUDE, scopes: ['admin'], expiresAt: new Date(Date.now() + DAY_MS), ...changes }
}

const store = {
  findCode: vi.fn<OAuthStore['findCode']>(),
  useCode: vi.fn<OAuthStore['useCode']>(),
  createConnection: vi.fn<OAuthStore['createConnection']>(),
  findRefreshToken: vi.fn<OAuthStore['findRefreshToken']>(),
  useRefreshToken: vi.fn<OAuthStore['useRefreshToken']>(),
  refreshConnection: vi.fn<OAuthStore['refreshConnection']>(),
  revoke: vi.fn<OAuthStore['revoke']>(),
}

async function buildApp(logs?: string[]) {
  const app = Fastify(logs ? { logger: { stream: { write: (line: string) => logs.push(line) } } } : {})
  useZodSchemas(app)
  await app.register(oauthAppRoutes, { store: store as unknown as OAuthStore, issuer: ISSUER })
  return app
}

type App = Awaited<ReturnType<typeof buildApp>>

function post(app: App, url: string, fields: Record<string, string> | string, contentType = 'application/x-www-form-urlencoded') {
  const payload = typeof fields === 'string' ? fields : new URLSearchParams(fields).toString()
  return app.inject({ method: 'POST', url, payload, headers: { 'content-type': contentType } })
}

const EXCHANGE = { grant_type: 'authorization_code', code: 'the-code', client_id: CLAUDE, redirect_uri: CALLBACK, code_verifier: VERIFIER }
const REFRESH = { grant_type: 'refresh_token', refresh_token: 'the-refresh-token', client_id: CLAUDE }

function exchange(app: App, changes: Record<string, string | undefined> = {}) {
  const fields = Object.fromEntries(Object.entries({ ...EXCHANGE, ...changes }).filter((entry): entry is [string, string] => entry[1] !== undefined))
  return post(app, '/api/oauth/token', fields)
}

describe('OAuth app routes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    store.findCode.mockResolvedValue(code())
    store.useCode.mockResolvedValue(true)
    store.createConnection.mockResolvedValue('connection-id')
    store.findRefreshToken.mockResolvedValue(refreshToken())
    store.useRefreshToken.mockResolvedValue(true)
    store.refreshConnection.mockResolvedValue()
    store.revoke.mockResolvedValue()
  })

  describe('metadata', () => {
    it("describes the authorization server", async () => {
      const app = await buildApp()
      const response = await app.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server' })
      expect(response.json()).toEqual({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/autoriser`,
        token_endpoint: `${ISSUER}/api/oauth/token`,
        revocation_endpoint: `${ISSUER}/api/oauth/revoke`,
        scopes_supported: ['admin'],
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        revocation_endpoint_auth_methods_supported: ['none'],
        client_id_metadata_document_supported: true,
        authorization_response_iss_parameter_supported: true,
      })
    })

    it.each(['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource'])('describes the MCP server at %s', async (url) => {
      const app = await buildApp()
      expect((await app.inject({ method: 'GET', url })).json()).toEqual({
        resource: `${ISSUER}/mcp`,
        authorization_servers: [ISSUER],
        scopes_supported: ['admin'],
        bearer_methods_supported: ['header'],
      })
    })
  })

  describe('POST /api/oauth/token', () => {
    it('exchanges a code for the tokens of a new connection', async () => {
      const app = await buildApp()
      const before = Date.now()
      const response = await exchange(app, { resource: 'HTTPS://Parking.Radio/mcp' })
      expect(response.statusCode).toBe(200)
      expect(response.headers['cache-control']).toBe('no-store')
      const body = response.json()
      expect(body).toEqual({ access_token: expect.any(String), token_type: 'Bearer', expires_in: expect.any(Number), refresh_token: expect.any(String), scope: 'admin' })
      // Worked out from when the token expires, so a second less once that's passed.
      expect([3599, 3600]).toContain(body.expires_in)
      expect(store.findCode).toHaveBeenCalledWith('the-code')
      expect(store.useCode).toHaveBeenCalledWith('the-code')
      const [usedCode, tokens] = store.createConnection.mock.calls[0]
      expect(usedCode).toBe('the-code')
      expect(tokens).toMatchObject({ accessToken: body.access_token, refreshToken: body.refresh_token, scopes: ['admin'] })
      expect(tokens.accessTokenExpiresAt.getTime() - before).toBeGreaterThanOrEqual(HOUR_MS)
      expect(tokens.refreshTokenExpiresAt.getTime() - before).toBeGreaterThanOrEqual(90 * DAY_MS)
      expect(tokens.refreshTokenExpiresAt.getTime() - Date.now()).toBeLessThanOrEqual(90 * DAY_MS)
    })

    it.each([
      ["a verifier that doesn't match", { code_verifier: 'x'.repeat(43) }, 'invalid_grant'],
      ['no verifier', { code_verifier: undefined }, 'invalid_grant'],
      ["a verifier that isn't one", { code_verifier: 'short' }, 'invalid_request'],
      ['no redirect URI', { redirect_uri: undefined }, 'invalid_request'],
      ['another redirect URI', { redirect_uri: 'https://claude.ai/other' }, 'invalid_request'],
      ["an app that isn't one of the clients", { client_id: 'https://example.com/client.json' }, 'invalid_client'],
      ['another resource', { resource: 'https://example.com/mcp' }, 'invalid_target'],
      ['another grant type', { grant_type: 'password' }, 'unsupported_grant_type'],
      ['no grant type', { grant_type: undefined }, 'invalid_request'],
      ['no app', { client_id: undefined }, 'invalid_request'],
      ['an app that authenticates', { client_secret: 'secret' }, 'invalid_request'],
    ])('refuses %s with %s', async (_, changes, error) => {
      const app = await buildApp()
      const response = await exchange(app, changes)
      expect(response.statusCode).toBe(400)
      expect(response.headers['cache-control']).toBe('no-store')
      expect(response.json()).toEqual({ error, error_description: expect.any(String) })
      expect(store.createConnection).not.toHaveBeenCalled()
    })

    it('refuses an app that authenticates with an Authorization header, at both endpoints', async () => {
      const app = await buildApp()
      for (const url of ['/api/oauth/token', '/api/oauth/revoke']) {
        const response = await app.inject({
          method: 'POST',
          url,
          payload: new URLSearchParams({ ...EXCHANGE, token: 'some-token' }).toString(),
          headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${CLAUDE}:secret`).toString('base64')}` },
        })
        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ error: 'invalid_request', error_description: "Apps don't authenticate: the request can't have an `Authorization` header" })
      }
      expect(store.findCode).not.toHaveBeenCalled()
      expect(store.revoke).not.toHaveBeenCalled()
    })

    it('uses the code up before checking the verifier, so that it can only be tried once', async () => {
      const app = await buildApp()
      await exchange(app, { code_verifier: 'x'.repeat(43) })
      expect(store.useCode).toHaveBeenCalledWith('the-code')
    })

    it("refuses a code that's unknown, expired, another app's, or used at the same time", async () => {
      const app = await buildApp()
      const cases: [() => void, string][] = [
        [() => store.findCode.mockResolvedValueOnce(null), 'unknown'],
        [() => store.findCode.mockResolvedValueOnce(code({ expiresAt: new Date(Date.now() - 1000) })), 'expired'],
        [() => store.findCode.mockResolvedValueOnce(code({ clientId: 'https://claude.ai/oauth/claude-code-client-metadata' })), "another app's"],
        [() => store.useCode.mockResolvedValueOnce(false), 'used'],
        [() => store.createConnection.mockRejectedValueOnce(new NoSuchConnection()), 'gone'],
      ]
      for (const [arrange, which] of cases) {
        arrange()
        const response = await exchange(app)
        expect(response.statusCode, which).toBe(400)
        expect(response.json().error, which).toBe('invalid_grant')
      }
    })

    it('gives a connection new tokens, keeping some of its scopes from then on when asked', async () => {
      const app = await buildApp()
      const response = await post(app, '/api/oauth/token', { ...REFRESH, scope: 'admin' })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body).toMatchObject({ token_type: 'Bearer', scope: 'admin' })
      expect(store.useRefreshToken).toHaveBeenCalledWith('the-refresh-token')
      expect(store.refreshConnection).toHaveBeenCalledWith('connection-id', {
        accessToken: body.access_token,
        accessTokenExpiresAt: expect.any(Date),
        refreshToken: body.refresh_token,
        refreshTokenExpiresAt: expect.any(Date),
        scopes: ['admin'],
      })
    })

    it("refuses a refresh token that's unknown, used, expired, another app's, for a scope its connection doesn't have, or whose connection ended", async () => {
      const app = await buildApp()
      const cases: [() => void, Record<string, string>, string][] = [
        [() => store.findRefreshToken.mockResolvedValueOnce(null), {}, 'invalid_grant'],
        [() => store.useRefreshToken.mockResolvedValueOnce(false), {}, 'invalid_grant'],
        [() => store.findRefreshToken.mockResolvedValueOnce(refreshToken({ expiresAt: new Date(Date.now() - 1000) })), {}, 'invalid_grant'],
        [() => store.findRefreshToken.mockResolvedValueOnce(refreshToken({ clientId: 'https://claude.ai/oauth/claude-code-client-metadata' })), {}, 'invalid_grant'],
        [() => store.refreshConnection.mockRejectedValueOnce(new NoSuchConnection()), {}, 'invalid_grant'],
        [() => {}, { scope: 'offline_access' }, 'invalid_scope'],
      ]
      for (const [arrange, changes, error] of cases) {
        arrange()
        const response = await post(app, '/api/oauth/token', { ...REFRESH, ...changes })
        expect(response.statusCode, JSON.stringify(changes)).toBe(400)
        expect(response.json().error).toBe(error)
      }
    })

    it('only takes forms, without a field twice, or the NUL character', async () => {
      const app = await buildApp()
      const responses = [
        await post(app, '/api/oauth/token', JSON.stringify(EXCHANGE), 'application/json'),
        await post(app, '/api/oauth/token', `${new URLSearchParams(EXCHANGE)}&code=again`),
        await app.inject({ method: 'POST', url: '/api/oauth/token' }),
      ]
      for (const response of responses) {
        expect(response.statusCode).toBe(400)
        expect(response.json()).toEqual({ error: 'invalid_request', error_description: expect.any(String) })
      }
      expect(responses[1].json().error_description).toBe('`code` is there more than once')
      const withNul = await post(app, '/api/oauth/revoke', { token: 'some\0token', client_id: CLAUDE })
      expect(withNul.json()).toEqual({ error: 'invalid_request', error_description: "Text can't contain the NUL character" })
      expect(store.revoke).not.toHaveBeenCalled()
      expect(store.findCode).not.toHaveBeenCalled()
    })

    it("logs why a request failed, its error's description, but not what it sent", async () => {
      const logs: string[] = []
      const app = await buildApp(logs)
      store.findCode.mockResolvedValueOnce(null)
      await exchange(app)
      // From the error handler, rather than the route.
      await post(app, '/api/oauth/token', `${new URLSearchParams(EXCHANGE)}&code=again`)
      const completed = logs.map((line) => JSON.parse(line)).filter((line) => line.msg === 'request completed')
      expect(completed.map((line) => [line.res.statusCode, line.error])).toEqual([
        [400, expect.stringMatching(/^Invalid grant/)],
        [400, '`code` is there more than once'],
      ])
      expect(logs.join('\n')).not.toContain('the-code')
    })

    it('fails with a 500, and logs the error without the values of a failed query', async () => {
      const logs: string[] = []
      const app = await buildApp(logs)
      store.findCode.mockRejectedValueOnce(new DrizzleQueryError('select from "oauth_codes" where "code_hash" = $1', ['secret-hash'], new Error('boom')))
      const response = await exchange(app)
      expect(response.statusCode).toBe(500)
      expect(response.json()).toEqual({ error: 'server_error', error_description: 'Internal server error' })
      expect(logs.join('\n')).toContain('boom')
      expect(logs.join('\n')).not.toContain('secret-hash')
    })
  })

  describe('POST /api/oauth/revoke', () => {
    it('ends the connection of a token, answering the same whether there was one or not', async () => {
      const app = await buildApp()
      const response = await post(app, '/api/oauth/revoke', { token: 'some-token', client_id: CLAUDE, token_type_hint: 'refresh_token' })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({})
      expect(store.revoke).toHaveBeenCalledWith('some-token', CLAUDE)
    })

    it('fails without a token or an app, or with a secret', async () => {
      const app = await buildApp()
      for (const fields of [{ client_id: CLAUDE }, { token: 'some-token' }, { token: 'some-token', client_id: CLAUDE, client_secret: 'secret' }] as Record<string, string>[]) {
        const response = await post(app, '/api/oauth/revoke', fields)
        expect(response.statusCode).toBe(400)
        expect(response.json().error).toBe('invalid_request')
      }
      expect(store.revoke).not.toHaveBeenCalled()
    })
  })
})
