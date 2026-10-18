import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // The time zone the server runs in, in its Docker image, whatever the time zone of the machine running the tests.
    env: { TZ: 'UTC' },
  },
})
