import { pino } from 'pino'

// The server's logger. Fastify uses it for its own logs and code that runs outside of
// a request uses it directly so all logs share the same format.
export const logger = pino()
