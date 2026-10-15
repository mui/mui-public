import { access } from 'node:fs/promises';
import { chromium } from '@playwright/test';

/**
 * Resolves the browser every benchmark runs on: Playwright's pinned Chrome for Testing, rather than
 * whatever Chrome the machine has auto-updated to.
 */
export async function resolveBrowserBinary(): Promise<string> {
  // `pnpm install` brings the package, not its browser.
  const binary = chromium.executablePath();
  try {
    await access(binary);
  } catch {
    throw new Error(
      `Playwright's Chromium is not installed at "${binary}". Run \`pnpm exec playwright install chromium\`.`,
    );
  }
  return binary;
}
