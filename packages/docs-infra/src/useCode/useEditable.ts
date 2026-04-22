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

const getCurrentRange = () => window.getSelection()!.getRangeAt(0)!;

const setCurrentRange = (range: Range) => {
  const selection = window.getSelection()!;
  selection.empty();
  selection.addRange(range);
};

const isUndoRedoKey = (event: KeyboardEvent): boolean =>
  (event.metaKey || event.ctrlKey) && !event.altKey && event.code === 'KeyZ';

const isPlaintextInputKey = (event: KeyboardEvent): boolean => {
  const usesAltGraph =
    typeof event.getModifierState === 'function' && event.getModifierState('AltGraph');

  return (
    event.key.length === 1 && !event.metaKey && !event.ctrlKey && (!event.altKey || usesAltGraph)
  );
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
  if (offset < node.textContent!.length) {
    range.setStart(node, offset);
  } else {
    range.setStartAfter(node);
  }
};

const setEnd = (range: Range, node: Node, offset: number) => {
  if (offset < node.textContent!.length) {
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
      const text = node.textContent!;
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
    const length = node.textContent!.length;
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

  // Case 1: cursor is in a text node at the very end and that text ends with '\n'
  if (
    startContainer.nodeType === Node.TEXT_NODE &&
    startOffset === startContainer.textContent!.length &&
    startContainer.textContent!.endsWith('\n')
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
    if (prevChild?.nodeType === Node.TEXT_NODE && prevChild.textContent!.endsWith('\n')) {
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
}

export interface Options {
  disabled?: boolean;
  indentation?: number;
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
  if (!opts) {
    opts = {};
  }

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
        let position = 0;
        if (typeof pos === 'number') {
          position = pos;
        } else {
          const lines = toString(element).split('\n').slice(0, pos.row);
          if (pos.row) {
            position += lines.join('\n').length + 1;
          }
          position += pos.column;
        }
        const cursorRange = makeRange(element, position);
        adjustCursorAtNewlineBoundary(cursorRange);
        setCurrentRange(cursorRange);
      }
    },
    getState() {
      const { current: element } = elementRef;
      const text = toString(element!);
      const position = getPosition(element!);
      return { text, position };
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

    if (!elementRef.current || opts!.disabled) {
      return undefined;
    }

    state.disconnected = false;
    observerRef.current?.observe(elementRef.current, observerSettings);
    // Skip restoring the cursor while a key is held down. The debounced
    // flushChanges hasn't run yet so state.position is stale; restoring it
    // here would jump the cursor back on every incidental re-render (e.g.
    // from an async enhancer setState). edit.insert() already placed the
    // cursor correctly in the DOM — leave it there until the debounce fires.
    if (state.position && state.repeatFlushId === null) {
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

    if (!elementRef.current || opts!.disabled) {
      state.history.length = 0;
      state.historyAt = -1;
      return undefined;
    }

    const element = elementRef.current!;
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

    if (opts!.indentation) {
      const tabSizeValue = `${opts!.indentation}`;
      element.style.setProperty('-moz-tab-size', tabSizeValue);
      element.style.tabSize = tabSizeValue;
    }

    const indentPattern = `${' '.repeat(opts!.indentation || 0)}`;
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
      if (!elementRef.current || window.getSelection()!.rangeCount === 0) {
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
          const mutation = state.queue.pop()!;
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

    const onKeyDown = (event: HTMLElementEventMap['keydown']) => {
      if (event.defaultPrevented || event.target !== element) {
        return;
      }
      if (state.disconnected) {
        // React Quirk: It's expected that we may lose events while disconnected, which is why
        // we'd like to block some inputs if they're unusually fast. However, this always
        // coincides with React not executing the update immediately and then getting stuck,
        // which can be prevented by issuing a dummy state change.
        event.preventDefault();
        unblock([]);
        return;
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
      } else if ((!hasPlaintextSupport || opts!.indentation) && event.key === 'Backspace') {
        // Firefox Quirk: Since plaintext-only is unsupported we must
        // ensure that only a single character is deleted
        event.preventDefault();
        const range = getCurrentRange();
        if (!range.collapsed) {
          edit.insert('', 0);
        } else {
          const position = getPosition(element);
          const match = blanklineRe.exec(position.content);
          edit.insert('', match ? -match[1].length : -1);
        }
      } else if (opts!.indentation && event.key === 'Tab') {
        event.preventDefault();
        const position = getPosition(element);
        const start = position.position - position.content.length;
        const content = toString(element);
        const newContent = event.shiftKey
          ? content.slice(0, start) +
            position.content.replace(indentRe, '') +
            content.slice(start + position.content.length)
          : content.slice(0, start) +
            (opts!.indentation ? ' '.repeat(opts!.indentation) : '\t') +
            content.slice(start);
        edit.update(newContent);
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
      state.position =
        window.getSelection()!.rangeCount && event.target === element ? getPosition(element) : null;
    };

    const onPaste = (event: HTMLElementEventMap['paste']) => {
      event.preventDefault();
      state.pendingContent = trackState(true) ?? toString(element);
      edit.insert(event.clipboardData!.getData('text/plain'));
      flushChanges(true);
    };

    document.addEventListener('selectstart', onSelect);
    window.addEventListener('keydown', onKeyDown);
    element.addEventListener('paste', onPaste);
    element.addEventListener('keyup', onKeyUp);

    return () => {
      if (state.repeatFlushId !== null) {
        clearTimeout(state.repeatFlushId);
        state.repeatFlushId = null;
      }
      document.removeEventListener('selectstart', onSelect);
      window.removeEventListener('keydown', onKeyDown);
      element.removeEventListener('paste', onPaste);
      element.removeEventListener('keyup', onKeyUp);
      element.style.whiteSpace = prevWhiteSpace;
      element.contentEditable = prevContentEditable;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elementRef.current, opts?.disabled, opts?.indentation]);

  return edit;
};
