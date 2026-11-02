import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// The checkout's .env, which has its ports, so that checkouts can run side by side (see "Several checkouts" in the
// README). It's read the way the server reads it (`node --env-file`): what's set takes precedence over the file.
const envFile = path.join(import.meta.dirname, '../.env')
const env = { ...(existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {}), ...process.env }
// The checkout's server (see `port` in server/src/core/config.ts).
const server = `http://localhost:${env.SERVER_PORT || env.PORT || 3000}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(env.CLIENT_PORT || 5173),
    // When the port is taken, e.g. by another checkout's dev server, Vite fails rather than taking the next one, where it
    // would still send requests to the server on SERVER_PORT, which could be that checkout's too.
    strictPort: true,
    proxy: {
      '/healthz': server,
      '/api': server,
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    // The admin pages show dates and times in the browser's time zone, except those of sessions and sets (see
    // quebec-time.ts), so the tests run in the one the admins are in, whatever the time zone of the machine running them.
    env: { TZ: 'America/Toronto' },
  },
})
