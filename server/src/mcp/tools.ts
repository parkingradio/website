import type { FastifyInstance, FastifySchema } from 'fastify'
import { z } from 'zod'
import type { ToolConfig } from '../api/schemas.js'
import { signSessionToken } from '../admins/auth.js'
import { config } from '../core/config.js'
import { areaOf } from './documentation.js'
import type { Area } from './documentation.js'

// The tools of the MCP server, which are the routes that say they're tools (see `config.tool` in api/schemas.ts, and
// docs/design/server/mcp.md). A tool sends its route the request its arguments make, as the connection's user, and gives
// back the route's response, so that the route stays the only thing that checks what's sent and decides what happens.

// A route that's a tool, as it was registered.
export type ToolRoute = { method: string; url: string; schema: FastifySchema; tool: ToolConfig }

// The user a tool acts as.
export type ToolUser = { id: string; email: string; sessionVersion: number }

type JsonObject = { [key: string]: unknown }

export type ToolResult = { content: [{ type: 'text'; text: string }]; isError?: true }

export type Tool = {
  name: string
  title: string
  description: string
  // The JSON Schema of its arguments, an object.
  inputSchema: JsonObject
  readOnly: boolean
  call(args: JsonObject, as: ToolUser): Promise<ToolResult>
}

// Collects the routes of `app` that are tools, as they're registered, which has to start before they are.
export function collectToolRoutes(app: FastifyInstance): ToolRoute[] {
  const routes: ToolRoute[] = []
  app.addHook('onRoute', (route) => {
    if (route.config?.tool) {
      // Not the HEAD routes that Fastify adds for GET routes.
      for (const method of [route.method].flat().filter((method) => method !== 'HEAD')) {
        routes.push({ method, url: route.url, schema: route.schema ?? {}, tool: route.config.tool })
      }
    }
  })
  return routes
}

// How long the session of a request a tool sends lasts: only for that request.
const TOOL_SESSION_SECONDS = 60

// The parts of a request that a tool's arguments go to.
type Part = 'path' | 'query' | 'body' | 'profile' | 'removePhoto'

// The JSON Schema of `schema`, as it's received, or as it's sent, with the schemas it refers to written in it, since an
// argument's schema can't refer to another tool's.
function jsonSchema(schema: z.ZodType, io: 'input' | 'output' = 'input'): JsonObject {
  const json = z.toJSONSchema(schema, { io, unrepresentable: 'any' }) as JsonObject & { $defs?: Record<string, unknown> }
  const $defs = json.$defs ?? {}
  delete json.$defs
  delete json.$schema
  const inline = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(inline)
    if (node === null || typeof node !== 'object') return node
    const { $ref, ...rest } = node as JsonObject
    const referred = typeof $ref === 'string' && $ref.startsWith('#/$defs/') ? inline($defs[$ref.slice('#/$defs/'.length)]) : {}
    return { ...(referred as JsonObject), ...Object.fromEntries(Object.entries(rest).map(([key, value]) => [key, inline(value)])) }
  }
  return inline(json) as JsonObject
}

// A multipart request's part that's JSON, e.g. an artist's profile, rather than a file or a field.
function profilePart(multipart: z.ZodObject): [string, z.ZodObject] {
  const parts = Object.entries(multipart.shape).filter(([name, part]) => name !== 'removePhoto' && part instanceof z.ZodObject)
  if (parts.length !== 1) throw new Error('A multipart tool takes one part that is JSON')
  return parts[0] as [string, z.ZodObject]
}

// The tools' arguments and where each one goes, from the route's schemas. Two arguments with the same name, e.g. a path
// parameter and a field of the body, can't be told apart, so the server refuses to start.
function argumentsOf(route: ToolRoute): { schema: JsonObject; parts: Map<string, Part>; profile?: string; nullable: string[] } {
  const properties: JsonObject = {}
  const required: string[] = []
  const parts = new Map<string, Part>()
  // The fields of a POST's body that can be null, which can be left out, and are then sent as null, e.g. a new set's
  // SoundCloud track. A PUT replaces everything, so its tool takes them all.
  const nullable: string[] = []
  const add = (schema: z.ZodType | undefined, part: Part) => {
    if (!schema) return
    const json = jsonSchema(schema) as { properties?: JsonObject; required?: string[] }
    // E.g. a union, whose arguments the tool couldn't name.
    if (!json.properties) throw new Error(`${route.method} ${route.url}: its tool's arguments have to be an object's properties`)
    for (const [name, property] of Object.entries(json.properties)) {
      if (parts.has(name)) throw new Error(`${route.method} ${route.url}: two of its tool's arguments are named \`${name}\``)
      parts.set(name, part)
      properties[name] = property
    }
    for (const name of json.required ?? []) {
      if (route.method === 'POST' && (part === 'body' || part === 'profile') && allowsNull(json.properties[name])) nullable.push(name)
      else required.push(name)
    }
  }
  add(route.schema.params as z.ZodType | undefined, 'path')
  // A path parameter is said to be the id of what's before it in the path, e.g. a session's for `create_set`, unless its
  // schema says otherwise.
  for (const [, before, param] of route.url.matchAll(/([a-z]+)s\/:(\w+)/g)) {
    const property = properties[param] as JsonObject | undefined
    if (property && !property.description) property.description = `The ${before}'s ${param}`
  }
  add(route.schema.querystring as z.ZodType | undefined, 'query')
  add(route.schema.body as z.ZodType | undefined, 'body')
  let profile: string | undefined
  if (route.schema.multipart) {
    const [name, schema] = profilePart(route.schema.multipart)
    profile = name
    add(schema, 'profile')
    if ('removePhoto' in route.schema.multipart.shape) {
      parts.set('removePhoto', 'removePhoto')
      properties.removePhoto = { type: 'boolean', description: "Whether to remove the photo. Tools can't send one" }
    }
  }
  return { schema: { type: 'object', properties, required, additionalProperties: false }, parts, profile, nullable }
}

// The schemas a value that follows a JSON Schema can follow: the schema, and its alternatives, e.g. a date and time, or
// null.
function alternatives(schema: unknown): JsonObject[] {
  if (schema === null || typeof schema !== 'object') return []
  const { anyOf, oneOf, allOf } = schema as { anyOf?: unknown[]; oneOf?: unknown[]; allOf?: unknown[] }
  return [schema as JsonObject, ...[...(anyOf ?? []), ...(oneOf ?? []), ...(allOf ?? [])].flatMap(alternatives)]
}

// Whether a JSON Schema takes null.
function allowsNull(schema: unknown): boolean {
  return alternatives(schema).some(({ type }) => type === 'null' || (Array.isArray(type) && type.includes('null')))
}

// Québec's time zone and the en-CA locale, which writes days as YYYY-MM-DD, like the client's (see
// client/src/quebec-time.ts).
const QUEBEC_TIME = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Toronto',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'longOffset',
})

// A date and time, in Québec time, to the second, with its offset from UTC, e.g. "2026-11-14T21:00:00-05:00" for
// "2026-11-15T02:00:00.000Z": the same instant, as admins see it.
export function inQuebecTime(dateTime: string): string {
  const part = Object.fromEntries(QUEBEC_TIME.formatToParts(new Date(dateTime)).map(({ type, value }) => [type, value]))
  // The offset is written "GMT-05:00".
  return `${part.year}-${part.month}-${part.day}T${part.hour}:${part.minute}:${part.second}${part.timeZoneName.replace('GMT', '')}`
}

// `value`, with the dates and times that `schema`, its JSON Schema, says it has in Québec time.
export function withQuebecTimes(value: unknown, schema: unknown): unknown {
  const schemas = alternatives(schema)
  if (typeof value === 'string') return schemas.some(({ format }) => format === 'date-time') ? inQuebecTime(value) : value
  if (Array.isArray(value)) return value.map((item) => withQuebecTimes(item, schemas.find(({ items }) => items)?.items))
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, field]) => [
      key,
      withQuebecTimes(field, schemas.map(({ properties }) => (properties as JsonObject | undefined)?.[key]).find(Boolean)),
    ]),
  )
}

// What a tool's description starts with: to read its area's rules, once, rather than before each call.
export function readFirst(area: Area | undefined): string {
  return `Once per conversation, before using it, read the rules with \`read_documentation\`${area ? `, area \`${area}\`` : ''}.`
}

// What a tool's description says: first, to read its area's rules, since some apps only give the model the tools'
// descriptions, rather than the instructions too (see docs/design/server/mcp.md), then the route's summary, and more.
function descriptionOf(route: ToolRoute, name: string): string {
  const summary = route.schema.summary ?? ''
  const sentences = [readFirst(areaOf(route.url)), /[.!?]$/.test(summary) ? summary : `${summary}.`]
  if (name in SUMMARIES) sentences.push(`Gives a summary of each one: \`get_${name.slice('list_'.length, -1)}\` gives all of it.`)
  // The tools that replace a whole item, rather than one of its fields, e.g. `update_set` but not `update_set_status`.
  if (route.method === 'PUT' && /^update_[a-z]+$/.test(name)) {
    sentences.push("It replaces it: what's left out is erased, except what it says it keeps, so read it first.")
  }
  if (route.schema.multipart) sentences.push("Tools can't send a photo.")
  if (hasContactDetails(route) && route.method !== 'DELETE') sentences.push('Emails and phone numbers are never shown.')
  if (route.schema.multipart && route.method === 'PUT') {
    sentences.push('Replacing a profile keeps the email and phone it isn\'t given, and null or "" removes them.')
  }
  return sentences.join(' ')
}

// Whether the route's responses have the emails and phone numbers of artists or collectives, which tools never give,
// since what a tool gives is sent to the model's provider (see docs/design/server/mcp.md).
export function hasContactDetails(route: Pick<ToolRoute, 'url'>): boolean {
  return /^\/api\/admin\/(artists|collectives)(\/|$)/.test(route.url)
}

// `value`, without its `email` and `phone` fields, wherever they are.
export function withoutContactDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutContactDetails)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'email' && key !== 'phone')
      .map(([key, field]) => [key, withoutContactDetails(field)]),
  )
}

type Answer = { status: number; body: unknown }
type Payload = { body: string | Buffer; contentType: string }
// Sends a request as the user a tool acts as.
type Send = (method: string, url: string, payload?: Payload) => Promise<Answer>

// What the tools that list artists, collectives, applications and sessions give of each one, so that their lists fit in
// what apps take as they grow: these fields of the full item, as they are.
const SUMMARIES: Record<string, (body: JsonObject, send: Send) => Promise<JsonObject>> = {
  list_artists: async ({ artists, ...rest }) => ({ ...rest, artists: pick(artists, ['id', 'name', 'country', 'city', 'genres', 'collectives']) }),
  list_collectives: async ({ collectives, ...rest }) => ({ ...rest, collectives: pick(collectives, ['id', 'name', 'country', 'city', 'members']) }),
  list_applications: async ({ applications, ...rest }, send) => {
    // With the name of their artist or collective, which the route doesn't give.
    const names = new Map<string, string>()
    const owners = await Promise.all([send('GET', '/api/admin/artists'), send('GET', '/api/admin/collectives')])
    for (const [field, { body }] of [['artists', owners[0]], ['collectives', owners[1]]] as const) {
      for (const { id, name } of ((body as JsonObject)[field] ?? []) as { id: string; name: string }[]) names.set(id, name)
    }
    const summaries = pick(applications, ['id', 'artistId', 'collectiveId', 'receivedAt', 'status', 'dates']).map((summary) => ({
      ...summary,
      name: names.get((summary.artistId ?? summary.collectiveId) as string) ?? null,
    }))
    return { ...rest, applications: summaries }
  },
  list_sessions: async ({ sessions, ...rest }) => ({
    ...rest,
    sessions: (sessions as JsonObject[]).map((session) => ({
      ...pickOne(session, ['id', 'start', 'end', 'name', 'takeover', 'status']),
      sets: pick(session.sets, ['id', 'start', 'end', 'status', 'performers']),
    })),
  }),
}

function pickOne(item: JsonObject, fields: string[]): JsonObject {
  return Object.fromEntries(fields.filter((field) => field in item).map((field) => [field, item[field]]))
}

function pick(items: unknown, fields: string[]): JsonObject[] {
  return ((items ?? []) as JsonObject[]).map((item) => pickOne(item, fields))
}

// A path parameter, as it goes in the path: only one segment, so that it can't lead to another route, e.g. with "..".
// Null when it can't be one.
function segment(value: unknown): string | null {
  if (typeof value !== 'string' || value === '' || value === '.' || value === '..') return null
  try {
    return encodeURIComponent(value)
  } catch {
    return null // e.g. a lone surrogate
  }
}

// The text of a result: JSON without spaces, with the line and paragraph separators escaped, which some apps can't take
// raw.
function text(value: unknown): string {
  return JSON.stringify(value).replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029')
}

function failure(status: number, body: unknown): ToolResult {
  return { content: [{ type: 'text', text: text({ status, ...(typeof body === 'object' ? body : { error: body }) }) }], isError: true }
}

// The tools of `routes`, which send their requests to `app`.
export function buildTools(routes: ToolRoute[], app: FastifyInstance): Tool[] {
  // What sends requests as `as`, with a session of their own, which no header of the MCP request goes in.
  const sender = async (as: ToolUser): Promise<Send> => {
    const session = await signSessionToken(as, TOOL_SESSION_SECONDS)
    return async (method, url, payload) => {
      const response = await app.inject({
        method: method as 'GET',
        url,
        cookies: { [config.sessionCookie]: session },
        ...(payload && { payload: payload.body, headers: { 'content-type': payload.contentType } }),
      })
      let body: unknown = response.body
      try {
        body = response.json()
      } catch {
        // Not JSON, which no tool's route answers with, but which is still said.
      }
      return { status: response.statusCode, body }
    }
  }

  const names = new Set<string>()
  return routes.map((route) => {
    const name = route.schema.operationId!
    if (names.has(name)) throw new Error(`Two tools are named \`${name}\``)
    names.add(name)
    const { schema, parts, profile, nullable } = argumentsOf(route)
    // What it responds, by status, for its dates and times.
    const responses = Object.fromEntries(
      Object.entries((route.schema.response ?? {}) as Record<string, z.ZodType>).map(([status, response]) => [status, jsonSchema(response, 'output')]),
    )
    const answer = (status: number, body: unknown) => withQuebecTimes(body, responses[status])

    const call = async (args: JsonObject, as: ToolUser): Promise<ToolResult> => {
      const invalid = [...route.url.matchAll(/:(\w+)/g)].find(([, param]) => segment(args[param]) === null)
      if (invalid) return failure(400, { error: `\`${invalid[1]}\` isn't valid` })
      const path = route.url.replace(/:(\w+)/g, (_, param: string) => segment(args[param])!)
      // The path has to lead to the tool's route, with the parameters it was given. Encoded, a parameter is one segment
      // of it, but a segment can still be that of another route, which the router prefers to a parameter, e.g.
      // `update_application({ id: "recipients" })` would lead to PUT /api/admin/applications/recipients. The router
      // then finds other parameters, or none, so asking it is what keeps every tool to its route, whatever the routes.
      const found = new URL(path, 'http://localhost').pathname === path ? app.findRoute({ method: route.method, url: path }) : null
      const params = [...route.url.matchAll(/:(\w+)/g)].map(([, param]) => param)
      if (!found || params.some((param) => (found.params as Record<string, string>)[param] !== args[param])) {
        const given = params.map((param) => `\`${param}\``).join(' and ')
        return failure(400, { error: `The ${given} given ${params.length === 1 ? 'leads' : 'lead'} to another endpoint` })
      }
      const unknown = Object.keys(args).find((arg) => !parts.has(arg))
      if (unknown) return failure(400, { error: `\`${unknown}\` isn't an argument of this tool` })
      const send = await sender(as)
      const query = new URLSearchParams()
      const body: JsonObject = {}
      let removePhoto = false
      for (const [arg, value] of Object.entries(args)) {
        const part = parts.get(arg)
        if (part === 'query' && value !== undefined) query.set(arg, String(value))
        if (part === 'body' || part === 'profile') body[arg] = value
        if (part === 'removePhoto') removePhoto = value === true
      }
      for (const field of nullable) if (!(field in body)) body[field] = null
      const url = query.size > 0 ? `${path}?${query}` : path

      let payload: Payload | undefined
      if (profile) {
        // A profile that's replaced keeps the email and phone it isn't given, since tools never show them, which loses a
        // change another admin makes to them in the meantime.
        if (route.method === 'PUT' && (!('email' in body) || !('phone' in body))) {
          const current = await send('GET', path)
          if (current.status !== 200) return failure(current.status, current.body)
          const saved = (current.body as JsonObject)[profile] as JsonObject | null | undefined
          if (!saved || typeof saved !== 'object') return failure(500, { error: `The ${profile} couldn't be read` })
          for (const field of ['email', 'phone']) if (!(field in body)) body[field] = saved[field]
        }
        const form = new FormData()
        form.append(profile, JSON.stringify(body))
        if (removePhoto) form.append('removePhoto', 'true')
        const encoded = new Response(form)
        payload = { body: Buffer.from(await encoded.arrayBuffer()), contentType: encoded.headers.get('content-type')! }
      } else if (route.schema.body) {
        payload = { body: JSON.stringify(body), contentType: 'application/json' }
      }

      const response = await send(route.method, url, payload)
      if (response.status >= 400) return failure(response.status, answer(response.status, response.body))
      let result = answer(response.status, response.body)
      if (SUMMARIES[name]) result = await SUMMARIES[name](result as JsonObject, send)
      if (hasContactDetails(route)) result = withoutContactDetails(result)
      return { content: [{ type: 'text', text: text(result) }] }
    }

    return {
      name,
      title: route.tool.title,
      description: descriptionOf(route, name),
      inputSchema: schema,
      readOnly: route.method === 'GET' || route.tool.readOnly === true,
      call,
    }
  })
}
