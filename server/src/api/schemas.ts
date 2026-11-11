import type { FastifyInstance, FastifySchemaValidationError, RouteOptions } from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { checksOrigin, requireAuth } from '../admins/auth.js'
import { logApiErrors, useApiErrors } from './errors.js'

// What the routes' zod schemas share. The schemas validate requests and responses, and openapi.json is generated from
// them (see generate-openapi.ts).

declare module 'fastify' {
  interface FastifyContextConfig {
    // The route requires an admin's session: see `useZodSchemas`.
    admin?: boolean
    // The route's tool of the MCP server (see docs/design/server/mcp.md), or null when it isn't one, which every admin
    // route has to say. Its name is the route's `operationId`.
    tool?: ToolConfig | null
  }

  interface FastifySchema {
    // The parts of a multipart/form-data request, which the route reads itself, e.g. with `readPhotoForm`, rather than
    // Fastify, so they aren't validated against it: it describes the request in openapi.json (see generate-openapi.ts).
    // Parts that are JSON, e.g. a profile, are described by their schema, which the route checks them against.
    multipart?: z.ZodObject
    // The route's name in openapi.json, which is also its tool's (see `tool`).
    operationId?: string
  }
}

export type ToolConfig = {
  // In French, since admins see it when an app asks them to confirm calling the tool, e.g. "Supprimer un artiste".
  title: string
  // For a route that only reads, other than a GET, which always does.
  readOnly?: true
}

// What tools are named: a verb, then what it acts on, then the field it changes, if it only changes one, in snake case,
// e.g. `update_set_status` (see docs/design/server/mcp.md).
const TOOL_NAME = /^[a-z]+(_[a-z]+)+$/

// Sent with a 4xx or 5xx status when a request fails.
export const ApiError = z.object({ ok: z.literal(false), error: z.string() }).meta({ id: 'ApiError' })
export type ApiError = z.infer<typeof ApiError>

// What requests that succeed respond when there's nothing else to say.
export const Ok = z.object({ ok: z.literal(true) }).meta({ id: 'Ok' })

// What the admin endpoints that list a collection give with their list (see "Totals" in docs/design/server/README.md).
export const Total = z.number().int().nonnegative().meta({ description: 'How many items the list has' })

// The parameters of a path with an id, e.g. `/api/admin/artists/:id`.
export const ById = z.object({ id: z.string() })

// Another artist or collective, as responses name them: e.g. an artist's collectives, and a collective's members.
export const Reference = z.object({ id: z.string(), name: z.string() }).meta({ id: 'Reference' })
export type Reference = z.infer<typeof Reference>

// The error of an object, e.g. an artist's profile, that has fields it doesn't take, which it names, so that a misspelled
// field doesn't go unnoticed (see "Unknown fields" in docs/design/server/README.md). Only admins send these objects, so
// it's in English.
export function unknownFields(keys: string[]): string {
  return `Unknown field${keys.length > 1 ? 's' : ''}: ${keys.map((key) => `\`${key}\``).join(', ')}`
}

// The errors of an object that refuses fields it doesn't take (`z.strictObject`): `unknownFields` for those, and `error`
// for the others, e.g. when it isn't an object. Only for the object itself: its fields have their own errors.
export function objectError(error: string) {
  return (issue: { code?: string; keys?: string[] }) => (issue.code === 'unrecognized_keys' ? unknownFields(issue.keys ?? []) : error)
}

const NOT_CHANGES = 'The changes must be an object with the fields to change'
const NO_CHANGES = 'There must be at least one field to change'

// What a PATCH endpoint takes (see "Changes" in docs/design/server/README.md): any of the fields of `shape`, which are
// those its PUT takes, each with its rules, but at least one, and no other.
export function changesTo<Shape extends z.ZodRawShape>(shape: Shape) {
  return z
    .strictObject(z.object(shape).partial().shape, { error: objectError(NOT_CHANGES) })
    .refine((changes) => Object.keys(changes).length > 0, NO_CHANGES)
    .meta({ minProperties: 1 })
}

// A credential of a service the server reads, e.g. the SoundCloud app's client ID, or a YouTube API key. The client has its
// own copy of the length, for its forms (see client/src/pages/admin/configuration/credentials-form.tsx).
const CREDENTIAL_MAX_LENGTH = 200
// openapi.json can't say that it's trimmed before its length is checked, so the description does.
export const Credential = z
  .string()
  .trim()
  .min(1)
  .max(CREDENTIAL_MAX_LENGTH)
  .meta({ description: `Trimmed, then between 1 and ${CREDENTIAL_MAX_LENGTH} characters` })

// Formats, e.g. `Timestamp`, which modules other than the routes' use too, e.g. the database's schema.
export { Day, Timestamp } from './formats.js'

// The errors that routes can fail with because of what they are, which they don't declare:
// - 400 when the route has a schema for its request, which refuses the requests that don't match it (or describes a
//   multipart request, which the route checks itself),
// - 401 when it requires an admin's session, and 403 too when its method isn't GET (see requireAuth),
// - 500 for every route.
// Routes declare the other errors they send, e.g. `404: ApiError`, including generic ones they send themselves, e.g. a
// 400 for a request that matches its schema but is still refused, so that the handler's types allow it. Errors that
// Fastify sends before routes are reached, e.g. 413 for a body that's too large, aren't declared.
function addGenericErrors(route: RouteOptions) {
  const where = `${route.method} ${route.url}`
  // Admin routes say so with `config.admin`, rather than with requireAuth itself, so that the same option both checks the
  // session and declares the errors that come with it.
  const hooks = [route.onRequest, route.preValidation, route.preHandler].flat()
  if (hooks.includes(requireAuth)) throw new Error(`${where}: set \`config: { admin: true }\` rather than using requireAuth`)
  if (!route.schema) throw new Error(`${where}: routes declared with zodRoutes need a schema`)
  const admin = route.config?.admin === true
  const methods = [route.method].flat()
  // Its GET would be declared as failing with 403 too, since the document has the same responses for every method.
  if (admin && methods.some(checksOrigin) && !methods.every(checksOrigin)) throw new Error(`${where}: one route per method`)
  // Before the request is parsed and validated, so that requests without a session fail with 401 (or 403) whatever they
  // send, rather than with 400.
  if (admin) route.onRequest = [requireAuth, route.onRequest ?? []].flat()

  const statuses = [500]
  const { params, querystring, body, headers, multipart } = route.schema
  if (params || querystring || body || headers || multipart) statuses.push(400)
  if (admin) statuses.push(401)
  if (admin && methods.some(checksOrigin)) statuses.push(403)
  const errors = Object.fromEntries(statuses.map((status) => [status, ApiError]))
  route.schema = { ...route.schema, response: { ...errors, ...(route.schema.response as object | undefined) } }
}

// The path to the first string in `value` that has the NUL character, or to the first object with a key that has it,
// or undefined when there's none. Objects without entries, e.g. a Date, have none.
function pathToNul(value: unknown): (string | number)[] | undefined {
  if (typeof value === 'string') return value.includes('\0') ? [] : undefined
  if (typeof value !== 'object' || value === null) return undefined
  for (const [key, item] of Array.isArray(value) ? value.entries() : Object.entries(value)) {
    if (String(key).includes('\0')) return []
    const found = pathToNul(item)
    if (found) return [key, ...found]
  }
  return undefined
}

const NUL_ERROR = "Text can't contain the NUL character"

// The error to refuse `value` with, what a schema kept of a request, if it has the NUL character anywhere, or null. For
// what routes check themselves, e.g. the JSON part of a multipart request, as `refusingNul` does for the others.
export function nulError(value: unknown): string | null {
  return pathToNul(value) ? NUL_ERROR : null
}

// Validates requests against their zod schema, then refuses those that send the NUL character, which the database can't
// store, anywhere in what the schema keeps (it drops the fields it doesn't know). Only once the schema accepted them, so
// that its own errors come first, e.g. the French ones of `text` in artists/profile.ts.
const refusingNul: typeof validatorCompiler = (route) => {
  const validate = validatorCompiler(route)
  return (data) => {
    const result = validate(data) as { error?: FastifySchemaValidationError[]; value?: unknown }
    if (result.error) return result
    const path = pathToNul(result.value)
    if (!path) return result
    return { error: [{ keyword: 'custom', instancePath: `/${path.join('/')}`, schemaPath: '#', params: {}, message: NUL_ERROR }] }
  }
}

// Lets routes declare zod schemas: requests that don't match theirs are rejected with 400, and responses that don't
// match the schema of their status fail with 500 rather than being sent, so that openapi.json tells the truth. Requests
// that send the NUL character are rejected with 400 too (see `refusingNul`).
//
// It also sets the app's error handler (see `useApiErrors`), so every app, tests' included, sends its errors as an
// `ApiError`, and logs why they failed (see `logApiErrors`).
export function useZodSchemas(app: FastifyInstance) {
  useApiErrors(app)
  logApiErrors(app)
  app.setValidatorCompiler(refusingNul)
  app.setSerializerCompiler(serializerCompiler)
  // E.g. "`enabled`: Invalid input: expected boolean, received string", or "body: Invalid input: ..." for the whole body.
  app.setSchemaErrorFormatter((errors, dataVar) => {
    const issues = errors.map(({ instancePath, message }) => {
      const path = instancePath.slice(1).replaceAll('/', '.')
      return `${path ? `\`${path}\`` : dataVar}: ${message}`
    })
    return new Error(issues.join(', '))
  })
  app.addHook('onRoute', function (route) {
    // `config.admin` is only enforced for the routes of zodRoutes, so it mustn't go unnoticed anywhere else.
    if (route.config?.admin && !this.hasDecorator('zodRoutes')) {
      throw new Error(`${route.method} ${route.url}: \`config.admin\` only works for the routes of zodRoutes`)
    }
    // Clients tell admin routes by their path, e.g. to take a 401 to mean that the session ended.
    if (Boolean(route.config?.admin) !== route.url.startsWith('/api/admin/')) {
      throw new Error(`${route.method} ${route.url}: admin routes are those under /api/admin/, and only those`)
    }
    // So that no admin route becomes a tool, or misses being one, without saying so.
    if (route.config?.admin && route.config.tool === undefined) {
      throw new Error(`${route.method} ${route.url}: admin routes say whether they're tools, with \`config.tool\``)
    }
    if (route.config?.tool && !TOOL_NAME.test(route.schema?.operationId ?? '')) {
      throw new Error(`${route.method} ${route.url}: a tool's \`operationId\` is its name, e.g. \`update_set_status\``)
    }
  })
}

// For routes whose schemas' messages are whole sentences, e.g. in French where artists see them, as their
// `schemaErrorFormatter` (e.g. a plugin's, with `setSchemaErrorFormatter`): a request that doesn't match gets the message
// of its first issue, as it is, rather than every issue with where it is (see `useZodSchemas`). The issues are in the
// order of the schema's fields.
export const firstIssue = (errors: FastifySchemaValidationError[]) => new Error(errors[0].message)

// The routes of a plugin, declared with zod schemas. Their responses get the generic errors, and admin routes check the
// session (see `addGenericErrors`).
export function zodRoutes(app: FastifyInstance) {
  // Unless a parent plugin already did, since its routes are this plugin's too.
  if (!app.hasDecorator('zodRoutes')) {
    app.decorate('zodRoutes', true)
    app.addHook('onRoute', addGenericErrors)
  }
  return app.withTypeProvider<ZodTypeProvider>()
}
