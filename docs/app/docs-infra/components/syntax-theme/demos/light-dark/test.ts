import { test, expect } from '@playwright/test';
import { appRoute } from '@/appRoute';

const route = appRoute(import.meta.url);

test('the syntax theme switches palettes with data-color-scheme', async ({ page }) => {
  await page.goto(route);
  const keyword = (scheme: string) =>
    page.locator(`.demo [data-color-scheme="${scheme}"] .pl-k`).first();

  await expect(keyword('light')).toHaveCSS('color', 'rgb(207, 34, 46)', { timeout: 15000 });
  await expect(keyword('dark')).toHaveCSS('color', 'rgb(255, 123, 114)');
});
