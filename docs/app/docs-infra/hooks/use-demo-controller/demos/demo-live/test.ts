import path from 'node:path';
import { test, expect } from '@playwright/test';
import type { Page, Locator } from '@playwright/test';

// The standalone demo route, derived from this file's location under `app`.
const route = path
  .dirname(import.meta.filename)
  .split('/app')
  .pop()!;

/**
 * Opens the demo, waits for the live preview, and engages the textarea editor.
 */
async function open(page: Page) {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  await page.goto(route);
  const demo = page.locator('.demo').first();
  await expect(demo).toContainText('Type Whatever You Want Below', { timeout: 15000 });
  const editable = demo.locator('textarea.editable-code-textarea').first();
  await editable.click();
  await page.waitForTimeout(700); // warm the lazy editor and runtime
  return { demo, editable, errors };
}

/**
 * Selects the line carrying `text` in the textarea and types its replacement.
 */
async function replaceLine(page: Page, editable: Locator, text: string, replacement: string) {
  await editable.evaluate((element, target) => {
    const textarea = element as HTMLTextAreaElement;
    const start = textarea.value.indexOf(target);
    if (start === -1) {
      throw new Error(`Unable to find source line containing: ${target}`);
    }
    const lineStart = textarea.value.lastIndexOf('\n', start) + 1;
    const lineEnd = textarea.value.indexOf('\n', start);
    textarea.focus();
    textarea.setSelectionRange(lineStart, lineEnd === -1 ? textarea.value.length : lineEnd);
  }, text);
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

test('demo-live keeps the last good preview when an edit throws at render', async ({ page }) => {
  const { editable, errors } = await open(page);

  // Replace the paragraph with JSX that transpiles fine but THROWS at render
  // (`undefined.x`). Unlike a transpile error — which never builds, so the prior build
  // simply stays — this build SUCCEEDS and commits, then the entry throws; the runner must
  // fall back to the last good render. The `.original` baseline must therefore have painted
  // first (the build must NOT swap in via a transition that supersedes the baseline's paint).
  await replaceLine(page, editable, 'Type Whatever You Want Below', '<p>{undefined.x}</p>');

  await expect(page.locator('p', { hasText: 'Type Whatever You Want Below' })).toBeVisible({
    timeout: 15000,
  });
  expect(errors, 'a render error should be caught by the boundary, not crash the page').toEqual([]);
});

test('demo-live keeps a preview after reset() then a broken edit', async ({ page }) => {
  const { editable, errors } = await open(page);

  // Make a real edit (so the controller holds code), then reset it back to the original.
  await replaceLine(page, editable, 'Type Whatever You Want Below', '<p>First edit</p>');
  await expect(page.locator('p', { hasText: 'First edit' })).toBeVisible({ timeout: 15000 });

  // Reset edits → open the actions menu and click "Reset edits"; the controller clears,
  // so the preview returns to the build-time (original) render.
  await page.getByRole('button', { name: 'More actions' }).first().click();
  await page.getByRole('menuitem', { name: 'Reset edits' }).click();
  await expect(page.locator('p', { hasText: 'Type Whatever You Want Below' })).toBeVisible({
    timeout: 15000,
  });

  // The first edit AFTER reset must re-arm the `.original` baseline, so a broken edit
  // — a TRANSPILATION error (unterminated JSX never reaches `setBuilt`) — keeps the
  // original render instead of blanking the preview.
  await replaceLine(page, editable, 'Type Whatever You Want Below', '<p>unterminated');

  await expect(page.locator('p', { hasText: 'Type Whatever You Want Below' })).toBeVisible({
    timeout: 15000,
  });
  expect(errors, 'reset-then-broken-edit must not throw uncaught').toEqual([]);
});

test('demo-live keeps a preview after reset() then a render error', async ({ page }) => {
  const { editable, errors } = await open(page);

  // Edit, then reset back to the original.
  await replaceLine(page, editable, 'Type Whatever You Want Below', '<p>First edit</p>');
  await expect(page.locator('p', { hasText: 'First edit' })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'More actions' }).first().click();
  await page.getByRole('menuitem', { name: 'Reset edits' }).click();
  await expect(page.locator('p', { hasText: 'Type Whatever You Want Below' })).toBeVisible({
    timeout: 15000,
  });

  // The first edit AFTER reset is a RENDER error — it transpiles and builds successfully,
  // then throws when the entry renders. The `.original` baseline (rebuilt first) must paint
  // before this edit's build commits, so the runner has a last-good to fall back to;
  // otherwise the preview blanks and only the error box shows. (This is the regression the
  // build's `startTransition` introduced by coalescing the baseline's paint away.)
  await replaceLine(page, editable, 'Type Whatever You Want Below', '<p>{undefined.x}</p>');

  await expect(page.locator('p', { hasText: 'Type Whatever You Want Below' })).toBeVisible({
    timeout: 15000,
  });
  expect(errors, 'reset-then-render-error must keep the baseline, not blank').toEqual([]);
});

test('demo-live never flashes an empty preview on the first edit', async ({ page }) => {
  const { editable, errors } = await open(page);

  // Watch the DOM across the first edit: a preview paragraph (build-time render, then the
  // live build) must be present after EVERY mutation. The controller holds the build-time
  // render on screen until the live build has rendered, so swapping it in must never
  // commit an empty frame (the regression: the live `<Suspense fallback={null}>` painting
  // `null` while its lazy runtime resolved).
  await page.evaluate(() => {
    const w = window as unknown as { sawEmptyPreview?: boolean; stopObserving?: () => void };
    w.sawEmptyPreview = false;
    const observer = new MutationObserver(() => {
      if (!document.querySelector('p')) {
        w.sawEmptyPreview = true;
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    w.stopObserving = () => observer.disconnect();
  });

  // Edit the paragraph; the live preview rebuilds and swaps in.
  await replaceLine(page, editable, 'Type Whatever You Want Below', '<p>Edited live output</p>');
  await expect(page.locator('p', { hasText: 'Edited live output' })).toBeVisible({
    timeout: 15000,
  });

  const sawEmpty = await page.evaluate(() => {
    const w = window as unknown as { sawEmptyPreview?: boolean; stopObserving?: () => void };
    w.stopObserving?.();
    return w.sawEmptyPreview;
  });
  expect(sawEmpty, 'the preview must never blank while the live build swaps in').toBe(false);
  expect(errors, 'editing should not throw uncaught').toEqual([]);
});
