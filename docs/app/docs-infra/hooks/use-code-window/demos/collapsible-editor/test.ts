import path from 'node:path';
import { test, expect, type Page, type Locator } from '@playwright/test';

// The standalone demo route, derived from this file's location under `app`.
const route = path
  .dirname(import.meta.filename)
  .split('/app')
  .pop()!;

/**
 * Caret state read straight from the live Selection — the source of truth the
 * user actually sees. `dataLn` is the `data-ln` of the `.line` the caret sits
 * in; `inGap` is true when the caret is stranded in an inter-line gap text node
 * (between `.line` spans) rather than inside a real line. `prevChar` /
 * `atLineStart` describe the character immediately before the caret without
 * depending on collapsed-mode column maths.
 */
async function caret(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector('[contenteditable]') as HTMLElement | null;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0) {
      return {
        position: -1,
        prevChar: null as string | null,
        atLineStart: true,
        dataLn: null as string | null,
        inGap: true,
      };
    }
    const range = sel.getRangeAt(0);
    const until = document.createRange();
    until.setStart(el, 0);
    until.setEnd(range.startContainer, range.startOffset);
    const text = until.toString();
    const prevChar = text.length > 0 ? text[text.length - 1] : null;
    const startNode = range.startContainer;
    const startElement =
      startNode.nodeType === 1 ? (startNode as Element) : startNode.parentElement;
    const lineEl = startElement ? startElement.closest('.line') : null;
    return {
      position: text.length,
      prevChar,
      atLineStart: prevChar === null || prevChar === '\n',
      dataLn: lineEl ? lineEl.getAttribute('data-ln') : null,
      inGap: !lineEl,
    };
  });
}

/**
 * The visible window of the editable: how many `.line`s are actually rendered
 * (height > 0, not `visibility: hidden`) and which `data-ln` they span. Scoped
 * to the editable's own collapsible container because the demo ALSO renders a
 * separate collapsible source viewer with its own checkbox/toggle.
 */
async function visibleWindow(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector('[contenteditable]') as HTMLElement | null;
    if (!el) {
      return {
        count: 0,
        firstLn: null as string | null,
        lastLn: null as string | null,
        expanded: false,
      };
    }
    const container = el.closest('div[class*=container]');
    const lines = Array.from(el.querySelectorAll('.line'));
    const visible = lines.filter((line) => {
      const rect = line.getBoundingClientRect();
      return rect.height > 0 && getComputedStyle(line).visibility !== 'hidden';
    });
    const checkbox = container?.querySelector('input[type=checkbox]') as HTMLInputElement | null;
    return {
      count: visible.length,
      firstLn: visible[0]?.getAttribute('data-ln') ?? null,
      lastLn: visible[visible.length - 1]?.getAttribute('data-ln') ?? null,
      expanded: checkbox?.checked ?? false,
    };
  });
}

/**
 * Clicks the visible `.line` carrying `dataLn` to place the caret on it, then
 * optionally normalizes the column with Home/End. Clicking (rather than a
 * synthetic range) exercises the engine's real pointer → caret pipeline.
 */
async function placeCaretOnLine(
  page: Page,
  editable: Locator,
  dataLn: number,
  where: 'start' | 'end' | 'click' = 'click',
) {
  await editable.locator(`.line[data-ln="${dataLn}"]`).click();
  await page.waitForTimeout(120);
  if (where === 'start') {
    await page.keyboard.press('Home');
  } else if (where === 'end') {
    await page.keyboard.press('End');
  }
  await page.waitForTimeout(80);
}

type Signature = { lineCount: number; visCount: number; empty: number; textLen: number };

/**
 * Records a structural signature of the editable on every DOM mutation while
 * `action` runs, so transient "flash" states are captured. A flash is any
 * intermediate frame whose structure is WORSE than both the stable before/after
 * states — a momentary empty `.line` (the browser's default contentEditable
 * behavior collapsing a line) or a dip in the visible line count — that then
 * reconciles back. These are invisible to a plain before/after assertion but
 * are exactly what the user sees flicker on screen.
 */
async function flashDuring(page: Page, action: () => Promise<void>) {
  await page.evaluate(() => {
    const el = document.querySelector('[contenteditable]') as HTMLElement;
    const probe = window as unknown as {
      flashSig: () => Signature;
      flashRec: Signature[];
      flashMo: MutationObserver;
    };
    probe.flashSig = () => {
      const lines = Array.from(el.querySelectorAll('.line'));
      const visible = lines.filter((line) => {
        const rect = line.getBoundingClientRect();
        return rect.height > 0 && getComputedStyle(line).visibility !== 'hidden';
      });
      return {
        lineCount: lines.length,
        visCount: visible.length,
        empty: lines.filter((line) => (line.textContent || '') === '').length,
        textLen: (el.textContent || '').length,
      };
    };
    probe.flashRec = [probe.flashSig()];
    probe.flashMo = new MutationObserver(() => probe.flashRec.push(probe.flashSig()));
    probe.flashMo.observe(el, { childList: true, subtree: true, characterData: true });
  });

  await action();
  await page.waitForTimeout(500);

  const records = await page.evaluate(() => {
    const probe = window as unknown as {
      flashSig: () => Signature;
      flashRec: Signature[];
      flashMo: MutationObserver;
    };
    probe.flashMo.disconnect();
    probe.flashRec.push(probe.flashSig());
    return probe.flashRec;
  });

  const baseline = records[0];
  const stable = records[records.length - 1];
  // Only meaningful for edits that keep the line structure (so before ≈ after).
  const stableVis = Math.min(baseline.visCount, stable.visCount);
  const flashed = records.some((rec) => rec.empty > stable.empty || rec.visCount < stableVis);
  return { records, baseline, stable, flashed };
}

/**
 * Content length of the editable, ignoring a single trailing newline. The
 * contentEditable serializes with a trailing newline (and the rendered fallback
 * reflects it once the source carries one), so measuring length without it makes
 * deltas reflect real edits rather than the line terminator.
 */
async function editableTextLength(page: Page) {
  return page.evaluate(() => {
    const text = document.querySelector('[contenteditable]')?.textContent ?? '';
    return (text.endsWith('\n') ? text.slice(0, -1) : text).length;
  });
}

/**
 * A content-based signature of the emphasis (`@highlight`) frame: the trimmed
 * text of its first and last line, plus its line count. Content-based (not line
 * numbers) so it survives the collapsed windowing — it answers "is the SAME
 * code still highlighted?" across edits and undo/redo.
 */
async function highlightSignature(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector('[contenteditable]');
    const frame = el?.querySelector('.frame[data-frame-type="highlighted"]') ?? null;
    if (!frame) {
      return null;
    }
    const lines = Array.from(frame.querySelectorAll('.line')).map((line) =>
      (line.textContent || '').trim(),
    );
    return { first: lines[0] ?? null, last: lines[lines.length - 1] ?? null, count: lines.length };
  });
}

/** The current Selection's plain text. */
async function selectionText(page: Page) {
  return page.evaluate(() => window.getSelection()?.toString() ?? '');
}

/**
 * Selects whole lines `fromLn`..`toLn` (inclusive) via a real Range and returns
 * the browser's `Selection.toString()`. Used instead of keyboard Shift+Arrow
 * for multi-line selections, which the browser extends unreliably across the
 * non-selectable inter-line gap nodes in the framed structure.
 */
async function selectLines(page: Page, fromLn: number, toLn: number) {
  return page.evaluate(
    ({ from, to }) => {
      const el = document.querySelector('[contenteditable]') as HTMLElement;
      const lines = Array.from(el.querySelectorAll('.line'));
      const first = lines.find((node) => node.getAttribute('data-ln') === String(from))!;
      const last = lines.find((node) => node.getAttribute('data-ln') === String(to))!;
      const range = document.createRange();
      range.setStart(first, 0);
      range.setEnd(last, last.childNodes.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return selection.toString();
    },
    { from: fromLn, to: toLn },
  );
}

/**
 * Dispatches a synthetic `copy`/`cut` ClipboardEvent (the same event a real
 * Ctrl+C/Ctrl+X fires) and returns the `text/plain` the engine's handler wrote
 * plus whether it intercepted the event. Avoids OS-clipboard/permission flake
 * while exercising the exact handler logic.
 */
async function clipboardFromEvent(page: Page, type: 'copy' | 'cut') {
  return page.evaluate((eventType) => {
    const el = document.querySelector('[contenteditable]') as HTMLElement;
    const data = new DataTransfer();
    const event = new ClipboardEvent(eventType, {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(event);
    return { text: data.getData('text/plain'), prevented: event.defaultPrevented };
  }, type);
}

/** Dispatches a synthetic paste of `value` (the same event a real Ctrl+V fires). */
async function pasteText(page: Page, value: string) {
  await page.evaluate((text) => {
    const el = document.querySelector('[contenteditable]') as HTMLElement;
    const data = new DataTransfer();
    data.setData('text/plain', text);
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, value);
}

/** Opens the demo, warms the lazy editing engine, and tracks uncaught errors. */
async function open(page: Page) {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  await page.goto(route);
  const editable = page.locator('[contenteditable]').first();
  await expect(editable).toBeVisible({ timeout: 15000 });
  await editable.locator('.line').first().click();
  await page.waitForTimeout(700); // warm the lazy editing engine
  return { editable, errors };
}

test.describe('collapsible editor — mount', () => {
  test('mounts, is editable, and renders the collapsed window', async ({ page }) => {
    const { editable, errors } = await open(page);
    // The visible (collapsed) region is the highlighted `useEffect` block.
    await expect(editable).toContainText('fetchUser');
    await expect(editable).toHaveAttribute('contenteditable');
    const view = await visibleWindow(page);
    // Collapsed: only the focused window (padding + highlighted block) shows,
    // far fewer than the ~33 total lines in the source.
    expect(view.count).toBeGreaterThan(0);
    expect(view.count).toBeLessThan(33);
    expect(errors, 'demo should mount without uncaught errors').toEqual([]);
  });
});

test.describe('cursor movement within the visible frame', () => {
  test('Home and End stay on the same line', async ({ page }) => {
    const { editable, errors } = await open(page);
    await placeCaretOnLine(page, editable, 12, 'click');
    const start = await caret(page);
    await page.keyboard.press('End');
    const atEnd = await caret(page);
    await page.keyboard.press('Home');
    const atHome = await caret(page);

    expect(atEnd.dataLn, 'End keeps the caret on its line').toBe(start.dataLn);
    expect(atHome.dataLn, 'Home keeps the caret on its line').toBe(start.dataLn);
    expect(atEnd.inGap).toBe(false);
    expect(atHome.inGap).toBe(false);
    expect(atHome.atLineStart).toBe(true);
    expect(errors).toEqual([]);
  });

  test('ArrowLeft at the start of a line wraps to the end of the previous line', async ({
    page,
  }) => {
    const { editable, errors } = await open(page);
    await placeCaretOnLine(page, editable, 13, 'start');
    const before = await caret(page);
    await page.keyboard.press('ArrowLeft');
    const after = await caret(page);

    expect(before.dataLn).toBe('13');
    expect(after.inGap, 'ArrowLeft must not strand the caret in an inter-line gap').toBe(false);
    expect(after.dataLn, 'ArrowLeft at line start lands on the previous line').toBe('12');
    expect(errors).toEqual([]);
  });

  test('ArrowRight at the end of a line wraps to the start of the next line', async ({ page }) => {
    const { editable, errors } = await open(page);
    await placeCaretOnLine(page, editable, 13, 'end');
    const before = await caret(page);
    await page.keyboard.press('ArrowRight');
    const after = await caret(page);

    expect(before.dataLn).toBe('13');
    expect(after.inGap, 'ArrowRight must not strand the caret in an inter-line gap').toBe(false);
    expect(after.dataLn, 'ArrowRight at line end lands on the next line').toBe('14');
    expect(errors).toEqual([]);
  });

  test('ArrowDown then ArrowUp moves one real line at a time', async ({ page }) => {
    const { editable, errors } = await open(page);
    await placeCaretOnLine(page, editable, 16, 'click');
    const start = await caret(page);
    await page.keyboard.press('ArrowDown');
    const down = await caret(page);
    await page.keyboard.press('ArrowUp');
    const back = await caret(page);

    expect(start.dataLn).toBe('16');
    expect(down.inGap).toBe(false);
    expect(down.dataLn).toBe('17');
    expect(back.inGap).toBe(false);
    expect(back.dataLn).toBe('16');
    expect(errors).toEqual([]);
  });

  // Typing `x`, then `=`, then Backspace must keep the caret right after the
  // `x`, not send it to the start of the line (a previously-fixed regression).
  test('typing x, =, then Backspace keeps the caret after x', async ({ page }) => {
    const { editable, errors } = await open(page);
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

    const ctx = `caret: ${JSON.stringify({ afterTyping, afterBackspace })}`;
    expect(afterBackspace.position, ctx).toBe(afterTyping.position - 1);
    expect(afterBackspace.prevChar, ctx).toBe('x');
    expect(afterBackspace.atLineStart, ctx).toBe(false);
    expect(errors).toEqual([]);
  });

  test('clicking in the gap between two lines snaps the caret onto a line', async ({ page }) => {
    const { errors } = await open(page);
    // Click just below line 12 — the inter-line gap text node, where a naive
    // contentEditable would strand the caret "between lines".
    const point = await page.evaluate(() => {
      const el = document.querySelector('[contenteditable]') as HTMLElement;
      const line = Array.from(el.querySelectorAll('.line')).find(
        (node) => node.getAttribute('data-ln') === '12',
      )!;
      const rect = line.getBoundingClientRect();
      return { x: rect.right - 2, y: rect.bottom + 0.5 };
    });
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(150);
    const after = await caret(page);

    expect(after.inGap, 'a click in the gap must snap onto a real line').toBe(false);
    expect(['12', '13'], `landed on ${after.dataLn}`).toContain(after.dataLn);
    expect(errors).toEqual([]);
  });
});

test.describe('navigating across empty lines', () => {
  test('ArrowDown/ArrowUp step onto a blank line instead of skipping it', async ({ page }) => {
    const { editable, errors } = await open(page);
    // data-ln 23 is a blank line between `}, [id]);` (22) and `if (!user) {` (24).
    await placeCaretOnLine(page, editable, 22, 'end');
    await page.keyboard.press('ArrowDown');
    const onBlank = await caret(page);
    await page.keyboard.press('ArrowDown');
    const belowBlank = await caret(page);
    await page.keyboard.press('ArrowUp');
    const backOnBlank = await caret(page);

    expect(onBlank.inGap, 'caret must land ON the blank line, not in a gap').toBe(false);
    expect(onBlank.dataLn).toBe('23');
    expect(belowBlank.dataLn).toBe('24');
    expect(backOnBlank.inGap).toBe(false);
    expect(backOnBlank.dataLn).toBe('23');
    expect(errors).toEqual([]);
  });

  test('ArrowUp stops on each of two consecutive empty lines (does not skip both)', async ({
    page,
  }) => {
    const { editable, errors } = await open(page);
    // Turn the single blank line 23 into TWO consecutive blank lines by pressing
    // Enter on it (an empty line has no indent to preserve, so this inserts a
    // truly-empty, zero-height line — the kind native vertical nav skips).
    await placeCaretOnLine(page, editable, 23, 'start');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const afterEnter = await caret(page);
    // Caret is now on the lower of the two blank lines. Step up onto the other.
    await page.keyboard.press('ArrowUp');
    const up1 = await caret(page);
    await page.keyboard.press('ArrowUp');
    const up2 = await caret(page);

    expect(afterEnter.inGap).toBe(false);
    expect(up1.inGap, 'ArrowUp must stop on the first blank line, not skip it').toBe(false);
    // up1 lands on a blank line one row above; up2 lands on the content line above.
    expect(Number(up1.dataLn)).toBe(Number(afterEnter.dataLn) - 1);
    expect(up2.inGap).toBe(false);
    expect(Number(up2.dataLn)).toBe(Number(afterEnter.dataLn) - 2);
    expect(errors).toEqual([]);
  });

  test('ArrowDown stops on each of two consecutive empty lines (does not skip both)', async ({
    page,
  }) => {
    const { editable, errors } = await open(page);
    // Two consecutive blank lines (Enter on the blank line 23), then step DOWN
    // through them starting from the content line above.
    await placeCaretOnLine(page, editable, 23, 'start');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    const top = await caret(page);
    await page.keyboard.press('ArrowDown');
    const down1 = await caret(page);
    await page.keyboard.press('ArrowDown');
    const down2 = await caret(page);

    expect(down1.inGap).toBe(false);
    expect(Number(down1.dataLn)).toBe(Number(top.dataLn) + 1);
    expect(down2.inGap, 'ArrowDown must stop on the second blank line, not skip it').toBe(false);
    expect(Number(down2.dataLn)).toBe(Number(top.dataLn) + 2);
    expect(errors).toEqual([]);
  });
});

test.describe('frame edges', () => {
  test('ArrowUp at the top of the window keeps the caret on a real line', async ({ page }) => {
    const { editable, errors } = await open(page);
    const view = await visibleWindow(page);
    // Click the topmost visible line, then press ArrowUp at the frame edge.
    await placeCaretOnLine(page, editable, Number(view.firstLn), 'click');
    const before = await caret(page);
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(600);
    const after = await caret(page);

    expect(before.dataLn).toBe(view.firstLn);
    expect(
      after.inGap,
      `ArrowUp at the top edge must not strand the caret in a gap (got ${JSON.stringify(after)})`,
    ).toBe(false);
    // It should step up onto the previously-hidden line above the window.
    expect(Number(after.dataLn)).toBe(Number(view.firstLn) - 1);
    expect(errors).toEqual([]);
  });

  test('ArrowUp at the top of the window expands the collapsed region', async ({ page }) => {
    const { editable, errors } = await open(page);
    const before = await visibleWindow(page);
    await placeCaretOnLine(page, editable, Number(before.firstLn), 'click');
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(800);
    const after = await visibleWindow(page);

    expect(
      after.count,
      `ArrowUp at the top edge should reveal more lines (before ${before.count}, after ${after.count})`,
    ).toBeGreaterThan(before.count);
    expect(errors).toEqual([]);
  });

  test('ArrowDown at the bottom of the window keeps the caret on a real line', async ({ page }) => {
    const { editable, errors } = await open(page);
    const view = await visibleWindow(page);
    await placeCaretOnLine(page, editable, Number(view.lastLn), 'click');
    const before = await caret(page);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(600);
    const after = await caret(page);

    expect(before.dataLn).toBe(view.lastLn);
    expect(
      after.inGap,
      `ArrowDown at the bottom edge must not strand the caret in a gap (got ${JSON.stringify(after)})`,
    ).toBe(false);
    expect(Number(after.dataLn)).toBe(Number(view.lastLn) + 1);
    expect(errors).toEqual([]);
  });

  test('ArrowDown at the bottom of the window expands the collapsed region', async ({ page }) => {
    const { editable, errors } = await open(page);
    const before = await visibleWindow(page);
    await placeCaretOnLine(page, editable, Number(before.lastLn), 'click');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(800);
    const after = await visibleWindow(page);

    expect(
      after.count,
      `ArrowDown at the bottom edge should reveal more lines (before ${before.count}, after ${after.count})`,
    ).toBeGreaterThan(before.count);
    expect(errors).toEqual([]);
  });

  test('ArrowLeft at the very start of the top line wraps to the previous line and expands', async ({
    page,
  }) => {
    const { editable, errors } = await open(page);
    const view = await visibleWindow(page);
    // Caret at column 0 of the topmost visible line, then ArrowLeft at the edge.
    await placeCaretOnLine(page, editable, Number(view.firstLn), 'start');
    const before = await caret(page);
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(800);
    const after = await caret(page);
    const afterView = await visibleWindow(page);

    expect(before.dataLn).toBe(view.firstLn);
    expect(
      after.inGap,
      `ArrowLeft at the top edge must not strand the caret in a gap (got ${JSON.stringify(after)})`,
    ).toBe(false);
    // It lands on the (now revealed) previous line — not stuck on the edge line.
    expect(after.dataLn, 'ArrowLeft at the top edge lands on the previous line').toBe(
      String(Number(view.firstLn) - 1),
    );
    expect(afterView.count, 'and the region expands').toBeGreaterThan(view.count);
    expect(errors).toEqual([]);
  });

  test('ArrowRight at the very end of the bottom line wraps to the next line and expands', async ({
    page,
  }) => {
    const { editable, errors } = await open(page);
    const view = await visibleWindow(page);
    await placeCaretOnLine(page, editable, Number(view.lastLn), 'end');
    const before = await caret(page);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(800);
    const after = await caret(page);
    const afterView = await visibleWindow(page);

    expect(before.dataLn).toBe(view.lastLn);
    expect(
      after.inGap,
      `ArrowRight at the bottom edge must not strand the caret in a gap (got ${JSON.stringify(after)})`,
    ).toBe(false);
    expect(after.dataLn, 'ArrowRight at the bottom edge lands on the next line').toBe(
      String(Number(view.lastLn) + 1),
    );
    expect(afterView.count, 'and the region expands').toBeGreaterThan(view.count);
    expect(errors).toEqual([]);
  });

  test('the Expand toggle reveals the hidden lines', async ({ page }) => {
    const { editable, errors } = await open(page);
    const before = await visibleWindow(page);
    const toggle = editable
      .locator('xpath=ancestor::div[contains(@class,"container")][1]')
      .locator('label')
      .first();
    await expect(toggle, 'the Expand/Collapse toggle should be visible').toBeVisible({
      timeout: 6000,
    });
    await toggle.click();
    await page.waitForTimeout(1500);
    const after = await visibleWindow(page);

    expect(
      after.count,
      `Expand should reveal the full source (before ${before.count}, after ${after.count})`,
    ).toBeGreaterThan(before.count);
    expect(errors).toEqual([]);
  });
});

test.describe('expanding and collapsing', () => {
  test('after expanding via ArrowUp, the caret keeps moving up into the revealed lines', async ({
    page,
  }) => {
    const { editable, errors } = await open(page);
    const view = await visibleWindow(page);
    await placeCaretOnLine(page, editable, Number(view.firstLn), 'click');
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(800);
    const up1 = await caret(page);
    // Now expanded: a second ArrowUp must keep stepping up through real lines.
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(200);
    const up2 = await caret(page);

    expect(up1.inGap).toBe(false);
    expect(up1.dataLn).toBe(String(Number(view.firstLn) - 1));
    expect(up2.inGap, 'the caret keeps moving up into revealed content').toBe(false);
    expect(Number(up2.dataLn)).toBe(Number(view.firstLn) - 2);
    expect(errors).toEqual([]);
  });

  test('the toggle expands and then collapses back to the original window', async ({ page }) => {
    const { editable, errors } = await open(page);
    const collapsed = await visibleWindow(page);
    const toggle = editable
      .locator('xpath=ancestor::div[contains(@class,"container")][1]')
      .locator('label')
      .first();

    await toggle.click();
    await page.waitForTimeout(1500);
    const expanded = await visibleWindow(page);

    await toggle.click();
    await page.waitForTimeout(1500);
    const recollapsed = await visibleWindow(page);

    expect(expanded.count, 'expands').toBeGreaterThan(collapsed.count);
    expect(recollapsed.count, 'collapses back to the original window').toBe(collapsed.count);
    expect(errors).toEqual([]);
  });
});

test.describe('editing operations', () => {
  test('the first keystroke is inserted and keeps focus', async ({ page }) => {
    // Bug 4: the first keystroke after engaging the editor used to lose focus.
    const { editable, errors } = await open(page);
    await placeCaretOnLine(page, editable, 12, 'end');
    await page.keyboard.type('Q');
    await page.waitForTimeout(300);
    const after = await caret(page);
    const focused = await page.evaluate(
      () => document.activeElement === document.querySelector('[contenteditable]'),
    );

    expect(focused, 'the editable keeps focus after the first keystroke').toBe(true);
    expect(after.prevChar, 'the character is inserted at the caret').toBe('Q');
    expect(after.dataLn).toBe('12');
    expect(errors).toEqual([]);
  });

  test('Tab indents and Shift+Tab dedents', async ({ page }) => {
    const { editable, errors } = await open(page);
    await placeCaretOnLine(page, editable, 13, 'start');
    const base = await editableTextLength(page);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    const indented = await editableTextLength(page);
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(300);
    const dedented = await editableTextLength(page);

    expect(indented, 'Tab adds one indent unit').toBe(base + 2);
    expect(dedented, 'Shift+Tab removes it again').toBe(base);
    expect(errors).toEqual([]);
  });

  test('forward Delete at the end of a line merges the next line up', async ({ page }) => {
    const { editable, errors } = await open(page);
    await placeCaretOnLine(page, editable, 12, 'end');
    const base = await editableTextLength(page);
    const before = await caret(page);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(400);
    const after = await caret(page);
    const merged = await editableTextLength(page);

    expect(before.dataLn).toBe('12');
    // The line break is removed, so the document loses exactly one character and
    // the caret stays put at the join (not stranded, not jumped).
    expect(merged, 'the line break is deleted').toBe(base - 1);
    expect(after.inGap).toBe(false);
    expect(after.dataLn).toBe('12');
    expect(errors).toEqual([]);
  });

  test('pasting multi-line text inserts every line', async ({ page }) => {
    const { editable, errors } = await open(page);
    await placeCaretOnLine(page, editable, 12, 'end');
    await pasteText(page, 'AAA\nBBB');
    await page.waitForTimeout(500);
    const after = await caret(page);

    await expect(editable).toContainText('AAA');
    await expect(editable).toContainText('BBB');
    expect(after.inGap, 'caret lands inside a real line after paste').toBe(false);
    expect(errors).toEqual([]);
  });

  test('Ctrl+Z undoes and Ctrl+Shift+Z redoes a typed edit', async ({ page }) => {
    const { editable, errors } = await open(page);
    await placeCaretOnLine(page, editable, 12, 'end');
    const base = await editableTextLength(page);
    await page.keyboard.type('Q');
    // Wait past the 500ms undo-coalescing window so the edit is its own step.
    await page.waitForTimeout(700);
    const typed = await editableTextLength(page);

    await page.keyboard.press('ControlOrMeta+z');
    await page.waitForTimeout(500);
    const undone = await editableTextLength(page);

    await page.keyboard.press('ControlOrMeta+Shift+z');
    await page.waitForTimeout(500);
    const redone = await editableTextLength(page);

    expect(typed, 'the character is typed').toBe(base + 1);
    expect(undone, 'Ctrl+Z removes it').toBe(base);
    expect(redone, 'Ctrl+Shift+Z restores it').toBe(base + 1);
    expect(errors).toEqual([]);
  });
});

test.describe('word- and line-granular deletion', () => {
  // The indentation editor routes every plain Backspace through a single-character
  // delete (to tame the Firefox/plaintext-only quirks). A MODIFIED Backspace
  // (Ctrl/Meta/Alt) must instead fall through to the browser's native word/line
  // deletion — mirroring the forward-Delete branch — so a held modifier keeps its
  // OS deletion granularity.
  test('Ctrl+Backspace deletes the whole word before the caret, not one character', async ({
    page,
  }) => {
    const { editable, errors } = await open(page);
    // Type a known word at the end of a line, then word-delete it.
    await placeCaretOnLine(page, editable, 12, 'end');
    await page.keyboard.type(' hello');
    await page.waitForTimeout(600);
    const typed = await editableTextLength(page);
    await page.keyboard.press('ControlOrMeta+Backspace');
    await page.waitForTimeout(400);
    const after = await editableTextLength(page);

    expect(typed - after, 'a whole word is removed in one press').toBeGreaterThanOrEqual(5);
    await expect(
      editable.locator('.line[data-ln="12"]'),
      'the word is gone, not just its last character',
    ).not.toContainText('hello');
    expect(errors).toEqual([]);
  });

  test('plain Backspace still deletes a single character', async ({ page }) => {
    const { editable, errors } = await open(page);
    await placeCaretOnLine(page, editable, 12, 'end');
    await page.keyboard.type(' hello');
    await page.waitForTimeout(600);
    const typed = await editableTextLength(page);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(400);

    expect(typed - (await editableTextLength(page)), 'one character is removed').toBe(1);
    await expect(editable.locator('.line[data-ln="12"]')).toContainText('hell');
    expect(errors).toEqual([]);
  });
});

test.describe('no flash on edits (synchronous reconciliation)', () => {
  test('typing a character does not flash', async ({ page }) => {
    const { editable, errors } = await open(page);
    await placeCaretOnLine(page, editable, 12, 'end');
    const { flashed, records } = await flashDuring(page, async () => {
      await page.keyboard.type('z');
    });
    expect(flashed, `transient flash detected: ${JSON.stringify(records)}`).toBe(false);
    expect(errors).toEqual([]);
  });

  test('backspacing trailing whitespace keeps the caret on the same line', async ({ page }) => {
    const { editable, errors } = await open(page);
    // Make the blank line 23 a whitespace-only line (one indent unit), then
    // erase it. A single Backspace clears the whole unit and empties the line —
    // "removing the last part of a line full of spaces".
    await placeCaretOnLine(page, editable, 23, 'start');
    await page.keyboard.type('  ');
    await page.waitForTimeout(300);
    const filled = await caret(page);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(300);
    const after = await caret(page);

    expect(filled.dataLn).toBe('23');
    expect(after.dataLn, 'Backspace on a space-only line must keep the caret on that line').toBe(
      '23',
    );
    expect(after.inGap).toBe(false);
    expect(errors).toEqual([]);
  });

  test('backspacing trailing whitespace does not flash the line', async ({ page }) => {
    const { editable, errors } = await open(page);
    // One indent unit of whitespace, so the single Backspace below empties the
    // line — the exact moment the browser's default behavior collapses it.
    await placeCaretOnLine(page, editable, 23, 'start');
    await page.keyboard.type('  ');
    await page.waitForTimeout(300);
    const { flashed, records } = await flashDuring(page, async () => {
      await page.keyboard.press('Backspace');
    });
    // The browser's default behavior momentarily collapses the line to empty;
    // the engine must reconcile to the final state synchronously so the user
    // never sees the line blink out and back.
    expect(flashed, `transient flash detected: ${JSON.stringify(records)}`).toBe(false);
    expect(errors).toEqual([]);
  });

  test('backspacing at the start of a line merges into the previous line without flashing', async ({
    page,
  }) => {
    const { editable, errors } = await open(page);
    await placeCaretOnLine(page, editable, 13, 'start');
    const before = await caret(page);
    const { flashed, records } = await flashDuring(page, async () => {
      await page.keyboard.press('Backspace');
    });
    const after = await caret(page);

    expect(before.dataLn).toBe('13');
    expect(flashed, `transient flash detected: ${JSON.stringify(records)}`).toBe(false);
    expect(after.inGap).toBe(false);
    expect(after.dataLn, 'the caret joins the end of the previous line').toBe('12');
    expect(errors).toEqual([]);
  });

  test('backspacing a line up into a BLANK line above does not flash', async ({ page }) => {
    const { editable, errors } = await open(page);
    // Line 11 is the blank padding line directly above the highlight. Backspacing
    // at the start of line 12 merges the highlighted line up into that empty line.
    // The merge momentarily collapses a `.line` until the async re-highlight
    // commits — unless the engine reconciles the merge synchronously. (Distinct
    // from the merge-into-a-non-blank-line case above, which absorbs the text
    // without leaving an extra empty line transiently.)
    await placeCaretOnLine(page, editable, 12, 'start');
    const before = await caret(page);
    const { flashed, records } = await flashDuring(page, async () => {
      await page.keyboard.press('Backspace');
    });
    const after = await caret(page);

    expect(before.dataLn).toBe('12');
    expect(flashed, `transient flash detected: ${JSON.stringify(records)}`).toBe(false);
    expect(after.inGap).toBe(false);
    expect(after.dataLn, 'the caret joins the previously-blank line above').toBe('11');
    expect(errors).toEqual([]);
  });

  test('pressing Enter splits a line onto a new line without flashing', async ({ page }) => {
    const { editable, errors } = await open(page);
    await placeCaretOnLine(page, editable, 13, 'click');
    const before = await caret(page);
    const { flashed, records } = await flashDuring(page, async () => {
      await page.keyboard.press('Enter');
    });
    const after = await caret(page);

    expect(before.dataLn).toBe('13');
    expect(flashed, `transient flash detected: ${JSON.stringify(records)}`).toBe(false);
    expect(after.inGap).toBe(false);
    expect(Number(after.dataLn), 'the caret moves onto the new line').toBe(
      Number(before.dataLn) + 1,
    );
    expect(errors).toEqual([]);
  });

  test('forward Delete that empties a line does not flash', async ({ page }) => {
    const { editable, errors } = await open(page);
    // Whitespace-only line (one indent unit); forward Delete from its start
    // empties it — the same zero-height collapse as the Backspace case, but via
    // the forward-delete path.
    await placeCaretOnLine(page, editable, 23, 'start');
    await page.keyboard.type('  ');
    await page.waitForTimeout(300);
    await page.keyboard.press('Home');
    await page.waitForTimeout(80);
    const { flashed, records } = await flashDuring(page, async () => {
      await page.keyboard.press('Delete');
      await page.keyboard.press('Delete');
    });
    const after = await caret(page);

    expect(flashed, `transient flash detected: ${JSON.stringify(records)}`).toBe(false);
    expect(after.inGap).toBe(false);
    expect(after.dataLn, 'the caret stays on the emptied line').toBe('23');
    expect(errors).toEqual([]);
  });

  test('pasting multi-line text does not flash', async ({ page }) => {
    const { editable, errors } = await open(page);
    await placeCaretOnLine(page, editable, 12, 'end');
    const { flashed, records } = await flashDuring(page, async () => {
      await pasteText(page, 'AAA\nBBB');
    });
    expect(flashed, `transient flash detected: ${JSON.stringify(records)}`).toBe(false);
    expect(errors).toEqual([]);
  });
});

test.describe('selection and clipboard', () => {
  test('Shift+ArrowRight extends the selection within a line', async ({ page }) => {
    const { editable, errors } = await open(page);
    await placeCaretOnLine(page, editable, 12, 'start');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    const selected = await selectionText(page);
    expect(selected.length, 'three characters are selected').toBe(3);
    expect(errors).toEqual([]);
  });

  test('Ctrl+A selects the editable content across multiple lines', async ({ page }) => {
    const { editable, errors } = await open(page);
    await placeCaretOnLine(page, editable, 12, 'click');
    await page.keyboard.press('ControlOrMeta+a');
    const selected = await selectionText(page);
    expect(selected.length, 'selects a large multi-line span').toBeGreaterThan(50);
    expect(selected, 'spans multiple lines').toContain('\n');
    expect(errors).toEqual([]);
  });

  test('copying a selection writes it to the system clipboard (real Ctrl+C)', async ({ page }) => {
    const { editable, errors } = await open(page);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await placeCaretOnLine(page, editable, 13, 'start');
    await page.keyboard.press('Shift+End');
    const selected = await selectionText(page);
    await page.keyboard.press('ControlOrMeta+c');
    await page.waitForTimeout(200);
    const clip = await page.evaluate(() => navigator.clipboard.readText());

    expect(selected.length).toBeGreaterThan(0);
    expect(clip, 'the clipboard holds exactly the selected text').toBe(selected);
    expect(errors).toEqual([]);
  });

  test('copying across lines collapses the browser-duplicated block newline', async ({ page }) => {
    const { errors } = await open(page);
    // The browser serializes each `.line` block with an EXTRA newline; the engine
    // overrides copy to use the range text so each line break appears once.
    const selected = await selectLines(page, 12, 13);
    const copied = await clipboardFromEvent(page, 'copy');

    expect(copied.prevented, 'the engine intercepts copy').toBe(true);
    expect(
      (selected.match(/\n/g) || []).length,
      'the browser selection has a doubled newline',
    ).toBeGreaterThan(1);
    expect(
      (copied.text.match(/\n/g) || []).length,
      'the clipboard has one newline per line break',
    ).toBe(1);
    expect(errors).toEqual([]);
  });

  test('cutting removes the selection and writes it to the clipboard', async ({ page }) => {
    const { editable, errors } = await open(page);
    await placeCaretOnLine(page, editable, 13, 'start');
    await page.keyboard.press('Shift+End');
    const selected = await selectionText(page);
    const before = await editableTextLength(page);

    const cut = await clipboardFromEvent(page, 'cut');
    await page.waitForTimeout(300);
    const after = await editableTextLength(page);

    expect(cut.prevented, 'the engine intercepts cut').toBe(true);
    expect(cut.text, 'the clipboard holds the cut text').toBe(selected);
    expect(after, 'the selected text is removed from the document').toBe(before - selected.length);
    expect(errors).toEqual([]);
  });

  test('pasting over a selection replaces it', async ({ page }) => {
    const { editable, errors } = await open(page);
    await placeCaretOnLine(page, editable, 13, 'start');
    await page.keyboard.press('Shift+End');
    const selected = await selectionText(page);
    const before = await editableTextLength(page);

    await pasteText(page, 'XYZ');
    await page.waitForTimeout(400);
    const after = await editableTextLength(page);

    await expect(editable).toContainText('XYZ');
    expect(after, 'the selection is replaced by the pasted text').toBe(
      before - selected.length + 'XYZ'.length,
    );
    expect(errors).toEqual([]);
  });

  test('Backspace deletes a whole multi-line selection', async ({ page }) => {
    const { errors } = await open(page);
    await selectLines(page, 12, 13);
    const before = await editableTextLength(page);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(400);
    const after = await caret(page);
    const remaining = await editableTextLength(page);

    // Both selected lines (~50 chars) are removed in one keystroke.
    expect(remaining, 'the whole selection is deleted').toBeLessThan(before - 40);
    expect(after.inGap, 'the caret lands on a real line after the delete').toBe(false);
    expect(errors).toEqual([]);
  });
});

test.describe('undo and redo restore the emphasis frames', () => {
  // The `@highlight` region is driven by the comment map, which must travel with
  // the code: an edit that moves the region must move it, and undo/redo must put
  // BOTH the code and the highlighted region back exactly where they were.

  test('inserting a line above the highlight, then undo/redo restores code and highlight', async ({
    page,
  }) => {
    const { editable, errors } = await open(page);
    const initial = await highlightSignature(page);
    const initialLen = await editableTextLength(page);
    expect(initial?.first, 'the useEffect block is highlighted to start').toBe(
      'React.useEffect(() => {',
    );

    // Add a blank line in the padding region above the highlight.
    await placeCaretOnLine(page, editable, 11, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    const edited = await highlightSignature(page);
    const editedLen = await editableTextLength(page);

    await page.keyboard.press('ControlOrMeta+z');
    await page.waitForTimeout(600);
    const undone = await highlightSignature(page);
    const undoneLen = await editableTextLength(page);

    await page.keyboard.press('ControlOrMeta+Shift+z');
    await page.waitForTimeout(600);
    const redone = await highlightSignature(page);
    const redoneLen = await editableTextLength(page);

    // The same code stays highlighted across the insert (it just moves down).
    expect(edited, 'the highlight still wraps the useEffect block').toMatchObject({
      first: 'React.useEffect(() => {',
      last: '}, [id]);',
    });
    // Undo restores both the code and the highlighted region exactly.
    expect(undoneLen, 'undo restores the code').toBe(initialLen);
    expect(undone, 'undo restores the highlighted region').toEqual(initial);
    // Redo re-applies both.
    expect(redoneLen, 'redo restores the code').toBe(editedLen);
    expect(redone, 'redo restores the highlighted region').toEqual(edited);
    expect(errors).toEqual([]);
  });

  test('cutting a line above the highlight, then undo/redo restores code and highlight', async ({
    page,
  }) => {
    const { editable, errors } = await open(page);
    const initial = await highlightSignature(page);
    const initialLen = await editableTextLength(page);

    // Select and cut the padding line directly above the highlight.
    await placeCaretOnLine(page, editable, 10, 'start');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('ControlOrMeta+x');
    await page.waitForTimeout(600);
    const edited = await highlightSignature(page);
    const editedLen = await editableTextLength(page);

    await page.keyboard.press('ControlOrMeta+z');
    await page.waitForTimeout(600);
    const undone = await highlightSignature(page);
    const undoneLen = await editableTextLength(page);

    await page.keyboard.press('ControlOrMeta+Shift+z');
    await page.waitForTimeout(600);
    const redone = await highlightSignature(page);
    const redoneLen = await editableTextLength(page);

    // Cutting above moves the code up but the SAME block stays highlighted.
    expect(edited, 'the highlight still wraps the useEffect block after the cut').toMatchObject({
      first: 'React.useEffect(() => {',
      last: '}, [id]);',
    });
    expect(undoneLen, 'undo restores the cut code').toBe(initialLen);
    expect(undone, 'undo restores the highlighted region').toEqual(initial);
    expect(redoneLen, 'redo re-applies the cut').toBe(editedLen);
    expect(redone, 'redo restores the highlighted region').toEqual(edited);
    expect(errors).toEqual([]);
  });

  test('editing inside the highlight, then undo/redo restores code and highlight', async ({
    page,
  }) => {
    const { editable, errors } = await open(page);
    const initial = await highlightSignature(page);
    const initialLen = await editableTextLength(page);

    // Add a line inside the highlighted block — it should grow the region.
    await placeCaretOnLine(page, editable, 15, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    const edited = await highlightSignature(page);

    await page.keyboard.press('ControlOrMeta+z');
    await page.waitForTimeout(600);
    const undone = await highlightSignature(page);
    const undoneLen = await editableTextLength(page);

    await page.keyboard.press('ControlOrMeta+Shift+z');
    await page.waitForTimeout(600);
    const redone = await highlightSignature(page);

    // The region grew by the inserted line but still starts/ends on the block.
    expect(edited?.count, 'the highlight grows by the inserted line').toBe(
      (initial?.count ?? 0) + 1,
    );
    expect(undoneLen, 'undo restores the code').toBe(initialLen);
    expect(undone, 'undo restores the highlighted region').toEqual(initial);
    expect(redone, 'redo restores the highlighted region').toEqual(edited);
    expect(errors).toEqual([]);
  });

  test('a no-op-line edit above the highlight does not drift the region', async ({ page }) => {
    const { editable, errors } = await open(page);
    const initial = await highlightSignature(page);

    // Typing a character above the highlight changes no line count, so the
    // highlighted region must stay on exactly the same code.
    await placeCaretOnLine(page, editable, 10, 'end');
    await page.keyboard.type('x');
    await page.waitForTimeout(600);
    const edited = await highlightSignature(page);

    expect(edited, 'the highlight must not drift when no line is added or removed').toEqual(
      initial,
    );
    expect(errors).toEqual([]);
  });
});

test.describe('crossing the window fold with non-arrow keys', () => {
  // Arrow keys at the visible edge expand the collapsed window (see "frame
  // edges"). Enter that pushes a new line past the fold, and PageUp/PageDown,
  // must behave the same — never strand the caret in the non-editable padding
  // filler that has no host `.line`.

  test('pressing Enter on the last visible line expands and keeps the caret on a real line', async ({
    page,
  }) => {
    const { editable, errors } = await open(page);
    await placeCaretOnLine(page, editable, 24, 'end'); // bottom visible line
    const before = await caret(page);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    const after = await caret(page);
    const window = await visibleWindow(page);

    expect(before.dataLn).toBe('24');
    expect(after.inGap, 'the caret is not stranded below the fold').toBe(false);
    expect(Number(after.dataLn), 'the caret moves onto the newly inserted line').toBe(25);
    expect(window.expanded, 'the window expands to reveal the new line').toBe(true);
    expect(errors).toEqual([]);
  });

  test('PageDown moves the caret to the bottom edge and expands', async ({ page }) => {
    const { editable, errors } = await open(page);
    await placeCaretOnLine(page, editable, 12, 'start');
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(400);
    const after = await caret(page);
    const window = await visibleWindow(page);

    expect(after.inGap, 'PageDown keeps the caret on a real line').toBe(false);
    expect(after.dataLn, 'the caret lands on the last visible line').toBe('24');
    expect(window.expanded).toBe(true);
    expect(errors).toEqual([]);
  });

  test('PageUp moves the caret to the top edge and expands', async ({ page }) => {
    const { editable, errors } = await open(page);
    await placeCaretOnLine(page, editable, 20, 'start');
    await page.keyboard.press('PageUp');
    await page.waitForTimeout(400);
    const after = await caret(page);
    const window = await visibleWindow(page);

    expect(after.inGap).toBe(false);
    expect(after.dataLn, 'the caret lands on the first visible line').toBe('10');
    expect(window.expanded).toBe(true);
    expect(errors).toEqual([]);
  });
});

test.describe('undo/redo restores the highlight after a structural deletion', () => {
  // Undo/redo reverse the comment-map transform: the engine tags the restored
  // position with its navigation direction so `shiftComments` re-inserts deleted
  // lines after the pre-edit caret (a plain delta can't tell an undo-of-a-merge
  // from forward typing — same caret, same delta — and would drift the region).

  test('forward Delete that merges a highlighted line, then undo/redo, restores the region', async ({
    page,
  }) => {
    const { editable, errors } = await open(page);
    const initial = await highlightSignature(page);
    expect(initial?.first, 'the useEffect block is highlighted to start').toBe(
      'React.useEffect(() => {',
    );
    await placeCaretOnLine(page, editable, 12, 'end');
    await page.keyboard.press('Delete'); // merge the next line up into the first highlighted line
    await page.waitForTimeout(600);
    const edited = await highlightSignature(page);

    await page.keyboard.press('ControlOrMeta+z');
    await page.waitForTimeout(600);
    const undone = await highlightSignature(page);

    await page.keyboard.press('ControlOrMeta+Shift+z');
    await page.waitForTimeout(600);
    const redone = await highlightSignature(page);

    expect(undone, 'undo restores both code and the highlighted region').toEqual(initial);
    expect(redone, 'redo re-applies the merge to the region').toEqual(edited);
    expect(errors).toEqual([]);
  });

  test('select-all, delete, retype, then undo rebuilds the highlight', async ({ page }) => {
    // Deleting a select-all that spans the whole frame REMOVES it (both ends are
    // stashed in the collapseMap), and undo reopens it: the restored caret can
    // land on a different line than the deletion's collapse point, so the engine
    // passes the forward edit's anchor (`historyPivotLine`) to reverse at the
    // right line.
    const { editable, errors } = await open(page);
    const initial = await highlightSignature(page);
    await placeCaretOnLine(page, editable, 12, 'start');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Delete');
    await page.waitForTimeout(300);
    await page.keyboard.type('x');
    await page.waitForTimeout(600);
    await page.keyboard.press('ControlOrMeta+z');
    await page.keyboard.press('ControlOrMeta+z');
    await page.keyboard.press('ControlOrMeta+z');
    await page.waitForTimeout(800);
    const undone = await highlightSignature(page);
    const after = await caret(page);

    expect(undone, 'undo rebuilds the highlighted region').toEqual(initial);
    expect(after.inGap, 'the caret is resolvable again').toBe(false);
    expect(errors).toEqual([]);
  });
});
