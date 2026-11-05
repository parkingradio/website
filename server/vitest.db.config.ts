import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { configDefaults, defineConfig } from 'vitest/config'
import base from './vitest.config.ts'

// The tests that need a real database (`npm run test:db`): each test file creates a database of its own on the Postgres
// server at DATABASE_URL (see src/db/test-database.ts), which comes from the environment, or else from the checkout's
// .env, like the server's.
config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true })

export default defineConfig({
  test: {
    ...base.test,
    include: ['src/**/*.db.test.ts'],
    exclude: configDefaults.exclude,
    // They run sequences of requests against the database, which takes a while.
    testTimeout: 10 * 60 * 1000,
    hookTimeout: 60 * 1000,
  },
})
