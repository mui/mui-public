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
      screenshotFailures: false,
      instances: [{ browser: 'chromium' }, { browser: 'firefox' }, { browser: 'webkit' }],
    },
    // Run test files sequentially within each browser worker. Vitest
    // still parallelises across the three browsers, but no longer spins
    // up multiple Playwright pages per browser concurrently — which was
    // OOM-killing the Playwright server on CircleCI's `medium` runner.
    fileParallelism: false,
  },
});
