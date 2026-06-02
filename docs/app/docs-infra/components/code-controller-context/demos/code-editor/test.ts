import path from 'node:path';
import { test, expect } from '@playwright/test';

// The standalone demo route, derived from this file's location under `app`.
const route = path
  .dirname(import.meta.filename)
  .split('/app')
  .pop()!;

test('code-editor re-renders the source after an edit', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto(route);
  const demo = page.locator('.demo').first();

  await expect(demo).toContainText('Welcome to the live code editor', { timeout: 15000 });

  // Engage the controlled editor (warms the lazy editing engine), then replace
  // the source and confirm it re-renders (re-highlights) through the controller.
  const editable = page.getByLabel('Editable code');
  await expect(editable).toBeVisible();
  await editable.click();
  await page.waitForTimeout(500);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('const sentinel = 42;');
  await expect(editable).toContainText('const sentinel = 42;', { timeout: 15000 });

  // A working demo mounts and renders its content without throwing.
  expect(pageErrors, 'the demo should mount without uncaught errors').toEqual([]);
});
