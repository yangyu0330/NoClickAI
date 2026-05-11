import { defineConfig, devices } from '@playwright/test'

const WEB_PORT = 55173
const REMOTE_BASE_URL = process.env.NOCLICK_E2E_BASE_URL?.replace(/\/+$/, '')
const WEB_BASE_URL = REMOTE_BASE_URL || `http://127.0.0.1:${WEB_PORT}`
const USE_LOCAL_SERVER = !REMOTE_BASE_URL

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: WEB_BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  ...(USE_LOCAL_SERVER
    ? {
        webServer: {
          command: 'node scripts/e2e-server.mjs',
          url: WEB_BASE_URL,
          timeout: 120_000,
          reuseExistingServer: !process.env.CI,
        },
      }
    : {}),
})
