import type { FastifyInstance, FastifyReply } from 'fastify'
import { McpServer, WebStandardStreamableHTTPServerTransport, fromJsonSchema } from '@modelcontextprotocol/server'
import type { AuthInfo, ScopeChallengeHandler, jsonSchemaValidator } from '@modelcontextprotocol/server'
import { useApiErrors } from '../api/errors.js'
import { mcpAddress, scopesOf } from '../oauth/authorization.js'
import type { AccessGrant, OAuthStore } from '../oauth/store.js'
import { AREAS, instructions, isArea, loadRules, serverName } from './documentation.js'
import { buildTools } from './tools.js'
import type { ToolResult, ToolRoute } from './tools.js'

// The MCP server, at /mcp (see docs/design/server/mcp.md): MCP's Streamable HTTP transport, in its 2025 versions, which
// answers each request with JSON, never as a stream, and keeps no sessions. Apps send the access token of a connection
// (see docs/design/server/oauth.md). Its errors are JSON-RPC's, rather than the API's.

declare module 'fastify' {
  interface FastifyRequest {
    // What the request's access token lets its app do, once it's checked.
    grant?: AccessGrant
  }
}

// The versions of MCP the server answers in, the latest first, which an app that asks for another one gets.
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26']
// The scope every tool needs, for now.
const TOOL_SCOPE = 'admin'
// Larger than any tool's arguments, e.g. a profile with a long bio.
const BODY_LIMIT = 1024 * 1024

// A JSON-RPC error that isn't the answer to a request, e.g. because the request couldn't be read.
function sendError(reply: FastifyReply, status: number, code: number, message: string) {
  return reply.code(status).send({ jsonrpc: '2.0', id: null, error: { code, message } })
}

// The tools validate nothing themselves: their routes do, as they do for the admin pages, so that what a tool takes is
// exactly what its route takes, as it takes it.
const PASS_THROUGH: jsonSchemaValidator = {
  getValidator: () => (input) => ({ valid: true, data: input as never, errorMessage: undefined }),
}

type McpOptions = {
  store: OAuthStore
  // Where the site is, which is the authorization server's issuer.
  issuer: string
  // The routes that are tools (see collectToolRoutes).
  routes: ToolRoute[]
  // Which deployment the server is (see config.environment), which it tells the model: `development` when it isn't
  // given, e.g. when generating openapi.json.
  environment?: string
}

export async function mcpRoutes(app: FastifyInstance, { store, issuer, routes, environment = 'development' }: McpOptions) {
  // What every request's server registers: the tools' definitions are only made once.
  const info = { name: serverName(environment), version: '1.0.0' }
  const instructionsText = instructions(environment)
  const tools = buildTools(routes, app).map((tool) => ({
    tool,
    config: {
      title: tool.title,
      description: tool.description,
      inputSchema: fromJsonSchema(tool.inputSchema as never, PASS_THROUGH),
      annotations: { title: tool.title, ...(tool.readOnly ? { readOnlyHint: true } : { destructiveHint: true }), openWorldHint: false },
    },
  }))
  const documentation = {
    title: 'Lire les règles',
    description:
      'The rules of an area, e.g. those sessions and sets follow, their statuses and what deleting them does: read them before changing anything in it.',
    inputSchema: fromJsonSchema(
      { type: 'object', properties: { area: { type: 'string', enum: [...AREAS] } }, required: ['area'], additionalProperties: false },
      PASS_THROUGH,
    ),
    annotations: { title: 'Lire les règles', readOnlyHint: true, openWorldHint: false },
  }
  const rules = await loadRules()
  const resourceMetadata = `${issuer}/.well-known/oauth-protected-resource/mcp`

  // The body is passed on as it is, after only checking that it's one JSON-RPC message.
  app.removeAllContentTypeParsers()
  app.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: BODY_LIMIT }, (_request, body, done) => done(null, body))
  useApiErrors(app, {
    send: (reply, status, message) => sendError(reply, status, status < 500 ? -32600 : -32603, message),
  })

  const unauthorized = (reply: FastifyReply, invalid: boolean) =>
    sendError(
      reply.header(
        'www-authenticate',
        `Bearer resource_metadata="${resourceMetadata}", scope="${TOOL_SCOPE}"${invalid ? ', error="invalid_token"' : ''}`,
      ),
      401,
      -32000,
      invalid ? 'The access token is invalid or has expired' : 'An access token is required',
    )

  app.addHook('onRequest', async (request, reply) => {
    // Against DNS rebinding: a browser says where a request comes from, and only the site's own pages can send one. The
    // site's address is an origin (see config.siteOrigin).
    const sentFrom = request.headers.origin
    if (sentFrom !== undefined && sentFrom !== issuer) return sendError(reply, 403, -32000, 'Requests from another origin are refused')
    const token = /^Bearer (\S+)$/i.exec(request.headers.authorization ?? '')?.[1]
    if (!token) return unauthorized(reply, false)
    const grant = await store.findAccessToken(token)
    if (!grant) return unauthorized(reply, true)
    request.grant = grant
  })

  // The server never sends anything on its own, and keeps no sessions.
  for (const method of ['GET', 'DELETE'] as const) {
    app.route({ method, url: '/mcp', handler: async (_request, reply) => sendError(reply.header('allow', 'POST'), 405, -32000, 'Only POST is allowed') })
  }

  app.post<{ Body: string }>('/mcp', async (request, reply) => {
    const grant = request.grant!
    let message: unknown
    try {
      message = JSON.parse(request.body)
    } catch {
      return sendError(reply, 400, -32700, 'The body is not valid JSON')
    }
    if (Array.isArray(message)) return sendError(reply, 400, -32600, 'Batches are not supported')

    // A server for this request only, since none is kept.
    const server = new McpServer(
      info,
      { capabilities: { tools: {} }, instructions: instructionsText, supportedProtocolVersions: PROTOCOL_VERSIONS },
    )
    // A tool whose scope the connection doesn't have, but its user does, asks the app to have the user allow it again.
    // When the user doesn't have it either, the tool fails like any other (see `allowed`). Neither can happen until there
    // are other scopes than `admin`, which every connection and every user has for now.
    const scopeChallenge: ScopeChallengeHandler = () =>
      !grant.scopes.includes(TOOL_SCOPE) && scopesOf().includes(TOOL_SCOPE) ? { scopes: [TOOL_SCOPE] } : undefined
    const allowed = (): ToolResult | undefined =>
      grant.scopes.includes(TOOL_SCOPE) ? undefined : { content: [{ type: 'text', text: "The connection can't use this tool" }], isError: true }
    const called = (name: string) => request.log.info({ tool: name, connection: grant.connectionId, user: grant.user.id }, 'An MCP tool was called')

    for (const { tool, config } of tools) {
      server.registerTool(tool.name, { ...config, scopeChallenge }, async (args) => {
        called(tool.name)
        return allowed() ?? tool.call((args ?? {}) as Record<string, unknown>, grant.user)
      })
    }
    server.registerTool('read_documentation', { ...documentation, scopeChallenge }, async (args) => {
      called('read_documentation')
      const area = (args as { area?: unknown } | undefined)?.area
      if (!isArea(area)) {
        return { content: [{ type: 'text', text: `\`area\` has to be one of ${AREAS.join(', ')}` }], isError: true }
      }
      return allowed() ?? { content: [{ type: 'text', text: rules[area] }] }
    })

    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    await server.connect(transport)
    // Only what MCP needs of the request's headers.
    const headers = new Headers()
    for (const name of ['accept', 'content-type', 'mcp-protocol-version']) {
      const value = request.headers[name]
      if (typeof value === 'string') headers.set(name, value)
    }
    const authInfo: AuthInfo = { token: '', clientId: grant.clientId, scopes: grant.scopes, resourceMetadataUrl: resourceMetadata }
    try {
      const response = await transport.handleRequest(new Request(mcpAddress(issuer), { method: 'POST', headers, body: request.body }), {
        parsedBody: message,
        authInfo,
      })
      reply.code(response.status)
      response.headers.forEach((value, name) => reply.header(name, value))
      return reply.send(await response.text())
    } finally {
      await server.close()
    }
  })
}
