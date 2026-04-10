import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './app',
  testMatch: '**/test.ts',
  forbidOnly: !!process.env.CI,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    viewport: { width: 2560, height: 1440 },
    deviceScaleFactor: 3,
    connectOptions: process.env.PLAYWRIGHT_SERVER
      ? { wsEndpoint: process.env.PLAYWRIGHT_SERVER }
      : undefined,
  },
  webServer: {
    command: 'pnpm build && pnpm start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
  },
});
