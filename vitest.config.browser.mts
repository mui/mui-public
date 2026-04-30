import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

const wsEndpoint = process.env.PLAYWRIGHT_SERVER;

export default defineConfig({
  test: {
    include: ['packages/**/*.browser.{ts,tsx}'],
    browser: {
      enabled: true,
      provider: playwright({
        ...(wsEndpoint ? { connectOptions: { wsEndpoint } } : {}),
      }),
      headless: true,
      instances: [{ browser: 'chromium' }, { browser: 'firefox' }, { browser: 'webkit' }],
    },
  },
});
