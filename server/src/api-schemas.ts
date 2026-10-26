import type { FastifyInstance, RouteOptions } from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { checksOrigin, requireAuth } from './auth.js'
import { keepQueryValuesPrivate } from './query-errors.js'

// What the routes' zod schemas share. The schemas validate requests and responses, and openapi.json is generated from
// them (see generate-openapi.ts).

declare module 'fastify' {
  interface FastifyContextConfig {
    // The route requires an admin's session: see `useZodSchemas`.
    admin?: boolean
  }
}

// Sent with a 4xx or 5xx status when a request fails.
export const ApiError = z.object({ ok: z.literal(false), error: z.string() }).meta({ id: 'ApiError' })

// What requests that succeed respond when there's nothing else to say.
export const Ok = z.object({ ok: z.literal(true) }).meta({ id: 'Ok' })

// A date and time, as an ISO 8601 string. It's checked like `z.iso.datetime`, which openapi.json would show as a long
// regular expression: only its format, `date-time`, is shown instead.
const isoDateTime = z.iso.datetime({ offset: true })
export const Timestamp = z
  .string()
  .refine((value) => isoDateTime.safeParse(value).success, 'Invalid date and time')
  .meta({ format: 'date-time' })

// A day, "YYYY-MM-DD", that exists. It's checked like `z.iso.date`, and shown as only its format, `date`, like `Timestamp`.
const isoDate = z.iso.date()
export const Day = z
  .string()
  .refine((value) => isoDate.safeParse(value).success, 'Invalid date')
  .meta({ format: 'date' })

// The errors that routes can fail with because of what they are, which they don't declare:
// - 400 when the route has a schema for its request, which refuses the requests that don't match it,
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
  if (route.schema.params || route.schema.querystring || route.schema.body || route.schema.headers) statuses.push(400)
  if (admin) statuses.push(401)
  if (admin && methods.some(checksOrigin)) statuses.push(403)
  const errors = Object.fromEntries(statuses.map((status) => [status, ApiError]))
  route.schema = { ...route.schema, response: { ...errors, ...(route.schema.response as object | undefined) } }
}

// Lets routes declare zod schemas: requests that don't match theirs are rejected with 400, and responses that don't
// match the schema of their status fail with 500 rather than being sent, so that openapi.json tells the truth.
export function useZodSchemas(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  // E.g. "`enabled`: Invalid input: expected boolean, received string", or "body: Invalid input: ..." for the whole body.
  app.setSchemaErrorFormatter((errors, dataVar) => {
    const issues = errors.map(({ instancePath, message }) => {
      const path = instancePath.slice(1).replaceAll('/', '.')
      return `${path ? `\`${path}\`` : dataVar}: ${message}`
    })
    return new Error(issues.join(', '))
  })
  // `config.admin` is only enforced for the routes of zodRoutes, so it mustn't go unnoticed anywhere else.
  app.addHook('onRoute', function (route) {
    if (route.config?.admin && !this.hasDecorator('zodRoutes')) {
      throw new Error(`${route.method} ${route.url}: \`config.admin\` only works for the routes of zodRoutes`)
    }
  })
}

// The routes of a plugin, declared with zod schemas. Their responses get the generic errors, and admin routes check the
// session (see `addGenericErrors`). Their errors are sent as an `ApiError` (see query-errors.ts), which also logs
// `message` for unexpected ones.
export function zodRoutes(app: FastifyInstance, message: string) {
  keepQueryValuesPrivate(app, message)
  // Unless a parent plugin already did, since its routes are this plugin's too.
  if (!app.hasDecorator('zodRoutes')) {
    app.decorate('zodRoutes', true)
    app.addHook('onRoute', addGenericErrors)
  }
  return app.withTypeProvider<ZodTypeProvider>()
}
