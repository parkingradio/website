import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const { usersTable } = vi.hoisted(() => ({
  usersTable: [] as { id: string; email: string; passwordHash: string | null }[],
}))

vi.mock('./db.js', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(usersTable.map(({ id }) => ({ id }))),
      }),
    }),
    insert: () => ({
      values: (row: { email: string; passwordHash: string }) => {
        usersTable.push({ id: 'new-user-id', ...row })
        return Promise.resolve()
      },
    }),
  },
}))

import { db } from './db.js'
import { ensureBootstrapAdmin } from './bootstrap-admin.js'

describe('ensureBootstrapAdmin', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    usersTable.length = 0
    process.env.BOOTSTRAP_ADMIN_EMAIL = 'admin@example.com'
    process.env.BOOTSTRAP_ADMIN_PASSWORD = 'bootstrap-password-123'
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('creates the bootstrap admin when no user with that email exists', async () => {
    await ensureBootstrapAdmin(db)

    expect(usersTable).toHaveLength(1)
    expect(usersTable[0].email).toBe('admin@example.com')
    expect(usersTable[0].passwordHash).toBe('bootstrap-password-123')
  })

  it('does nothing when a user with that email already exists', async () => {
    usersTable.push({ id: 'existing-user-id', email: 'admin@example.com', passwordHash: 'existing-hash' })

    await ensureBootstrapAdmin(db)

    expect(usersTable).toHaveLength(1)
    expect(usersTable[0].passwordHash).toBe('existing-hash')
  })
})
