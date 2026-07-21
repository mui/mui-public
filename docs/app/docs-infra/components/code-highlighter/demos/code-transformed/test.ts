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
  const demo = page.locator('.demo').first();

  await expect(demo).toContainText('interface User', { timeout: 15000 });

  // Toggle TS->JS on the demo's code block. The transform renames the rendered
  // file to `.jsx` (the demo's own source listing keeps the `.tsx` string and the
  // `interface` text, so assert on the renamed tab — unique to the live block).
  await page.getByRole('button', { name: 'JS' }).click();
  await expect(demo).toContainText('UserList.jsx', { timeout: 15000 });

  // A working demo mounts and renders its content without throwing.
  expect(pageErrors, 'the demo should mount without uncaught errors').toEqual([]);
});

test('restores a transformed filename from localStorage', async ({ page }) => {
  await page.goto(route);

  // Persist a JS preference via a manual toggle (writes localStorage), and wait
  // for it to commit so the preference is saved before reload.
  await page.getByRole('button', { name: 'JS' }).click();
  await expect(page.locator('.demo').first()).toContainText('UserList.jsx', { timeout: 15000 });

  await page.reload();
  await expect(page.locator('.demo').first()).toContainText('UserList.jsx', { timeout: 15000 });
});
