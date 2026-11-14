import { describe, expect, it } from 'vitest'
import { checkAuthorization, isResource } from './authorization.js'
import type { AuthorizationParams } from './authorization.js'

const ISSUER = 'https://parking.radio'
const CLAUDE = 'https://claude.ai/oauth/mcp-oauth-client-metadata'
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback'
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

// A valid request from Claude, with `changes` made to it.
function request(changes: AuthorizationParams = {}): AuthorizationParams {
  const params: AuthorizationParams = {
    response_type: 'code',
    client_id: CLAUDE,
    redirect_uri: CALLBACK,
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    state: 'the-state',
    ...changes,
  }
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined))
}

function check(changes: AuthorizationParams = {}) {
  return checkAuthorization(request(changes), { issuer: ISSUER, userScopes: ['admin'] })
}

// The error the browser is sent back to the app with, and the rest of the redirect's query.
function redirected(changes: AuthorizationParams) {
  const checked = check(changes)
  if (checked.ok || !('redirect' in checked)) throw new Error(`Expected a redirect, got ${JSON.stringify(checked)}`)
  const url = new URL(checked.redirect)
  expect(url.origin + url.pathname).toBe(CALLBACK)
  return Object.fromEntries(url.searchParams)
}

describe('checkAuthorization', () => {
  it("takes a valid request, with all of the user's scopes by default", () => {
    expect(check()).toMatchObject({ ok: true, redirectUri: CALLBACK, codeChallenge: CHALLENGE, scopes: ['admin'], state: 'the-state' })
  })

  it("ignores the scopes it doesn't know, and takes those it does", () => {
    expect(check({ scope: 'offline_access' })).toMatchObject({ ok: true, scopes: ['admin'] })
    expect(check({ scope: 'admin offline_access admin' })).toMatchObject({ ok: true, scopes: ['admin'] })
  })

  it('shows errors about client_id or redirect_uri on the page, without sending the browser back to the app', () => {
    for (const changes of [{ client_id: undefined }, { client_id: [CLAUDE, CLAUDE] }, { redirect_uri: undefined }, { redirect_uri: [CALLBACK, CALLBACK] }, { redirect_uri: 'https://example.com/callback' }]) {
      const checked = check(changes)
      expect(checked, JSON.stringify(changes)).toMatchObject({ ok: false, unknownClient: false })
      expect(checked).not.toHaveProperty('redirect')
    }
  })

  it("says when the app isn't one of the clients", () => {
    expect(check({ client_id: 'https://example.com/client.json' })).toEqual({ ok: false, error: "This app can't connect", unknownClient: true })
  })

  it('checks client_id and redirect_uri before anything else', () => {
    expect(check({ redirect_uri: 'https://example.com/callback', response_type: 'token' })).toMatchObject({ ok: false, unknownClient: false })
  })

  it('sends the other errors back to the app, with the state and the issuer', () => {
    expect(redirected({ response_type: 'token' })).toEqual({
      error: 'unsupported_response_type',
      error_description: '`response_type` has to be `code`',
      state: 'the-state',
      iss: ISSUER,
    })
    expect(redirected({ response_type: undefined }).error).toBe('unsupported_response_type')
    expect(redirected({ code_challenge: undefined }).error).toBe('invalid_request')
    expect(redirected({ code_challenge: 'short' }).error).toBe('invalid_request')
    expect(redirected({ code_challenge_method: undefined }).error).toBe('invalid_request')
    expect(redirected({ code_challenge_method: 'plain' }).error).toBe('invalid_request')
    expect(redirected({ resource: 'https://example.com/mcp' }).error).toBe('invalid_target')
    expect(redirected({ resource: 'https://parking.radio/mcp/' }).error).toBe('invalid_target')
  })

  it("refuses a parameter that's there more than once, without the state when it's the state", () => {
    expect(redirected({ scope: ['admin', 'admin'] })).toMatchObject({ error: 'invalid_request', error_description: '`scope` is there more than once' })
    expect(redirected({ state: ['a', 'b'] })).toEqual({ error: 'invalid_request', error_description: '`state` is there more than once', iss: ISSUER })
  })

  it('leaves the state out when the app sent none', () => {
    expect(redirected({ state: undefined, response_type: 'token' })).not.toHaveProperty('state')
    expect(check({ state: undefined })).toMatchObject({ ok: true, state: undefined })
  })

  it("refuses a scope the user doesn't have", () => {
    const checked = checkAuthorization(request({ scope: 'admin' }), { issuer: ISSUER, userScopes: [] })
    expect(checked.ok || !('redirect' in checked) ? null : new URL(checked.redirect).searchParams.get('error')).toBe('invalid_scope')
  })

  it("takes Claude Code's redirect URI on any port", () => {
    const checked = check({ client_id: 'https://claude.ai/oauth/claude-code-client-metadata', redirect_uri: 'http://localhost:3118/callback' })
    expect(checked).toMatchObject({ ok: true, redirectUri: 'http://localhost:3118/callback' })
  })
})

describe('isResource', () => {
  it('compares the scheme and the host whatever their case, and nothing else', () => {
    expect(isResource('https://parking.radio/mcp', 'https://parking.radio/mcp')).toBe(true)
    expect(isResource('HTTPS://Parking.Radio/mcp', 'https://parking.radio/mcp')).toBe(true)
    expect(isResource('https://parking.radio:443/mcp', 'https://parking.radio/mcp')).toBe(false)
    expect(isResource('https://parking.radio/x/../mcp', 'https://parking.radio/mcp')).toBe(false)
    expect(isResource('https://parking.radio\\mcp', 'https://parking.radio/mcp')).toBe(false)
    expect(isResource('https://parking.radio/mcp/', 'https://parking.radio/mcp')).toBe(false)
    expect(isResource('https://parking.radio/MCP', 'https://parking.radio/mcp')).toBe(false)
    expect(isResource('https://parking.radio/mcp#x', 'https://parking.radio/mcp')).toBe(false)
    expect(isResource('parking.radio/mcp', 'https://parking.radio/mcp')).toBe(false)
  })
})
