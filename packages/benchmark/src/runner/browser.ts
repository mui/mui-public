import { access } from 'node:fs/promises';
import type * as PlaywrightTest from '@playwright/test';

/**
 * Resolves the browser every benchmark runs on: Playwright's pinned Chrome for Testing, rather than
 * whatever Chrome the machine has auto-updated to.
 */
export async function resolveBrowserBinary(harnessDir: string): Promise<string> {
  let playwright: typeof PlaywrightTest;
  try {
    playwright = await import('@playwright/test');
  } catch {
    // An optional peer, so it installs cleanly when absent and only fails here.
    throw new Error(
      `"@playwright/test" is not installed. Add it as a devDependency of ${harnessDir}.`,
    );
  }

  const binary = playwright.chromium.executablePath();
  try {
    await access(binary);
  } catch {
    throw new Error(
      `Playwright's Chromium is not installed at "${binary}". Run \`pnpm exec playwright install chromium\`.`,
    );
  }
  return binary;
}
