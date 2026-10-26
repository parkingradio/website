import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import Fastify from 'fastify'
import fastifySwagger from '@fastify/swagger'
import { jsonSchemaTransform, jsonSchemaTransformObject } from 'fastify-type-provider-zod'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
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

type Schema = { $ref?: string; type?: unknown; properties?: Record<string, Schema> }
type Operation = { requestBody?: { content: Record<string, { schema: Schema; encoding?: object }> } }
type Document = { paths?: Record<string, Record<string, Operation>>; components?: { schemas?: Record<string, Schema> } }

// `document`, where the references to the components named in `renamed` refer to their new names.
function withReferencesRenamed(document: Document, renamed: Map<string, string>): Document {
  return JSON.parse(JSON.stringify(document), (key, value: unknown) =>
    key === '$ref' && typeof value === 'string' ? value.replace(/[^/]+$/, (name) => renamed.get(name) ?? name) : value,
  )
}

// The type provider adds every schema with an id to the components twice, as it's sent, named by its id, and as it's
// received, as `<id>Input`, so that a schema whose transforms make them differ has both. This keeps a single one when
// they're the same, e.g. for an enum, and names the one as it's received by the id when nothing refers to the other,
// e.g. for a profile that's only received.
function withInputsNamedByTheirIds(document: Document): Document {
  const renamed = new Map<string, string>()
  let current = document
  for (;;) {
    const schemas = current.components?.schemas ?? {}
    const used = references(current.paths)
    for (const name of used) references(schemas[name], used)
    // By the ids of the schemas (zod's registry only has them in `_idmap`), since a schema's id could end with "Input".
    const found = [...z.globalRegistry._idmap.keys()].filter(
      (id) => used.has(`${id}Input`) && (!used.has(id) || isDeepStrictEqual(schemas[id], schemas[`${id}Input`])),
    )
    if (found.length === 0) return current
    for (const id of found) renamed.set(`${id}Input`, id)
    current = withReferencesRenamed(current, renamed)
    const renamedSchemas = Object.fromEntries(found.map((id) => [id, schemas[`${id}Input`]]))
    current = { ...current, components: { ...current.components, schemas: { ...current.components?.schemas, ...renamedSchemas } } }
  }
}

// The type provider adds every schema with an id to the components, whether routes use it or not. This keeps the ones
// that routes use, directly or through other components.
function withoutUnusedComponents(document: Document): Document {
  const schemas = document.components?.schemas ?? {}
  const used = references(document.paths)
  for (const name of used) references(schemas[name], used)
  // By name, rather than in the order the modules that declare them are imported.
  const kept = Object.fromEntries(Object.entries(schemas).filter(([name]) => used.has(name)).sort(([a], [b]) => a.localeCompare(b)))
  return { ...document, components: { ...document.components, schemas: kept } }
}

// Says that the parts of multipart/form-data requests (see `FastifySchema.multipart`) that aren't text or files, e.g. a
// profile, are JSON. That's what OpenAPI assumes of an object anyway, but not every tool knows that a reference is one.
function withJsonParts(document: Document): Document {
  const schemas = document.components?.schemas ?? {}
  for (const operations of Object.values(document.paths ?? {})) {
    for (const operation of Object.values(operations)) {
      const form = operation.requestBody?.content['multipart/form-data']
      if (!form) continue
      const json = Object.entries(form.schema.properties ?? {}).filter(([, part]) => {
        const schema = part.$ref ? schemas[part.$ref.replace('#/components/schemas/', '')] : part
        return schema?.type !== 'string'
      })
      if (json.length > 0) form.encoding = Object.fromEntries(json.map(([name]) => [name, { contentType: 'application/json' }]))
    }
  }
  return document
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
  // Routes without a schema are left out. A multipart/form-data request, which the route reads itself, is described as
  // its body.
  transform: (route) => {
    if (!route.schema) return { schema: { hide: true }, url: route.url }
    const { multipart, ...schema } = route.schema
    return jsonSchemaTransform({ ...route, schema: multipart ? { ...schema, body: multipart, consumes: ['multipart/form-data'] } : schema })
  },
  transformObject: jsonSchemaTransformObject,
})
await registerRoutes(app, deps)
await app.ready()

const document = withJsonParts(withoutUnusedComponents(withInputsNamedByTheirIds(app.swagger() as Document)))
const generated = `${JSON.stringify(document, null, 2)}\n`
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
