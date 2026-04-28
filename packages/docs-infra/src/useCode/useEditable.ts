/*

MIT License

Copyright (c) 2020 Phil Plückthun,
Copyright (c) 2021 Formidable
Copyright (c) 2026 Material-UI SAS

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/

// Forked from https://github.com/FormidableLabs/use-editable
// Changes:
// - Fix linting and formatting
// - Add Tests
// - Replace manual queue-based DFS in makeRange with TreeWalker for better performance
// - Replace Range.toString() in getPosition with a TreeWalker character count to avoid O(N) string allocation
// - Deduplicate toString() calls via trackState return value
// - Fix Firefox rapid-typing line-loss bug: preserve pre-edit pendingContent across keydowns until flush
// - Refresh pendingContent baseline after controlled edits so native input following Enter/Tab/Backspace can still be repaired
// - Record repaired (not raw) content into the undo stack so Firefox merge intermediates don't pollute history
// - Debounce repeat-key flushes so highlights only re-render once the user pauses typing
// - Fix undo-to-initial-state bug: allow trackState to record before the first flushChanges
// - Fix undo-after-rapid-Enter bug: bypass 500ms dedup on keyup for structural edits (Enter)
// - Fix React 19 compatibility: useState lazy init for edit, useRef for MutationObserver, window SSR guard
// - Add `minColumn` option: skip clipped indent gutter via horizontal arrow navigation
// - Add `minRow`/`maxRow`/`onBoundary` options: detect arrow-key navigation past the visible region; allow native movement when `onBoundary` is provided so hosts can expand collapsed regions without losing focus
// - Add `caretSelector` option: when the caret is inside a matching element, `ArrowLeft` at column 0 and `ArrowRight` at the end of a line jump synchronously to the adjacent line so non-selectable gap text nodes (e.g. newlines between `.line` spans) don't trap the caret. Vertical navigation is left to the browser to preserve wrapped-line behavior in `pre-wrap` layouts
// - Override `copy`/`cut` to write `Range.toString()` for `text/plain` (avoiding duplicated newlines from block-level line wrappers like `display: block` `.line` spans separated by literal `\n` text nodes) and a `<pre>`-wrapped clone with computed styles inlined for `text/html` so pasting into rich-text targets (email, Word, Notion, etc.) keeps syntax highlighting without depending on the host stylesheet. When `minColumn` is set, also strips up to that many leading whitespace characters per line from both payloads so the clipped indent gutter doesn't leak into the clipboard

import * as React from 'react';

export interface Position {
  position: number;
  extent: number;
  content: string;
  line: number;
}

type History = [Position, string];

const observerSettings = {
  characterData: true,
  characterDataOldValue: true,
  childList: true,
  subtree: true,
};

const getCurrentRange = (): Range => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    // Internal helper — only called from event handlers and edit methods
    // that have already verified there is an active selection. Throwing
    // here surfaces contract violations early instead of letting them
    // explode further down the call stack.
    throw new Error('useEditable: expected an active selection');
  }
  return selection.getRangeAt(0);
};

const setCurrentRange = (range: Range) => {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  selection.empty();
  selection.addRange(range);
};

/**
 * Narrow a `Node | null` to `Element | null` using a runtime check so
 * downstream code can reason about element-only APIs without a cast.
 */
const asElement = (node: Node | null | undefined): Element | null =>
  node instanceof Element ? node : null;

/**
 * Pull the next element out of a `SHOW_ELEMENT` `TreeWalker` with a
 * runtime check rather than a type cast. Tree walkers configured for
 * `SHOW_ELEMENT` only emit elements in practice, but the DOM type
 * exposes `Node | null`.
 */
const nextElement = (walker: TreeWalker): Element | null => asElement(walker.nextNode());

const isUndoRedoKey = (event: KeyboardEvent): boolean =>
  (event.metaKey || event.ctrlKey) && !event.altKey && event.code === 'KeyZ';

const isPlaintextInputKey = (event: KeyboardEvent): boolean => {
  const usesAltGraph =
    typeof event.getModifierState === 'function' && event.getModifierState('AltGraph');

  return (
    event.key.length === 1 && !event.metaKey && !event.ctrlKey && (!event.altKey || usesAltGraph)
  );
};

// Computed-style properties inlined onto each element in the copied HTML
// fragment so external paste targets render with the same syntax
// highlighting without needing our stylesheet.
const CLIPBOARD_STYLE_PROPS = [
  'color',
  'background-color',
  'font-weight',
  'font-style',
  'text-decoration',
];

// Properties inlined onto the wrapper so the pasted block keeps the
// editable's typography even if only a descendant was selected.
const CLIPBOARD_ROOT_STYLE_PROPS = [
  'font-family',
  'font-size',
  'line-height',
  'white-space',
  'background-color',
  'color',
];
// A small amount of padding + rounded corners gives the pasted snippet a
// card-like appearance in rich-text targets without overriding the
// background or font that consumers already control via the editable's
// own styles.
const CLIPBOARD_ROOT_STATIC_STYLES = 'padding:1em;border-radius:0.5em;';

// Strip leading whitespace characters per line of a plain-text string,
// used to drop the clipped indent gutter (`minColumn`) from clipboard
// payloads so the pasted snippet matches what the user sees.
//
// `firstLineCount` is the budget for the first line — typically
// `max(0, minColumn - startColumn)` so that a selection starting
// mid-gutter only loses the gutter portion still inside the selection.
// `restCount` is the budget for every line after a `\n`, normally the
// full `minColumn`.
const stripLeadingPerLine = (text: string, firstLineCount: number, restCount: number): string => {
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

// Mirror of `stripLeadingPerLine` that returns *what was stripped* per
// line, joined with `\n`. Used by `cut` to re-insert the gutter
// whitespace at the selection location so cut is lossless: the
// clipboard payload omits the clipped indent gutter, but the underlying
// document keeps it.
const extractLeadingPerLine = (text: string, firstLineCount: number, restCount: number): string => {
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

// DOM-aware version of `stripLeadingPerLine`: walks every text node under
// `root` in document order and removes leading whitespace at the start of
// each logical line. The budget refills to `restCount` after every `\n`
// and is consumed across consecutive text nodes so that indent nested
// inside multiple wrapper spans is still removed correctly.
const stripLeadingPerLineDom = (root: Node, firstLineCount: number, restCount: number): void => {
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

const toString = (element: HTMLElement): string => {
  const content = element.textContent || '';

  // contenteditable Quirk: Without plaintext-only a pre/pre-wrap element must always
  // end with at least one newline character
  if (content[content.length - 1] !== '\n') {
    return `${content}\n`;
  }

  return content;
};

interface LineInfo {
  /** Full text of the requested line. */
  currentLine: string;
  /** Full text of `lineIndex - 1`. Empty when `lineIndex <= 0`. */
  prevLine: string;
  /** Full text of `lineIndex + 1`. Empty when there is no next line. */
  nextLine: string;
  /**
   * True when a real line follows `currentLine` — including a blank
   * line. False when the document ends at `currentLine` (matching the
   * old `toString(element).split('\n').slice(0, -1)` semantics where
   * the phantom empty entry after the trailing `\n` does not count as
   * a next line).
   */
  hasNextLine: boolean;
}

/**
 * Walk text nodes to extract the requested line plus its immediate
 * neighbors without materializing the full document text or splitting
 * it into a per-line array. Used by per-keystroke handlers (arrow keys,
 * Backspace, gutter snapping) so they stay O(chars-on-touched-lines)
 * instead of O(document-length) on every event.
 *
 * Walks each text node in document order and slices contiguous segments
 * directly into the relevant accumulator (`prevLine` / `currentLine` /
 * `nextLine`). Skips chunks belonging to lines we don't care about and
 * exits as soon as the trailing `\n` of `lineIndex + 1` is consumed.
 *
 * Mirrors `toString(element).split('\n').slice(0, -1)` semantics:
 *
 * - `hasNextLine` is `true` whenever a real line follows `currentLine`,
 *   even if that line is blank — `"a\n\nb\n"` reports a next line for
 *   row 0. The phantom empty entry that `split` produces after the
 *   document's trailing `\n` is intentionally ignored.
 * - The implicit trailing newline that `toString` appends when the DOM
 *   doesn't end with one has no effect: we walk raw text content.
 */
const getLineInfo = (element: HTMLElement, lineIndex: number): LineInfo => {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let currentLine = '';
  let prevLine = '';
  let nextLine = '';
  let hasNextLine = false;
  let line = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? '';
    let segStart = 0;
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] !== '\n') {
        continue;
      }
      // Flush the segment that lives on `line` before crossing the newline.
      if (segStart < i) {
        const segment = text.slice(segStart, i);
        if (line === lineIndex - 1) {
          prevLine += segment;
        } else if (line === lineIndex) {
          currentLine += segment;
        } else if (line === lineIndex + 1) {
          nextLine += segment;
        }
      }
      // We're about to cross the `\n` that terminates `line`. If `line`
      // is the next line, we've now fully read it and confirmed it
      // exists (a terminator means there is at least one more position
      // in the document past `currentLine`'s end).
      if (line === lineIndex + 1) {
        hasNextLine = true;
        return { currentLine, prevLine, nextLine, hasNextLine };
      }
      line += 1;
      segStart = i + 1;
    }
    // Tail segment of this text node belongs to `line` (no newline yet).
    if (segStart < text.length) {
      const segment = text.slice(segStart);
      if (line === lineIndex - 1) {
        prevLine += segment;
      } else if (line === lineIndex) {
        currentLine += segment;
      } else if (line === lineIndex + 1) {
        // An unterminated tail on `lineIndex + 1` is the document's
        // last (real) line — it counts as a next line. The phantom
        // empty entry produced by `toString`'s trailing `\n` has no
        // tail, so it correctly leaves `hasNextLine` false.
        nextLine += segment;
        hasNextLine = true;
      }
    }
  }
  return { currentLine, prevLine, nextLine, hasNextLine };
};

/**
 * Convert a `(row, column)` coordinate into an absolute character offset
 * by counting newlines through the editable's text nodes, exiting the
 * moment we land on the requested row. Avoids the
 * `toString(element).split('\n').slice(0, row).join('\n').length`
 * round-trip — that pattern allocates the full document string and a
 * full per-line array on every `edit.move({row, column})` call.
 *
 * If the row is past the end of the document, returns the document
 * length plus `column` so the eventual `makeRange` clamps gracefully.
 */
const getOffsetAtLineColumn = (element: HTMLElement, row: number, column: number): number => {
  if (row <= 0) {
    return Math.max(0, column);
  }
  let offset = 0;
  let line = 0;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? '';
    for (let i = 0; i < text.length; i += 1) {
      offset += 1;
      if (text[i] === '\n') {
        line += 1;
        if (line === row) {
          return offset + column;
        }
      }
    }
  }
  return offset + column;
};

const repairUnexpectedLineMerge = (
  newContent: string,
  previousContent: string | null,
  position: Position,
): string => {
  if (previousContent == null || position.extent !== 0) {
    return newContent;
  }

  const previousLines = previousContent.split('\n');
  const nextLines = newContent.split('\n');

  if (nextLines.length >= previousLines.length) {
    return newContent;
  }

  const cursorLine = position.line;

  for (let i = 0; i < cursorLine && i < nextLines.length; i += 1) {
    if (nextLines[i] !== previousLines[i]) {
      return newContent;
    }
  }

  const linesLost = previousLines.length - nextLines.length;
  const mergedPreviousContent = previousLines
    .slice(cursorLine + 1, cursorLine + 1 + linesLost)
    .join('');

  if (!nextLines[cursorLine]?.endsWith(mergedPreviousContent)) {
    return newContent;
  }

  const editedCursorLine = nextLines[cursorLine].slice(
    0,
    nextLines[cursorLine].length - mergedPreviousContent.length,
  );

  if (editedCursorLine === previousLines[cursorLine]) {
    return newContent;
  }

  return [
    ...nextLines.slice(0, cursorLine),
    editedCursorLine,
    ...previousLines.slice(cursorLine + 1, cursorLine + 1 + linesLost),
    ...nextLines.slice(cursorLine + 1),
  ].join('\n');
};

const setStart = (range: Range, node: Node, offset: number) => {
  const length = (node.textContent ?? '').length;
  if (offset < length) {
    range.setStart(node, offset);
  } else {
    range.setStartAfter(node);
  }
};

const setEnd = (range: Range, node: Node, offset: number) => {
  const length = (node.textContent ?? '').length;
  if (offset < length) {
    range.setEnd(node, offset);
  } else {
    range.setEndAfter(node);
  }
};

const getPosition = (element: HTMLElement): Position => {
  const range = getCurrentRange();
  const extent = !range.collapsed ? range.toString().length : 0;

  // Fast path: cursor is in a text node (Chrome/Safari with plaintext-only, and
  // Firefox after edit.insert repositions the cursor). Walk text nodes to count
  // characters without allocating an O(cursor-position) string.
  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let position = 0;
    let line = 0;
    let lineContent = '';

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      const isTarget = node === range.startContainer;
      const upTo = isTarget ? range.startOffset : text.length;

      let segStart = 0;
      for (let i = 0; i < upTo; i += 1) {
        if (text[i] === '\n') {
          line += 1;
          lineContent = '';
          segStart = i + 1;
        }
      }
      lineContent += text.slice(segStart, upTo);
      position += upTo;

      if (isTarget) {
        break;
      }
    }

    return { position, extent, content: lineContent, line };
  }

  // Firefox fallback: cursor may be at an element boundary (e.g. after a click
  // before any edit). Use Range.toString() to extract the pre-cursor text.
  // Firefox Quirk: Since plaintext-only is unsupported, the selection can land
  // on element nodes rather than text nodes.
  const untilRange = document.createRange();
  untilRange.setStart(element, 0);
  untilRange.setEnd(range.startContainer, range.startOffset);
  let content = untilRange.toString();
  const position = content.length;
  const lines = content.split('\n');
  const line = lines.length - 1;
  content = lines[line];
  return { position, extent, content, line };
};

const makeRange = (element: HTMLElement, start: number, end?: number): Range => {
  if (start <= 0) {
    start = 0;
  }
  if (!end || end < 0) {
    end = start;
  }

  const range = document.createRange();
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let current = 0;
  let position = start;

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = (node.textContent ?? '').length;
    if (current + length >= position) {
      const offset = position - current;
      if (position === start) {
        setStart(range, node, offset);
        if (end === start) {
          break;
        }
        position = end;
        if (current + length >= position) {
          setEnd(range, node, position - current);
          break;
        }
        // end is in a later node — fall through to advance current
      } else {
        setEnd(range, node, offset);
        break;
      }
    }
    current += length;
  }

  return range;
};

/** Walk to the next text node in document order without allocating a TreeWalker. */
const nextTextNode = (node: Node): Node | null => {
  let current: Node | null = node;
  // Walk up and across siblings until we find a branch to descend into.
  while (current) {
    if (current.nextSibling) {
      current = current.nextSibling;
      // Descend to the first text node.
      while (current.firstChild) {
        current = current.firstChild;
      }
      if (current.nodeType === Node.TEXT_NODE) {
        return current;
      }
      // Not a text leaf — continue walking siblings from here.
      continue;
    }
    current = current.parentNode;
  }
  return null;
};

/**
 * After makeRange positions a collapsed cursor at a newline boundary via
 * setStartAfter(textNode), the cursor ends up inside the *previous* line span
 * (after the '\n').  This adjusts the range forward to offset 0 of the
 * next text node so the cursor renders on the correct visual line.
 */
const adjustCursorAtNewlineBoundary = (range: Range): void => {
  if (!range.collapsed) {
    return;
  }

  const { startContainer, startOffset } = range;
  const startText = startContainer.textContent ?? '';

  // Case 1: cursor is in a text node at the very end and that text ends with '\n'
  if (
    startContainer.nodeType === Node.TEXT_NODE &&
    startOffset === startText.length &&
    startText.endsWith('\n')
  ) {
    const next = nextTextNode(startContainer);
    if (next) {
      range.setStart(next, 0);
      range.collapse(true);
    }
    return;
  }

  // Case 2: cursor is at an element boundary where the previous child is a
  // text node ending with '\n' (happens when setStartAfter places us here)
  if (startContainer.nodeType === Node.ELEMENT_NODE && startOffset > 0) {
    const prevChild = startContainer.childNodes[startOffset - 1];
    const prevText = prevChild?.textContent ?? '';
    if (prevChild?.nodeType === Node.TEXT_NODE && prevText.endsWith('\n')) {
      const next = nextTextNode(prevChild);
      if (next) {
        range.setStart(next, 0);
        range.collapse(true);
      }
    }
  }
};

interface State {
  disconnected: boolean;
  onChange(text: string, position: Position): void;
  pendingContent: string | null;
  queue: MutationRecord[];
  history: History[];
  historyAt: number;
  position: Position | null;
  /** setTimeout id used to debounce flushChanges() calls during key-repeat */
  repeatFlushId: ReturnType<typeof setTimeout> | null;
  /**
   * Set when an arrow-key handler invokes `onBoundary` (which typically
   * triggers a host re-render to expand a collapsed region). The native
   * arrow-key default action moves the caret AFTER our keydown handler
   * returns, but the host's re-render commits BEFORE the resulting
   * `selectionchange` updates `state.position`. Without this flag, the
   * unconditional restore effect would snap the caret back to the stale
   * pre-arrow `state.position` on that intermediate render. The flag is
   * cleared after one skipped restore.
   */
  skipNextRestore: boolean;
}

export interface Options {
  disabled?: boolean;
  indentation?: number;
  /**
   * Minimum column the cursor is allowed to occupy on indented lines.
   *
   * When set, horizontal arrow navigation skips over the leading whitespace
   * up to `minColumn` so the caret never lands inside a clipped/hidden
   * indent region:
   *
   * - `ArrowLeft` at column `minColumn` (with that line's first `minColumn`
   *   characters all whitespace) jumps to the end of the previous line
   *   instead of stepping into the indent.
   * - `ArrowRight` at the end of a line jumps to column `minColumn` of the
   *   next line (when the next line is indented at least that far) instead
   *   of landing at column 0.
   *
   * Useful when the editor is rendered in a horizontally-shifted view (for
   * example a collapsed code block whose left padding is translated off
   * screen) where columns below `minColumn` are not visible. Leave
   * `undefined` for default arrow-key behavior.
   */
  minColumn?: number;
  /**
   * First row of the visible region. When set, `ArrowUp` on this row and
   * `ArrowLeft` at the start of this row are blocked (no caret movement)
   * and `onBoundary` is invoked. Useful when content above the visible
   * region is hidden and the host wants a chance to reveal it.
   */
  minRow?: number;
  /**
   * Last row of the visible region. When set, `ArrowDown` on this row and
   * `ArrowRight` at the end of this row are blocked (no caret movement)
   * and `onBoundary` is invoked.
   */
  maxRow?: number;
  /**
   * Called when the user attempts to navigate past `minRow`/`maxRow` via
   * arrow keys. When `onBoundary` is provided, the navigation is allowed
   * to proceed natively so the host can react (e.g. expand a collapsed
   * code block) and the caret continues moving in the now-visible
   * content. When `onBoundary` is omitted, the navigation is blocked
   * (caret stays put).
   */
  onBoundary?: () => void;
  /**
   * CSS selector identifying the elements that represent selectable
   * "lines" inside the editable. When set, and only while the caret is
   * actually inside an element matching the selector:
   *
   * - `ArrowLeft` at column 0 jumps synchronously to the end of the
   *   previous line.
   * - `ArrowRight` at the end of a line jumps synchronously to the start
   *   of the next line.
   *
   * Useful when the editable contains intentionally-empty whitespace
   * text nodes between block-level children (e.g. newline text nodes
   * separating `.line` spans inside a `.frame`). Without this, the
   * browser would place the caret in those gap nodes on horizontal
   * navigation, making `ArrowLeft`/`ArrowRight` appear to no-op.
   *
   * Vertical navigation (`ArrowUp`/`ArrowDown`) is intentionally left to
   * the browser so wrapped visual lines in `pre-wrap` layouts continue
   * to behave natively. Gap nodes styled with `line-height: 0` are
   * skipped by browsers vertically without intervention.
   *
   * The selector is matched against the caret's containing element via
   * `Element.closest`, so non-`.line` render paths (e.g. plain-string
   * editables) never trigger the wrap behavior.
   */
  caretSelector?: string;
}

export interface Edit {
  /** Replaces the entire content of the editable while adjusting the caret position. */
  update(content: string): void;
  /** Inserts new text at the caret position while deleting text in range of the offset (which accepts negative offsets). */
  insert(append: string, offset?: number): void;
  /** Positions the caret where specified */
  move(pos: number | { row: number; column: number }): void;
  /** Returns the current editor state, as usually received in onChange */
  getState(): { text: string; position: Position };
}

export const useEditable = (
  elementRef: { current: HTMLElement | undefined | null },
  onChange: (text: string, position: Position) => void,
  opts?: Options,
): Edit => {
  // Normalize once into a non-optional local so closures (effects, the
  // edit object, event handlers) can read `config.X` directly without
  // any non-null assertions on `opts`.
  const config: Options = opts ?? {};

  const unblock = React.useState([])[1];
  const state = React.useState<State>(() => ({
    disconnected: false,
    onChange,
    pendingContent: null,
    queue: [],
    history: [],
    historyAt: -1,
    position: null,
    repeatFlushId: null,
    skipNextRestore: false,
  }))[0];

  // MutationObserver is created once via useRef so it is never recreated on
  // re-render and is not subject to React Strict Mode double-invocation of
  // useState initializers (which would silently discard the first observer).
  const observerRef = React.useRef<MutationObserver | null>(null);
  if (observerRef.current === null && typeof MutationObserver !== 'undefined') {
    observerRef.current = new MutationObserver((batch) => {
      state.queue.push(...batch);
    });
  }

  // The visible-region bounds (`minColumn`/`minRow`/`maxRow`/`onBoundary`)
  // and `caretSelector` only affect handler logic, not the contentEditable
  // setup itself. We mirror them in a ref so the handlers always read the
  // latest values, while keeping these values out of the main effect's deps.
  // Listing them as deps would tear down and re-bind contentEditable every
  // time they change (e.g. when a host expands a collapsed code block),
  // which causes the browser to drop focus mid-animation.
  const boundsRef = React.useRef({
    minColumn: config.minColumn,
    minRow: config.minRow,
    maxRow: config.maxRow,
    onBoundary: config.onBoundary,
    caretSelector: config.caretSelector,
  });
  boundsRef.current.minColumn = config.minColumn;
  boundsRef.current.minRow = config.minRow;
  boundsRef.current.maxRow = config.maxRow;
  boundsRef.current.onBoundary = config.onBoundary;
  boundsRef.current.caretSelector = config.caretSelector;

  // useMemo with [] is a performance hint, not a semantic guarantee — React 19
  // may discard the cache and recreate the object. useState with a lazy
  // initializer is the correct primitive for a referentially stable object.
  const [edit] = React.useState<Edit>(() => ({
    update(content: string) {
      const { current: element } = elementRef;
      if (element) {
        const position = getPosition(element);
        const prevContent = toString(element);
        position.position += content.length - prevContent.length;
        state.position = position;
        state.onChange(content, position);
      }
    },
    insert(append: string, deleteOffset?: number) {
      const { current: element } = elementRef;
      if (element) {
        let range = getCurrentRange();
        range.deleteContents();
        range.collapse();
        const position = getPosition(element);
        const offset = deleteOffset || 0;
        const start = position.position + (offset < 0 ? offset : 0);
        const end = position.position + (offset > 0 ? offset : 0);
        range = makeRange(element, start, end);
        adjustCursorAtNewlineBoundary(range);
        range.deleteContents();
        if (append) {
          range.insertNode(document.createTextNode(append));
        }
        const cursorRange = makeRange(element, start + append.length);
        adjustCursorAtNewlineBoundary(cursorRange);
        setCurrentRange(cursorRange);
      }
    },
    move(pos: number | { row: number; column: number }) {
      const { current: element } = elementRef;
      if (element) {
        element.focus();
        const position =
          typeof pos === 'number' ? pos : getOffsetAtLineColumn(element, pos.row, pos.column);
        const cursorRange = makeRange(element, position);
        adjustCursorAtNewlineBoundary(cursorRange);
        setCurrentRange(cursorRange);
      }
    },
    getState() {
      const element = elementRef.current;
      if (!element) {
        // Pre-mount / unmounted: return an empty snapshot so callers
        // that subscribe before the ref is attached get a stable shape.
        return {
          text: '',
          position: { position: 0, extent: 0, content: '', line: 0 },
        };
      }
      return { text: toString(element), position: getPosition(element) };
    },
  }));

  React.useLayoutEffect(() => {
    // Only for SSR / server-side logic
    // typeof navigator check fails on Node.js 21+ which exposes navigator.userAgent;
    // typeof window is the standard isomorphic SSR guard.
    if (typeof window === 'undefined') {
      return undefined;
    }

    state.onChange = onChange;

    if (!elementRef.current || config.disabled) {
      return undefined;
    }

    state.disconnected = false;
    observerRef.current?.observe(elementRef.current, observerSettings);
    // Skip restoring the cursor while a key is held down. The debounced
    // flushChanges hasn't run yet so state.position is stale; restoring it
    // here would jump the cursor back on every incidental re-render (e.g.
    // from an async enhancer setState). edit.insert() already placed the
    // cursor correctly in the DOM — leave it there until the debounce fires.
    //
    // Also skip on the render right after an arrow-key boundary callback
    // (see `state.skipNextRestore`): the native arrow movement hasn't
    // applied yet, so `state.position` is the pre-arrow location and
    // restoring it would visibly snap the caret back upward/downward.
    if (state.skipNextRestore) {
      state.skipNextRestore = false;
    } else if (state.position && state.repeatFlushId === null) {
      const { position, extent } = state.position;
      const cursorRange = makeRange(elementRef.current, position, position + extent);
      adjustCursorAtNewlineBoundary(cursorRange);
      setCurrentRange(cursorRange);
    }

    return () => {
      observerRef.current?.disconnect();
    };
  });

  React.useLayoutEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    if (!elementRef.current || config.disabled) {
      state.history.length = 0;
      state.historyAt = -1;
      return undefined;
    }

    const element = elementRef.current;
    if (!element) {
      return undefined;
    }
    if (state.position) {
      element.focus();
      const { position, extent } = state.position;
      const cursorRange = makeRange(element, position, position + extent);
      adjustCursorAtNewlineBoundary(cursorRange);
      setCurrentRange(cursorRange);
    }

    const prevWhiteSpace = element.style.whiteSpace;
    const prevContentEditable = element.contentEditable;
    let hasPlaintextSupport = true;
    try {
      // Firefox and IE11 do not support plaintext-only mode
      element.contentEditable = 'plaintext-only';
    } catch (_error) {
      element.contentEditable = 'true';
      hasPlaintextSupport = false;
    }

    if (prevWhiteSpace !== 'pre') {
      element.style.whiteSpace = 'pre-wrap';
    }

    if (config.indentation) {
      const tabSizeValue = `${config.indentation}`;
      element.style.setProperty('-moz-tab-size', tabSizeValue);
      element.style.tabSize = tabSizeValue;
    }

    const indentPattern = `${' '.repeat(config.indentation || 0)}`;
    const indentRe = new RegExp(`^(?:${indentPattern})`);
    const blanklineRe = new RegExp(`^(?:${indentPattern})*(${indentPattern})$`);

    let trackStateTimestamp: number;
    const trackState = (
      ignoreTimestamp?: boolean,
      contentOverride?: string,
      positionOverride?: Position,
    ): string | null => {
      // Require a live selection so getPosition() (which calls getRangeAt(0)) is safe.
      // Using !state.position would block recording the initial state: state.position is
      // only set by flushChanges() which runs on keyup — after the first edit. Switching
      // to rangeCount === 0 lets the very first keydown snapshot the pre-edit content.
      if (!elementRef.current || (window.getSelection()?.rangeCount ?? 0) === 0) {
        return null;
      }

      // Callers may pass in already-computed (and possibly repaired) content so
      // we don't re-read a buggy intermediate DOM. flushChanges uses this to
      // record the repaired post-edit state instead of the merged DOM that
      // Firefox/observer left behind.
      const content = contentOverride ?? toString(element);
      const position = positionOverride ?? getPosition(element);
      const timestamp = new Date().valueOf();

      // Prevent recording new state in list if last one has been new enough
      const lastEntry = state.history[state.historyAt];
      if (
        (!ignoreTimestamp && timestamp - trackStateTimestamp < 500) ||
        (lastEntry && lastEntry[1] === content)
      ) {
        trackStateTimestamp = timestamp;
        return content;
      }

      state.historyAt += 1;
      const at = state.historyAt;
      state.history[at] = [position, content];
      state.history.splice(at + 1);
      if (at > 500) {
        state.historyAt -= 1;
        state.history.shift();
      }
      return content;
    };

    const disconnect = () => {
      observerRef.current?.disconnect();
      state.disconnected = true;
    };

    const flushChanges = (ignoreTimestamp?: boolean) => {
      const records = observerRef.current?.takeRecords() ?? [];
      state.queue.push(...records);
      const position = getPosition(element);
      if (state.queue.length) {
        disconnect();
        const content = repairUnexpectedLineMerge(
          toString(element),
          state.pendingContent,
          position,
        );
        state.position = position;
        while (state.queue.length > 0) {
          const mutation = state.queue.pop();
          if (!mutation) {
            break;
          }
          if (mutation.oldValue !== null) {
            mutation.target.textContent = mutation.oldValue;
          }
          for (let i = mutation.removedNodes.length - 1; i >= 0; i -= 1) {
            mutation.target.insertBefore(mutation.removedNodes[i], mutation.nextSibling);
          }
          for (let i = mutation.addedNodes.length - 1; i >= 0; i -= 1) {
            if (mutation.addedNodes[i].parentNode) {
              mutation.target.removeChild(mutation.addedNodes[i]);
            }
          }
        }

        // Record the REPAIRED content into history before notifying the app.
        // Reading toString() back from the DOM here would capture the buggy
        // pre-repair state (e.g. a Firefox line-merge), which is what was
        // previously polluting the undo stack.
        trackState(ignoreTimestamp, content, position);

        state.onChange(content, position);
      }

      state.pendingContent = null;
    };

    // Snap a collapsed caret out of an inter-line gap text node (e.g. the
    // literal `\n` between `.line` spans) onto the nearest `.line` in
    // `direction`. Used by both the post-arrow rAF and the pointer
    // handlers — clicks can land in gap nodes too. When `isVertical`, the
    // caret lands at `preferredColumn` of the target line (clamped);
    // otherwise it lands at the start (forward) or end (backward).
    // Returns `true` when a snap was applied.
    const snapCaretOutOfGapNode = (
      direction: 'forward' | 'backward',
      isVertical: boolean,
      preferredColumn: number,
    ): boolean => {
      const { caretSelector } = boundsRef.current;
      if (caretSelector === undefined) {
        return false;
      }
      const sel = element.ownerDocument.defaultView?.getSelection();
      if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) {
        return false;
      }
      const snapRange = sel.getRangeAt(0);
      if (!element.contains(snapRange.startContainer)) {
        return false;
      }
      const startContainer = snapRange.startContainer;
      const startElement = asElement(startContainer) ?? startContainer.parentElement;
      // Caret is already inside a `.line` (or equivalent) — no snap needed.
      if (startElement?.closest(caretSelector)) {
        return false;
      }
      const lineEls = Array.from(element.querySelectorAll(caretSelector));
      if (lineEls.length === 0) {
        return false;
      }
      // Use document position to pick the right neighbour.
      let target: Element | null = null;
      if (direction === 'forward') {
        for (let i = 0; i < lineEls.length; i += 1) {
          const r = element.ownerDocument.createRange();
          r.selectNode(lineEls[i]);
          // cmp < 0 means the caret is before this line.
          if (snapRange.compareBoundaryPoints(Range.START_TO_START, r) < 0) {
            target = lineEls[i];
            break;
          }
        }
        // No line ahead — caret has landed past the last line. Snap back
        // to the last line so the caret stays inside an editable row.
        if (!target) {
          target = lineEls[lineEls.length - 1];
        }
      } else {
        for (let i = lineEls.length - 1; i >= 0; i -= 1) {
          const r = element.ownerDocument.createRange();
          r.selectNode(lineEls[i]);
          // cmp > 0 means the caret is after this line.
          if (snapRange.compareBoundaryPoints(Range.END_TO_END, r) > 0) {
            target = lineEls[i];
            break;
          }
        }
        // No line behind — caret has landed before the first line.
        if (!target) {
          target = lineEls[0];
        }
      }
      if (!target) {
        return false;
      }
      const newRange = element.ownerDocument.createRange();
      if (isVertical) {
        // Walk the target line's text nodes to find the offset that
        // matches `preferredColumn`, clamping to the line length.
        const targetText = target.textContent ?? '';
        const targetColumn = Math.min(preferredColumn, targetText.length);
        let remaining = targetColumn;
        const walker = element.ownerDocument.createTreeWalker(target, NodeFilter.SHOW_TEXT);
        let placed = false;
        let node = walker.nextNode();
        while (node) {
          const len = node.textContent?.length ?? 0;
          if (remaining <= len) {
            newRange.setStart(node, remaining);
            newRange.collapse(true);
            placed = true;
            break;
          }
          remaining -= len;
          node = walker.nextNode();
        }
        if (!placed) {
          newRange.selectNodeContents(target);
          newRange.collapse(false);
        }
      } else if (direction === 'forward') {
        newRange.selectNodeContents(target);
        newRange.collapse(true);
      } else {
        newRange.selectNodeContents(target);
        newRange.collapse(false);
      }
      sel.removeAllRanges();
      sel.addRange(newRange);
      return true;
    };

    // Snap a collapsed caret out of the clipped indent gutter (`[0, minColumn)`)
    // when the user clicks there. The arrow-key handler already prevents
    // landing inside the gutter via keyboard navigation; this covers
    // pointer-driven clicks. Range selections are left alone — clamping the
    // anchor of a drag would feel surprising mid-gesture.
    const snapCaretOutOfGutter = () => {
      const { minColumn } = boundsRef.current;
      if (minColumn === undefined || minColumn <= 0) {
        return;
      }
      const sel = element.ownerDocument.defaultView?.getSelection();
      if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) {
        return;
      }
      const range = sel.getRangeAt(0);
      if (!element.contains(range.startContainer)) {
        return;
      }
      const position = getPosition(element);
      if (position.content.length >= minColumn) {
        return;
      }
      // Only snap when the gutter is actually whitespace — otherwise the
      // line is shorter than `minColumn` and there's nowhere to snap to.
      // `getLineInfo` walks just enough text nodes to read the current
      // line; avoids materializing the full document text on every click.
      const lineText = getLineInfo(element, position.line).currentLine;
      if (lineText.length < minColumn || !/^\s*$/.test(lineText.slice(0, minColumn))) {
        return;
      }
      edit.move({ row: position.line, column: minColumn });
    };

    const onKeyDown = (event: HTMLElementEventMap['keydown']) => {
      if (event.defaultPrevented || event.target !== element) {
        return;
      }
      if (state.disconnected) {
        // React Quirk: between flushChanges() (which calls disconnect() and
        // rewinds the DOM back to the pre-edit content) and React's commit
        // (which re-observes via useLayoutEffect and restores state.position),
        // an event can fire that we'd otherwise mishandle.
        //
        // For NAVIGATION keys (arrows) the DOM revert is irrelevant — the
        // browser only needs a valid caret position to compute the next
        // selection — so resync inline (restore caret + re-observe) and let
        // the event proceed. Otherwise the keystroke would be eaten and the
        // user would lose, for example, an ArrowUp step after Enter inside
        // a focus frame. We deliberately do NOT include Home/End/PageUp/
        // PageDown here: they would also need to compensate for the pending
        // rerender (matching the arrow-key skip-next-restore handling) and
        // currently lack that coverage, so keep them on the safe path.
        //
        // For EDITING keys (printable text, Enter, Tab, Backspace, Delete,
        // …) we must NOT fall through: the live DOM is the reverted
        // pre-edit snapshot, so applying a second edit on top would target
        // the wrong text and corrupt content. Keep the original block-and-
        // unblock behavior for those keys — React will commit the queued
        // onChange momentarily and the user can re-issue the keystroke.
        const isArrowKey =
          event.key === 'ArrowLeft' ||
          event.key === 'ArrowRight' ||
          event.key === 'ArrowUp' ||
          event.key === 'ArrowDown';
        if (!isArrowKey) {
          event.preventDefault();
          unblock([]);
          return;
        }
        if (state.position && state.repeatFlushId === null) {
          const { position, extent } = state.position;
          const cursorRange = makeRange(element, position, position + extent);
          adjustCursorAtNewlineBoundary(cursorRange);
          setCurrentRange(cursorRange);
        }
        observerRef.current?.observe(element, observerSettings);
        state.disconnected = false;
        // The `unblock([])` below schedules a React rerender. If that
        // rerender's restore effect runs before the native arrow movement
        // has updated `state.position` (which happens asynchronously via
        // `selectionchange`), the restore would snap the caret back to the
        // stale pre-arrow position. In practice `selectionchange` usually
        // fires first so the restore is a no-op, but arming the skip flag
        // makes the fast path race-free regardless of scheduling. The
        // boundary-movement branches arm the same flag for the same reason.
        state.skipNextRestore = true;
        unblock([]);
        // Fall through and let this arrow event be handled normally
        // with the restored caret position.
      }

      if (isUndoRedoKey(event)) {
        event.preventDefault();

        let history: History;
        if (!event.shiftKey) {
          state.historyAt -= 1;
          const at = state.historyAt;
          history = state.history[at];
          if (!history) {
            state.historyAt = 0;
          }
        } else {
          state.historyAt += 1;
          const at = state.historyAt;
          history = state.history[at];
          if (!history) {
            state.historyAt = state.history.length - 1;
          }
        }

        if (history) {
          disconnect();
          state.position = history[0];
          state.onChange(history[1], history[0]);
        }
        return;
      }

      // Only capture the pre-edit snapshot when no edit is currently pending
      // (i.e. the previous keystroke has already been flushed on keyup).
      // Overwriting pendingContent on a rapid second keydown — whether the
      // same key repeating OR a different key pressed before the first
      // keyup — would lose the baseline that repairUnexpectedLineMerge
      // needs to detect Firefox's line-merge quirk. The DOM may already
      // contain a merged state when the second keydown fires; treating that
      // as "previous" content makes the line-loss invisible.
      if (state.pendingContent === null) {
        state.pendingContent = trackState() ?? toString(element);
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        // Firefox Quirk: Since plaintext-only is unsupported we must
        // ensure that only newline characters are inserted
        const position = getPosition(element);
        // We also get the current line and preserve indentation for the next
        // line that's created
        const match = /\S/g.exec(position.content);
        const index = match ? match.index : position.content.length;
        const text = `\n${position.content.slice(0, index)}`;
        edit.insert(text);
      } else if (!hasPlaintextSupport && !event.isComposing && isPlaintextInputKey(event)) {
        // Firefox Quirk: native typing in contentEditable="true" can insert
        // directly into the frame wrapper before the current line span.
        // Route plain text input through the controlled insert path instead.
        event.preventDefault();
        edit.insert(event.key);
      } else if ((!hasPlaintextSupport || config.indentation) && event.key === 'Backspace') {
        // Firefox Quirk: Since plaintext-only is unsupported we must
        // ensure that only a single character is deleted
        event.preventDefault();
        const range = getCurrentRange();
        if (!range.collapsed) {
          edit.insert('', 0);
        } else {
          const position = getPosition(element);
          const { minColumn } = boundsRef.current;
          // When the caret sits at `minColumn` on a blank (whitespace-only)
          // line inside a clipped indent gutter, a normal Backspace would
          // step into `[0, minColumn)` — visually invisible to the user
          // since that range is hidden by the host. The user has nothing
          // useful to delete on this line, so collapse the entire blank
          // line and land the caret at the end of the previous line. This
          // matches the mental model: "Backspace from an empty indented
          // line removes the line."
          //
          // Walk only enough text nodes to read the current line — we
          // don't need the rest of the document on every Backspace.
          const couldCollapse =
            minColumn !== undefined &&
            minColumn > 0 &&
            position.line > 0 &&
            position.content.length === minColumn &&
            /^\s*$/.test(position.content);
          if (couldCollapse && minColumn !== undefined) {
            // The redundant `minColumn !== undefined` check pins TS's
            // narrowing across the boundary so we can use `minColumn`
            // as a number directly without an assertion.
            const fullLine = getLineInfo(element, position.line).currentLine;
            if (fullLine.length === minColumn && /^\s*$/.test(fullLine)) {
              edit.insert('', -(minColumn + 1));
              return;
            }
          }
          const match = blanklineRe.exec(position.content);
          edit.insert('', match ? -match[1].length : -1);
        }
      } else if (config.indentation && event.key === 'Tab') {
        event.preventDefault();
        const position = getPosition(element);
        const start = position.position - position.content.length;
        const content = toString(element);
        const newContent = event.shiftKey
          ? content.slice(0, start) +
            position.content.replace(indentRe, '') +
            content.slice(start + position.content.length)
          : content.slice(0, start) +
            (config.indentation ? ' '.repeat(config.indentation) : '\t') +
            content.slice(start);
        edit.update(newContent);
      } else if (
        (boundsRef.current.minColumn !== undefined ||
          boundsRef.current.minRow !== undefined ||
          boundsRef.current.maxRow !== undefined ||
          boundsRef.current.caretSelector !== undefined) &&
        !event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        (event.key === 'ArrowLeft' ||
          event.key === 'ArrowRight' ||
          event.key === 'ArrowUp' ||
          event.key === 'ArrowDown')
      ) {
        // Arrow-key navigation that respects the visible region:
        // - `minColumn`: skip over hidden/clipped leading indent so the
        //   caret never lands before `minColumn` via horizontal navigation.
        // - `minRow`/`maxRow`: block navigation past the visible row range
        //   and invoke `onBoundary` so the host can react (e.g. expand).
        // - `caretSelector`: when set, the editable contains non-selectable
        //   gap text nodes between lines; handle horizontal line-wrap
        //   ourselves so `ArrowLeft` at column 0 lands at the end of the
        //   previous line synchronously (without flashing through the gap).
        // Only acts on a collapsed selection — let the browser handle range
        // expansion when a modifier is held or text is already selected.
        const range = getCurrentRange();
        if (range.collapsed) {
          const { minColumn, minRow, maxRow, onBoundary, caretSelector } = boundsRef.current;
          const position = getPosition(element);
          const column = position.content.length;
          // Walk just enough of the document to gather the current line
          // and its immediate neighbors instead of allocating the entire
          // document string and a full per-line array on every keypress.
          const {
            currentLine: lineText,
            prevLine,
            nextLine,
            hasNextLine,
          } = getLineInfo(element, position.line);
          const lineIsIndented =
            minColumn !== undefined &&
            lineText.length >= minColumn &&
            /^\s*$/.test(lineText.slice(0, minColumn));
          const atVisibleStart = minRow !== undefined && position.line === minRow;
          const atVisibleEnd = maxRow !== undefined && position.line === maxRow;
          const atLineStart =
            column === 0 || (lineIsIndented && minColumn !== undefined && column === minColumn);
          const atLineEnd = column === lineText.length;

          // For caretSelector wrap, also confirm the caret is currently
          // *inside* an element matching the selector. This keeps the wrap
          // scoped to render paths that actually have inter-line gap nodes
          // (e.g. highlighted `.line` spans) and leaves plain-text editables
          // — where the browser handles arrows fine — untouched.
          const caretInLine =
            caretSelector !== undefined &&
            (() => {
              const startContainer = range.startContainer;
              const startElement = asElement(startContainer) ?? startContainer.parentElement;
              return !!startElement?.closest(caretSelector);
            })();

          // Helper: place the caret on a target line, clamping the column
          // to the line's length and respecting `minColumn` indent. Used
          // when we need to move synchronously across the inter-line gap
          // text nodes that `caretSelector`-rendered content places between
          // `.line` spans (a native arrow press would otherwise drop the
          // caret *in* the gap). The caller passes the target line's text
          // (already in hand from `getLineInfo`) so we don't re-walk the
          // document.
          const moveToLine = (targetRow: number, targetLine: string, desiredColumn: number) => {
            let targetColumn = Math.min(desiredColumn, targetLine.length);
            if (
              minColumn !== undefined &&
              targetLine.length >= minColumn &&
              /^\s*$/.test(targetLine.slice(0, minColumn)) &&
              targetColumn < minColumn
            ) {
              targetColumn = minColumn;
            }
            edit.move({ row: targetRow, column: targetColumn });
          };

          if (event.key === 'ArrowUp') {
            if (atVisibleStart) {
              if (caretInLine && position.line > 0) {
                // Synchronously move the caret onto the previous `.line`
                // before notifying the host. Without this, native ArrowUp
                // can drop the caret into the inter-line gap text node
                // (e.g. the literal `\n` between `.line` spans), trapping
                // it in the "between lines" area after the host expands.
                event.preventDefault();
                moveToLine(position.line - 1, prevLine, column);
                if (onBoundary) {
                  state.skipNextRestore = true;
                  onBoundary();
                }
              } else if (onBoundary) {
                // Allow native caret movement so the host can scroll the
                // newly-revealed content into view alongside the caret.
                state.skipNextRestore = true;
                onBoundary();
              } else {
                event.preventDefault();
              }
            }
          } else if (event.key === 'ArrowDown') {
            if (atVisibleEnd) {
              if (caretInLine && hasNextLine) {
                event.preventDefault();
                moveToLine(position.line + 1, nextLine, column);
                if (onBoundary) {
                  state.skipNextRestore = true;
                  onBoundary();
                }
              } else if (onBoundary) {
                state.skipNextRestore = true;
                onBoundary();
              } else {
                event.preventDefault();
              }
            }
          } else if (event.key === 'ArrowLeft') {
            if (atVisibleStart && atLineStart) {
              if (caretInLine && position.line > 0) {
                event.preventDefault();
                edit.move({ row: position.line - 1, column: prevLine.length });
                if (onBoundary) {
                  state.skipNextRestore = true;
                  onBoundary();
                }
              } else if (onBoundary) {
                state.skipNextRestore = true;
                onBoundary();
              } else {
                event.preventDefault();
              }
            } else if (
              lineIsIndented &&
              minColumn !== undefined &&
              column === minColumn &&
              position.line > 0
            ) {
              event.preventDefault();
              edit.move({ row: position.line - 1, column: prevLine.length });
            } else if (caretInLine && column === 0 && position.line > 0) {
              // With non-selectable gaps between lines the browser would
              // place the caret *in* the gap text node — making ArrowLeft
              // a no-op. Jump synchronously to the end of the previous
              // line instead.
              event.preventDefault();
              edit.move({ row: position.line - 1, column: prevLine.length });
            }
          } else if (event.key === 'ArrowRight') {
            if (atVisibleEnd && atLineEnd) {
              if (caretInLine && hasNextLine) {
                event.preventDefault();
                moveToLine(position.line + 1, nextLine, 0);
                if (onBoundary) {
                  state.skipNextRestore = true;
                  onBoundary();
                }
              } else if (onBoundary) {
                state.skipNextRestore = true;
                onBoundary();
              } else {
                event.preventDefault();
              }
            } else if (minColumn !== undefined && column === lineText.length && hasNextLine) {
              const nextIsIndented =
                nextLine.length >= minColumn && /^\s*$/.test(nextLine.slice(0, minColumn));
              if (nextIsIndented) {
                event.preventDefault();
                edit.move({ row: position.line + 1, column: minColumn });
              } else if (caretInLine) {
                // Same gap-flash avoidance as ArrowLeft: jump to start of
                // next line synchronously.
                event.preventDefault();
                edit.move({ row: position.line + 1, column: 0 });
              }
            } else if (caretInLine && atLineEnd && hasNextLine) {
              event.preventDefault();
              edit.move({ row: position.line + 1, column: 0 });
            }
          }
        }

        // Schedule a post-arrow snap when `caretSelector` is set: the
        // browser's native arrow handling can drop the caret into the
        // non-selectable gap text nodes (e.g. the literal `\n` between
        // `.line` spans, especially after pressing Down on the last line
        // or Up on the first line). After the default action runs, if the
        // caret is no longer inside a matching element, jump it to the
        // nearest `.line` in the direction of travel so the caret never
        // gets stuck "between lines".
        const { caretSelector } = boundsRef.current;
        if (caretSelector !== undefined && !event.defaultPrevented) {
          const direction =
            event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 'forward' : 'backward';
          // For vertical arrows, capture the column the user is leaving
          // *before* the browser moves the caret, so we can land on the
          // same column of the target line if a snap is needed. Horizontal
          // arrows always snap to start/end of the adjacent line.
          const isVertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';
          let preferredColumn = 0;
          if (isVertical) {
            const preSel = element.ownerDocument.defaultView?.getSelection();
            if (preSel && preSel.rangeCount > 0 && preSel.isCollapsed) {
              const preRange = preSel.getRangeAt(0);
              if (element.contains(preRange.startContainer)) {
                preferredColumn = getPosition(element).content.length;
              }
            }
          }
          // requestAnimationFrame fires after the browser has applied the
          // native caret movement but before paint, so the snap is invisible.
          window.requestAnimationFrame(() => {
            snapCaretOutOfGapNode(direction, isVertical, preferredColumn);
          });
        }
      }

      // After a controlled edit in plaintext-only contentEditable, the DOM is
      // in a known-good post-edit state. Refresh pendingContent to that state
      // so any subsequent native input within the same key burst — e.g.
      // holding Enter then pressing x in plaintext-only contentEditable, where
      // `x` falls through to native browser handling and may merge frame
      // boundary lines — is measured against the correct baseline. Without
      // this, repairUnexpectedLineMerge sees Enter add a line and the native
      // merge remove a line for a net zero delta and short-circuits, leaving
      // the merge unrepaired.
      //
      // We gate on `hasPlaintextSupport` because in the Firefox fallback
      // (contenteditable=true) `edit.insert` itself can trigger the line-merge
      // quirk, so toString() after it would already be buggy and we must keep
      // the pre-edit baseline.
      if (event.defaultPrevented && hasPlaintextSupport) {
        state.pendingContent = toString(element);
      }

      // Flush changes as a key is held so the app can catch up.
      // Debounce: reset the timer on each repeat keydown so the expensive
      // onChange (syntax re-highlight) only fires once the user pauses typing.
      // edit.insert() already updated the DOM so the cursor and text are live.
      if (event.repeat) {
        if (state.repeatFlushId !== null) {
          clearTimeout(state.repeatFlushId);
        }
        state.repeatFlushId = setTimeout(() => {
          state.repeatFlushId = null;
          flushChanges();
        }, 100);
      }
    };

    const onKeyUp = (event: HTMLElementEventMap['keyup']) => {
      if (event.defaultPrevented || event.isComposing) {
        return;
      }
      // Cancel any pending debounced flush so keyup always flushes immediately
      if (state.repeatFlushId !== null) {
        clearTimeout(state.repeatFlushId);
        state.repeatFlushId = null;
      }
      // Structural edits (Enter) must always create their own undo checkpoint.
      // Regular character typing uses the 500ms dedup so you undo a word at a
      // time, but each Enter should be individually undoable. flushChanges
      // records the (repaired) post-edit content into history before firing
      // onChange, so we don't poison the undo stack with intermediate
      // browser-merged DOM states.
      if (!isUndoRedoKey(event)) {
        flushChanges(event.key === 'Enter');
      } else {
        flushChanges();
      }
      // Chrome Quirk: The contenteditable may lose focus after the first edit or so
      element.focus();
    };

    const onSelect = (event: Event) => {
      // Chrome Quirk: The contenteditable may lose its selection immediately on first focus
      const hasRange = (window.getSelection()?.rangeCount ?? 0) > 0;
      state.position = hasRange && event.target === element ? getPosition(element) : null;
    };

    const onPaste = (event: HTMLElementEventMap['paste']) => {
      event.preventDefault();
      const clipboard = event.clipboardData;
      if (!clipboard) {
        return;
      }
      state.pendingContent = trackState(true) ?? toString(element);
      edit.insert(clipboard.getData('text/plain'));
      flushChanges(true);
    };

    // When the editable wraps lines in block-level elements (e.g. `.line`
    // spans separated by literal `\n` gap text nodes), the browser's
    // default HTML→text/plain serializer inserts an implicit newline
    // between each block element on top of the explicit `\n` already
    // present in the DOM, producing duplicated newlines in the
    // clipboard. Override copy/cut to write `Range.toString()` for
    // `text/plain` while still preserving the HTML payload (so pasting
    // into rich-text targets keeps syntax highlighting).
    const onCopyOrCut = (event: ClipboardEvent) => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || !event.clipboardData) {
        return;
      }
      const range = selection.getRangeAt(0);
      if (range.collapsed || !element.contains(range.commonAncestorContainer)) {
        return;
      }
      event.preventDefault();
      const minColumn = boundsRef.current.minColumn;
      // When the selection starts mid-gutter (e.g. minColumn=4 but the
      // user dragged from column 2), only the gutter portion *inside*
      // the selection should be stripped from the first line. Subsequent
      // lines always start at column 0 of the document, so they get the
      // full `minColumn` budget.
      let firstLineStrip = 0;
      const restStrip = minColumn ?? 0;
      if (minColumn !== undefined && minColumn > 0) {
        const beforeRange = element.ownerDocument.createRange();
        beforeRange.setStart(element, 0);
        beforeRange.setEnd(range.startContainer, range.startOffset);
        const beforeText = beforeRange.toString();
        const lastNewline = beforeText.lastIndexOf('\n');
        const startColumn = beforeText.length - (lastNewline + 1);
        firstLineStrip = Math.max(0, minColumn - startColumn);
      }
      let plainText = range.toString();
      if (restStrip > 0) {
        // The caret-navigation guard already treats `[0, minColumn)` as a
        // clipped indent gutter. Strip up to that many leading whitespace
        // characters per line from the clipboard so the pasted snippet
        // matches what the user sees rather than including indent that
        // is hidden in the editable.
        plainText = stripLeadingPerLine(plainText, firstLineStrip, restStrip);
      }
      event.clipboardData.setData('text/plain', plainText);
      // Re-serialize the HTML ourselves since `preventDefault()` skipped
      // the browser's default text/html write. Wrap in a `<pre>` so the
      // monospace + whitespace context survives, then inline the
      // computed styles from each source element onto its clone so
      // rich-text paste targets (email, Word, Notion, etc.) render with
      // the same visual styling without needing our stylesheet.
      const doc = element.ownerDocument;
      const view = doc.defaultView;
      const fragment = range.cloneContents();
      const container = doc.createElement('pre');
      // Carry the editable's className onto the wrapper so consumers
      // that scope styles by class (e.g. `.code-block`) keep matching
      // when the snippet is pasted into a richer environment that loads
      // the same stylesheet.
      if (element.className) {
        container.className = element.className;
      }
      // `Range.cloneContents` returns the descendants of the
      // `commonAncestorContainer` but never the ancestor itself, so any
      // selection that lives entirely inside a styled wrapper (a single
      // text node inside a token, or multiple children of the same token)
      // loses that wrapper in the clipboard payload. The computed-style
      // inlining pass below has nothing to inline onto in that case.
      // Reconstruct the ancestor chain up to (but not including) the
      // editable root and inline styles onto each rebuilt wrapper so
      // rich-text paste targets keep the original highlighting.
      const cac = range.commonAncestorContainer;
      const anchor: Element | null = asElement(cac) ?? cac.parentElement;
      let rootContent: Node = fragment;
      // The innermost reconstructed wrapper, if any. The style-inlining
      // pass below walks from here so the clone walker stays aligned
      // with the source walker (which starts from the CAC's descendants).
      let cloneStylingRoot: Node = container;
      if (anchor && anchor !== element && element.contains(anchor)) {
        let current: Element | null = anchor;
        let innermost: Element | null = null;
        while (current && current !== element) {
          const cloned = current.cloneNode(false);
          // `Element.cloneNode` returns an Element; the runtime check
          // exists purely to satisfy the DOM lib's `Node` return type.
          if (!(cloned instanceof Element)) {
            current = current.parentElement;
            continue;
          }
          const ancestorClone = cloned;
          if (view) {
            const computed = view.getComputedStyle(current);
            let inline = ancestorClone.getAttribute('style') ?? '';
            for (const prop of CLIPBOARD_STYLE_PROPS) {
              const value = computed.getPropertyValue(prop);
              if (value && value !== 'normal' && value !== 'none' && value !== 'auto') {
                inline += `${prop}:${value};`;
              }
            }
            if (inline) {
              ancestorClone.setAttribute('style', inline);
            }
          }
          ancestorClone.appendChild(rootContent);
          rootContent = ancestorClone;
          if (innermost === null) {
            innermost = ancestorClone;
          }
          current = current.parentElement;
        }
        if (innermost) {
          cloneStylingRoot = innermost;
        }
      }
      container.appendChild(rootContent);
      if (view) {
        // Walk the CAC's descendants and mirror them onto the cloned
        // descendants of the innermost reconstructed wrapper. Both
        // walkers exclude their root, so as long as the roots correspond
        // (CAC ↔ innermost reconstructed wrapper, or CAC ↔ <pre> when
        // there is no reconstruction) the per-step pairing is correct.
        const sourceWalker = doc.createTreeWalker(
          range.commonAncestorContainer,
          NodeFilter.SHOW_ELEMENT,
          {
            acceptNode: (node) =>
              range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
          },
        );
        const cloneWalker = doc.createTreeWalker(cloneStylingRoot, NodeFilter.SHOW_ELEMENT);
        let source = nextElement(sourceWalker);
        let clone = nextElement(cloneWalker);
        while (source && clone) {
          if (source.tagName === clone.tagName) {
            const computed = view.getComputedStyle(source);
            let inline = clone.getAttribute('style') ?? '';
            for (const prop of CLIPBOARD_STYLE_PROPS) {
              const value = computed.getPropertyValue(prop);
              if (value && value !== 'normal' && value !== 'none' && value !== 'auto') {
                inline += `${prop}:${value};`;
              }
            }
            if (inline) {
              clone.setAttribute('style', inline);
            }
          }
          source = nextElement(sourceWalker);
          clone = nextElement(cloneWalker);
        }
        // Apply the editable's own typography to the wrapper so the
        // pasted block matches the source font/size even when only a
        // descendant span was selected.
        const rootComputed = view.getComputedStyle(element);
        let rootInline = CLIPBOARD_ROOT_STATIC_STYLES;
        for (const prop of CLIPBOARD_ROOT_STYLE_PROPS) {
          const value = rootComputed.getPropertyValue(prop);
          if (value) {
            rootInline += `${prop}:${value};`;
          }
        }
        if (rootInline) {
          container.setAttribute('style', rootInline);
        }
      }
      if (restStrip > 0) {
        stripLeadingPerLineDom(container, firstLineStrip, restStrip);
      }
      event.clipboardData.setData('text/html', container.outerHTML);
      if (event.type === 'cut') {
        // Mirror the paste path: capture pre-edit state for history, then
        // delete the selection. When `minColumn` clipped the leading
        // gutter whitespace out of the clipboard, re-insert exactly
        // those characters at the selection location so cut stays
        // lossless — the document keeps the hidden indent that the user
        // could not see and never copied.
        state.pendingContent = trackState(true) ?? toString(element);
        const replacement =
          restStrip > 0 ? extractLeadingPerLine(range.toString(), firstLineStrip, restStrip) : '';
        edit.insert(replacement);
        flushChanges(true);
      }
    };

    const onMouseUp = () => {
      // First lift the caret out of any inter-line gap node so the
      // gutter check below can see a real line position.
      snapCaretOutOfGapNode('forward', false, 0);
      snapCaretOutOfGutter();
    };

    // Tabbing into the editor places the caret at column 0 of the first
    // line, which lands inside the clipped indent gutter. Browsers set the
    // initial selection asynchronously after `focus`, so defer the snap.
    const onFocus = () => {
      const view = element.ownerDocument.defaultView;
      if (!view) {
        return;
      }
      view.requestAnimationFrame(() => {
        snapCaretOutOfGapNode('forward', false, 0);
        snapCaretOutOfGutter();
      });
    };

    document.addEventListener('selectstart', onSelect);
    window.addEventListener('keydown', onKeyDown);
    element.addEventListener('paste', onPaste);
    element.addEventListener('copy', onCopyOrCut);
    element.addEventListener('cut', onCopyOrCut);
    element.addEventListener('keyup', onKeyUp);
    element.addEventListener('mouseup', onMouseUp);
    element.addEventListener('focus', onFocus);

    return () => {
      if (state.repeatFlushId !== null) {
        clearTimeout(state.repeatFlushId);
        state.repeatFlushId = null;
      }
      document.removeEventListener('selectstart', onSelect);
      window.removeEventListener('keydown', onKeyDown);
      element.removeEventListener('paste', onPaste);
      element.removeEventListener('copy', onCopyOrCut);
      element.removeEventListener('cut', onCopyOrCut);
      element.removeEventListener('keyup', onKeyUp);
      element.removeEventListener('mouseup', onMouseUp);
      element.removeEventListener('focus', onFocus);
      element.style.whiteSpace = prevWhiteSpace;
      element.contentEditable = prevContentEditable;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elementRef.current, opts?.disabled, opts?.indentation]);

  return edit;
};
