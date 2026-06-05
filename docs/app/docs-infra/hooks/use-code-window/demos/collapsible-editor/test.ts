import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';

// The standalone demo route, derived from this file's location under `app`.
const route = path
  .dirname(import.meta.filename)
  .split('/app')
  .pop()!;

/**
 * Caret state that doesn't depend on collapsed-mode line/column maths: the
 * character immediately before the caret, plus whether the caret sits at the
 * start of its line. The "x =" bug sends the caret to the line start, so the
 * preceding character flips from `x` to a newline (or nothing).
 */
async function caret(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector('[contenteditable]') as HTMLElement | null;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0) {
      return { position: -1, prevChar: null as string | null, atLineStart: true };
    }
    const range = sel.getRangeAt(0);
    const until = document.createRange();
    until.setStart(el, 0);
    until.setEnd(range.startContainer, range.startOffset);
    const text = until.toString();
    const prevChar = text.length > 0 ? text[text.length - 1] : null;
    return {
      position: text.length,
      prevChar,
      atLineStart: prevChar === null || prevChar === '\n',
    };
  });
}

async function open(page: Page) {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  await page.goto(route);
  const editable = page.locator('[contenteditable]').first();
  await expect(editable).toBeVisible({ timeout: 15000 });
  await editable.click();
  await page.waitForTimeout(700); // warm the lazy editing engine
  return { editable, errors };
}

test('the collapsible editor mounts and is editable', async ({ page }) => {
  const { editable, errors } = await open(page);
  // The visible (collapsed) region is the highlighted `useEffect` block.
  await expect(editable).toContainText('fetchUser');
  await expect(editable).toHaveAttribute('contenteditable');
  expect(errors, 'demo should mount without uncaught errors').toEqual([]);
});

// Bug 3: typing `x`, then `=`, then Backspace must keep the caret right after the
// `x`, not send it to the start of the line.
test('Bug 3: x then = then Backspace keeps the caret after x', async ({ page }) => {
  const { editable } = await open(page);
  // Land the caret at the end of a visible line (the line/inter-line-gap
  // boundary, where native plaintext typing used to flatten the spans).
  await editable.locator('.line').first().click();
  await page.keyboard.press('End');

  await page.keyboard.type('x');
  await page.waitForTimeout(300);
  await page.keyboard.type('=');
  await page.waitForTimeout(300);
  const afterTyping = await caret(page);

  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);
  const afterBackspace = await caret(page);

  // Deleting the `=` should move the caret back exactly one position and leave
  // it sitting right after the `x`. The bug sent it to the line start instead:
  // the caret's preceding character became the newline, not `x`.
  const ctx = `caret: ${JSON.stringify({ afterTyping, afterBackspace })}`;
  expect(afterBackspace.position, ctx).toBe(afterTyping.position - 1);
  expect(afterBackspace.prevChar, ctx).toBe('x');
  expect(afterBackspace.atLineStart, ctx).toBe(false);
});
