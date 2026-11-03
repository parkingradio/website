// The apps that can connect (see Clients in docs/design/server/oauth.md). They identify themselves by the address of a
// document that describes them (a client ID metadata document), which the server doesn't fetch: it knows those of the
// apps it's for. When an app changes its document, e.g. its redirect URIs, this list has to change with it.

export type OAuthClient = {
  // The address of its document, which is its `client_id`.
  id: string
  // What the pages call it, rather than what its document says.
  name: string
  redirectUris: string[]
  // Whether it runs on the user's computer, and listens there for the browser on a port that changes every time, so that
  // the port of its redirect URIs is ignored (RFC 8252).
  local: boolean
}

export const OAUTH_CLIENTS: OAuthClient[] = [
  {
    id: 'https://claude.ai/oauth/mcp-oauth-client-metadata',
    name: 'Claude',
    redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
    local: false,
  },
  {
    id: 'https://claude.ai/oauth/claude-code-client-metadata',
    name: 'Claude Code',
    redirectUris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
    local: true,
  },
]

export function findClient(id: string): OAuthClient | undefined {
  return OAUTH_CLIENTS.find((client) => client.id === id)
}

// Whether `uri` is one of the client's redirect URIs, exactly, except for the port of those of an app on the user's
// computer. They're compared as they're written, rather than parsed, so that nothing else can differ, e.g. a user in
// `http://localhost@example.com/callback`, a query or a fragment.
export function isRedirectUri(client: OAuthClient, uri: string): boolean {
  return client.redirectUris.some((registered) => {
    if (uri === registered) return true
    if (!client.local) return false
    const { origin, pathname } = new URL(registered)
    const port = uri.startsWith(`${origin}:`) ? uri.slice(origin.length + 1).match(/^(\d{1,5})(.*)$/s) : null
    return port !== null && Number(port[1]) >= 1 && Number(port[1]) <= 65535 && port[2] === pathname
  })
}
