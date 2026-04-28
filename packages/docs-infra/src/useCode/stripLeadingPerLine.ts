/**
 * Per-line leading-whitespace utilities. Useful when copying text out
 * of a region whose first `N` columns are visually clipped (an indent
 * gutter, a line-number column, etc.) so the clipboard payload matches
 * what the user sees rather than including the hidden prefix.
 *
 * Each helper takes two budgets:
 *
 * - `firstLineCount` — the budget for the first line. Typically
 *   `max(0, gutterWidth - selectionStartColumn)` so a selection that
 *   begins mid-gutter only loses the gutter portion still inside the
 *   selection.
 * - `restCount` — the budget for every line after a `\n`, normally the
 *   full gutter width.
 */

/**
 * Strip leading whitespace per line from a plain-text string. Returns
 * the trimmed text. Up to `firstLineCount` characters of leading space
 * or tab are removed from the first line, and up to `restCount` from
 * every line after a `\n`.
 */
export const stripLeadingPerLine = (
  text: string,
  firstLineCount: number,
  restCount: number,
): string => {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const budget = i === 0 ? firstLineCount : restCount;
    if (budget <= 0) {
      continue;
    }
    const line = lines[i];
    let stripped = 0;
    while (stripped < budget && stripped < line.length) {
      const ch = line[stripped];
      if (ch !== ' ' && ch !== '\t') {
        break;
      }
      stripped += 1;
    }
    lines[i] = line.slice(stripped);
  }
  return lines.join('\n');
};

/**
 * Mirror of `stripLeadingPerLine` that returns *what was stripped* per
 * line, joined with `\n`. Useful for "lossless cut": the clipboard
 * payload omits the clipped prefix, but the underlying document keeps
 * it by re-inserting the extracted prefix string at the selection
 * location.
 */
export const extractLeadingPerLine = (
  text: string,
  firstLineCount: number,
  restCount: number,
): string => {
  const lines = text.split('\n');
  const prefixes: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const budget = i === 0 ? firstLineCount : restCount;
    if (budget <= 0) {
      prefixes.push('');
      continue;
    }
    const line = lines[i];
    let stripped = 0;
    while (stripped < budget && stripped < line.length) {
      const ch = line[stripped];
      if (ch !== ' ' && ch !== '\t') {
        break;
      }
      stripped += 1;
    }
    prefixes.push(line.slice(0, stripped));
  }
  return prefixes.join('\n');
};

/**
 * DOM-aware variant of `stripLeadingPerLine`: walks every text node
 * under `root` in document order and removes leading whitespace at the
 * start of each logical line. The budget refills to `restCount` after
 * every `\n` and is consumed across consecutive text nodes, so indent
 * nested inside multiple wrapper spans is still removed correctly.
 */
export const stripLeadingPerLineDom = (
  root: Node,
  firstLineCount: number,
  restCount: number,
): void => {
  const ownerDoc = root.ownerDocument ?? document;
  const walker = ownerDoc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let atLineStart = firstLineCount > 0;
  let remaining = firstLineCount;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? '';
    let result = '';
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '\n') {
        atLineStart = restCount > 0;
        remaining = restCount;
        result += ch;
      } else if (atLineStart && remaining > 0 && (ch === ' ' || ch === '\t')) {
        remaining -= 1;
      } else {
        atLineStart = false;
        result += ch;
      }
    }
    node.textContent = result;
  }
};
