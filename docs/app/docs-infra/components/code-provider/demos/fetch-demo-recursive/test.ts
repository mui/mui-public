import path from 'node:path';
import { test, expect } from '@playwright/test';

// The standalone demo route, derived from this file's location under `app`.
const route = path
  .dirname(import.meta.filename)
  .split('/app')
  .pop()!;

test('fetch-demo-recursive renders recursively-fetched source', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto(route);
  const demo = page.locator('.demo-component').first();

  // Fetches from GitHub at runtime (recursive import resolution); allow extra
  // time. Note: this test needs network access (unauthenticated GitHub API).
  await expect(demo).toContainText('CheckboxBasic', { timeout: 30000 });

  // A working demo mounts and renders its content without throwing.
  expect(pageErrors, 'the demo should mount without uncaught errors').toEqual([]);
});
