import type { FastifyRequest } from 'fastify'

// The token in a request's `Authorization: Bearer <token>` header, if it has one, e.g. an app's (see mcp/routes.ts).
export const bearerToken = (request: FastifyRequest): string | undefined => /^Bearer (\S+)$/i.exec(request.headers.authorization ?? '')?.[1]
