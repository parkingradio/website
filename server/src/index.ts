import { existsSync } from 'node:fs'
import path from 'node:path'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { healthRoutes } from './routes/health.js'
import { adminRoutes } from './routes/admin.js'
import { config } from './config.js'

const app = Fastify({ logger: true })

await app.register(healthRoutes)
await app.register(adminRoutes)

const clientDist = path.join(import.meta.dirname, '../../client/dist')

if (existsSync(clientDist)) {
  await app.register(fastifyStatic, { root: clientDist })

  app.setNotFoundHandler((request, reply) => {
    if (request.method === 'GET') {
      return reply.sendFile('index.html')
    }
    return reply.code(404).send()
  })
}

const port = config.port

try {
  await app.listen({ port, host: '0.0.0.0' })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
