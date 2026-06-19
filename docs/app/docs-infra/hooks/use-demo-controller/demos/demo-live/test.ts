import path from 'node:path';
import { test, expect, type Page, type Locator } from '@playwright/test';

// The standalone demo route, derived from this file's location under `app`.
const route = path
  .dirname(import.meta.filename)
  .split('/app')
  .pop()!;

/**
 * Opens the demo, waits for the live preview, and warms the lazy editing engine +
 * transpile worker by engaging the editor on a real `.line` (mirrors the
 * `collapsible-editor` test's `open()`). Returns the editable + an error sink.
 */
async function open(page: Page) {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  await page.goto(route);
  const demo = page.locator('.demo').first();
  await expect(demo).toContainText('Type Whatever You Want Below', { timeout: 15000 });
  // use-editable sets contentEditable to 'plaintext-only', so match by presence.
  const editable = demo.locator('pre[contenteditable]').first();
  await editable.locator('.line').first().click();
  await page.waitForTimeout(700); // warm the lazy editing engine
  return { demo, editable, errors };
}

/**
 * Places the caret on the `.line` carrying `text`, selects the whole line, and
 * types `replacement` over it — a targeted, real-keystroke edit (the engine
 * forwards per-key events to the controller; a synthetic `insertText` would not).
 */
async function replaceLine(page: Page, editable: Locator, text: string, replacement: string) {
  await editable.locator('.line', { hasText: text }).first().click();
  await page.waitForTimeout(120);
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await page.keyboard.type(replacement);
}

test('demo-live renders the live preview and editable source', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));

  await page.goto(route);
  await expect(page.locator('.demo').first()).toContainText('Type Whatever You Want Below', {
    timeout: 15000,
  });

  // A working demo mounts and renders its content without throwing.
  expect(errors, 'the demo should mount without uncaught errors').toEqual([]);
});

test('demo-live re-renders the live preview after editing a line', async ({ page }) => {
  const { editable, errors } = await open(page);

  // Targeted edit: replace just the paragraph line with a different renderable.
  await replaceLine(page, editable, 'Type Whatever You Want Below', '<p>Edited live output</p>');

  // The LIVE PREVIEW updates — proving the edit was transpiled (off the main
  // thread) and the component re-rendered. Asserting on a real <p> (not the demo's
  // source viewer, which holds the same text inside a <pre>) avoids a trivial pass
  // against the edited source.
  await expect(page.locator('p', { hasText: 'Edited live output' })).toBeVisible({
    timeout: 15000,
  });

  expect(errors, 'editing should not throw uncaught').toEqual([]);
});

test('demo-live keeps the last good preview when an edit is broken', async ({ page }) => {
  const { editable, errors } = await open(page);

  // Replace the paragraph line with unterminated JSX — it fails to transpile.
  await replaceLine(page, editable, 'Type Whatever You Want Below', '<p>unterminated');

  // The broken edit must not blank or crash the preview: the last good render stays
  // on screen (its <p> survives, even though the source line no longer holds that
  // text), and no uncaught error escapes.
  await expect(page.locator('p', { hasText: 'Type Whatever You Want Below' })).toBeVisible({
    timeout: 15000,
  });
  expect(errors, 'a broken edit should be caught, not crash the page').toEqual([]);
});
