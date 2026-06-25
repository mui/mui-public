import path from 'node:path';
import { test, expect } from '@playwright/test';

// The standalone demo route, derived from this file's location under `app`.
const route = path
  .dirname(import.meta.filename)
  .split('/app')
  .pop()!;

test('editable-toggle starts read-only and edits after clicking Edit', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await page.goto(route);
  const demo = page.locator('.demo').first();
  await expect(demo).toContainText('Read-only until you click Edit', { timeout: 15000 });

  // Starts read-only (`initialDisabled`): the editable affordance only appears once the
  // reader opts in, so there's nothing to engage yet.
  await expect(page.getByLabel('Editable code')).toHaveCount(0);

  // Click "Edit" → editing turns on and the live-editing engine attaches.
  await page.getByRole('button', { name: 'Edit' }).first().click();
  const editable = page.getByLabel('Editable code');
  await expect(editable).toBeVisible({ timeout: 15000 });

  // Edit the source and confirm it re-renders (re-highlights) through the controller.
  await editable.click();
  await page.waitForTimeout(500);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('const sentinel = 42;');
  await expect(editable).toContainText('const sentinel = 42;', { timeout: 15000 });

  expect(pageErrors, 'the demo should mount without uncaught errors').toEqual([]);
});
