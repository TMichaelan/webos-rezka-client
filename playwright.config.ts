import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5173', channel: 'chrome', viewport: { width: 1920, height: 1080 }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'npm run dev -- --fixture', url: 'http://127.0.0.1:5173', reuseExistingServer: false, timeout: 60000 },
})
