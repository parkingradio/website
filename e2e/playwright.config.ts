import { defineConfig, devices } from '@playwright/test'
import { required } from './env.ts'
import type { Options } from './tests/fixtures.ts'

// Browser tests for the site, run against a server that's already up, at BASE_URL. run.sh starts the production Docker
// image for them (see README.md), and global-setup.ts seeds it.

export default defineConfig<Options>({
  testDir: 'tests',
  globalSetup: './global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: [[process.env.CI ? 'github' : 'list'], ['html', { open: 'never' }]],
  use: {
    baseURL: required('BASE_URL'),
    trace: 'retain-on-failure',
  },
  // Phones get the navigation links in a drawer, and the admin menu as a row above the section, so every test runs on a
  // phone too.
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'], hasDrawer: true } },
  ],
})
