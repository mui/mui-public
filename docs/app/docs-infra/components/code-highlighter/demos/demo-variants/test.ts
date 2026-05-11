import path from 'node:path';
import { test } from '@playwright/test';

const route = path
  .dirname(import.meta.filename)
  .split('/app')
  .pop()!;

test('code highlighter with multiple variants', async ({ page }) => {
  await page.goto(route);
  await page.waitForLoadState('networkidle');

  await page.getByLabel('More actions').first().click();
  // Wait for the menu open animation to settle.
  await page.waitForTimeout(300);

  await page
    .locator('.demo')
    .first()
    /* file://./../../../../../../public/docs-infra/components/code-highlighter/demos/demo-variants.png */
    .screenshot({ path: `public/${route}.png` });
});
