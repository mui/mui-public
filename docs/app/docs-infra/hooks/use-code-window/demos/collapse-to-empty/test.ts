import path from 'node:path';
import { test, expect } from '@playwright/test';

// The standalone demo route, derived from this file's location under `app`.
const route = path
  .dirname(import.meta.filename)
  .split('/app')
  .pop()!;

test('use-code-window/collapse-to-empty renders a collapsed-to-empty block', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto(route);
  const demo = page.locator('.demo').first();

  // The source is present in the DOM even while collapsed (the frames are
  // hidden, not removed), so the text is matchable.
  await expect(demo).toContainText('defineConfig', { timeout: 15000 });

  // collapseToEmpty empties the collapsed window: the <code> reports 0 focused
  // lines, and an Expand toggle is shown because the block is forced collapsible.
  await expect(demo.locator('code[data-focused-lines="0"]')).toHaveCount(1);
  await expect(demo).toContainText('Expand');

  // A working demo mounts and renders its content without throwing.
  expect(pageErrors, 'the demo should mount without uncaught errors').toEqual([]);
});
