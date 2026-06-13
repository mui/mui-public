import path from 'node:path';
import { test, expect } from '@playwright/test';

// The standalone demo route, derived from this file's location under `app`.
const route = path
  .dirname(import.meta.filename)
  .split('/app')
  .pop()!;

test('code-highlight-init renders the source (highlight deferred to init)', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto(route);
  const demo = page.locator('.demo-component').first();

  await expect(demo).toContainText('Hello, world!', { timeout: 15000 });

  // `highlightAt: 'init'` paints the initially-visible frames already highlighted
  // on the first render — from the server-built highlighted-visible fallback, with no
  // client-side decompression. Scope to the LIVE output's `language-javascript` block
  // (the demo source viewer is `language-tsx`, so a bare `code span.pl-*` could match
  // the viewer's highlighting instead of the live block).
  await expect(
    demo.locator('code[class*="language-javascript"] span[class*="pl-"]').first(),
  ).toBeVisible({ timeout: 15000 });

  // A working demo mounts and renders its content without throwing.
  expect(pageErrors, 'the demo should mount without uncaught errors').toEqual([]);
});
