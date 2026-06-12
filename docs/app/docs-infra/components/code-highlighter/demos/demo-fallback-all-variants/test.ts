import path from 'node:path';
import { test, expect } from '@playwright/test';

// The standalone demo route, derived from this file's location under `app`.
const route = path
  .dirname(import.meta.filename)
  .split('/app')
  .pop()!;

test('demo-fallback-all-variants swaps variants without a decode error', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto(route);
  const demo = page.locator('.demo-component').first();

  await expect(demo).toContainText('styles.root', { timeout: 15000 });
  // The Tailwind source is only shown once swapped (guards a trivial pass).
  await expect(demo).not.toContainText('bg-red-500');

  // The production crash was on this variant swap (residual fallback decode).
  await demo.getByText('CSS Modules', { exact: true }).click();
  await page.getByRole('option', { name: 'Tailwind' }).click();
  await expect(demo).toContainText('bg-red-500', { timeout: 15000 });

  // A working demo mounts and renders its content without throwing.
  expect(pageErrors, 'the demo should mount without uncaught errors').toEqual([]);
});
