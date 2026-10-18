import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/healthz': 'http://localhost:3000',
      '/api': 'http://localhost:3000',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    // The admin pages show dates and times in the browser's time zone, so the tests run in the one the admins are in,
    // whatever the time zone of the machine running them.
    env: { TZ: 'America/Toronto' },
  },
})
