import { test, expect } from '@playwright/test';
import { appRoute } from '@/appRoute';

// The standalone demo route, derived from this file's location under `app`.
const route = appRoute(import.meta.url);

test('use-copier/text-input-copy renders the copy control', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto(route);
  const demo = page.locator('.demo').first();

  // The copy control's label toggles between 'Copy' and 'Copied' — match either.
  await expect(demo.getByRole('button', { name: /cop/i }).first()).toBeVisible({ timeout: 15000 });

  // A working demo mounts and renders its content without throwing.
  expect(pageErrors, 'the demo should mount without uncaught errors').toEqual([]);
});
