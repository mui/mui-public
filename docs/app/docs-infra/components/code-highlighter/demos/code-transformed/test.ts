import path from 'node:path';
import { test, expect } from '@playwright/test';

// The standalone demo route, derived from this file's location under `app`.
const route = path
  .dirname(import.meta.filename)
  .split('/app')
  .pop()!;

test('code-transformed applies the TypeScript to JavaScript transform', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto(route);
  const demo = page.locator('.demo-component').first();

  await expect(demo).toContainText('interface User', { timeout: 15000 });

  // Toggle TS->JS on the demo's code block. The transform renames the rendered
  // file to `.jsx` (the demo's own source listing keeps the `.tsx` string and the
  // `interface` text, so assert on the renamed tab — unique to the live block).
  await page.getByRole('button', { name: 'JS' }).click();
  await expect(demo).toContainText('UserList.jsx', { timeout: 15000 });

  // A working demo mounts and renders its content without throwing.
  expect(pageErrors, 'the demo should mount without uncaught errors').toEqual([]);
});

// The swap animation surfaces as `data-transforming` on the rendered <pre>. The
// *active* (animating) phases are `expanding`/`collapsing`; `collapsed`/`expanded`
// are paused holds. "Instant, no animation" means the swap never reaches an
// active phase.
const ACTIVE_PHASE = /expanding|collapsing/;

// Control: a manual TS->JS toggle animates the swap.
test('swap transition plays on a manual transform toggle', async ({ page }) => {
  await page.goto(route);
  const pre = page.locator('.demo-component').first().locator('pre').first();

  await page.getByRole('button', { name: 'JS' }).click();
  await expect(pre).toHaveAttribute('data-transforming', ACTIVE_PHASE, { timeout: 5000 });
});

// Regression: a transform restored from localStorage should animate the same
// way a manual toggle does. Previously the restored swap was instant (no active
// phase) because the post-swap window only armed on a null->X flip and a
// mount-applied transform is committed from the first render. Toggling JS
// persists the preference; reloading restores it.
test('swap transition plays when a transform is restored from localStorage', async ({ page }) => {
  await page.goto(route);

  // Persist a JS preference via a manual toggle (writes localStorage), and wait
  // for it to commit so the preference is saved before reload.
  await page.getByRole('button', { name: 'JS' }).click();
  await expect(page.locator('.demo-component').first()).toContainText('UserList.jsx', {
    timeout: 15000,
  });

  // Reload: JS is restored from localStorage. It SHOULD replay the swap
  // animation (active phase), the same as the manual toggle above.
  await page.reload();
  const pre = page.locator('.demo-component').first().locator('pre').first();
  await expect(pre).toHaveAttribute('data-transforming', ACTIVE_PHASE, { timeout: 5000 });
});
