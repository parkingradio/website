import { afterEach, describe, expect, it } from 'vitest'
import { config } from './config.js'

describe('config', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe('port', () => {
    it('defaults to 3000 when PORT is unset', () => {
      delete process.env.PORT
      expect(config.port).toBe(3000)
    })

    it('reads PORT when set', () => {
      process.env.PORT = '4000'
      expect(config.port).toBe(4000)
    })
  })

  describe('databaseUrl', () => {
    it('throws a clear error when DATABASE_URL is unset', () => {
      delete process.env.DATABASE_URL
      expect(() => config.databaseUrl).toThrow('Missing required environment variable: DATABASE_URL')
    })

    it('returns DATABASE_URL when set', () => {
      process.env.DATABASE_URL = 'postgres://localhost/test'
      expect(config.databaseUrl).toBe('postgres://localhost/test')
    })
  })

  describe('jwtSecret', () => {
    it('throws a clear error when JWT_SECRET is unset', () => {
      delete process.env.JWT_SECRET
      expect(() => config.jwtSecret).toThrow('Missing required environment variable: JWT_SECRET')
    })

    it('returns JWT_SECRET when set', () => {
      process.env.JWT_SECRET = 'test-secret'
      expect(config.jwtSecret).toBe('test-secret')
    })
  })
})
