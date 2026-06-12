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

  const response = await page.goto(route);
  const demo = page.locator('.demo-component').first();

  // The low-res baseline (9 sampled points) is server-rendered into the SSR HTML as the
  // Suspense placeholder, and the detailed line (72 points) is revealed in the same
  // streamed document. The docs ship as a static export, so the server `Loader` delay is
  // paid at build time and the reveal swaps at parse time — too fast to observe the
  // placeholder in the live DOM — so assert the swap from the SSR response instead. The
  // counts are computed at render time, so they appear in the rendered markup but not the
  // source panel. React splits adjacent dynamic text with `<!-- -->` separators, so strip
  // those before matching the rendered counts.
  const html = (await response!.text()).replace(/<!--[\s\S]*?-->/g, '');
  expect(html, 'the low-res preview is server-rendered into the SSR HTML').toContain(
    'low-res preview — 9 points',
  );
  expect(html, 'the detailed line is revealed in the same streamed document').toContain(
    'detailed — 72 points',
  );

  // The live demo settles on the detailed line once the reveal runs.
  await expect(demo).toContainText('72 points', { timeout: 15000 });

  // A working demo mounts and renders its content without throwing.
  expect(pageErrors, 'the demo should mount without uncaught errors').toEqual([]);
});
