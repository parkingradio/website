import { describe, expect, it } from 'vitest'
import { OAUTH_CLIENTS, findClient, isRedirectUri } from './clients.js'

const claude = findClient('https://claude.ai/oauth/mcp-oauth-client-metadata')!
const claudeCode = findClient('https://claude.ai/oauth/claude-code-client-metadata')!

describe('OAuth clients', () => {
  it('are Claude and Claude Code, by the addresses of their documents', () => {
    expect(OAUTH_CLIENTS.map(({ name }) => name)).toEqual(['Claude', 'Claude Code'])
    expect(findClient('https://example.com/client.json')).toBeUndefined()
  })

  it("only take Claude's redirect URI exactly", () => {
    expect(isRedirectUri(claude, 'https://claude.ai/api/mcp/auth_callback')).toBe(true)
    for (const uri of [
      'https://claude.ai/api/mcp/auth_callback/',
      'https://claude.ai:443/api/mcp/auth_callback',
      'https://CLAUDE.ai/api/mcp/auth_callback',
      'https://claude.ai/api/mcp/auth_callback?x=1',
      'https://claude.ai/api/mcp/auth_callback#x',
      'http://claude.ai/api/mcp/auth_callback',
      'http://localhost/callback',
    ]) {
      expect(isRedirectUri(claude, uri), uri).toBe(false)
    }
  })

  it("take Claude Code's redirect URIs on any port", () => {
    for (const uri of ['http://localhost/callback', 'http://localhost:3118/callback', 'http://127.0.0.1:1/callback', 'http://127.0.0.1:65535/callback']) {
      expect(isRedirectUri(claudeCode, uri), uri).toBe(true)
    }
  })

  it("don't take anything else for Claude Code's", () => {
    for (const uri of [
      'http://localhost:0/callback',
      'http://localhost:65536/callback',
      'http://localhost:/callback',
      'http://localhost:3118/callback/',
      'http://localhost:3118/callback?x=1',
      'http://localhost:3118/callback#x',
      'http://localhost:3118/other',
      'http://localhost.example.com:3118/callback',
      'http://localhost@example.com/callback',
      'http://localhost:3118@example.com/callback',
      'https://localhost:3118/callback',
      'http://[::1]:3118/callback',
      'http://127.0.0.2:3118/callback',
      'https://claude.ai/api/mcp/auth_callback',
    ]) {
      expect(isRedirectUri(claudeCode, uri), uri).toBe(false)
    }
  })
})
