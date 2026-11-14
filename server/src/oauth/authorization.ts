import { findClient, isRedirectUri } from './clients.js'
import type { OAuthClient } from './clients.js'

// The authorization step of OAuth (see Authorizing an app in docs/design/server/oauth.md): the request an app sends the
// admin's browser to the authorization page with, which the page shows, then allows or refuses through the routes.

export const SCOPES = ['admin'] as const
export type Scope = (typeof SCOPES)[number]

// The scopes a user can give apps. Every user is an admin for now, who has them all.
export function scopesOf(): Scope[] {
  return [...SCOPES]
}

function isScope(scope: string): scope is Scope {
  return (SCOPES as readonly string[]).includes(scope)
}

// The address of the MCP server, which tokens are for (`resource`), on the site at `issuer`.
export function mcpAddress(issuer: string): string {
  return `${issuer}/mcp`
}

// An address's scheme and authority, and the rest.
const ADDRESS = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)(.*)$/is

// Whether `resource`, as an app sent it, is `address`, whatever the case of its scheme and host, and exactly otherwise.
export function isResource(resource: string, address: string): boolean {
  const [sent, expected] = [ADDRESS.exec(resource), ADDRESS.exec(address)]
  return sent !== null && expected !== null && sent[1].toLowerCase() === expected[1].toLowerCase() && sent[2] === expected[2]
}

// The authorization request's parameters, as they're in the page's query: a parameter that's there more than once is a
// list.
export type AuthorizationParams = Record<string, string | string[] | undefined>

export type CheckedAuthorization =
  | { ok: true; client: OAuthClient; redirectUri: string; codeChallenge: string; scopes: Scope[]; state: string | undefined }
  // What's wrong, as the page says it, with where to send the browser to tell the app, when the app can be told.
  | { ok: false; error: string; redirect: string }
  // Or else whether it's because the app isn't one of the clients.
  | { ok: false; error: string; unknownClient: boolean }

// PKCE's code challenge (RFC 7636), which S256 makes 43 characters long.
const CODE_CHALLENGE = /^[A-Za-z0-9._~-]{43,128}$/

// `redirectUri`, with `params` added to its query, e.g. the code or the error, and the state.
export function redirectTo(redirectUri: string, params: Record<string, string | undefined>): string {
  const url = new URL(redirectUri)
  for (const [name, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(name, value)
  return url.href
}

// Checks an authorization request for a user who has `userScopes`, on the site at `issuer`. `client_id` and
// `redirect_uri` are checked first, since until they are, the browser can't be sent back to the app.
export function checkAuthorization(params: AuthorizationParams, { issuer, userScopes }: { issuer: string; userScopes: Scope[] }): CheckedAuthorization {
  const clientId = params.client_id
  if (typeof clientId !== 'string') return { ok: false, error: '`client_id` is missing, or there more than once', unknownClient: false }
  const client = findClient(clientId)
  if (!client) return { ok: false, error: "This app can't connect", unknownClient: true }
  const redirectUri = params.redirect_uri
  if (typeof redirectUri !== 'string' || !isRedirectUri(client, redirectUri)) {
    return { ok: false, error: "`redirect_uri` isn't one of the app's", unknownClient: false }
  }

  const state = typeof params.state === 'string' ? params.state : undefined
  const back = (error: string, description: string) => ({
    ok: false as const,
    error: description,
    redirect: redirectTo(redirectUri, { error, error_description: description, state, iss: issuer }),
  })
  for (const [name, value] of Object.entries(params)) {
    if (Array.isArray(value)) return back('invalid_request', `\`${name}\` is there more than once`)
  }
  const once = params as Record<string, string | undefined>
  const { response_type: responseType, code_challenge: codeChallenge, code_challenge_method: method, scope, resource } = once
  if (responseType !== 'code') return back('unsupported_response_type', '`response_type` has to be `code`')
  if (typeof codeChallenge !== 'string' || !CODE_CHALLENGE.test(codeChallenge)) {
    return back('invalid_request', '`code_challenge` is missing, or invalid')
  }
  if (method !== 'S256') return back('invalid_request', '`code_challenge_method` has to be `S256`')
  if (resource !== undefined && !isResource(resource, mcpAddress(issuer))) {
    return back('invalid_target', '`resource` has to be the MCP server')
  }
  // Those the server doesn't know are ignored, and asking for none of those it knows means all of the user's.
  const asked = [...new Set((scope ?? '').split(/\s+/).filter(isScope))]
  if (asked.some((scope) => !userScopes.includes(scope))) return back('invalid_scope', "The app asks for a scope the user doesn't have")
  return { ok: true, client, redirectUri, codeChallenge, scopes: asked.length > 0 ? asked : userScopes, state }
}
