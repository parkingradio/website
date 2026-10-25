import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import Fastify from 'fastify'
import fastifySwagger from '@fastify/swagger'
import { jsonSchemaTransform, jsonSchemaTransformObject } from 'fastify-type-provider-zod'
import { registerRoutes } from './app.js'
import type { Dependencies } from './app.js'

// Writes openapi.json: the OpenAPI document of the API, generated from the routes' zod schemas. It only has the routes
// that have schemas. With `--check`, it only checks that openapi.json is up to date instead.
//
//   npm run generate:api    # at the root, which also generates the client's types from it

const OUTPUT = path.join(import.meta.dirname, '../openapi.json')

// The routes only use their dependencies to handle requests, which they don't get here.
const deps = {} as Dependencies

// The names of the components that `value` refers to, e.g. `Feature` for `{ "$ref": "#/components/schemas/Feature" }`.
function references(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) references(item, found)
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref' && typeof child === 'string') found.add(child.replace('#/components/schemas/', ''))
      else references(child, found)
    }
  }
  return found
}

type Document = { paths?: object; components?: { schemas?: Record<string, unknown> } }

// The type provider adds every schema with an id to the components, as it's sent and, as `<id>Input`, as it's received,
// whether routes use it or not. This keeps the ones that routes use, directly or through other components.
function withoutUnusedComponents(document: Document): Document {
  const schemas = document.components?.schemas ?? {}
  const used = references(document.paths)
  for (const name of used) references(schemas[name], used)
  // By name, rather than in the order the modules that declare them are imported.
  const kept = Object.fromEntries(Object.entries(schemas).filter(([name]) => used.has(name)).sort(([a], [b]) => a.localeCompare(b)))
  return { ...document, components: { ...document.components, schemas: kept } }
}

const app = Fastify()
await app.register(fastifySwagger, {
  openapi: {
    openapi: '3.1.0',
    info: {
      title: 'Parking Radio',
      version: '0.0.0',
      description: 'Generated from the server. The design documents, in docs/design/server, specify the API.',
    },
  },
  // Routes without a schema are left out.
  transform: (route) => (route.schema ? jsonSchemaTransform(route) : { schema: { hide: true }, url: route.url }),
  transformObject: jsonSchemaTransformObject,
})
await registerRoutes(app, deps)
await app.ready()

const generated = `${JSON.stringify(withoutUnusedComponents(app.swagger() as Document), null, 2)}\n`
if (process.argv.includes('--check')) {
  let current = ''
  try {
    current = readFileSync(OUTPUT, 'utf8')
  } catch {
    // Missing, so not up to date.
  }
  if (current !== generated) {
    console.error("server/openapi.json doesn't match the routes' schemas. Run 'npm run generate:api' and commit the result.")
    process.exit(1)
  }
} else {
  writeFileSync(OUTPUT, generated)
}
await app.close()
