import Fastify from 'fastify'
import { healthRoutes } from './routes/health.js'

const app = Fastify({ logger: true })

await app.register(healthRoutes)

const port = Number(process.env.PORT ?? 3000)

try {
  await app.listen({ port })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
