import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import { useZodSchemas } from '../api/schemas.js'
import { TEST_ADMIN, acceptSessions, sessionCookies } from '../admins/test-sessions.js'
import type { OAuthStore } from './store.js'
import { oauthRoutes } from './routes.js'

const ISSUER = 'https://parking.radio'
const CLAUDE = 'https://claude.ai/oauth/mcp-oauth-client-metadata'
const CLAUDE_CODE = 'https://claude.ai/oauth/claude-code-client-metadata'
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback'
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
const AUTHORIZATION = '/api/admin/oauth/authorization'

// What the routes use of the store: the rest is the token endpoint's (see app-routes.test.ts).
const store = {
  createCode: vi.fn<OAuthStore['createCode']>(async () => 'the-code'),
  list: vi.fn<OAuthStore['list']>(async () => []),
  delete: vi.fn<OAuthStore['delete']>(async () => true),
}

async function buildApp(logs?: string[]) {
  const app = Fastify(logs ? { logger: { stream: { write: (line: string) => logs.push(line) } } } : {})
  useZodSchemas(app)
  await app.register(fastifyCookie)
  acceptSessions(app)
  await app.register(oauthRoutes, { store: store as unknown as OAuthStore, issuer: ISSUER })
  return app
}

// A valid request from Claude, with `changes` made to it.
function params(changes: Record<string, string | undefined> = {}) {
  const all: Record<string, string | undefined> = {
    response_type: 'code',
    client_id: CLAUDE,
    redirect_uri: CALLBACK,
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    state: 'the-state',
    ...changes,
  }
  return Object.fromEntries(Object.entries(all).filter((entry): entry is [string, string] => entry[1] !== undefined))
}

async function getAuthorization(app: Awaited<ReturnType<typeof buildApp>>, query: string) {
  return app.inject({ method: 'GET', url: `${AUTHORIZATION}?${query}`, cookies: await sessionCookies() })
}

async function postAuthorization(app: Awaited<ReturnType<typeof buildApp>>, body: object) {
  return app.inject({ method: 'POST', url: AUTHORIZATION, payload: body, cookies: await sessionCookies() })
}

describe('OAuth routes', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
    vi.clearAllMocks()
  })

  afterEach(() => {
    delete process.env.JWT_SECRET
  })

  it('require a session, and refuse changes from another origin', async () => {
    const app = await buildApp()
    for (const response of [
      await app.inject({ method: 'GET', url: `${AUTHORIZATION}?${new URLSearchParams(params())}` }),
      await app.inject({ method: 'POST', url: AUTHORIZATION, payload: { ...params(), allow: true } }),
      await app.inject({ method: 'GET', url: '/api/admin/connections' }),
      await app.inject({ method: 'DELETE', url: '/api/admin/connections/some-id' }),
    ]) {
      expect(response.statusCode).toBe(401)
    }
    for (const headers of [{ 'sec-fetch-site': 'cross-site' }, { origin: 'https://example.com' }]) {
      const crossSite = await app.inject({ method: 'POST', url: AUTHORIZATION, payload: { ...params(), allow: true }, headers, cookies: await sessionCookies() })
      expect(crossSite.statusCode, JSON.stringify(headers)).toBe(403)
    }
    expect(store.createCode).not.toHaveBeenCalled()
  })

  describe('GET /api/admin/oauth/authorization', () => {
    it('says which app asks, where the browser goes back to, and what it would get', async () => {
      const app = await buildApp()
      const response = await getAuthorization(app, new URLSearchParams(params()).toString())
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ ok: true, client: 'Claude', redirectHost: 'claude.ai', local: false, scopes: ['admin'] })
    })

    it("says when the app is on the user's computer", async () => {
      const app = await buildApp()
      const query = new URLSearchParams(params({ client_id: CLAUDE_CODE, redirect_uri: 'http://127.0.0.1:3118/callback' }))
      expect((await getAuthorization(app, query.toString())).json()).toMatchObject({ client: 'Claude Code', redirectHost: '127.0.0.1', local: true })
    })

    it('fails with where to send the browser to tell the app, when it can be told', async () => {
      const app = await buildApp()
      const response = await getAuthorization(app, `${new URLSearchParams(params())}&state=again`)
      expect(response.statusCode).toBe(400)
      const { redirect, ...error } = response.json()
      expect(error).toEqual({ ok: false, error: '`state` is there more than once' })
      expect(Object.fromEntries(new URL(redirect).searchParams)).toEqual({
        error: 'invalid_request',
        error_description: '`state` is there more than once',
        iss: ISSUER,
      })
    })

    it("sends the browser back to an app on the user's computer, on its port, to tell it what's wrong", async () => {
      const app = await buildApp()
      const query = new URLSearchParams(params({ client_id: CLAUDE_CODE, redirect_uri: 'http://localhost:3118/callback', response_type: 'token' }))
      const redirect = new URL((await getAuthorization(app, query.toString())).json().redirect)
      expect(redirect.origin + redirect.pathname).toBe('http://localhost:3118/callback')
      expect(redirect.searchParams.get('error')).toBe('unsupported_response_type')
    })

    it("fails without sending the browser back for an app it doesn't know, and logs it", async () => {
      const logs: string[] = []
      const app = await buildApp(logs)
      const clientId = `https://example.com/${'x'.repeat(300)}`
      const response = await getAuthorization(app, new URLSearchParams(params({ client_id: clientId })).toString())
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ ok: false, error: 'Only Claude and Claude Code can connect', unknownClient: true })
      const logged = logs.map((line) => JSON.parse(line)).find((line) => line.msg === "An app that the server doesn't know asked to connect")
      expect(logged.clientId).toBe(clientId.slice(0, 200))
    })

    it("fails without sending the browser back for a redirect URI that isn't the app's", async () => {
      const app = await buildApp()
      const response = await getAuthorization(app, new URLSearchParams(params({ redirect_uri: 'https://example.com/callback' })).toString())
      expect(response.json()).toEqual({ ok: false, error: "`redirect_uri` isn't one of the app's", unknownClient: false })
    })
  })

  describe('POST /api/admin/oauth/authorization', () => {
    it('gives the app a code, which it saves, with the state and the issuer', async () => {
      const app = await buildApp()
      const before = Date.now()
      const response = await postAuthorization(app, { ...params({ scope: 'admin' }), allow: true })
      expect(response.statusCode).toBe(200)
      const redirect = new URL(response.json().redirect)
      expect(redirect.origin + redirect.pathname).toBe(CALLBACK)
      expect(Object.fromEntries(redirect.searchParams)).toEqual({ code: 'the-code', state: 'the-state', iss: ISSUER })
      expect(store.createCode).toHaveBeenCalledWith({
        userId: TEST_ADMIN.id,
        clientId: CLAUDE,
        redirectUri: CALLBACK,
        codeChallenge: CHALLENGE,
        scopes: ['admin'],
        expiresAt: expect.any(Date),
      })
      const { expiresAt } = store.createCode.mock.calls[0][0]
      expect(expiresAt.getTime() - before).toBeGreaterThanOrEqual(10 * 60 * 1000)
      expect(expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000)
    })

    it('tells the app that the user refused, without a code', async () => {
      const app = await buildApp()
      const response = await postAuthorization(app, { ...params(), allow: false })
      expect(Object.fromEntries(new URL(response.json().redirect).searchParams)).toEqual({
        error: 'access_denied',
        error_description: 'The user refused',
        state: 'the-state',
        iss: ISSUER,
      })
      expect(store.createCode).not.toHaveBeenCalled()
    })

    it("ignores the parameters it doesn't know, which the page sends as it got them", async () => {
      const app = await buildApp()
      const response = await postAuthorization(app, { ...params(), foo: 'x', allow: true })
      expect(response.statusCode).toBe(200)
      expect(new URL(response.json().redirect).searchParams.get('code')).toBe('the-code')
    })

    it('fails like the GET, without a code', async () => {
      const app = await buildApp()
      const response = await postAuthorization(app, { ...params({ code_challenge_method: 'plain' }), allow: true })
      expect(response.statusCode).toBe(400)
      expect(new URL(response.json().redirect).searchParams.get('error')).toBe('invalid_request')
      expect(store.createCode).not.toHaveBeenCalled()
    })
  })

  describe('connections', () => {
    it("lists the admin's own, by the names of their apps", async () => {
      const createdAt = new Date('2026-11-01T12:00:00Z')
      const lastUsedAt = new Date('2026-11-02T12:00:00Z')
      store.list.mockResolvedValueOnce([{ id: 'connection-id', clientId: CLAUDE_CODE, scopes: ['admin'], createdAt, lastUsedAt }])
      const app = await buildApp()
      const response = await app.inject({ method: 'GET', url: '/api/admin/connections', cookies: await sessionCookies() })
      expect(response.json()).toEqual({
        ok: true,
        connections: [{ id: 'connection-id', client: 'Claude Code', scopes: ['admin'], createdAt: createdAt.toISOString(), lastUsedAt: lastUsedAt.toISOString() }],
      })
      expect(store.list).toHaveBeenCalledWith(TEST_ADMIN.id)
    })

    it("ends one of the admin's own, or fails with 404", async () => {
      const app = await buildApp()
      const deleted = await app.inject({ method: 'DELETE', url: '/api/admin/connections/connection-id', cookies: await sessionCookies() })
      expect(deleted.json()).toEqual({ ok: true })
      expect(store.delete).toHaveBeenCalledWith(TEST_ADMIN.id, 'connection-id')
      store.delete.mockResolvedValueOnce(false)
      const missing = await app.inject({ method: 'DELETE', url: '/api/admin/connections/other-id', cookies: await sessionCookies() })
      expect(missing.statusCode).toBe(404)
      expect(missing.json()).toEqual({ ok: false, error: 'No such connection' })
    })
  })
})
