import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { config } from './config.js'

describe('config', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe('isProduction', () => {
    it('is false when NODE_ENV is not production', () => {
      delete process.env.NODE_ENV
      expect(config.isProduction).toBe(false)
    })

    it('is true when NODE_ENV is production', () => {
      process.env.NODE_ENV = 'production'
      expect(config.isProduction).toBe(true)
    })
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

  describe('assetsDomain', () => {
    it('throws a clear error when ASSETS_DOMAIN is unset', () => {
      delete process.env.ASSETS_DOMAIN
      expect(() => config.assetsDomain).toThrow(
        'Missing required environment variable: ASSETS_DOMAIN',
      )
    })

    it('returns ASSETS_DOMAIN when set', () => {
      process.env.ASSETS_DOMAIN = 'assets.example.test'
      expect(config.assetsDomain).toBe('assets.example.test')
    })
  })

  describe('soundcloudClientId', () => {
    it('throws a clear error when SOUNDCLOUD_CLIENT_ID is unset', () => {
      delete process.env.SOUNDCLOUD_CLIENT_ID
      expect(() => config.soundcloudClientId).toThrow('Missing required environment variable: SOUNDCLOUD_CLIENT_ID')
    })

    it('returns SOUNDCLOUD_CLIENT_ID when set', () => {
      process.env.SOUNDCLOUD_CLIENT_ID = 'client-id'
      expect(config.soundcloudClientId).toBe('client-id')
    })
  })

  describe('soundcloudClientSecret', () => {
    it('throws a clear error when SOUNDCLOUD_CLIENT_SECRET is unset', () => {
      delete process.env.SOUNDCLOUD_CLIENT_SECRET
      expect(() => config.soundcloudClientSecret).toThrow('Missing required environment variable: SOUNDCLOUD_CLIENT_SECRET')
    })

    it('returns SOUNDCLOUD_CLIENT_SECRET when set', () => {
      process.env.SOUNDCLOUD_CLIENT_SECRET = 'client-secret'
      expect(config.soundcloudClientSecret).toBe('client-secret')
    })
  })

  describe('Turnstile keys', () => {
    it('throw a clear error when unset', () => {
      delete process.env.TURNSTILE_SITE_KEY
      delete process.env.TURNSTILE_SECRET_KEY
      expect(() => config.turnstileSiteKey).toThrow('Missing required environment variable: TURNSTILE_SITE_KEY')
      expect(() => config.turnstileSecretKey).toThrow('Missing required environment variable: TURNSTILE_SECRET_KEY')
    })

    it('are read from the environment when set', () => {
      process.env.TURNSTILE_SITE_KEY = 'site-key'
      process.env.TURNSTILE_SECRET_KEY = 'secret-key'
      expect(config.turnstileSiteKey).toBe('site-key')
      expect(config.turnstileSecretKey).toBe('secret-key')
    })
  })

  describe('privateFiles', () => {
    beforeEach(() => {
      delete process.env.PRIVATE_BUCKET
      delete process.env.PRIVATE_BUCKET_DIRECTORY
    })

    it('is the bucket when PRIVATE_BUCKET is set', () => {
      process.env.PRIVATE_BUCKET = 'parking-radio-test-private'
      process.env.PRIVATE_BUCKET_DIRECTORY = '/tmp/private-bucket'
      expect(config.privateFiles).toEqual({ bucket: 'parking-radio-test-private' })
    })

    it('is PRIVATE_BUCKET_DIRECTORY otherwise', () => {
      process.env.PRIVATE_BUCKET_DIRECTORY = '/tmp/private-bucket'
      expect(config.privateFiles).toEqual({ directory: '/tmp/private-bucket' })
    })

    it('throws a clear error when neither is set, in development as in production', () => {
      delete process.env.NODE_ENV
      expect(() => config.privateFiles).toThrow('Missing required environment variable: PRIVATE_BUCKET (or PRIVATE_BUCKET_DIRECTORY)')
      process.env.NODE_ENV = 'production'
      expect(() => config.privateFiles).toThrow('Missing required environment variable: PRIVATE_BUCKET (or PRIVATE_BUCKET_DIRECTORY)')
    })
  })
})
