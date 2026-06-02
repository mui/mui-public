import path from 'node:path';
import { test, expect } from '@playwright/test';

// The standalone demo route, derived from this file's location under `app`.
const route = path
  .dirname(import.meta.filename)
  .split('/app')
  .pop()!;

test('initial-detailed swaps the low-res preview for the detailed line', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto(route);
  const demo = page.locator('.demo').first();

  // The low-res preview (9 sampled points) is server-rendered into the SSR HTML
  // and paints first...
  await expect(demo).toContainText('9 points', { timeout: 15000 });
  // ...then the detailed line (72 points) streams in from the server Loader and
  // swaps in once it resolves. The counts are computed at render time, so they
  // cannot match the source panel.
  await expect(demo).toContainText('72 points', { timeout: 15000 });

  // A working demo mounts and renders its content without throwing.
  expect(pageErrors, 'the demo should mount without uncaught errors').toEqual([]);
});
