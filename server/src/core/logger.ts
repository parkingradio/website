import type { FastifyBaseLogger, FastifyRequest } from 'fastify'
import { pino } from 'pino'
import type { DestinationStream, Logger } from 'pino'

// The URL of a request, without the values of its query string, which can be secrets, e.g. the token of an invite's link
// (see docs/design/server/admins.md).
export function withoutQueryValues(url: string): string {
  const start = url.indexOf('?')
  return start === -1 ? url : url.slice(0, start + 1) + url.slice(start + 1).replace(/=[^&]*/g, '=[redacted]')
}

// What Fastify logs of a request when it comes in, as it does by default, but without the values of its query string.
function req(request: FastifyRequest) {
  return {
    method: request.method,
    url: withoutQueryValues(request.url),
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket?.remotePort,
  }
}

// A logger that writes to `destination`, or else to the standard output, like the server's.
export function createLogger(destination?: DestinationStream): Logger {
  return pino({ serializers: { req } }, destination)
}

// The server's logger. Fastify uses it for its own logs and code that runs outside of
// a request uses it directly so all logs share the same format.
export const logger = createLogger()

// Adds `fields` to the lines that `request` logs from then on, including the one Fastify logs once it's answered, with
// its status and how long it took ("request completed"), e.g. why it failed (see Logs in docs/design/server/README.md).
// Fields that are undefined are left out. A key that the request's lines already have keeps its value, since a logger
// can't replace one: it would be there twice. Apps without a logger, e.g. most tests', have no lines to add them to.
export function logWithRequest(request: FastifyRequest, fields: Record<string, unknown>) {
  const log = request.log as FastifyBaseLogger & Partial<Pick<Logger, 'bindings' | 'setBindings'>>
  if (!log.setBindings || !log.bindings) return
  const bound = log.bindings()
  log.setBindings(Object.fromEntries(Object.entries(fields).filter(([key, value]) => value !== undefined && !(key in bound))))
}
