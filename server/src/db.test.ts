import { afterEach, describe, expect, it, vi } from 'vitest'

const { send } = vi.hoisted(() => {
  // db.ts builds the pool when imported, which requires a database URL. Creating the pool doesn't
  // connect to anything.
  process.env.DATABASE_URL = 'postgres://parking_radio:local-password@localhost:5432/parking_radio'
  return { send: vi.fn() }
})
vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class {
    send = send
  },
  GetSecretValueCommand: class {},
}))

import { poolConfig } from './db.js'

describe('poolConfig', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('uses DATABASE_URL as is when there is no password secret', () => {
    delete process.env.DATABASE_PASSWORD_SECRET_ID

    const pool = poolConfig()

    expect(pool.connectionString).toBe(process.env.DATABASE_URL)
    expect(pool.password).toBeUndefined()
  })

  it('reads the password from the secret when there is one', async () => {
    process.env.DATABASE_URL = 'postgres://parking_radio@db.example.com:5432/parking_radio'
    process.env.DATABASE_PASSWORD_SECRET_ID = 'my-secret'
    send.mockResolvedValue({ SecretString: JSON.stringify({ password: 'p@ss' }) })

    const pool = poolConfig()

    // pg would silently ignore the password function if it were also given a connection string.
    expect(pool.connectionString).toBeUndefined()
    expect(pool).toMatchObject({ host: 'db.example.com', port: 5432, user: 'parking_radio', database: 'parking_radio' })
    expect(typeof pool.password).toBe('function')
    expect(await (pool.password as () => Promise<string>)()).toBe('p@ss')
  })
})
