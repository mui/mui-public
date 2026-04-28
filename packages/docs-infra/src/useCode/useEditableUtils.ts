/*
 * Pure DOM/text helpers extracted from useEditable.ts. None of these
 * touch React state or the hook's internal `state` object — they only
 * read from / mutate the DOM and the browser Selection. Kept in a
 * sibling file (per AGENTS.md docs-infra rule 2.3) so the main hook
 * stays focused on lifecycle wiring and event handling.
 */

export interface Position {
  position: number;
  extent: number;
  content: string;
  line: number;
}

export const getCurrentRange = (): Range => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    // Internal helper — only called from event handlers and edit methods
    // that have already verified there is an active selection. Throwing
    // here surfaces contract violations early instead of letting them
    // explode further down the call stack (matching the prior implicit
    // `DOMException` from `getRangeAt(0)` on an empty selection).
    throw new Error('useEditable: expected an active selection');
  }
  return selection.getRangeAt(0);
};

export const setCurrentRange = (range: Range) => {
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
export const asElement = (node: Node | null | undefined): Element | null =>
  node instanceof Element ? node : null;

/**
 * Pull the next element out of a `SHOW_ELEMENT` `TreeWalker` with a
 * runtime check rather than a type cast. Tree walkers configured for
 * `SHOW_ELEMENT` only emit elements in practice, but the DOM type
 * exposes `Node | null`.
 */
export const nextElement = (walker: TreeWalker): Element | null => asElement(walker.nextNode());

export const isUndoRedoKey = (event: KeyboardEvent): boolean =>
  (event.metaKey || event.ctrlKey) && !event.altKey && event.code === 'KeyZ';

export const isPlaintextInputKey = (event: KeyboardEvent): boolean => {
  const usesAltGraph =
    typeof event.getModifierState === 'function' && event.getModifierState('AltGraph');

  return (
    event.key.length === 1 && !event.metaKey && !event.ctrlKey && (!event.altKey || usesAltGraph)
  );
};

export const toString = (element: HTMLElement): string => {
  const content = element.textContent || '';

  // contenteditable Quirk: Without plaintext-only a pre/pre-wrap element must always
  // end with at least one newline character
  if (content[content.length - 1] !== '\n') {
    return `${content}\n`;
  }

  return content;
};

export interface LineInfo {
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
export const getLineInfo = (element: HTMLElement, lineIndex: number): LineInfo => {
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
export const getOffsetAtLineColumn = (
  element: HTMLElement,
  row: number,
  column: number,
): number => {
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

export const repairUnexpectedLineMerge = (
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

export const getPosition = (element: HTMLElement): Position => {
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

export const makeRange = (element: HTMLElement, start: number, end?: number): Range => {
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
export const adjustCursorAtNewlineBoundary = (range: Range): void => {
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
