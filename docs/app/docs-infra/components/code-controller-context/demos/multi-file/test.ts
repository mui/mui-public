import path from 'node:path';
import { test, expect } from '@playwright/test';

// The standalone demo route, derived from this file's location under `app`.
const route = path
  .dirname(import.meta.filename)
  .split('/app')
  .pop()!;

test('multi-file switches between files', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto(route);
  const demo = page.locator('.demo').first();

  await expect(page.getByRole('tab', { name: 'App.tsx' })).toBeVisible({ timeout: 15000 });

  // Switch to the second file; the CSS source replaces the JSX.
  await page.getByRole('tab', { name: 'styles.css' }).click();
  await expect(demo).toContainText('.container', { timeout: 15000 });

  // A working demo mounts and renders its content without throwing.
  expect(pageErrors, 'the demo should mount without uncaught errors').toEqual([]);
});
