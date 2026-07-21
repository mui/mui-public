'use client';

import * as React from 'react';
import type { ElementContent, RootContent } from 'hast';
import type { SetSource } from './useSourceEditing';
import type { EditableSourceProjection, VariantSource } from '../CodeHighlighter/types';
import type { FallbackNode } from '../CodeHighlighter/fallbackFormat';
import { fallbackToHast, fallbackIsHighlighted } from '../CodeHighlighter/fallbackFormat';
import { useCodeContext } from '../CodeProvider/CodeContext';
import { hastToJsx, frameFallbackFromSpans, stringOrHastToString } from '../pipeline/hastUtils';
import { stripHighlightingSpans } from '../pipeline/hastUtils/stripHighlightingSpans';
import { decodeHastSource } from '../pipeline/loadIsomorphicCodeVariant/decodeHastSource';
import {
  resolveCollapsedFrameType,
  getInitialVisibleFrames,
} from '../pipeline/parseSource/frameVisibility';
import { isFrameSpan } from '../pipeline/parseSource/isFrameSpan';
import { getSourceLineCounts } from './sourceLineCounts';
import type { SourceLineCounts } from './sourceLineCounts';
import { subscribeToggleNudge } from './subscribeToggleNudge';
import { CodeEditorLazy } from './CodeEditorLazy';

const hastChildrenCache = new WeakMap<ElementContent[], React.ReactNode>();
const fallbackHastCache = new WeakMap<ElementContent[], React.ReactNode>();

function resolveFrameTypeAttribute(
  frameType: string | undefined,
  collapseToEmpty: boolean,
): string | undefined {
  const resolved = resolveCollapsedFrameType(frameType, collapseToEmpty);
  return resolved && resolved !== 'normal' ? resolved : undefined;
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
    jsx = hastToJsx({ type: 'root', children: frameFallbackFromSpans(hastChildren) });
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
  displayFileName,
  language,
  ref,
  setSource,
  shouldHighlight,
  hydrateMargin = '200px 0px 200px 0px',
  fallback,
  fallbackLineCounts,
  expanded = false,
  collapseToEmpty = false,
  editActivation,
  onActivate,
  onBoundary,
  editable = true,
  sourceProjection,
}: {
  children: VariantSource;
  className?: string;
  fileName?: string;
  displayFileName?: string;
  language?: string;
  ref?: React.Ref<HTMLPreElement>;
  setSource?: SetSource;
  shouldHighlight?: boolean;
  hydrateMargin?: string;
  fallback?: FallbackNode[];
  /**
   * Authoritative line metadata for a string source's framed fallback. Deferred
   * string sources do not have decoded HAST yet, but their loader-built fallback
   * already knows whether the collapsed window hides lines.
   */
  fallbackLineCounts?: SourceLineCounts | null;
  /**
   * Whether the host has expanded the (collapsible) code block. When `true`,
   * collapsed-state behaviors such as `minColumn` are disabled so the caret
   * can move into the indent gutter normally.
   */
  expanded?: boolean;
  /**
   * Render-time "collapse to empty": collapse the block to an *empty* window so the
   * whole block is hidden until expanded. Demotes every collapsed-visible frame
   * type to its hidden equivalent (`focus`→`focus-unfocused`,
   * `highlighted`→`highlighted-unfocused`, `padding-*`→`normal`), forces the
   * block collapsible, and reports `0` focused lines. Orthogonal to `expanded`
   * — it only changes what the *collapsed* state shows, not whether the block
   * starts expanded. The precomputed HAST is never mutated.
   */
  collapseToEmpty?: boolean;
  /**
   * Controls when the textarea editor loads for an editable block: `'eager'`
   * (default) loads it as soon as the block is editable; `'interaction'` defers
   * the load until the user hovers/focuses/clicks the `<pre>`. Ignored when the
   * block is not editable.
   */
  editActivation?: 'eager' | 'interaction';
  /**
   * Fired once when the block first engages for editing. `CodeHighlighter` uses
   * it to warm the live-editing runtime, grammars, and worker.
   */
  onActivate?: () => void;
  /** Expands a collapsed focused source when caret navigation crosses its boundary. */
  onBoundary?: () => void;
  /**
   * Whether edit mode is on. When `false` the block stays read-only, so the editor
   * is not loaded and `onActivate` is not called.
   * Defaults to `true`; the host drives it from the `editable` toggle `useCode` returns.
   */
  editable?: boolean;
  /** Contiguous source shown by the collapsed textarea editor. */
  sourceProjection?: EditableSourceProjection;
}): React.ReactNode {
  // Defer the decompressing `decodeHastSource` to a post-paint render ONLY when the
  // first-paint `.fallback` is ALREADY highlighted — i.e. the promoted highlighted-visible
  // fallback the server ships for `highlightAfter: 'init'`. Then paint that highlighted
  // fallback first (no decompression on the critical path) and swap in the full decoded
  // tree after. When the fallback is plain — every other mode, including a late-mounted
  // `'hydration'` block where `shouldHighlight` is also true on the first render — decode
  // on mount instead, so we never flash plain → highlighted.
  const [deferInitialDecode] = React.useState(
    () =>
      shouldHighlight === true &&
      !!fallback &&
      fallbackIsHighlighted(fallback) &&
      typeof children !== 'string',
  );
  const [decodeAllowed, setDecodeAllowed] = React.useState(!deferInitialDecode);
  React.useEffect(() => {
    if (deferInitialDecode) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional post-paint latch: flip after the first paint so the highlighted fallback shows before the decompressing decode runs
      setDecodeAllowed(true);
    }
  }, [deferInitialDecode]);

  // The variant `fallback` is forwarded to `decodeHastSource` so the
  // `hastCompressed` payload is decompressed with the matching DEFLATE
  // dictionary and each frame's `data.fallback` is restored. The decoded
  // tree stays shared (read-only), since `Pre` only reads it.
  const hast = React.useMemo(() => {
    if (!children || typeof children === 'string' || !decodeAllowed) {
      return null;
    }
    return decodeHastSource(children, fallback);
  }, [children, fallback, decodeAllowed]);

  const preRef = React.useRef<HTMLPreElement>(null);
  const { codeEditorLoader } = useCodeContext();

  const [visibleFrames, setVisibleFrames] = React.useState<{ [key: number]: boolean }>(() =>
    getInitialVisibleFrames(hast, collapseToEmpty),
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
    // Next state unions the new initial-visible set onto `prev` rather than
    // replacing it (see 564-597): replacing would drop frames already
    // hydrated by IO/editing on the prior tree, causing the visible flash this
    // guards against. Depends on both a prop (`hast`) and prior state, so it
    // can't be derived during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisibleFrames((prev) => {
      const initial = getInitialVisibleFrames(hast, collapseToEmpty);
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
  }, [hast, collapseToEmpty]);

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

      if (isFrameSpan(child)) {
        const currentFrameIndex = frameIndex;
        const isVisible = Boolean(visibleFrames[currentFrameIndex]);
        const shouldRenderHast = shouldHighlight && isVisible;

        frameIndex += 1;

        return (
          <span
            key={index}
            className="frame"
            data-lined={shouldRenderHast ? '' : undefined}
            data-frame-type={resolveFrameTypeAttribute(
              child.properties.dataFrameType ? String(child.properties.dataFrameType) : undefined,
              collapseToEmpty,
            )}
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
          </span>
        );
      }

      return (
        <React.Fragment key={index}>
          {shouldHighlight ? hastToJsx(child) : renderFallbackChild(child)}
        </React.Fragment>
      );
    });
  }, [hast, observeFrame, shouldHighlight, visibleFrames, collapseToEmpty]);

  const hasCollapsibleFrames =
    (hast ? getSourceLineCounts(hast).collapsible : fallbackLineCounts?.collapsible === true) ||
    collapseToEmpty;

  // Expose the source line counts so consumers / CSS can reason about the
  // collapsed window size — most notably the collapse-to-nothing case
  // (`focusedLines === 0`) produced by `oversizedFocus: 'hide'`, where the
  // block is collapsible but the collapsed window is empty. Counts come from
  // the parsed `hast` when available. Deferred string sources use the metadata
  // that travelled with their framed fallback; without it, they fall back to the
  // raw string count and remain non-collapsible.
  const { totalLines: sourceTotalLines, focusedLines: rawFocusedLines } = hast
    ? getSourceLineCounts(hast)
    : (fallbackLineCounts ?? getSourceLineCounts(children));
  // Collapse-to-empty empties the collapsed window, so the focused-line count is 0
  // regardless of the precomputed value.
  const sourceFocusedLines = collapseToEmpty ? 0 : rawFocusedLines;

  const isEditable = Boolean(setSource) && editable;
  const fullSource = React.useMemo(
    () => stringOrHastToString(children, fallback),
    [children, fallback],
  );
  const [editorRequested, setEditorRequested] = React.useState(
    () => editActivation !== 'interaction',
  );
  const focusEditorRef = React.useRef(false);
  const activatedRef = React.useRef(false);

  // The wrapper is the only page Tab stop. Enter moves focus into the textarea;
  // Escape returns it here so normal page navigation resumes.
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

  const requestEditorFocus = React.useCallback(() => {
    focusEditorRef.current = true;
    setPromptVisible(false);
    setEditorRequested(true);
  }, [setPromptVisible]);

  const handleWrapperKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget && event.key === 'Enter') {
        event.preventDefault();
        requestEditorFocus();
      }
    },
    [requestEditorFocus],
  );

  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.target instanceof Element && event.target.closest('textarea')) {
        return;
      }
      event.preventDefault();
      requestEditorFocus();
    },
    [requestEditorFocus],
  );

  const handleEditorActivate = React.useCallback(() => {
    if (!activatedRef.current) {
      activatedRef.current = true;
      onActivate?.();
    }
  }, [onActivate]);

  const handleEditorReady = React.useCallback(
    (textarea: HTMLTextAreaElement) => {
      if (focusEditorRef.current) {
        focusEditorRef.current = false;
        textarea.focus();
        handleEditorActivate();
      }
    },
    [handleEditorActivate],
  );

  const handleEditorExit = React.useCallback(() => {
    setPromptVisible(true);
    wrapperRef.current?.focus();
  }, [setPromptVisible]);

  // A plain-string source hasn't been highlighted yet (deferred mode). Render it
  // FRAMED — the compact `fallback` (the loader's windowed plain-text frames) when one
  // travelled with it, otherwise a single-frame wrap — so the `<code>` is never bare
  // text. The highlighted tree swaps in via `frames` once parsing completes.
  // The fallback render, used whenever the decoded `hast` isn't in hand: a string
  // source (highlighted on the client after hydration) or an object source whose
  // decode is deferred off the first paint (`deferInitialDecode`). For `init` the
  // server-built `fallback` already carries the initially-visible frames
  // highlighted, so this first paint is highlighted with no decompression.
  const framedFallback = React.useMemo(() => {
    const frameNodes: FallbackNode[] | null =
      fallback ??
      (typeof children === 'string'
        ? [['span', 'frame', { dataFrameType: 'focus' }, children]]
        : null);
    if (!frameNodes) {
      return null;
    }
    const root = fallbackToHast(frameNodes);
    if (collapseToEmpty) {
      for (const child of root.children) {
        if (child.type !== 'element' || !isFrameSpan(child)) {
          continue;
        }
        const frameType =
          typeof child.properties.dataFrameType === 'string'
            ? child.properties.dataFrameType
            : undefined;
        const resolved = resolveFrameTypeAttribute(frameType, true);
        if (resolved === frameType) {
          continue;
        }
        if (!resolved) {
          delete child.properties.dataFrameType;
        } else {
          child.properties.dataFrameType = resolved;
        }
      }
    }
    return hastToJsx(root);
  }, [children, collapseToEmpty, fallback]);

  const preElement = (
    <pre
      ref={bindPre}
      className={className}
      spellCheck={false}
      tabIndex={isEditable ? -1 : undefined}
    >
      <code
        className={language ? `language-${language}` : undefined}
        data-collapsible={hasCollapsibleFrames ? '' : undefined}
        data-total-lines={sourceTotalLines}
        data-focused-lines={sourceFocusedLines}
      >
        {hast ? frames : framedFallback}
      </code>
    </pre>
  );

  if (!isEditable) {
    return preElement;
  }

  return (
    // Intentional focus trap: the wrapper is a keyboard-only stop in the
    // tab order so we can prompt the user ("Press Enter to start editing")
    // before the textarea's Tab-indents-instead-of-moving-focus behavior
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
      onPointerDown={handlePointerDown}
    >
      {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      {editorRequested ? (
        <CodeEditorLazy
          loader={codeEditorLoader}
          fallback={preElement}
          source={fullSource}
          sourceProjection={sourceProjection}
          expanded={expanded}
          fileName={fileName}
          displayFileName={displayFileName}
          language={language}
          className={className}
          setSource={setSource!}
          onActivate={handleEditorActivate}
          onBoundary={onBoundary}
          onExit={handleEditorExit}
          onReady={handleEditorReady}
        />
      ) : (
        preElement
      )}
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
