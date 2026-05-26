'use client';

import * as React from 'react';
import { type ElementContent, type RootContent } from 'hast';
import { useEditable, type Position } from './useEditable';
import type { SetSource } from './useSourceEditing';
import type { HastRoot, VariantSource } from '../CodeHighlighter/types';
import { useCodeContext } from '../CodeProvider/CodeContext';
import { hastToJsx, decompressHast } from '../pipeline/hastUtils';
import { stripHighlightingSpans } from '../pipeline/hastUtils/stripHighlightingSpans';
import { getSourceLineCounts } from './useCodeUtils';

const hastChildrenCache = new WeakMap<ElementContent[], React.ReactNode>();
const fallbackHastCache = new WeakMap<ElementContent[], React.ReactNode>();

// Document-level subscriber registry for `<details>` toggle events. Each
// `<Pre>` would otherwise install its own capture-phase listener; on docs
// pages with many code blocks that's N listeners all firing on every
// toggle anywhere in the document. A single shared listener fans out to
// the relevant subscribers instead.
//
// Subscribers register their `<pre>` element so the dispatcher can do a
// single `target.contains(pre)` ancestry check per subscriber and skip
// the nudge entirely for unrelated toggles — no JS-side work runs in
// `<Pre>` instances whose subtree the toggle didn't touch.
//
// The value is a Set rather than a single function so the registry
// tolerates the (unlikely but possible) case where two `<Pre>` instances
// transiently share the same DOM node — e.g. a fast unmount/remount
// where the next mount's setup runs before the prior mount's cleanup.
// Without the set the second subscribe would silently overwrite the
// first nudge and a single unsubscribe would orphan the other instance.
type ToggleNudge = () => void;
const toggleSubscribers = new Map<HTMLElement, Set<ToggleNudge>>();
let toggleListenerAttached = false;
let sharedToggleListener: ((event: Event) => void) | null = null;

// Reconcile the document-level capture listener with the current
// subscriber set. Idempotent: callable from any code path (including
// test teardowns that want to defensively assert no leaked listener)
// without risk of leaving the document in a half-attached state.
function syncToggleListener(): void {
  if (typeof document === 'undefined') {
    if (toggleSubscribers.size === 0) {
      sharedToggleListener = null;
      toggleListenerAttached = false;
    }
    return;
  }
  if (toggleSubscribers.size === 0) {
    if (toggleListenerAttached && sharedToggleListener) {
      document.removeEventListener('toggle', sharedToggleListener, true);
    }
    sharedToggleListener = null;
    toggleListenerAttached = false;
    return;
  }
  if (!toggleListenerAttached || !sharedToggleListener) {
    sharedToggleListener = (event) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      // Snapshot before iterating: a nudge may synchronously trigger an
      // unmount that mutates `toggleSubscribers` mid-dispatch. Iterating
      // a snapshot keeps dispatch order independent of subscriber
      // mutations and matches the snapshot pattern used by
      // `sweepDetachedFrames` / `nudgeFrameObserver`.
      Array.from(toggleSubscribers).forEach(([preNode, nudges]) => {
        // Centralized ancestry filter: only nudge subscribers whose `<pre>`
        // is a descendant of the toggled element. Done here (rather than
        // in each subscriber) so unrelated toggles short-circuit before
        // any subscriber-side work runs.
        if (!target.contains(preNode)) {
          return;
        }
        Array.from(nudges).forEach((nudge) => nudge());
      });
    };
    document.addEventListener('toggle', sharedToggleListener, true);
    toggleListenerAttached = true;
  }
}

function subscribeToggleNudge(preNode: HTMLElement, nudge: ToggleNudge): () => void {
  // Defensive SSR no-op: there is no `document` to attach a listener to,
  // and module state in Node persists across requests — leaking a
  // subscriber here would also leak the closure it captures. `useEffect`
  // already won't run on the server, but make the contract explicit so
  // any future non-effect caller can't strand entries in the registry.
  if (typeof document === 'undefined') {
    return () => {};
  }
  let nudges = toggleSubscribers.get(preNode);
  if (!nudges) {
    nudges = new Set();
    toggleSubscribers.set(preNode, nudges);
  }
  nudges.add(nudge);
  syncToggleListener();
  return () => {
    const existing = toggleSubscribers.get(preNode);
    if (existing) {
      existing.delete(nudge);
      if (existing.size === 0) {
        toggleSubscribers.delete(preNode);
      }
    }
    syncToggleListener();
  };
}

const INITIAL_VISIBLE_FRAME_TYPES = new Set([
  'highlighted',
  'focus',
  'padding-top',
  'padding-bottom',
]);

function getInitialVisibleFrames(hast: HastRoot | null): { [key: number]: boolean } {
  if (!hast) {
    return { 0: true };
  }

  const visibleFrames: { [key: number]: boolean } = {};
  let frameIndex = 0;
  let hasVisibleEmphasisFrame = false;

  hast.children.forEach((child) => {
    if (child.type !== 'element' || child.properties.className !== 'frame') {
      return;
    }

    const frameType = child.properties.dataFrameType;
    if (typeof frameType === 'string' && INITIAL_VISIBLE_FRAME_TYPES.has(frameType)) {
      visibleFrames[frameIndex] = true;
      hasVisibleEmphasisFrame = true;
    }

    frameIndex += 1;
  });

  if (!hasVisibleEmphasisFrame && frameIndex > 0) {
    visibleFrames[0] = true;
  }

  return visibleFrames;
}

/**
 * Bounds describing the visible region of a collapsible code block in its
 * collapsed state. Used to constrain caret movement in `useEditable` and to
 * trigger expansion when the user navigates past the boundaries.
 */
type CollapsedBounds = {
  /**
   * Smallest column the visible region exposes on indented lines (derived
   * from the minimum `data-frame-indent` across collapsed-visible region
   * frames). `undefined` when no visible region frame is indented.
   */
  minColumn: number | undefined;
  /** First row of the visible region. */
  minRow: number;
  /** Last row of the visible region. */
  maxRow: number;
};

/**
 * Counts newlines in a hast subtree and reports whether the tree's text
 * content ends with a newline. Walks text nodes directly instead of
 * materializing the subtree into a string — avoids the O(N) allocation
 * `hast-util-to-text` performs per call, which adds up across hundreds of
 * frames in large code blocks.
 *
 * Returns `[newlineCount, endsWithNewline]`. `endsWithNewline` is `false`
 * for an empty subtree (matches the previous `text.endsWith('\n')` check
 * on an empty string).
 */
function countFrameNewlines(node: ElementContent | HastRoot): [number, boolean] {
  let count = 0;
  let endsWithNewline = false;
  let sawText = false;

  const walk = (current: { type: string; value?: unknown; children?: unknown }): void => {
    if (current.type === 'text') {
      const value = current.value as string;
      if (value.length === 0) {
        return;
      }
      sawText = true;
      for (let i = 0; i < value.length; i += 1) {
        if (value.charCodeAt(i) === 10 /* \n */) {
          count += 1;
        }
      }
      endsWithNewline = value.charCodeAt(value.length - 1) === 10;
      return;
    }
    if (Array.isArray(current.children)) {
      const children = current.children;
      for (let i = 0; i < children.length; i += 1) {
        walk(children[i]);
      }
    }
  };

  walk(node);
  return [count, sawText && endsWithNewline];
}

/**
 * Counts newlines in a hast subtree without tracking the trailing-newline
 * flag. Used for hidden frames that precede the visible-when-collapsed
 * region: we only need to advance the running row offset, not figure out
 * how the frame's last line aligns.
 */
function countFrameNewlinesOnly(node: ElementContent | HastRoot): number {
  let count = 0;

  const walk = (current: { type: string; value?: unknown; children?: unknown }): void => {
    if (current.type === 'text') {
      const value = current.value as string;
      for (let i = 0; i < value.length; i += 1) {
        if (value.charCodeAt(i) === 10 /* \n */) {
          count += 1;
        }
      }
      return;
    }
    if (Array.isArray(current.children)) {
      const children = current.children;
      for (let i = 0; i < children.length; i += 1) {
        walk(children[i]);
      }
    }
  };

  walk(node);
  return count;
}

/**
 * When the code block is collapsible, returns the row range of the
 * collapsed-visible frames (the same set used by `getInitialVisibleFrames`)
 * along with the minimum indent column. Returns `undefined` when the block
 * isn't collapsible or no frame is visible-when-collapsed.
 *
 * `data-frame-indent` is encoded as `leadingSpaces / indentation`, so the
 * column count is `indent * indentation`.
 */
function computeCollapsedBounds(
  hast: HastRoot | null,
  indentation: number,
): CollapsedBounds | undefined {
  if (!hast || hast.data?.collapsible !== true) {
    return undefined;
  }

  let minIndent: number | undefined;
  let minRow: number | undefined;
  let maxRow: number | undefined;
  let row = 0;

  for (const child of hast.children) {
    if (child.type !== 'element' || child.properties.className !== 'frame') {
      continue;
    }
    const frameType = child.properties.dataFrameType;
    const indent = child.properties.dataFrameIndent;
    const isVisibleWhenCollapsed =
      typeof frameType === 'string' && INITIAL_VISIBLE_FRAME_TYPES.has(frameType);

    if (!isVisibleWhenCollapsed) {
      // Once we've passed the visible region, hidden frames can't change
      // any output — bail out entirely.
      if (maxRow !== undefined) {
        break;
      }
      // Hidden frames before the visible region only need their row count
      // to keep `row` accurate for the next visible frame's `minRow`. We
      // don't need `endsWithNewline` (only consumed by visible frames for
      // `maxRow` arithmetic) or any indent metadata, so do the cheap
      // newline-only walk.
      row += countFrameNewlinesOnly(child);
      continue;
    }

    const [newlines, endsWithNewline] = countFrameNewlines(child);
    const lastContentRow = endsWithNewline ? row + Math.max(0, newlines - 1) : row + newlines;

    if (minRow === undefined) {
      minRow = row;
    }
    maxRow = lastContentRow;
    if (typeof indent === 'number' && (minIndent === undefined || indent < minIndent)) {
      minIndent = indent;
    }

    row += newlines;
  }

  if (minRow === undefined || maxRow === undefined) {
    return undefined;
  }

  return {
    minColumn: minIndent !== undefined && minIndent > 0 ? minIndent * indentation : undefined,
    minRow,
    maxRow,
  };
}

function renderCode(
  hastChildren: ElementContent[],
  renderHast?: boolean,
  fallback?: ElementContent[],
) {
  if (renderHast) {
    let jsx = hastChildrenCache.get(hastChildren);
    if (!jsx) {
      jsx = hastToJsx({ type: 'root', children: hastChildren });
      hastChildrenCache.set(hastChildren, jsx);
    }
    return jsx;
  }

  // Server-rendered / pre-hydration fallback: drop highlighting spans but
  // keep frame + collapse placeholders + link structure so the rendered
  // block matches the height of the fully-highlighted version. This avoids
  // a layout shift when a frame swaps from fallback to highlighted on
  // intersection.
  //
  // Prefer a precomputed fallback (set on `frame.data.fallback` by
  // `addLineGutters` for multi-frame splits) — usually a single text node —
  // so the renderer skips the per-frame `stripHighlightingSpans` walk.
  if (fallback) {
    let jsx = fallbackHastCache.get(fallback);
    if (!jsx) {
      jsx = hastToJsx({ type: 'root', children: fallback });
      fallbackHastCache.set(fallback, jsx);
    }
    return jsx;
  }

  let jsx = fallbackHastCache.get(hastChildren);
  if (!jsx) {
    const stripped = stripHighlightingSpans({ type: 'root', children: hastChildren });
    jsx = hastToJsx(stripped);
    fallbackHastCache.set(hastChildren, jsx);
  }
  return jsx;
}

function renderFallbackChild(child: RootContent) {
  // Same fallback path as `renderCode` but for top-level non-frame children
  // (e.g. text whitespace between frames). Caching is keyed by the parent
  // children array in `renderFrames` via React reconciliation; the
  // structural cost here is bounded by hast size.
  const stripped = stripHighlightingSpans({ type: 'root', children: [child] });
  return hastToJsx(stripped);
}

export function Pre({
  children,
  className,
  fileName,
  debugScope,
  bridgeLineMode = 'focus',
  language,
  ref,
  setSource,
  shouldHighlight,
  hydrateMargin = '200px 0px 200px 0px',
  expanded = false,
  expand,
  transforming,
  swapTarget,
}: {
  children: VariantSource;
  className?: string;
  fileName?: string;
  debugScope?: string;
  bridgeLineMode?: 'focus' | 'total';
  language?: string;
  ref?: React.Ref<HTMLPreElement>;
  setSource?: SetSource;
  shouldHighlight?: boolean;
  hydrateMargin?: string;
  /**
   * Whether the host has expanded the (collapsible) code block. When `true`,
   * collapsed-state behaviors such as `minColumn` are disabled so the caret
   * can move into the indent gutter normally.
   */
  expanded?: boolean;
  /**
   * Called when the user attempts to navigate the caret past the visible
   * region of a collapsed code block (e.g. `ArrowUp` on the first visible
   * row, `ArrowDown` on the last). Typically wired to the host's
   * `expand()` action.
   */
  expand?: () => void;
  /**
   * Direction of an in-flight transform animation, or `null` when
   * settled. When set, the rendered `<pre>` is annotated with a
   * `data-transforming="expand"` (outgoing tree's `.collapse`
   * placeholders should expand back to their original height before the
   * swap) or `data-transforming="collapse"` (incoming tree's `.collapse`
   * placeholders should collapse from their original height down to 0)
   * attribute so consumer CSS can run direction-specific animations.
   */
  transforming?: 'expand' | 'collapse' | null;
  /**
   * Per-file line counts from the *other* variant participating in an
   * in-flight variant swap. When set alongside `transforming`, `<Pre>`
   * appends a bridge `<span class="collapse" data-lines={delta}>` to
   * the last visible frame (when collapsed) or the last frame overall
   * (when expanded) so consumer CSS can animate the height delta
   * between the two variants. The placeholder is only added when the
   * partner has *more* lines than the currently-rendered tree (i.e.
   * this `<Pre>` is the shorter side of the swap); otherwise the
   * rendered hast is returned untouched.
   *
   * `null` (or omitted) disables the bridge entirely — useful for
   * transform-only swaps where `transforming` is set but no variant
   * swap is in flight.
   */
  swapTarget?: { focusedLines: number; totalLines: number } | null;
}): React.ReactNode {
  const hast = React.useMemo(() => {
    if (typeof children === 'string') {
      return null;
    }

    if ('hastJson' in children) {
      return JSON.parse(children.hastJson) as HastRoot;
    }

    if ('hastCompressed' in children) {
      return JSON.parse(decompressHast(children.hastCompressed)) as HastRoot;
    }

    return children;
  }, [children]);

  // Variant-swap bridge descriptor. While a variant swap is in flight
  // and the partner variant is taller than this one, we render an
  // extra `<span class="collapse">` inside the appropriate frame so
  // consumer CSS can animate the missing height before/after the swap
  // commits. The bridge is JSX-only — `hast` itself is left pristine
  // so caret bounds, line-gutter math, and the `visibleFrames` IO
  // seeding all stay anchored to the real tree.
  const shouldLogBridgeDebug = debugScope === 'demo-variants';
  const bridge = React.useMemo<{ frameIndex: number; lines: number } | null>(() => {
    if (shouldLogBridgeDebug) {
      console.warn('[bridge:input]', {
        hasHast: !!hast,
        transforming,
        swapTarget,
        expanded,
        bridgeLineMode,
        fileName,
        debugScope,
      });
    }
    if (!hast || !transforming || !swapTarget) {
      return null;
    }
    const { totalLines: currentTotal, focusedLines: currentFocused } = getSourceLineCounts(hast);
    const compareFocused = bridgeLineMode === 'focus' && !expanded;
    const current = compareFocused ? currentFocused : currentTotal;
    const target = compareFocused ? swapTarget.focusedLines : swapTarget.totalLines;
    const lines = target - current;
    if (shouldLogBridgeDebug) {
      console.warn('[bridge:counts]', {
        currentTotal,
        currentFocused,
        target,
        current,
        lines,
        compareFocused,
        hastDataKeys: hast.data ? Object.keys(hast.data) : null,
      });
    }
    if (lines <= 0) {
      return null;
    }
    // Pick the frame the bridge lands in:
    //   - collapsed: the last frame that's visible-by-default (so the
    //     placeholder sits inside the focus window).
    //   - expanded:  the last frame overall (placeholder appears at
    //     the bottom of the fully-rendered block).
    let frameIndex = -1;
    let candidate = -1;
    for (let i = 0; i < hast.children.length; i += 1) {
      const child = hast.children[i];
      if (child.type !== 'element' || child.properties.className !== 'frame') {
        continue;
      }
      frameIndex += 1;
      if (!expanded) {
        const frameType = child.properties.dataFrameType;
        if (typeof frameType === 'string' && INITIAL_VISIBLE_FRAME_TYPES.has(frameType)) {
          candidate = frameIndex;
        }
      } else {
        candidate = frameIndex;
      }
    }
    if (candidate < 0) {
      return null;
    }
    if (shouldLogBridgeDebug) {
      console.warn('[bridge:result]', { frameIndex: candidate, lines });
    }
    return { frameIndex: candidate, lines };
  }, [
    hast,
    transforming,
    swapTarget,
    expanded,
    bridgeLineMode,
    fileName,
    debugScope,
    shouldLogBridgeDebug,
  ]);

  const preRef = React.useRef<HTMLPreElement>(null);

  // useEditable uses ref.current in its effect deps. On first render it's null
  // (set later by the callback ref), so the deps change on the next render,
  // causing contentEditable to flash and the cursor to be lost. Delaying
  // enablement by one synchronous re-render ensures the ref is already set
  // when useEditable first activates, keeping deps stable afterward.
  const [editableReady, setEditableReady] = React.useState(false);
  React.useLayoutEffect(() => {
    setEditableReady(true);
  }, []);

  const onEditableChange = React.useCallback(
    (text: string, position: Position, preParsed?: HastRoot) => {
      setSource?.(text, fileName, position, preParsed);
    },
    [setSource, fileName],
  );

  // Worker-backed async parser exposed by `CodeProvider`. When present we
  // hand it to `useEditable` as `preParse` so highlighting moves off the
  // main thread during live typing. The resolved HAST is forwarded into
  // `setSource` (4th arg) where the host can stash it in a per-file cache
  // so the synchronous `parseControlledCode` pass can reuse it.
  const { parseSourceAsync } = useCodeContext();
  const preParse = React.useMemo(() => {
    if (!setSource || !parseSourceAsync || !fileName) {
      return undefined;
    }
    return (text: string, _position: Position, signal: AbortSignal) =>
      parseSourceAsync(text, fileName, language, signal);
  }, [setSource, parseSourceAsync, fileName, language]);

  const [visibleFrames, setVisibleFrames] = React.useState<{ [key: number]: boolean }>(() =>
    getInitialVisibleFrames(hast),
  );

  // Re-seed `visibleFrames` whenever the parsed tree identity changes
  // (e.g. a transform swap such as JS↔TS, where the host keeps `<Pre>`
  // mounted — see `getPreRenderKey` in `useFileNavigation`). Without
  // this, frame indices computed from a prior tree leak into the new
  // one: any emphasis frames that should be visible on first render of
  // the new tree would stay un-hydrated until the IntersectionObserver
  // corrects them (or indefinitely in environments without IO).
  //
  // We *union* the new initial-visible set onto whatever is currently
  // visible rather than replacing outright. Replacing would drop frames
  // hydrated by IO/editing in the prior tree before IO has a chance to
  // re-run, causing a visible flash. Stale indices that no longer map
  // to a frame in the new tree are harmless — the render loop skips
  // them, and IO prunes them on the next pass.
  //
  // Runs in `useLayoutEffect` so the merged state commits before paint,
  // keeping the update outside the render phase while still avoiding a
  // visible flash of un-hydrated emphasis frames.
  React.useLayoutEffect(() => {
    setVisibleFrames((prev) => {
      const initial = getInitialVisibleFrames(hast);
      let merged: { [key: number]: boolean } | undefined;
      Object.keys(initial).forEach((key) => {
        const index = Number(key);
        if (prev[index] !== true) {
          if (!merged) {
            merged = { ...prev };
          }
          merged[index] = true;
        }
      });
      return merged || prev;
    });
  }, [hast]);

  // When the code block is collapsible AND currently collapsed, derive the
  // visible region's row range and minimum indent column so that:
  //   - the caret never lands in the clipped indent gutter (`minColumn`),
  //   - arrow-key navigation past the visible region is blocked, optionally
  //     calling `expand` so the host can reveal the hidden content.
  // See `computeCollapsedBounds` above.
  //
  // `data-frame-indent` is encoded as `leadingSpaces / 2`, matching the
  // hardcoded `indentation: 2` below.
  const indentation = 2;
  const collapsedBounds = React.useMemo(
    () => (expanded ? undefined : computeCollapsedBounds(hast, indentation)),
    [hast, expanded],
  );

  useEditable(preRef, onEditableChange, {
    indentation,
    disabled: !setSource || !editableReady,
    minColumn: collapsedBounds?.minColumn,
    minRow: collapsedBounds?.minRow,
    maxRow: collapsedBounds?.maxRow,
    onBoundary: collapsedBounds && expand ? expand : undefined,
    // The HAST emitted for highlighted code separates `.line` spans with
    // whitespace text nodes (newlines) that are direct children of `.frame`.
    // Without this, clicks or arrow navigation could land the caret in
    // those gap nodes \u2014 visually invisible (collapsed via line-height: 0)
    // but still real text positions in contentEditable. `.line` matches
    // every selectable row. Only set when the highlighter has actually
    // produced `.line` elements.
    caretSelector: shouldHighlight ? '.line' : undefined,
    preParse,
  });

  const observer = React.useRef<IntersectionObserver | null>(null);
  const observedFrames = React.useRef<Set<Element>>(new Set());
  const frameIndexMap = React.useRef(new WeakMap<Element, number>());

  // Drop frame spans that have been detached from the DOM. Used as a
  // defensive sweep in `nudgeFrameObserver` (and the IO effect) so the
  // tracking sets don't grow unboundedly across re-renders, even on
  // React 17/18 where the cleanup return value of `observeFrame` is
  // ignored. `node.isConnected` is the cheapest available signal.
  const sweepDetachedFrames = React.useCallback(() => {
    const io = observer.current;
    // Snapshot before iterating: we mutate `observedFrames` inside the
    // loop, so iterating the live Set would rely on its (well-defined
    // but subtle) skip-deleted-entries semantics. An array snapshot makes
    // the intent explicit and decouples iteration order from insertion
    // order should the storage ever change.
    Array.from(observedFrames.current).forEach((frame) => {
      if (!frame.isConnected) {
        observedFrames.current.delete(frame);
        frameIndexMap.current.delete(frame);
        io?.unobserve(frame);
      }
    });
  }, []);

  // Re-observe every tracked frame so the IntersectionObserver re-evaluates
  // visibility without a synchronous `getBoundingClientRect()` call. Used
  // when ancestor layout changes (CSS-driven collapse/expand, <details>
  // toggle, tab/accordion swaps) clip or unclip frames in ways that don't
  // themselves trigger an IntersectionObserver entry. Mirrors the
  // `nudgeObserver` pattern in `<TypeCode>`.
  const nudgeFrameObserver = React.useCallback(() => {
    const io = observer.current;
    if (!io) {
      return;
    }
    // Snapshot before iterating — see `sweepDetachedFrames` above.
    Array.from(observedFrames.current).forEach((frame) => {
      if (!frame.isConnected) {
        observedFrames.current.delete(frame);
        frameIndexMap.current.delete(frame);
        io.unobserve(frame);
        return;
      }
      io.unobserve(frame);
      io.observe(frame);
    });
  }, []);

  // Holds the mounted `<pre>` element so the IO/RO/toggle setup effect can
  // key on it. Using a state + callback-ref pair (rather than driving the
  // setup from inside the ref callback) lets React's effect lifecycle
  // guarantee teardown — including under StrictMode's double-invoke and
  // for any abrupt unmount path — instead of relying on the ref callback
  // being called with `null`.
  const [preNode, setPreNode] = React.useState<HTMLPreElement | null>(null);

  // Mirror the latest forwarded `ref` so `bindPre` can read it without
  // depending on `ref` in its deps (which would re-create `bindPre` on
  // every parent re-render and tear down the IO/RO/toggle setup effect
  // below). Using `useLayoutEffect` (React 17 safe) keeps this in sync
  // before any consumer's layout effect or imperative-handle read.
  const forwardedRef = React.useRef(ref);
  React.useLayoutEffect(() => {
    const previous = forwardedRef.current;
    forwardedRef.current = ref;
    if (previous === ref) {
      return;
    }
    // Consumer swapped to a different ref function/object on a render
    // where the DOM node didn't change (so `bindPre` wasn't called by
    // React). Reconcile manually: detach the old, attach the new with
    // the current node, matching React's standard callback-ref
    // semantics for ref swaps.
    const current = preRef.current;
    if (typeof previous === 'function') {
      previous(null);
    } else if (previous) {
      previous.current = null;
    }
    if (typeof ref === 'function') {
      ref(current);
    } else if (ref) {
      ref.current = current;
    }
  }, [ref]);

  // `bindPre` is stable (empty deps): if it depended on the forwarded
  // `ref`, a parent re-render that supplies a new ref function would
  // recreate `bindPre`, causing React to invoke the previous callback
  // with `null` and the new one with the same DOM node. That sequence
  // would tear down and rebuild the IO/RO/toggle subscription on every
  // parent render. Ref-function swaps that don't change the DOM node
  // are reconciled by the layout effect above.
  //
  // Forward the consumer's ref synchronously inside the callback (not in
  // a separate `useEffect`) so any parent `useLayoutEffect` or
  // imperative handle that reads `ref.current` right after mount sees
  // the `<pre>` rather than `null`.
  const bindPre = React.useCallback((root: HTMLPreElement | null) => {
    // React 18+ StrictMode (and some normal-update paths) can invoke a
    // ref callback with the same node it already holds. Short-circuit
    // so we don't trigger an extra render via `setPreNode` or a
    // redundant ref-forward cycle for the consumer.
    if (preRef.current === root) {
      return;
    }
    preRef.current = root;
    const current = forwardedRef.current;
    if (typeof current === 'function') {
      current(root);
    } else if (current) {
      current.current = root;
    }
    setPreNode(root);
  }, []);

  const handleIntersection = React.useCallback((entries: IntersectionObserverEntry[]) => {
    setVisibleFrames((prev) => {
      const visible: number[] = [];
      const invisible: number[] = [];

      entries.forEach((entry) => {
        const index = frameIndexMap.current.get(entry.target);
        if (index === undefined) {
          return;
        }
        // A frame counts as visible only when it intersects the
        // viewport AND its intersection rect has non-zero area.
        // Frames hidden by a CSS-driven collapse (`max-height: 0;
        // overflow: hidden;` or `visibility: hidden`) collapse to a
        // zero-area rect; some browsers still report
        // `isIntersecting: true` for them based on their geometric
        // position in the document. Checking the rect dimensions
        // matches what the user actually sees and prevents hidden
        // frames from being upgraded to highlighted HAST.
        const rect = entry.intersectionRect;
        const isVisuallyVisible = entry.isIntersecting && rect.width > 0 && rect.height > 0;
        if (isVisuallyVisible) {
          visible.push(index);
        } else {
          invisible.push(index);
        }
      });

      // avoid mutating the object if nothing changed
      let frames: { [key: number]: boolean } | undefined;
      visible.forEach((frame) => {
        if (prev[frame] !== true) {
          if (!frames) {
            frames = { ...prev };
          }
          frames[frame] = true;
        }
      });

      invisible.forEach((frame) => {
        if (prev[frame]) {
          if (!frames) {
            frames = { ...prev };
          }
          delete frames[frame];
        }
      });

      return frames || prev;
    });
  }, []);

  // Set up IntersectionObserver, ResizeObserver, and the shared
  // <details> toggle subscription whenever the pre element changes.
  // Running this in `useEffect` (rather than in the ref callback)
  // delegates teardown to React's effect lifecycle, so cleanup is
  // guaranteed even under StrictMode's double-invoke and for any
  // unmount path.
  React.useEffect(() => {
    if (!preNode) {
      return undefined;
    }

    const io = new IntersectionObserver(handleIntersection, { rootMargin: hydrateMargin });
    observer.current = io;

    // Sweep any spans that detached between the previous IO's teardown
    // and this one, then start observing every frame whose ref callback
    // has registered it.
    sweepDetachedFrames();
    observedFrames.current.forEach((frame) => io.observe(frame));

    // Watch the `<pre>` itself for size changes (CSS-driven collapse
    // animations resize ancestors, accordions/tabs swap layout). When
    // the pre resizes, re-observe every frame so the IO re-evaluates
    // their clipped-vs-unclipped state. Guarded so older runtimes (and
    // JSDOM in unit tests) without ResizeObserver still work.
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(nudgeFrameObserver);
      ro.observe(preNode);
    }

    // Native <details> toggle events do not bubble, but a capture-phase
    // listener on the document still intercepts them. A single shared
    // listener (see `subscribeToggleNudge`) fans the event out only to
    // mounted `<Pre>` instances whose `<pre>` is a descendant of the
    // toggled element, so unrelated toggles elsewhere in the document
    // don't trigger any per-instance work.
    const unsubscribeToggle = subscribeToggleNudge(preNode, nudgeFrameObserver);

    return () => {
      io.disconnect();
      observer.current = null;
      ro?.disconnect();
      unsubscribeToggle();
    };
  }, [preNode, hydrateMargin, handleIntersection, nudgeFrameObserver, sweepDetachedFrames]);

  const observeFrame = React.useCallback(
    (node: HTMLSpanElement | null) => {
      if (!node) {
        // React 17/18 invoke ref callbacks with `null` on detach but
        // ignore the cleanup return value below, and a single shared
        // callback can't tell which span detached. Prune any tracked
        // frame that's no longer in the DOM so detached nodes don't
        // accumulate strongly-referenced inside `observedFrames` for
        // the lifetime of the `<Pre>` instance.
        sweepDetachedFrames();
        return undefined;
      }
      // Derive frame index from DOM position among .frame siblings.
      // This avoids putting data-frame in server-rendered HTML.
      let index = 0;
      let sibling = node.previousElementSibling;
      while (sibling) {
        if (sibling.classList.contains('frame')) {
          index += 1;
        }
        sibling = sibling.previousElementSibling;
      }
      frameIndexMap.current.set(node, index);
      observedFrames.current.add(node);
      if (observer.current) {
        observer.current.observe(node);
      }
      // React 19 ref-callback cleanup. On React 17/18 the return value is
      // ignored; the `if (!node)` branch above + `sweepDetachedFrames`
      // (also called from `nudgeFrameObserver` and the IO setup effect)
      // drop entries whose `node.isConnected` is false, so the tracking
      // sets stay bounded on those versions too.
      return () => {
        observedFrames.current.delete(node);
        frameIndexMap.current.delete(node);
        observer.current?.unobserve(node);
      };
    },
    [sweepDetachedFrames],
  );

  const frames = React.useMemo(() => {
    let frameIndex = 0;

    return hast?.children.map((child, index) => {
      if (child.type !== 'element') {
        if (child.type === 'text') {
          return <React.Fragment key={index}>{child.value}</React.Fragment>;
        }

        return null;
      }

      if (child.properties.className === 'frame') {
        const currentFrameIndex = frameIndex;
        const isVisible = Boolean(visibleFrames[currentFrameIndex]);
        const shouldRenderHast = shouldHighlight && isVisible;

        frameIndex += 1;

        // Inject the variant-swap bridge inside the chosen frame. JSX
        // siblings to `renderCode(...)` mean the host CSS — which
        // animates `.frame .collapse > span` — still matches the
        // placeholder without us mutating the underlying hast.
        const bridgeNode =
          bridge && bridge.frameIndex === currentFrameIndex ? (
            <span className="collapse" data-lines={bridge.lines}>
              {Array.from({ length: bridge.lines }, (_, i) => (
                <span key={i} />
              ))}
            </span>
          ) : null;

        return (
          <span
            key={index}
            className="frame"
            data-lined={shouldRenderHast ? '' : undefined}
            data-frame-type={
              child.properties.dataFrameType ? String(child.properties.dataFrameType) : undefined
            }
            data-frame-indent={
              child.properties.dataFrameIndent != null
                ? String(child.properties.dataFrameIndent)
                : undefined
            }
            data-frame-truncated={
              child.properties.dataFrameTruncated
                ? String(child.properties.dataFrameTruncated)
                : undefined
            }
            data-frame-description={
              child.properties.dataFrameDescription
                ? String(child.properties.dataFrameDescription)
                : undefined
            }
            ref={observeFrame}
          >
            {renderCode(child.children, shouldRenderHast, child.data?.fallback)}
            {bridgeNode}
          </span>
        );
      }

      return (
        <React.Fragment key={index}>
          {shouldHighlight ? hastToJsx(child) : renderFallbackChild(child)}
        </React.Fragment>
      );
    });
  }, [hast, bridge, observeFrame, shouldHighlight, visibleFrames]);

  const hasCollapsibleFrames = hast?.data?.collapsible === true;

  const isEditable = Boolean(setSource);

  // Focus-trap state for editable code blocks. When the user tabs into the
  // wrapper (keyboard-only, gated by `:focus-visible`), an overlay prompts
  // them to press Enter before contentEditable Tab-indentation kicks in.
  // Mouse clicks land directly on the `<pre>` (skipping the wrapper as a
  // focus stop) so editing still engages immediately for pointer users.
  // Escape from the engaged `<pre>` returns focus to the wrapper, restoring
  // normal Tab navigation through the page.
  //
  // The prompt-visibility flag is tracked imperatively via a ref + DOM data
  // attribute rather than React state on purpose: a re-render triggered by
  // focus movement (e.g. blur on Tab-out, or focusing the wrapper from
  // Escape) would re-run useEditable's per-render Selection restore, and
  // Chrome pulls focus back into a contentEditable when the document
  // Selection is mutated inside it — yanking focus back to the editable
  // mid-tab and trapping keyboard users. Imperative attribute updates avoid
  // that whole round trip; consumer styles already react to
  // `data-editable-prompt`.
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const overlayRef = React.useRef<HTMLDivElement>(null);
  const overlayId = React.useId();

  const setPromptVisible = React.useCallback((visible: boolean) => {
    const wrapper = wrapperRef.current;
    const overlay = overlayRef.current;
    if (!wrapper || !overlay) {
      return;
    }
    if (visible) {
      wrapper.setAttribute('data-editable-prompt', '');
      // Remove the `hidden` attribute so the overlay is announced and
      // shown by default (no CSS required). Consumer styles can override
      // `[hidden]` with `display: block` to keep the element rendered for
      // animation, and rely on `[data-editable-prompt]` to drive visibility.
      overlay.removeAttribute('hidden');
    } else {
      wrapper.removeAttribute('data-editable-prompt');
      overlay.setAttribute('hidden', '');
    }
  }, []);

  const handleWrapperFocus = React.useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) {
        return;
      }
      // Only show the overlay for keyboard-driven focus. `:focus-visible` is
      // the browser's heuristic for "user is navigating with the keyboard",
      // which keeps the overlay from flashing if the wrapper itself ever
      // receives a click (e.g. on padding around the `<pre>`).
      let focusVisible = true;
      try {
        focusVisible = event.currentTarget.matches(':focus-visible');
      } catch {
        // Older browsers without `:focus-visible` support — treat any focus
        // as keyboard focus rather than silently dropping the overlay.
      }
      if (focusVisible) {
        setPromptVisible(true);
      }
    },
    [setPromptVisible],
  );

  const handleWrapperBlur = React.useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) {
        return;
      }
      setPromptVisible(false);
    },
    [setPromptVisible],
  );

  const handleWrapperKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      preRef.current?.focus();
    }
  }, []);

  const handlePreKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLPreElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        // Show the prompt explicitly: programmatic `.focus()` doesn't
        // reliably trigger `:focus-visible` across browsers (Chrome in
        // particular often treats it as non-visible focus), so the
        // `onFocus` branch would no-op here. Since we know this came from
        // a keyboard Escape, force the overlay back on.
        setPromptVisible(true);
        // Returning focus to the wrapper restores the page's Tab order.
        wrapperRef.current?.focus();
      }
    },
    [setPromptVisible],
  );

  const preElement = (
    // The <pre> is made interactive by contentEditable (set imperatively by
    // useEditable). jsx-a11y can't see that, so disable its rule here.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <pre
      ref={bindPre}
      className={className}
      spellCheck={false}
      tabIndex={isEditable ? -1 : undefined}
      onKeyDown={isEditable ? handlePreKeyDown : undefined}
      data-transforming={transforming ?? undefined}
    >
      <code
        className={language ? `language-${language}` : undefined}
        data-collapsible={hasCollapsibleFrames ? '' : undefined}
      >
        {typeof children === 'string' ? children : frames}
      </code>
    </pre>
  );

  if (!isEditable) {
    return preElement;
  }

  return (
    // Intentional focus trap: the wrapper is a keyboard-only stop in the
    // tab order so we can prompt the user ("Press Enter to start editing")
    // before contentEditable's Tab-indents-instead-of-moving-focus behavior
    // takes over. role="group" + aria-label give it an accessible name.
    /* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
    <div
      ref={wrapperRef}
      className="editable-code-wrapper"
      tabIndex={0}
      role="group"
      aria-label="Editable code"
      aria-describedby={overlayId}
      onFocus={handleWrapperFocus}
      onBlur={handleWrapperBlur}
      onKeyDown={handleWrapperKeyDown}
    >
      {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      {preElement}
      {/* The overlay stays mounted so consumer styles can animate it in/out
          based on the wrapper's `data-editable-prompt` attribute. The
          `hidden` attribute is the default state — overrideable with
          `display: block` (etc.) when CSS wants to keep it rendered for
          transitions. */}
      <div
        id={overlayId}
        ref={overlayRef}
        className="editable-code-overlay"
        aria-live="polite"
        hidden
      >
        Press <kbd>Enter</kbd> to start editing
      </div>
    </div>
  );
}
