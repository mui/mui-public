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
// Changes (see git history and inline comments for rationale):
// - Linting, formatting, tests, and React 19 compatibility (lazy useState, useRef MutationObserver, SSR guards)
// - Performance: TreeWalker-based makeRange/getPosition, deduped toString() calls, getLineInfo walks only neighboring lines
// - Firefox quirks: preserve pendingContent across rapid keydowns, refresh baseline after controlled edits, repair line-merges, route plaintext keys through edit.insert in the contentEditable="true" fallback
// - Undo stack: record repaired (not raw) content, allow tracking before first flush, bypass 500ms dedup for structural edits (Enter)
// - Repeat-key flush debouncing so syntax re-highlight fires once on key release
// - Resync (instead of block) on stale-DOM arrow keys so navigation isn't eaten after a pending edit
// - adjustCursorAtNewlineBoundary applied to all programmatic caret placements; getState() returns an empty snapshot pre-mount
// - New `minColumn` option: skip clipped indent gutter via arrow navigation, click, and tab-focus; Backspace on a fully-clipped blank line clears the whole hidden indent (caret stays on the line at column 0)
// - New `minRow`/`maxRow`/`onBoundary` options: arrow navigation past the visible region invokes the callback (and falls through natively when provided so hosts can expand collapsed regions)
// - New `caretSelector` option: synchronous horizontal line-wrap and post-arrow rAF snap to lift the caret out of inter-line gap text nodes (e.g. `\n` between `.line` spans)
// - Override copy/cut: write `Range.toString()` for `text/plain` (avoids duplicated newlines from block-level line wrappers) and an inline-styled `<pre>` clone for `text/html`; strip the clipped indent gutter from both payloads when `minColumn` is set

import * as ReactDOM from 'react-dom';

import {
  type Position,
  adjustCursorAtNewlineBoundary,
  asElement,
  getCurrentRange,
  getLineInfo,
  getOffsetAtLineColumn,
  getPosition,
  isPlaintextInputKey,
  isUndoRedoKey,
  makeRange,
  repairUnexpectedLineMerge,
  restoreSelection,
  setCurrentRange,
  toString,
} from './useEditableUtils';
import { cloneRangeWithInlineStyles } from './cloneRangeWithInlineStyles';
import {
  extractLeadingPerLine,
  stripLeadingPerLine,
  stripLeadingPerLineDom,
} from './stripLeadingPerLine';
import type { EditingEngineLoader } from './editingEngineCache';

type History = [Position, string];

const observerSettings = {
  characterData: true,
  characterDataOldValue: true,
  childList: true,
  subtree: true,
};

// Cross-instance batching for the `getComputedStyle` read + conditional
// inline-style writes that happen during each editable's setup.
//
// Pages like the Material UI component docs render ~30 demos at once.
// The previous implementation interleaved a write (the layout effect's
// own `element.style.whiteSpace = ...` / `tabSize` settings, plus the
// implicit invalidation from the preceding `contentEditable` write)
// with a read (`getComputedStyle(element).whiteSpace`) inside each
// instance's effect. That forced the browser to flush a fresh style
// recalc on every iteration — 30 recalcs in a row during a single
// commit.
//
// By queuing each instance's read+write block into a single microtask
// we run all of the reads (which share one recalc) followed by all the
// writes, instead of interleaving them with the other instances'.
//
// `contentEditable` itself is still set synchronously inside the layout
// effect: the keyboard/paste/focus handlers bound in the same effect
// assume the host element is already editable when the commit returns,
// so any input that lands in the same frame as the mount (autofocus,
// programmatic focus, a queued keystroke) is routed through the
// plaintext-only path instead of falling back to native contenteditable
// behavior.
//
// The cleanup-side restore (`whiteSpace` + `contentEditable` back to
// their pre-mount values) runs synchronously inside the layout-effect
// teardown, gated by `element.isConnected` so detached hosts skip the
// write. The in-flight mount-side microtask is cancelled via
// `styleSetupCancelled` so there's no race.
let pendingEditableStyleTasks: Array<() => void> | null = null;

function scheduleEditableStyleTask(task: () => void): void {
  if (pendingEditableStyleTasks === null) {
    pendingEditableStyleTasks = [task];
    queueMicrotask(() => {
      const tasks = pendingEditableStyleTasks!;
      pendingEditableStyleTasks = null;
      for (let i = 0; i < tasks.length; i += 1) {
        tasks[i]();
      }
    });
  } else {
    pendingEditableStyleTasks.push(task);
  }
}

// Computed-style properties inlined onto each element in the copied
// HTML fragment so external paste targets render with the same syntax
// highlighting without needing our stylesheet.
const CLIPBOARD_ELEMENT_STYLE_PROPS = [
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

// A small amount of padding + rounded corners gives the pasted snippet
// a card-like appearance in rich-text targets without overriding the
// background or font that consumers already control via the editable's
// own styles.
const CLIPBOARD_ROOT_STATIC_STYLES = 'padding:1em;border-radius:0.5em;';

export interface State {
  disconnected: boolean;
  onChange(text: string, position: Position, preParseResult?: unknown): void;
  pendingContent: string | null;
  queue: MutationRecord[];
  history: History[];
  historyAt: number;
  /**
   * The text most recently reported via `onChange` (i.e. last seen by the
   * controlled host), independent of the undo stack. Lets the
   * external-swap detector recover edits that the 500ms dedup kept out
   * of `history`: when the host swaps the editable's content, anything
   * the user typed since the last history checkpoint is still reachable
   * here and gets pushed onto the stack just before the swap is
   * recorded. Cleared on every undo/redo so we don't double-record after
   * navigating the existing history.
   */
  lastCommittedContent: string | null;
  /**
   * Set whenever the MutationObserver sees DOM changes between renders,
   * cleared after the snapshot block consumes them. Lets the per-render
   * layout effect skip the O(N) `toString` walk on idle re-renders
   * (parent updates, async state syncs, variant switches that don't
   * actually touch the editable's DOM). React's reconciliation of an
   * unchanged highlighted subtree produces zero mutation records, so
   * `domDirty` stays false and the snapshot is a no-op.
   */
  domDirty: boolean;
  position: Position | null;
  /** setTimeout id used to debounce flushChanges() calls during key-repeat */
  repeatFlushId: ReturnType<typeof setTimeout> | null;
  /**
   * AbortController for the in-flight `preParse` callback (if any). Reset
   * on every new flush so a rapidly-typed sequence aborts stale parses
   * before posting a fresh request.
   */
  preParseAbort: AbortController | null;
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

export interface Options<TPreParseResult = unknown> {
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
  /**
   * Optional async pre-parse hook invoked before each `onChange` flush.
   * When provided, the parser receives the post-edit `text` and caret
   * `position` plus an `AbortSignal` that fires when a newer keystroke
   * supersedes this flush. Its resolved value is forwarded as the third
   * argument to `onChange`, allowing the host to cache an already-parsed
   * HAST (or any other derived state) keyed off the same source string.
   *
   * If `preParse` is omitted, `onChange` runs synchronously inside the
   * keyup / debounce handler as before. If it is provided, the React
   * state sync is delayed until the returned promise settles. Structural
   * edits that need a synchronous re-render (Enter, paste, cut, undo/redo,
   * programmatic `edit.update`/`edit.insert`, `minColumn` blank-line
   * collapse) bypass `preParse` and fire `onChange` immediately without
   * a third argument.
   */
  preParse?: (text: string, position: Position, signal: AbortSignal) => Promise<TPreParseResult>;
  /**
   * Loads the editing engine module on demand. Supplied by `CodeProvider` via
   * context (eager → bundled, resolves instantly; lazy → dynamic `import()`).
   * When omitted, `useEditable` falls back to a built-in dynamic import so
   * editing still works without a provider.
   */
  engineLoader?: EditingEngineLoader;
  /**
   * Controls when the editing engine loads once the block is editable:
   * `'eager'` (default) loads it immediately; `'interaction'` defers until the
   * user hovers, focuses, or clicks the editable.
   */
  activation?: 'eager' | 'interaction';
  /**
   * Called once when the block is first activated for editing — immediately in
   * `'eager'` mode, or on first engagement (hover / focus / click) in
   * `'interaction'` mode. Lets the host warm the rest of the live-editing
   * dependencies (grammars, worker) at the right moment, especially when
   * `'interaction'` has deferred them.
   */
  onActivate?: () => void;
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

export type Bounds = {
  minColumn?: number;
  minRow?: number;
  maxRow?: number;
  onBoundary?: () => void;
  caretSelector?: string;
  preParse?: (text: string, position: Position, signal: AbortSignal) => Promise<unknown>;
};

/**
 * Everything {@link createEditableEngine} needs from its host hook. `useEditable`
 * owns this state and these refs so they survive this module's lazy load; the
 * engine only reads and mutates them, and they are shared by reference so the
 * engine's handlers always observe live values.
 */
export interface EditableEngineContext {
  elementRef: { current: HTMLElement | undefined | null };
  state: State;
  observerRef: { current: MutationObserver | null };
  boundsRef: { current: Bounds };
  configRef: { current: Options };
  unblock: (value: never[]) => void;
}

/**
 * The heavy editing runtime bound to a host element. `setup` applies
 * `contentEditable` and binds the keyboard/paste/caret handlers; `observeAndRestore`
 * runs the per-render MutationObserver + caret-restore pass. Each returns its cleanup.
 */
export interface EditableEngine {
  edit: Edit;
  observeAndRestore(): (() => void) | undefined;
  setup(): (() => void) | undefined;
}

export type CreateEditableEngine = (ctx: EditableEngineContext) => EditableEngine;

/**
 * Resolves the editing engine factory. `CodeProvider` supplies one via context
 * (eager → bundled, resolves instantly; lazy → dynamic `import()`); `useEditable`
 * also has a built-in fallback so editing works without a provider.
 */
export type EditableEngineLoader = () => Promise<CreateEditableEngine>;

/**
 * Builds the editing engine for a host element. This module statically imports
 * the heavy editing utilities (`useEditableUtils`, `cloneRangeWithInlineStyles`,
 * `stripLeadingPerLine`) and `react-dom`, so the bundler emits it as a separate
 * chunk that `useEditable` loads on demand — read-only code blocks never pull it in.
 */
export const createEditableEngine: CreateEditableEngine = (ctx) => {
  const { elementRef, state, observerRef, boundsRef, configRef, unblock } = ctx;

  // MutationObserver is created lazily here (not in the host hook) so code
  // blocks that never activate editing never allocate one. The host owns the
  // ref; the engine fills it on first construction.
  if (observerRef.current === null && typeof MutationObserver !== 'undefined') {
    observerRef.current = new MutationObserver((batch) => {
      state.queue.push(...batch);
    });
  }

  const edit: Edit = {
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
  };

  // Per-render observe + caret-restore + external-swap snapshot. The host hook
  // calls this from a layout effect on every render once the engine exists.
  const observeAndRestore = (): (() => void) | undefined => {
    // Only for SSR / server-side logic
    // typeof navigator check fails on Node.js 21+ which exposes navigator.userAgent;
    // typeof window is the standard isomorphic SSR guard.
    if (typeof window === 'undefined') {
      return undefined;
    }

    const config = configRef.current;

    if (!elementRef.current || config.disabled) {
      return undefined;
    }

    // Detect content swaps that happen outside the keystroke pipeline (e.g.
    // a host calling `setSource(...)` from a Reset button or React state
    // change) and snapshot them into the undo stack so the user can Ctrl+Z
    // back to their prior text. We skip this on the post-flush re-render
    // (`state.disconnected === true`): in that case `flushChanges` has just
    // recorded the new content via `trackState`, so re-reading the DOM
    // would only re-confirm what we already know — wasting an O(N) walk
    // on every keystroke. We also skip while a user edit is in flight
    // (`pendingContent !== null`) so we don't race with the imminent
    // flush. Finally, we only push when there's already a recorded entry
    // that the new content differs from — the initial-baseline capture
    // before the very first user edit is left to `trackState`'s keydown
    // path so we don't double-record (and inadvertently arm its 500ms
    // dedup timestamp before flushChanges gets a chance to record the
    // post-edit state).
    if (!state.disconnected && state.pendingContent === null && state.history.length > 0) {
      // Detect host-driven content swaps (e.g. a `setSource(...)` from a
      // Reset button or an external React state change) and snapshot
      // them into the undo stack so the user can Ctrl+Z back to their
      // prior text. We compare the live DOM against
      // `state.lastCommittedContent` — the content of the most recent
      // `onChange` call. After a normal commit, React's reconciliation
      // produces a DOM whose `toString()` matches `lastCommittedContent`
      // exactly, so the comparison is a cheap no-op. After an external
      // swap they differ and we record the new entry.
      //
      // We deliberately do NOT use the MutationObserver record queue as
      // a gate here: React's own reconciliation between renders fires
      // records too, and pushing those into `state.queue` would cause
      // `commit()` to revert React's DOM patches on the next keystroke.
      // The observer's per-render `disconnect()` (in the cleanup below)
      // drops those records on the floor by design.
      const lastCommitted = state.lastCommittedContent;
      if (lastCommitted !== null) {
        const currentContent = toString(elementRef.current);
        if (currentContent !== lastCommitted) {
          const lastEntry = state.history[state.historyAt];
          // Recover edits the 500ms dedup kept out of `history`. Without
          // this, a user who typed within the dedup window then
          // triggered an external swap would lose those keystrokes
          // entirely on undo: history holds only the pre-typing
          // checkpoint, so Ctrl+Z would jump straight past the user's
          // most recent state.
          if (lastEntry && lastCommitted !== lastEntry[1]) {
            state.historyAt += 1;
            const at = state.historyAt;
            state.history[at] = [state.position ?? lastEntry[0], lastCommitted];
            state.history.splice(at + 1);
            if (at > 500) {
              state.historyAt -= 1;
              state.history.shift();
            }
          }
          const lastEntryAfter = state.history[state.historyAt];
          state.historyAt += 1;
          const at = state.historyAt;
          state.history[at] = [
            lastEntryAfter
              ? lastEntryAfter[0]
              : (state.position ?? { position: 0, extent: 0, content: '', line: 0 }),
            currentContent,
          ];
          state.history.splice(at + 1);
          if (at > 500) {
            state.historyAt -= 1;
            state.history.shift();
          }
          state.lastCommittedContent = currentContent;
        }
      }
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
      restoreSelection(elementRef.current, state.position);
    }

    return () => {
      // Drain the observer's pending record queue into a single dirty
      // bit BEFORE disconnecting. `disconnect()` per spec drops the
      // queue, which would otherwise hide an external DOM swap that
      // happened between this render's commit and the next render's
      // snapshot block. We deliberately do NOT push the records into
      // `state.queue`: React's own reconciliation mutations land here
      // too, and `commit()` on the next keystroke would revert them,
      // corrupting the rendered DOM. The boolean is a pure gating
      // signal — the snapshot block does its own `toString` comparison
      // against `lastCommittedContent` to decide whether the change was
      // a real swap or just React reconciling to the committed content.
      const pending = observerRef.current?.takeRecords();
      if (pending && pending.length > 0) {
        state.domDirty = true;
      }
      observerRef.current?.disconnect();
    };
  };

  // Applies contentEditable and binds the keyboard/paste/caret handlers. The
  // host hook calls this from a layout effect; it re-runs when the element,
  // `disabled`, or `indentation` change (matching the prior effect deps).
  const setup = (): (() => void) | undefined => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const config = configRef.current;

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
      restoreSelection(element, state.position);
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

    // Defer the `getComputedStyle` read + conditional inline-style
    // writes into a module-level microtask so all editables on the page
    // share a single style recalc instead of forcing one per instance.
    // `styleSetupCancelled` shorts the task out if cleanup runs before
    // the microtask fires (e.g. an unmount in the same tick as commit).
    let styleSetupCancelled = false;
    scheduleEditableStyleTask(() => {
      if (styleSetupCancelled) {
        return;
      }
      // Only set inline styles when the computed style isn't already
      // suitable. This lets consumers control these properties via CSS
      // (e.g. a `pre` selector) without us clobbering their values with
      // inline styles that win specificity.
      const computed = element.ownerDocument.defaultView?.getComputedStyle(element);
      const computedWhiteSpace = computed?.whiteSpace ?? '';
      // Any whitespace-preserving value works for an editable surface.
      // `pre-line` is intentionally excluded because it collapses runs
      // of spaces, which would corrupt indentation.
      const whiteSpaceIsPreserving =
        computedWhiteSpace === 'pre' ||
        computedWhiteSpace === 'pre-wrap' ||
        computedWhiteSpace === 'break-spaces';
      if (!whiteSpaceIsPreserving) {
        element.style.whiteSpace = 'pre-wrap';
      }

      if (config.indentation) {
        const tabSizeValue = `${config.indentation}`;
        if (computed?.tabSize !== tabSizeValue) {
          element.style.setProperty('-moz-tab-size', tabSizeValue);
          element.style.tabSize = tabSizeValue;
        }
      }
    });

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

    const flushChanges = (
      ignoreTimestamp?: boolean,
      bypassPreParse?: boolean,
      positionFlags?: Partial<Position>,
    ) => {
      const records = observerRef.current?.takeRecords() ?? [];
      state.queue.push(...records);
      const position = getPosition(element);
      // Caller-supplied metadata that the post-edit caret can't carry on its own
      // (e.g. that a selection delete started at column 0). Rides on the reported
      // position into `onChange`/history so derived state and undo can use it.
      if (positionFlags) {
        Object.assign(position, positionFlags);
      }
      if (state.queue.length) {
        // We DO NOT revert the queued mutations yet — letting them stay in
        // the live DOM means the user's keystroke remains visible while
        // `preParse` runs. The mutation queue is held until commit (below)
        // so when React eventually re-renders the highlighted content, it
        // first sees its expected previous DOM.
        const content = repairUnexpectedLineMerge(
          toString(element),
          state.pendingContent,
          position,
        );
        state.position = position;

        // Record the REPAIRED content into history before notifying the app.
        // Reading toString() back from the DOM here would capture the buggy
        // pre-repair state (e.g. a Firefox line-merge), which is what was
        // previously polluting the undo stack.
        trackState(ignoreTimestamp, content, position);

        // Snapshot the queue length representing mutations that belong to
        // THIS flush. Anything appended past this index by the time
        // `commit` runs is a straggler — a newer keystroke whose own
        // keyup-triggered `flushChanges` will produce a fresher commit. In
        // that case we must NOT revert the stragglers (or we'd lose the
        // user's character) and we must NOT call `onChange` with our now
        // stale `content` (or we'd briefly render the older state on top
        // of the newer DOM).
        const queueLengthAtFlush = state.queue.length;

        // Commit phase: revert the queued mutations and hand control to
        // React. The revert + React commit are bundled into a single task
        // via `flushSync` so the browser cannot paint the briefly-reverted
        // DOM between the two — the user's keystroke stays continuously on
        // screen, transitioning directly from "raw mutation" to
        // "highlighted React render".
        const commit = (preParseResult?: unknown) => {
          // Drain anything pending in the observer first so we have an
          // accurate count of stragglers (mutations made after this
          // flush started). The observer stays connected during the
          // `preParse` await so additional keystrokes ARE captured but
          // are NOT blocked by the `state.disconnected` guard in
          // `onKeyDown`.
          const stragglers = observerRef.current?.takeRecords() ?? [];
          state.queue.push(...stragglers);
          if (state.queue.length > queueLengthAtFlush) {
            // A newer keystroke landed in the DOM after this flush
            // started. Drop this commit on the floor — the straggler's
            // own `flushChanges` (already running, or about to run on
            // its keyup) will produce a fresher commit that reverts the
            // entire combined mutation set and reports the up-to-date
            // content. Leaving the observer connected and
            // `state.disconnected` false lets onKeyDown keep accepting
            // input in the meantime.
            return;
          }
          disconnect();
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
          ReactDOM.flushSync(() => {
            state.lastCommittedContent = content;
            if (preParseResult === undefined) {
              // Preserve the historical (text, position) calling convention
              // for the sync / bypass path so consumers can distinguish a
              // preParse-result-less commit from one whose result happened
              // to be `undefined`.
              state.onChange(content, position);
            } else {
              state.onChange(content, position, preParseResult);
            }
          });
        };

        const { preParse } = boundsRef.current;
        if (preParse && !bypassPreParse) {
          // Abort any prior in-flight preParse — only the most recent
          // keystroke's parse result is worth waiting for.
          if (state.preParseAbort) {
            state.preParseAbort.abort();
          }
          const controller = new AbortController();
          state.preParseAbort = controller;
          const { signal } = controller;
          preParse(content, position, signal).then(
            (result) => {
              if (signal.aborted) {
                return;
              }
              if (state.preParseAbort === controller) {
                state.preParseAbort = null;
              }
              commit(result);
            },
            () => {
              if (state.preParseAbort === controller) {
                state.preParseAbort = null;
              }
              if (signal.aborted) {
                // Aborted by a newer keystroke — drop silently. The
                // queued mutations stay in place until the superseding
                // flush commits them.
                return;
              }
              // Real parse failure (e.g. unknown grammar, worker error).
              // Fall back to committing without a preParseResult so the
              // source still propagates to onChange — matching the
              // historical sync path's fail-open behavior. Without this,
              // the DOM would show the user's typed text while controlled
              // state stayed stale, and the next render would revert it.
              commit();
            },
          );
        } else {
          // Structural / synchronous edit — bypass preParse so the React
          // state sync happens on the same commit as the DOM change.
          if (state.preParseAbort) {
            state.preParseAbort.abort();
            state.preParseAbort = null;
          }
          commit();
        }
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

    // The most recent non-empty `caretSelector`. The host may briefly drop it
    // (e.g. `shouldHighlight` flips false while the post-edit re-highlight is in
    // flight), but the rendered `.line` structure persists across that window,
    // so we latch the selector to keep framed-line handling stable mid-edit.
    let latchedCaretSelector: string | undefined = boundsRef.current.caretSelector;

    // True when this is a framed (`caretSelector`) editor — i.e. the content is
    // rendered as `.line` spans inside `.frame` wrappers separated by inter-line
    // gap text nodes. Native plaintext-only typing at a `.line`/gap boundary
    // lands the character in the `.frame` wrapper instead, flattening the line
    // spans and splitting input across rows (which then strands the caret at the
    // line start on Backspace). Routing every printable key through the
    // controlled `edit.insert` keeps the character inside its line span. We key
    // off the *latched* selector (not the live caret position) because the caret
    // can momentarily sit in a gap node mid-edit and the host briefly drops
    // `caretSelector` while a post-edit re-highlight is in flight.
    const framedEditorActive = (): boolean => {
      const configured = boundsRef.current.caretSelector;
      if (configured !== undefined) {
        latchedCaretSelector = configured;
      }
      return latchedCaretSelector !== undefined;
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
          restoreSelection(element, state.position);
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
        // The state we are leaving — its position is the POST-edit caret of the
        // edit being undone, which the host needs as the reversal pivot (it can
        // differ from the destination's PRE-edit caret after a selection edit).
        let leavingPosition: Position | undefined;
        if (!event.shiftKey) {
          const leavingAt = state.historyAt;
          state.historyAt -= 1;
          const at = state.historyAt;
          history = state.history[at];
          if (!history) {
            state.historyAt = 0;
          } else {
            leavingPosition = state.history[leavingAt]?.[0];
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
          state.lastCommittedContent = history[1];
          // Tag the reported position with the navigation direction so the host
          // can reverse the edit's derived state (e.g. the comment/highlight map)
          // relative to this PRE-edit caret instead of assuming a forward-edit
          // (post-edit) caret. On undo, also pass the reversed edit's anchor line
          // (the leaving state's caret) so the reversal pivots on the same line
          // the forward edit did — they diverge after a selection edit (e.g.
          // Select All). A fresh object keeps the stored history entry clean for
          // re-navigation.
          state.onChange(history[1], {
            ...history[0],
            history: event.shiftKey ? 'redo' : 'undo',
            ...(leavingPosition
              ? {
                  historyPivotLine: leavingPosition.line,
                  // Carry the reversed edit's column-0 flag so the reversal drops
                  // its anchor by the same line the forward edit did, keeping the
                  // collapseMap keys aligned across delete↔undo.
                  deletedFromLineStart: leavingPosition.deletedFromLineStart,
                }
              : {}),
          });
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
        // Pressing Enter on the last visible row pushes the new line past the
        // collapsed window's fold, where there is no rendered `.line` to host
        // the caret (it would strand in the padding filler). Mirror the
        // arrow-key boundary handling and ask the host to expand. Cheap: a
        // single bounds read plus the `getPosition` we already need for the
        // post-expand caret restore.
        const { maxRow, onBoundary } = boundsRef.current;
        if (maxRow !== undefined && onBoundary && position.line >= maxRow) {
          state.position = getPosition(element);
          state.skipNextRestore = true;
          onBoundary();
        } else if (!event.repeat) {
          // Reconcile synchronously (revert the raw newline, re-render React's
          // frame structure in one `flushSync`) so an Enter that MOVES an
          // emphasis frame — e.g. re-splitting a line whose earlier Backspace
          // merge had scrolled the collapsed window — repositions the window in
          // the same task as the native insert. Without this the live DOM keeps
          // the pre-reconcile window position until the keyup flush, a visible
          // flash. Mirrors the synchronous Backspace-merge path; the keyup flush
          // then no-ops (content unchanged → `trackState` dedups). Held Enter
          // (`event.repeat`) keeps the debounced keyup flush so the highlight
          // re-runs once on release instead of once per repeat.
          flushChanges(true, true);
          return;
        }
      } else if (
        !event.isComposing &&
        isPlaintextInputKey(event) &&
        (!hasPlaintextSupport || framedEditorActive())
      ) {
        // Firefox Quirk: native typing in contentEditable="true" can insert
        // directly into the frame wrapper before the current line span.
        //
        // Chromium/WebKit (plaintext-only) Quirk: native typing at the END of a
        // framed `.line` (the boundary with the inter-line gap text node)
        // likewise lands the character in the `.frame` wrapper, flattening the
        // line spans and splitting subsequent input onto the next row — which
        // then strands the caret at the line start on the next Backspace.
        //
        // Route plain text input through the controlled insert path in both
        // cases so the character lands inside the current line span.
        event.preventDefault();
        edit.insert(event.key);
      } else if (
        (!hasPlaintextSupport || config.indentation) &&
        event.key === 'Backspace' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        // Firefox Quirk: Since plaintext-only is unsupported we must
        // ensure that only a single character is deleted.
        //
        // Modifier guard: Ctrl/Meta/Alt+Backspace request word- or
        // line-granular deletion. Mirror the forward-`Delete` branch below
        // and let those modified presses fall through to the browser's
        // native `deleteWord*`/`deleteSoftLine*` so a held modifier keeps its
        // OS deletion semantics instead of being downgraded to a single char.
        event.preventDefault();
        const beforePosition = getPosition(element);
        const range = getCurrentRange();
        if (!range.collapsed) {
          // Whether the deletion removed WHOLE lines from the first line down. True
          // only when the selection BOTH started at column 0 (no content before it)
          // AND ended at a line boundary (its text ends with a newline) — then the
          // first line is gone and the post-delete caret lands on the line that
          // shifted up from below, so the comment-map anchor sits one line higher
          // (see `deletedFromLineStart`). A selection that ends MID-line instead
          // collapses the spanned lines INTO the first line, which survives (emptied)
          // under the caret — no shift-up — so the flag must stay false, or a marker
          // on that surviving line is dragged one line too high.
          const deletedFromLineStart =
            beforePosition.content.length === 0 && range.toString().endsWith('\n');
          edit.insert('', 0);
          // A multi-line selection delete can natively remove whole `.frame`
          // wrapper elements (e.g. selecting exactly one emphasis frame). That
          // detaches nodes React still holds, so its next reconcile throws
          // `removeChild`/`NotFoundError` and unmounts the whole editor. Reconcile
          // synchronously (revert the raw mutation, re-render from the new source
          // in one `flushSync`) so React owns the structural change consistently.
          flushChanges(true, true, { deletedFromLineStart });
          return;
        }
        // Collapsed caret (the non-collapsed range case returned above).
        const { minColumn } = boundsRef.current;
        // When the caret sits at `minColumn` on a blank (whitespace-only)
        // line inside a clipped indent gutter, a single-character Backspace
        // would step into `[0, minColumn)` — visually invisible to the user
        // since that range is hidden by the host. Clearing one indent unit
        // at a time would leave the caret stranded in that hidden gutter.
        // Instead, clear the WHOLE clipped indent in one Backspace so the
        // line becomes truly empty and the caret lands at its visible
        // column 0 — keeping the caret on the same line rather than
        // collapsing the line and jumping it up to the previous one.
        //
        // Walk only enough text nodes to read the current line — we
        // don't need the rest of the document on every Backspace.
        const clearsClippedIndent =
          minColumn !== undefined &&
          minColumn > 0 &&
          beforePosition.line > 0 &&
          beforePosition.content.length === minColumn &&
          /^\s*$/.test(beforePosition.content);
        let handled = false;
        if (clearsClippedIndent && minColumn !== undefined) {
          // The redundant `minColumn !== undefined` check pins TS's
          // narrowing across the boundary so we can use `minColumn`
          // as a number directly without an assertion.
          const fullLine = getLineInfo(element, beforePosition.line).currentLine;
          if (fullLine.length === minColumn && /^\s*$/.test(fullLine)) {
            edit.insert('', -minColumn);
            handled = true;
          }
        }
        if (!handled) {
          const match = blanklineRe.exec(beforePosition.content);
          edit.insert('', match ? -match[1].length : -1);
        }
        // If the deletion left the current line empty, OR merged this line up
        // into the previous one (a Backspace at column 0 deletes the preceding
        // newline), the browser leaves a transient zero-height/collapsed
        // `.line` span in the DOM that only disappears once the change commits
        // and React re-renders. Left to the keyup flush (or an async
        // re-highlight) the line blinks out and back — the visible flash when
        // "removing the last part of a line full of spaces" or backspacing a
        // line up into the one above. Reconcile synchronously (bypassing
        // preParse) so the final structure is in place before the next paint.
        const afterDelete = getPosition(element);
        const lineEmptied = getLineInfo(element, afterDelete.line).currentLine.length === 0;
        const lineMerged = afterDelete.line < beforePosition.line;
        if (lineEmptied || lineMerged) {
          flushChanges(true, true);
          return;
        }
      } else if (
        (!hasPlaintextSupport || framedEditorActive()) &&
        event.key === 'Delete' &&
        !event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        // Forward delete, mirroring the Backspace handling. Native plaintext-only
        // forward-delete is unreliable in framed editors: at a `.line`/gap
        // boundary it can no-op instead of merging the next line, and when it
        // empties a line it leaves a zero-height empty `.line` that flashes
        // before the async re-highlight commits. Route it through the controlled
        // `edit.insert` so the deletion is predictable, then reconcile
        // synchronously when the line empties (same flash fix as Backspace).
        event.preventDefault();
        const range = getCurrentRange();
        if (!range.collapsed) {
          // See the Backspace branch above: deletedFromLineStart holds only when the
          // selection removed whole lines (started at column 0 AND ended at a line
          // boundary). A mid-line end collapses the lines in place, leaving the first
          // line emptied under the caret — no shift-up — so the flag must stay false.
          const deletedFromLineStart =
            getPosition(element).content.length === 0 && range.toString().endsWith('\n');
          edit.insert('', 0);
          // Same frame-wrapper detach crash as the Backspace branch above: a
          // multi-line selection delete must reconcile synchronously so React
          // commits the structural change instead of crashing on a detached node.
          flushChanges(true, true, { deletedFromLineStart });
          return;
        }
        edit.insert('', 1);
        const afterForwardDelete = getPosition(element);
        if (getLineInfo(element, afterForwardDelete.line).currentLine.length === 0) {
          flushChanges(true, true);
          return;
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
        ((event.key === 'PageDown' && boundsRef.current.maxRow !== undefined) ||
          (event.key === 'PageUp' && boundsRef.current.minRow !== undefined)) &&
        !event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        // Paging inside a COLLAPSED window: the hidden out-of-window lines are
        // still in the DOM, so the browser's native PageUp/PageDown drops the
        // caret into the non-editable padding filler beyond the fold. Instead,
        // move the caret to the far visible edge in the paging direction and ask
        // the host to expand — landing it on a real, now-revealed line. Mirrors
        // the arrow-at-edge handling: PageDown engages only when `maxRow` is set
        // (a bottom fold to protect, like `ArrowDown` at `maxRow`) and PageUp
        // only when `minRow` is set. With no bound in the press direction there
        // is no fold to strand into, so the key falls through to native handling
        // instead of half-engaging. Bounded cost (one `getLineInfo` for the edge
        // line). Only acts on a collapsed selection so Shift-paging (range
        // extension) stays native.
        const range = getCurrentRange();
        const { minRow, maxRow, onBoundary } = boundsRef.current;
        if (range.collapsed && onBoundary) {
          const column = getPosition(element).content.length;
          const targetRow = event.key === 'PageDown' ? maxRow : minRow;
          if (targetRow !== undefined) {
            event.preventDefault();
            const edge = getLineInfo(element, targetRow).currentLine;
            edit.move({ row: targetRow, column: Math.min(column, edge.length) });
            state.position = getPosition(element);
            state.skipNextRestore = true;
            onBoundary();
          }
        }
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
            // Refresh the tracked caret to the new position. Arrow navigation
            // otherwise never updates `state.position` (it is only seeded on
            // click/focus and edits), so a host re-render triggered by
            // `onBoundary` (e.g. expanding a collapsed block) would restore the
            // stale pre-navigation position — snapping the caret back to where
            // the user last clicked instead of where the arrow key left it.
            state.position = getPosition(element);
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
            } else if (
              caretSelector !== undefined &&
              position.line > 0 &&
              (prevLine.length === 0 || lineText.length === 0)
            ) {
              // Zero-height blank lines (`.line` blocks with no content) are
              // skipped by the browser's native vertical navigation, so a
              // single ArrowUp can jump over one or more blank rows. Step
              // exactly one logical line up synchronously — preventing the
              // native skip so the user never sees the caret land on the wrong
              // line first — whenever the row we leave or the row we enter is
              // blank. Gated on `caretSelector` (not `caretInLine`) because a
              // caret sitting *on* a blank line lives in the inter-line gap
              // text node, not inside a `.line`, so `caretInLine` is false
              // there; the logical row from `getPosition` stays accurate.
              // Non-blank rows fall through to native handling so wrapped
              // visual lines keep behaving natively.
              event.preventDefault();
              moveToLine(position.line - 1, prevLine, column);
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
            } else if (
              caretSelector !== undefined &&
              hasNextLine &&
              (nextLine.length === 0 || lineText.length === 0)
            ) {
              // Mirror of ArrowUp: step onto the blank row the browser would
              // otherwise skip. See the ArrowUp branch above.
              event.preventDefault();
              moveToLine(position.line + 1, nextLine, column);
            }
          } else if (event.key === 'ArrowLeft') {
            if (atVisibleStart && atLineStart) {
              if (caretInLine && position.line > 0) {
                event.preventDefault();
                // Use `moveToLine` (not a bare `edit.move`) so `state.position`
                // is updated to the end of the previous line. Like the ArrowUp /
                // ArrowDown / ArrowRight boundary branches, `onBoundary` triggers
                // a host re-render (expand); the per-render caret restore reads
                // `state.position`, so a stale value would snap the caret back to
                // the boundary line instead of landing it on the revealed line.
                moveToLine(position.line - 1, prevLine, prevLine.length);
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
      } else if (
        // Gate on the rendered structure (`.line` spans carry `data-ln`), NOT on
        // `boundsRef.current.caretSelector`: the host drops `caretSelector` to
        // undefined whenever `shouldHighlight` is false (an EXPANDED block, or a
        // post-edit re-highlight in flight), yet the `.line`/frame structure
        // persists. The old live-`caretSelector` check silently disabled this
        // whole branch in those states, leaving native Shift+Arrow to stall on
        // the zero-height empty lines this branch exists to step over.
        element.querySelector('[data-ln]') !== null &&
        event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        (event.key === 'ArrowUp' || event.key === 'ArrowDown')
      ) {
        // Shift+Up/Down selection extension in a framed editor (`caretSelector`
        // set, with non-selectable inter-line gap `\n` text nodes between
        // `.line` spans). The browser's native vertical selection-extension
        // skips zero-height blank `.line` spans (a two-line jump) and parks the
        // focus in a gap node. Step the FOCUS exactly one logical `.line`
        // synchronously — preserving the anchor — so the selection grows one
        // line at a time and the focus always lands inside a `.line`.
        const sel = element.ownerDocument.defaultView?.getSelection();
        if (sel && sel.rangeCount > 0 && sel.focusNode && element.contains(sel.focusNode)) {
          // The focus is the moving end; `getPosition` reads the range start
          // (the anchor on a forward selection), so derive the focus row/column
          // straight from the live selection's focus.
          const focusProbe = element.ownerDocument.createRange();
          focusProbe.setStart(element, 0);
          focusProbe.setEnd(sel.focusNode, sel.focusOffset);
          const beforeFocus = focusProbe.toString();
          const focusRow = beforeFocus.split('\n').length - 1;
          const focusColumn = beforeFocus.length - (beforeFocus.lastIndexOf('\n') + 1);
          const { hasNextLine } = getLineInfo(element, focusRow);
          const goingUp = event.key === 'ArrowUp';
          const { minColumn, minRow, maxRow } = boundsRef.current;
          // Don't extend the selection past the collapsed window into the
          // zero-height clipped frames above `minRow` / below `maxRow`: the
          // focus would land in an h=0 region and paint a stray highlight on a
          // hidden line (and strand the focus in a non-selectable node).
          // `preventDefault` blocks the native extension too; the user can
          // expand the window to reach the hidden lines. Mirrors the non-shift
          // arrow boundary handling, minus the `onBoundary` expand (which would
          // collapse the in-progress selection on the restore).
          const atWindowEdge = goingUp
            ? minRow !== undefined && focusRow <= minRow
            : maxRow !== undefined && focusRow >= maxRow;
          if (atWindowEdge) {
            event.preventDefault();
          } else if (goingUp ? focusRow > 0 : hasNextLine) {
            event.preventDefault();
            // Step the focus exactly ONE logical line. Crucially this is row-based
            // (text newline count), so it advances correctly even across a line
            // the browser renders at ZERO height — an empty line the CSS collapses
            // to 0px. Native Shift+Arrow stalls there (it works in visual space and
            // a zero-height line has none), which is the "two Shift+Downs land on
            // the same line / can't get past the empty line" bug. We step in
            // logical space and `extend` to a real offset, so each press advances
            // one line, empty or not.
            const targetRow = goingUp ? focusRow - 1 : focusRow + 1;
            const targetLine = getLineInfo(element, targetRow).currentLine;
            let targetColumn = Math.min(focusColumn, targetLine.length);
            if (
              minColumn !== undefined &&
              targetLine.length >= minColumn &&
              /^\s*$/.test(targetLine.slice(0, minColumn)) &&
              targetColumn < minColumn
            ) {
              targetColumn = minColumn;
            }
            const targetRange = makeRange(
              element,
              getOffsetAtLineColumn(element, targetRow, targetColumn),
            );
            adjustCursorAtNewlineBoundary(targetRange);
            sel.extend(targetRange.startContainer, targetRange.startOffset);
            // Keep the tracked selection in sync so a host re-render's restore
            // preserves the extended range instead of snapping it back.
            const trackedPosition = getPosition(element);
            // `getPosition` reads the forward-normalized range start and so loses
            // which end is the focus. Record the direction explicitly: a backward
            // selection (focus above the anchor) must be rebuilt focus-at-top on
            // restore, or `addRange` would flip the focus to the bottom and the
            // next Shift+Arrow would extend from the wrong end. The focus we just
            // moved sits at the range start exactly when the selection is backward.
            if (sel.anchorNode && element.contains(sel.anchorNode)) {
              const anchorProbe = element.ownerDocument.createRange();
              anchorProbe.setStart(element, 0);
              anchorProbe.setEnd(sel.anchorNode, sel.anchorOffset);
              const anchorOffset = anchorProbe.toString().length;
              if (anchorOffset > trackedPosition.position) {
                trackedPosition.backward = true;
              }
            }
            state.position = trackedPosition;
          }
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
          // The user may have moved focus or cleared the selection in the
          // 100ms since the last repeat keydown (e.g. clicked elsewhere,
          // unmounted, blurred). The debounced flush is best-effort; if the
          // engine is gone or there's no live selection inside the editable
          // any more, skip — the next real event will pick up state.
          //
          // Bail out before touching `window`: a stray timer can fire after
          // teardown, and in a test environment the `window` global may already
          // be removed, so `window.getSelection()` would throw a `ReferenceError`
          // (an unhandled rejection that can mask real failures).
          if (state.disconnected || typeof window === 'undefined') {
            return;
          }
          const selection = window.getSelection();
          if (
            !selection ||
            selection.rangeCount === 0 ||
            !element.contains(selection.getRangeAt(0).startContainer)
          ) {
            return;
          }
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
      // browser-merged DOM states. Enter also forces a synchronous React
      // state sync (bypassing `preParse`) so newlines render immediately.
      if (!isUndoRedoKey(event)) {
        flushChanges(event.key === 'Enter', event.key === 'Enter');
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
      // Paste replaces a chunk of source — flush synchronously so the
      // pasted text highlights on the same commit instead of after a
      // worker round-trip.
      flushChanges(true, true);
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

      // The caret-navigation guard already treats `[0, minColumn)` as a
      // clipped indent gutter. Strip up to that many leading whitespace
      // characters per line from the clipboard so the pasted snippet
      // matches what the user sees rather than including indent that
      // is hidden in the editable.
      const plainText =
        restStrip > 0
          ? stripLeadingPerLine(range.toString(), firstLineStrip, restStrip)
          : range.toString();
      event.clipboardData.setData('text/plain', plainText);

      const container = cloneRangeWithInlineStyles(element, range, {
        elementStyleProps: CLIPBOARD_ELEMENT_STYLE_PROPS,
        rootStyleProps: CLIPBOARD_ROOT_STYLE_PROPS,
        rootStaticStyles: CLIPBOARD_ROOT_STATIC_STYLES,
      });
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
        // Cut also bypasses preParse so the resulting document re-renders
        // synchronously alongside the clipboard write.
        flushChanges(true, true);
      }
    };

    // Capture the current caret/selection into `state.position` when the
    // selection lives inside the editable. The `selectstart` listener only
    // fires for newly-initiated selections (typically mouse drags) — it
    // does NOT fire for a plain click that places a collapsed caret. Without
    // this capture, a user who clicks into the editable but hasn't typed
    // yet has `state.position === null`, so the unconditional restore in
    // the first `useLayoutEffect` skips and a host re-render (e.g.
    // expanding a collapsed code block) lets the DOM mutation clobber the
    // browser's selection, producing a visible "cursor lost / text
    // selected" jump. Re-using `getPosition` matches what `onSelect` does.
    const capturePosition = () => {
      const hasRange = (window.getSelection()?.rangeCount ?? 0) > 0;
      if (!hasRange) {
        return;
      }
      const selection = window.getSelection();
      const anchorNode = selection?.anchorNode ?? null;
      if (!anchorNode || !element.contains(anchorNode)) {
        return;
      }
      state.position = getPosition(element);
    };

    // Pull a non-collapsed selection's focus back inside the collapsed window
    // when a drag carried it past `minRow`/`maxRow` into a zero-height clipped
    // frame (the hidden lines above/below the fold). Leaving it there paints a
    // stray highlight on a line the user can't see. Browsers usually clamp a
    // drag to the visible content on their own, but autoscroll past the fold can
    // defeat that — this is the requested fix-on-mouse-up safety net. A no-op
    // when the focus already rests inside the window.
    const clampSelectionToWindow = () => {
      const { minRow, maxRow } = boundsRef.current;
      if (minRow === undefined && maxRow === undefined) {
        return;
      }
      const sel = element.ownerDocument.defaultView?.getSelection();
      if (
        !sel ||
        sel.rangeCount === 0 ||
        sel.isCollapsed ||
        !sel.focusNode ||
        !element.contains(sel.focusNode)
      ) {
        return;
      }
      const focusProbe = element.ownerDocument.createRange();
      focusProbe.setStart(element, 0);
      focusProbe.setEnd(sel.focusNode, sel.focusOffset);
      const focusRow = focusProbe.toString().split('\n').length - 1;
      let targetRow: number | undefined;
      let targetColumn = 0;
      if (maxRow !== undefined && focusRow > maxRow) {
        targetRow = maxRow;
        targetColumn = getLineInfo(element, maxRow).currentLine.length;
      } else if (minRow !== undefined && focusRow < minRow) {
        targetRow = minRow;
        targetColumn = 0;
      }
      if (targetRow === undefined) {
        return;
      }
      const targetOffset = getOffsetAtLineColumn(element, targetRow, targetColumn);
      const targetRange = makeRange(element, targetOffset);
      adjustCursorAtNewlineBoundary(targetRange);
      // `extend` moves only the focus, leaving the drag's anchor put.
      sel.extend(targetRange.startContainer, targetRange.startOffset);
    };

    const onMouseUp = () => {
      // First pull a drag-selection focus out of the clipped region, then lift
      // a collapsed caret out of any inter-line gap node so the gutter check
      // below can see a real line position.
      clampSelectionToWindow();
      snapCaretOutOfGapNode('forward', false, 0);
      snapCaretOutOfGutter();
      capturePosition();
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
        capturePosition();
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
      // Abort any in-flight preParse so its eventual `onChange` doesn't
      // fire after the editable has been torn down or toggled disabled.
      if (state.preParseAbort) {
        state.preParseAbort.abort();
        state.preParseAbort = null;
      }
      document.removeEventListener('selectstart', onSelect);
      window.removeEventListener('keydown', onKeyDown);
      element.removeEventListener('paste', onPaste);
      element.removeEventListener('copy', onCopyOrCut);
      element.removeEventListener('cut', onCopyOrCut);
      element.removeEventListener('keyup', onKeyUp);
      element.removeEventListener('mouseup', onMouseUp);
      element.removeEventListener('focus', onFocus);
      styleSetupCancelled = true;
      // Restore synchronously so observers on the same tick as
      // `unmount()` see the pre-mount values. Skipped when the host
      // has already been detached (the typical page-transition case),
      // where the write would be wasted. The mount-side deferred style
      // task is cancelled above, so there's no microtask race.
      if (element.isConnected) {
        element.style.whiteSpace = prevWhiteSpace;
        element.contentEditable = prevContentEditable;
      }
    };
  };

  return { edit, observeAndRestore, setup };
};
