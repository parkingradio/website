import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // The time zone the server runs in, in its Docker image, whatever the time zone of the machine running the tests.
    env: { TZ: 'UTC' },
    // The tests that need a database have their own configuration (see vitest.db.config.ts).
    exclude: [...configDefaults.exclude, '**/*.db.test.ts'],
  },
})
