import type { FastifyInstance } from 'fastify'
import { config } from '../core/config.js'
import { signSessionToken } from './auth.js'

// For the tests of routes that require an admin session (see requireAuth in admins/auth.ts).

// The admin the tests send requests as.
export const TEST_ADMIN = { id: 'admin-id', email: 'admin@example.com', sessionVersion: 0 }

// The cookies of a session of `admin`, TEST_ADMIN unless told otherwise.
export async function sessionCookies(admin = TEST_ADMIN) {
  return { [config.sessionCookie]: await signSessionToken(admin) }
}

// Lets requireAuth check sessions without a database, as if every admin existed and had never chosen a new password.
export function acceptSessions(app: FastifyInstance) {
  app.decorate('adminSessions', { sessionVersion: async () => 0 })
}
