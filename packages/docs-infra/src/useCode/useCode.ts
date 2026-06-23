import * as React from 'react';

import { useCodeHighlighterContextOptional } from '../CodeHighlighter/CodeHighlighterContext';
import { useCodeContext } from '../CodeProvider/CodeContext';
import type { ContentProps, SourceEnhancers } from '../CodeHighlighter/types';
import { useControlledCode } from '../CodeControllerContext';
import { extractNameAndSlugFromUrl } from '../pipeline/loaderUtils';
import { useVariantSelection } from './useVariantSelection';
import { useTransformManagement } from './useTransformManagement';
import { useFileNavigation } from './useFileNavigation';
import { useUIState } from './useUIState';
import { useCopyFunctionality } from './useCopyFunctionality';
import { useSourceEditing } from './useSourceEditing';
import { findCollapseInFocusTransforms, shouldHighlightForRender } from './useCodeUtils';
import { findVariantFocusedLinesMismatches } from './sourceLineCounts';
import { type UseCopierOpts } from '../useCopier';

export type UseCodeOpts = {
  preClassName?: string;
  copy?: UseCopierOpts;
  githubUrlPrefix?: string;
  initialVariant?: string;
  initialTransform?: string;
  /**
   * Controls hash removal behavior when user interacts with file tabs:
   * - 'remove-hash': Remove entire hash (default)
   * - 'remove-filename': Remove only filename, keep variant in hash
   */
  fileHashMode?: 'remove-hash' | 'remove-filename';
  /**
   * Controls when to save hash variant to localStorage:
   * - 'on-load': Save immediately when page loads with hash
   * - 'on-interaction': Save only when user clicks a tab (default)
   * - 'never': Never save hash variant to localStorage
   */
  saveHashVariantToLocalStorage?: 'on-load' | 'on-interaction' | 'never';
  /**
   * Array of enhancer functions to apply to parsed HAST sources.
   * Enhancers receive the HAST root, comments extracted from source, and filename.
   * Runs asynchronously when code changes.
   */
  sourceEnhancers?: SourceEnhancers;
  /**
   * Disables editing of the code block even when a CodeControllerContext is present.
   */
  disabled?: boolean;
  /**
   * Called when the code block is asked to expand its collapsed window — most
   * importantly from the editor itself, when the caret navigates past the
   * visible region (e.g. `ArrowUp` at the top of a collapsed block). Fires
   * synchronously, *before* the expansion re-renders, so a host can capture the
   * still-collapsed layout and engage a scroll anchor (e.g. `useCodeWindow`'s
   * `anchorScroll('expand')`) — matching the timing of a click on the expand
   * toggle. Without this, keyboard-driven expansion would jump the viewport
   * instead of smoothly anchoring it.
   */
  onExpand?: () => void;
  /**
   * Delay in milliseconds between a transform change and the actual swap
   * of the rendered file tree to the new transform. `selectedTransform`
   * still updates synchronously so UI controls reflect the change
   * immediately — whether triggered by a user click in this demo or
   * received as an external broadcast from a peer demo. While the swap
   * is pending the rendered `<pre>` element receives a `data-transforming`
   * attribute so consumer CSS can run an exit animation — most notably
   * expanding `.collapse` placeholders back to their original height —
   * before the new tree replaces them. When omitted or `0`, the new
   * transform commits synchronously (default behavior).
   */
  transformDelay?: number;
  /**
   * Delay in milliseconds between a variant change and the actual
   * swap of the rendered file tree to the new variant. `selectedVariant`
   * still updates synchronously so UI controls (tabs, dropdowns)
   * reflect the change immediately — whether triggered by a user
   * click in this demo or received as an external broadcast from a
   * peer demo. While the swap is pending the rendered `<pre>` element
   * receives a `data-transforming` attribute, and `<Pre>` appends a
   * bridge `<span class="collapse">` to the shorter of the two
   * variants' rendered tree so consumer CSS can animate between the
   * two heights before the swap commits. When omitted or `0`, the
   * new variant commits synchronously (default behavior).
   */
  variantSwapDelay?: number;
  /**
   * Controls which transforms are treated as layout-affecting (phase 1,
   * coordinated barrier) versus non-layout (phase 2, deferred). All
   * options consult the precomputed `hasCollapse` /
   * `hasCollapseInFocus` flags on each transform manifest entry — no
   * tree walking happens at runtime.
   *
   *   - `'all'` — Phase 1 if *any* file (main or `extraFiles`) in the
   *     selected variant has `hasCollapse: true`. Most conservative;
   *     matches the historical pre-`transformLayoutShift` behavior.
   *   - `'selected'` (default) — Phase 1 only when the currently
   *     rendered file's transform has `hasCollapse: true`. Avoids
   *     coordinating swaps that wouldn't visibly shift the rendered
   *     pre.
   *   - `'focus'` — Like `'selected'`, but while the surrounding code
   *     block is *collapsed* (un-expanded), use `hasCollapseInFocus`
   *     instead of `hasCollapse`. A `.collapse` placeholder outside
   *     the initially-visible region (the lines covered by
   *     `data-frame-type` ∈ `'highlighted' | 'focus' | 'padding-top' |
   *     'padding-bottom'`) won't trigger the coordinated barrier
   *     because the user can't see the resulting layout shift. Falls
   *     back to `'selected'`-style behavior when expanded.
   */
  transformLayoutShift?: 'all' | 'selected' | 'focus';
  /**
   * When `true`, throws synchronously during render if any transform
   * on any variant has `hasCollapseInFocus: true` — i.e. its
   * `.collapse` placeholder lands inside the focus region that is
   * visible while the surrounding code block is un-expanded. The
   * thrown error names the offending variant/file/transform so the
   * demo author can narrow the `@focus` (or `@padding`) markers, or
   * shrink the transform's edit range, until the placeholder lands
   * outside the initially-visible window. Pair with
   * `transformLayoutShift: 'focus'` to guarantee no coordinated
   * barrier swaps fire while the block is collapsed.
   */
  strictCollapseInFocus?: boolean;
  /**
   * Controls which variant swaps are treated as layout-affecting
   * (phase 1, coordinated barrier) versus non-layout (phase 2,
   * deferred). The check consults `totalLines` / `focusedLines`
   * metadata precomputed by the pipeline — no tree walking happens
   * at runtime.
   *
   *   - `'all'` — Phase 1 when the sum of `totalLines` across every
   *     file (main + `extraFiles`) differs between the from-variant
   *     and the to-variant. Useful when the rendering surface shows
   *     all files simultaneously.
   *   - `'selected'` (default) — Phase 1 when the currently selected
   *     file's `totalLines` differs between the two variants (or
   *     the file is missing from one side). Avoids coordinating
   *     swaps that wouldn't visibly shift the rendered pre.
   *   - `'focus'` — Like `'selected'`, but while the surrounding
   *     code block is *collapsed* (un-expanded), compare
   *     `focusedLines` (the size of the visible window when
   *     collapsed) instead of `totalLines`. Recommended for demos
   *     that use `@focus` / `@padding` markers to collapse to a
   *     specific region.
   */
  variantLayoutShift?: 'all' | 'selected' | 'focus';
  /**
   * When `true`, throws synchronously during render if any two
   * variants declare a file with the same name but a different
   * `focusedLines` count. Pair with `variantLayoutShift: 'focus'`
   * to guarantee no coordinated barrier swaps fire while the block
   * is collapsed: when every shared file's focused window matches
   * across variants, switching variants can never shift the
   * collapsed pre's height. The thrown error names the offending
   * variants / file so the demo author can align the
   * `@focus` / `@padding` markers.
   */
  strictMatchingVariantFocusedLines?: boolean;
};

type UserProps<T extends {} = {}> = T & {
  name?: string;
  slug?: string;
};

export interface UseCodeResult<T extends {} = {}> {
  variants: string[];
  selectedVariant: string;
  selectVariant: (variant: string | null) => void;
  files: Array<{ name: string; slug?: string; component: React.ReactNode }>;
  selectedFile: React.ReactNode;
  selectedFileLines: number;
  selectedFileName: string | undefined;
  /**
   * URL of the currently selected file, derived from the selected variant's
   * `url`, the file's name, and its `relativeUrl` (when set). `undefined` when
   * the variant has no `url` or the URL cannot be resolved.
   */
  selectedFileUrl: string | undefined;
  /**
   * Slug for the currently selected file. Always derived from the canonical
   * (original) file name — transforms are a view preference and do not
   * produce separate slugs. Useful for building permalinks (e.g. `#${slug}`)
   * that survive transform changes.
   */
  selectedFileSlug: string | undefined;
  selectFileName: (fileName: string) => void;
  allFilesSlugs: Array<{ fileName: string; slug: string; variantName: string }>;
  expanded: boolean;
  expand: () => void;
  setExpanded: (expanded: boolean) => void;
  copy: (event: React.MouseEvent<Element>) => Promise<void>;
  /**
   * Copies all files in the current variant to the clipboard as a Markdown
   * snippet (heading + per-file fenced code blocks).
   */
  copyMarkdown: (event: React.MouseEvent<Element>) => Promise<void>;
  availableTransforms: string[];
  selectedTransform: string | null | undefined;
  selectTransform: (transformName: string | null) => void;
  /**
   * Target of an in-flight transform swap that is still waiting on
   * slow peers to catch up. `undefined` when no swap is pending or
   * shortly after one commits. Otherwise mirrors the shape of
   * `selectedTransform`: `null` for a pending swap back to the
   * un-transformed original, or the transform name for a pending
   * swap to that transform. Consumers can check
   * `pendingTransform !== undefined` to render a generic loading
   * indicator, or read the value to render something like
   * `` `Switching to ${pendingTransform ?? 'original'}…` ``. Only
   * populated on the demo that originated the change — peer demos
   * receiving the broadcast keep this `undefined` so the indicator
   * stays anchored to the demo the user interacted with.
   */
  pendingTransform: string | null | undefined;
  /**
   * Whether edit mode is currently on. `true` by default; starts `false` when the block
   * opts in via `initialDisabled` — per demo through the `createDemo` `meta`, or across a
   * factory's demos through `createDemoFactory`. While `false` the block renders
   * read-only and the live-editing engine is not even warmed; flip it with
   * {@link setEditable}. Independent of `editActivation`, which governs *when* the engine
   * loads once editing is on, and of `disabled`, which turns editing off permanently.
   */
  editable: boolean;
  /**
   * Turns edit mode on or off. `undefined` when the block can't be edited at all — no
   * `CodeControllerContext` with `setCode` in scope, or editing is hard-`disabled` — so
   * a toggle button can render only when this is defined. Toggling off keeps the
   * reader's edits (use {@link reset} to discard them).
   */
  setEditable?: (editable: boolean) => void;
  /**
   * Replace the source of the currently selected file (or `fileName` when
   * provided) in the controlled code. Internal hooks may pass additional
   * arguments (caret position, pre-parsed HAST) that are not part of the
   * public contract.
   */
  setSource?: (source: string, fileName?: string) => void;
  /**
   * Clears the entire controlled code state back to `undefined`, discarding
   * user edits across **all variants and files** owned by the surrounding
   * `CodeControllerContext` (not just the currently selected file or
   * variant). Only available when a `CodeControllerContext` with `setCode`
   * is in scope and editing is not disabled.
   */
  reset?: () => void;
  /**
   * Re-fetches the block's data on the client by re-running the full variant
   * loader, then swaps in the fresh result while keeping the current highlighted
   * output visible until the new tree lands (stale-while-revalidate). Invalidates
   * the pre-parsed HAST cache. `undefined` (or a no-op) for a block with no `url`
   * to re-fetch from, or with no `CodeProvider` in scope.
   */
  refresh?: () => void;
  userProps: UserProps<T>;
}

export function useCode<T extends {} = {}>(
  contentProps: ContentProps<T>,
  opts?: UseCodeOpts,
): UseCodeResult<T> {
  const {
    copy: copyOpts,
    initialVariant,
    initialTransform,
    preClassName,
    fileHashMode = 'remove-hash',
    saveHashVariantToLocalStorage = 'on-interaction',
    sourceEnhancers,
    disabled,
    onExpand,
    transformDelay,
    transformLayoutShift = 'selected',
    strictCollapseInFocus = false,
    variantLayoutShift = 'selected',
    variantSwapDelay,
    strictMatchingVariantFocusedLines = false,
  } = opts || {};

  // Safely try to get context values - will be undefined if not in context
  const context = useCodeHighlighterContextOptional();
  const codeContext = useCodeContext();
  const controllerContext = useControlledCode();

  // Merge enhancers from CodeProvider, CodeControllerContext, and useCode opts.
  // Provider enhancers run first so they match the order applied by
  // `loadPrecomputedCodeHighlighter` on the server, then controller and
  // per-call enhancers layer on top. This lets a single `<CodeProvider>`
  // configure the baseline (e.g., `@highlight` / `@focus` framing) while
  // individual `useCode` callers add demo-specific extras without losing the
  // shared defaults.
  // Hoist the optional controller member into a stable local so the memo's
  // inferred dependency matches the source dependency. `useControlledCode()`
  // always returns a fresh object, so `controllerContext` is never null but
  // changes identity every render; depending on the narrowed value keeps the
  // memo correct (and lets the compiler preserve the manual memoization).
  const controllerEnhancers = controllerContext?.sourceEnhancers;
  const mergedEnhancers = React.useMemo((): SourceEnhancers | undefined => {
    const enhancers: SourceEnhancers = [];
    if (codeContext.sourceEnhancers) {
      enhancers.push(...codeContext.sourceEnhancers);
    }
    if (controllerEnhancers) {
      enhancers.push(...controllerEnhancers);
    }
    if (sourceEnhancers) {
      enhancers.push(...sourceEnhancers);
    }
    return enhancers.length > 0 ? enhancers : undefined;
  }, [codeContext.sourceEnhancers, controllerEnhancers, sourceEnhancers]);

  // Get the effective code - context overrides contentProps if available
  const effectiveCode = React.useMemo(() => {
    return context?.code || contentProps.code || {};
  }, [context?.code, contentProps.code]);

  // Opt-in development-time assertion: throw if any transform's
  // `.collapse` placeholder would land inside the focus region. The
  // check is purely a lookup against precomputed manifest flags (no
  // tree walking) so it is cheap to run on every render; the memo
  // ensures the actual scan only re-runs when `effectiveCode` changes.
  // Fail-fast in render so demo authors notice the problem the first
  // time they load the page instead of debugging a missing animation.
  const collapseInFocusOffenders = React.useMemo(
    () => (strictCollapseInFocus ? findCollapseInFocusTransforms(effectiveCode) : null),
    [strictCollapseInFocus, effectiveCode],
  );
  if (collapseInFocusOffenders && collapseInFocusOffenders.length > 0) {
    const first = collapseInFocusOffenders[0];
    const extraCount = collapseInFocusOffenders.length - 1;
    const suffix = extraCount > 0 ? ` (${extraCount} more offender(s) suppressed).` : `.`;
    throw new Error(
      `[useCode] strictCollapseInFocus is enabled and transform "${first.transformKey}" on variant "${first.variantName}" file "${first.fileName}" introduces a .collapse placeholder inside the visible focus region. Narrow the focused area (e.g. tighten @focus/@padding markers or shrink the transform's edit range) so the placeholder lands outside the initially-visible window${suffix}`,
    );
  }

  // Opt-in development-time assertion: throw if any two variants
  // declare a file with the same name but disagree on
  // `focusedLines`. Cheap precomputed-metadata lookup — the memo
  // ensures the actual scan only re-runs when `effectiveCode`
  // changes. Fail-fast in render so demo authors notice the problem
  // the first time they load the page.
  const variantFocusedLinesMismatches = React.useMemo(
    () =>
      strictMatchingVariantFocusedLines ? findVariantFocusedLinesMismatches(effectiveCode) : null,
    [strictMatchingVariantFocusedLines, effectiveCode],
  );
  if (variantFocusedLinesMismatches && variantFocusedLinesMismatches.length > 0) {
    const first = variantFocusedLinesMismatches[0];
    const extraCount = variantFocusedLinesMismatches.length - 1;
    const suffix = extraCount > 0 ? ` (${extraCount} more mismatch(es) suppressed).` : `.`;
    throw new Error(
      `[useCode] strictMatchingVariantFocusedLines is enabled and file "${first.fileName}" has ${first.focusedLinesA} focused line(s) in variant "${first.variantA}" but ${first.focusedLinesB} focused line(s) in variant "${first.variantB}". Align the @focus/@padding markers across variants so the collapsed window matches${suffix}`,
    );
  }

  // Dev-only sanity check: `strictMatchingVariantFocusedLines` only
  // protects against coordinated-barrier risk while the block is
  // collapsed under `variantLayoutShift: 'focus'`. Enabling it in
  // any other mode produces throws that don't correspond to a real
  // layout-shift hazard, so warn the author once per render.
  if (
    process.env.NODE_ENV !== 'production' &&
    strictMatchingVariantFocusedLines &&
    variantLayoutShift !== 'focus'
  ) {
    console.warn(
      `[useCode] strictMatchingVariantFocusedLines is enabled but variantLayoutShift is "${variantLayoutShift}". The strict check only guards coordinated-barrier swaps under 'focus' mode; consider setting variantLayoutShift: 'focus' or disabling strictMatchingVariantFocusedLines.`,
    );
  }

  // Memoize userProps with auto-generated name and slug if missing
  const userProps = React.useMemo((): UserProps<T> => {
    // Extract only the user-defined properties (T) from contentProps
    const {
      name: contentName,
      slug: contentSlug,
      code,
      components,
      url: contentUrl,
      // `collapseToEmpty` / `initialExpanded` are render-time display flags, not
      // user-facing props — strip them (rest siblings) so they don't leak into
      // the demo's props.
      collapseToEmpty: collapseToEmptyContentProp,
      initialExpanded: initialExpandedContentProp,
      ...userDefinedProps
    } = contentProps;
    // Get URL from context first, then fall back to contentProps
    const effectiveUrl = context?.url || contentUrl;

    let name = contentName;
    let slug = contentSlug;
    // Generate name and slug from URL if they're missing and we have a URL
    if ((!name || !slug) && effectiveUrl) {
      try {
        const generated = extractNameAndSlugFromUrl(effectiveUrl);
        name = name || generated.name;
        slug = slug || generated.slug;
      } catch {
        // If URL parsing fails, keep the original values (which might be undefined)
      }
    }

    return {
      ...userDefinedProps,
      name,
      slug,
    } as UserProps<T>;
  }, [contentProps, context?.url]);

  // Resolve the render-time display flags. They must come from `contentProps`
  // (threaded by the demo factory / `CodeHighlighter` / code transforms) rather
  // than `useCode` opts: the loading fallback derives its own copy from the same
  // `contentProps`, so a per-call opt would let the live render and the fallback
  // disagree.
  const collapseToEmpty = contentProps.collapseToEmpty === true;
  const initialExpanded = contentProps.initialExpanded === true;
  const initialDisabled = contentProps.initialDisabled === true;

  // Sub-hook: UI State Management (needs slug to check for relevant hash)
  const uiState = useUIState({ initialExpanded, initialDisabled, mainSlug: userProps.slug });

  // Lift `selectedFileName` state out of `useFileNavigation` so
  // `useTransformManagement` *and* `useVariantSelection` can read it
  // (selected-file-scoped `transformLayoutShift` /
  // `variantLayoutShift` modes). `useFileNavigation` consumes the
  // value + setter as controlled props. Initial value is resolved
  // below once `useVariantSelection` has reported the initial
  // variant.
  const [selectedFileNameState, setSelectedFileNameState] = React.useState<string | undefined>(
    undefined,
  );

  // Sub-hook: Variant Selection
  const variantSelection = useVariantSelection({
    effectiveCode,
    initialVariant,
    variantType: contentProps.variantType,
    mainSlug: userProps.slug,
    saveHashVariantToLocalStorage,
    variantLayoutShift,
    selectedFileName: selectedFileNameState,
    expanded: uiState.expanded,
    variantSwapDelay,
    deferHighlight: context?.deferHighlight,
  });

  // Seed the selected file name from the variant's main file the
  // first time the variant resolves. Subsequent file selections come
  // through `useFileNavigation`'s controlled setter. Set-state during
  // render triggers one extra render on first mount; we accept that
  // cost because the alternative (lazy `useState` initializer)
  // requires resolving the variant key here, which depends on
  // `useUrlHashState` / `usePreference` hooks that already live
  // inside `useVariantSelection`. Duplicating them at this level
  // would be worse than the extra render.
  if (selectedFileNameState === undefined && variantSelection.selectedVariant?.fileName) {
    setSelectedFileNameState(variantSelection.selectedVariant.fileName);
  }

  // Defer the outgoing `<Pre>` from rendering highlighted spans while
  // a stored-preference bootstrap swap is known to be coming. See
  // `shouldHighlightForRender` for the full rationale, including the
  // `highlightAfter === 'init'` bypass that prevents a visible flash
  // of unhighlighted code on first-paint variant swaps.
  const shouldHighlight = shouldHighlightForRender({
    deferHighlight: context?.deferHighlight,
    highlightReady: context?.highlightReady,
    pendingBootstrap: variantSelection.pendingBootstrap,
    highlightAfter: context?.highlightAfter,
  });

  // The rendered tree should reflect the *committed* variant so the
  // outgoing `<Pre>` stays put during `variantSwapDelay`. When no
  // delay is configured these are always equal to `selectedVariant` /
  // `selectedVariantKey`. Falling back to the pending value (rather
  // than `null`) keeps the boot path — before the coordinator has
  // committed for the first time — rendering the freshly-resolved
  // variant instead of nothing.
  const renderedVariant = variantSelection.committedVariant ?? variantSelection.selectedVariant;
  const renderedVariantKey =
    variantSelection.committedVariantKey || variantSelection.selectedVariantKey;

  // Sub-hook: Transform Management
  const transformManagement = useTransformManagement({
    context,
    effectiveCode,
    selectedVariantKey: renderedVariantKey,
    selectedVariant: renderedVariant,
    initialTransform,
    transformDelay,
    transformLayoutShift,
    selectedFileName: selectedFileNameState,
    expanded: uiState.expanded,
  });

  // Sub-hook: Source Editing
  const sourceEditing = useSourceEditing({
    context,
    selectedVariantKey: renderedVariantKey,
    effectiveCode,
    selectedVariant: renderedVariant,
    disabled,
  });

  // Combine the two animation phases into a single `transforming`
  // attribute for `<Pre>`. Both phases share the `data-transforming`
  // attribute and the `.collapse` placeholder bridge — the only
  // difference is which delta drives the bridge. When both are
  // simultaneously eligible (rare — a transform swap mid-variant-swap
  // window) the variant phase takes precedence because the rendered
  // tree just swapped variants and that's the larger visual change.
  const transforming: 'collapsed' | 'expanding' | 'expanded' | 'collapsing' | null =
    variantSelection.variantSwappingPhase ?? transformManagement.transformingPhase;

  // Route `<Pre>`'s readiness callback to whichever phase source owns
  // the current animation window. Each source flips its own paused →
  // active transition independently; we just forward the signal.
  const variantPhaseActive = variantSelection.variantSwappingPhase !== null;
  const notifyVariantTransitionReady = variantSelection.notifyVariantTransitionReady;
  const notifyTransformTransitionReady = transformManagement.notifyTransformTransitionReady;
  const onPreTransitionReady = React.useCallback(() => {
    if (variantPhaseActive) {
      notifyVariantTransitionReady();
    } else {
      notifyTransformTransitionReady();
    }
  }, [variantPhaseActive, notifyVariantTransitionReady, notifyTransformTransitionReady]);

  // Defer `expand()` while a variant or transform swap is in flight,
  // or while the currently-displayed variant's source is still being
  // highlighted. Callers that pair `selectVariant(...)` /
  // `selectTransform(...)` with `expand()` in the same tick (e.g.
  // "show source of variant X" or "switch to JS then expand"
  // affordances) would otherwise flip `expanded` mid-animation: the
  // bridge `.collapse` placeholder switches metric (`focus` →
  // `total`) and the previously-hidden rows pop in before the swap
  // commits, producing a visible jump. When no `variantSwapDelay`
  // is configured the swap commits synchronously, but the new
  // variant's `parsedCode` is still computed asynchronously — the
  // `deferHighlight` flag published by `CodeHighlighterClient`
  // (true while `waitingForParsedCode`) keeps the gate engaged
  // through that window too.
  //
  // `expand()` always queues through a `pendingExpand` state flag;
  // a passive effect resolves it on every render where the composed
  // `transforming` phase is `null` and `deferHighlight` is falsy
  // (i.e. neither a variant/transform swap nor an async re-highlight
  // is in flight). Using state (not a ref) keeps the drain reactive:
  // a synchronous `expand()` triggers a render, the effect runs, and
  // `setExpanded(true)` flushes in the same React batch — preserving
  // the "expand is synchronous" semantics for the common case while
  // naturally waiting on in-flight swaps. `setExpanded` stays direct
  // so explicit controlled-state writes remain synchronous regardless
  // of swap phase.
  const setExpanded = uiState.setExpanded;
  const swapInFlight = transforming !== null || !!context?.deferHighlight;
  const [pendingExpand, setPendingExpand] = React.useState(false);
  // Keep the latest `onExpand` in a ref so the stable `expand` callback below
  // can call it without changing identity (it is forwarded down to `<Pre>`).
  const onExpandRef = React.useRef(onExpand);
  React.useLayoutEffect(() => {
    onExpandRef.current = onExpand;
  });
  const expand = React.useCallback(() => {
    // Notify the host synchronously, while the block is still collapsed, so it
    // can capture the pre-expansion layout and engage a scroll anchor (the
    // expansion itself is deferred below via `pendingExpand`). This mirrors the
    // timing of clicking the expand toggle, where the host anchors the scroll
    // before the layout changes.
    onExpandRef.current?.();
    setPendingExpand(true);
  }, []);
  React.useEffect(() => {
    if (pendingExpand && !swapInFlight) {
      /* eslint-disable react-hooks/set-state-in-effect -- intentional queue drain: commit deferred expand only after in-flight swaps settle (swapInFlight transitions false on a later render); see comment above re: flicker-avoidance and same-batch synchronous-expand semantics */
      setPendingExpand(false);
      setExpanded(true);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [pendingExpand, swapInFlight, setExpanded]);

  // Partner variant whose per-file line counts feed `<Pre>`'s bridge
  // computation. `null` when no variant swap is in flight (the bridge
  // collapses to a no-op inside `<Pre>` either way; this lookup is a
  // performance shortcut so we don't read the entire variant on every
  // render).
  const swapPartnerVariant = React.useMemo(() => {
    if (!variantSelection.swapPartnerVariantKey) {
      return null;
    }
    const variant = effectiveCode[variantSelection.swapPartnerVariantKey];
    if (variant && typeof variant === 'object' && 'source' in variant) {
      return variant;
    }
    return null;
  }, [effectiveCode, variantSelection.swapPartnerVariantKey]);

  // Bridge line-count metric should mirror variant layout-shift mode:
  // only `'focus'` compares focused lines while collapsed; every other
  // mode always compares total lines.
  const variantBridgeLineMode: 'focus' | 'total' =
    variantLayoutShift === 'focus' ? 'focus' : 'total';

  // Sub-hook: File Navigation
  const fileNavigation = useFileNavigation({
    selectedVariant: renderedVariant,
    transformedFiles: transformManagement.transformedFiles,
    selectedTransform: transformManagement.selectedTransform,
    mainSlug: userProps.slug,
    selectedVariantKey: renderedVariantKey,
    selectVariant: variantSelection.selectVariantProgrammatic,
    variantKeys: variantSelection.variantKeys,
    shouldHighlight,
    preClassName,
    setSource: sourceEditing.setSource,
    editActivation: context?.editActivation,
    onActivate: context?.onEditingActivated,
    editable: uiState.editable,
    effectiveCode,
    fileHashMode,
    saveHashVariantToLocalStorage,
    saveVariantToLocalStorage: variantSelection.saveVariantToLocalStorage,
    hashVariant: variantSelection.hashVariant,
    sourceEnhancers: mergedEnhancers,
    fallbacks: context?.fallbacks,
    expanded: uiState.expanded,
    collapseToEmpty,
    expand,
    transforming,
    onPreTransitionReady,
    variantBridgeLineMode,
    swapPartnerVariant,
    selectedFileName: selectedFileNameState,
    setSelectedFileName: setSelectedFileNameState,
  });

  // Sub-hook: Copy Functionality
  const copyFunctionality = useCopyFunctionality({
    selectedFile: fileNavigation.selectedFile,
    selectedVariant: renderedVariant,
    transformedFiles: transformManagement.transformedFiles,
    // Per-file dictionaries for the active variant (decodes `hastCompressed`
    // sources back to text); `selectedFileFallback` covers the single-file copy.
    fallbacks: context?.fallbacks,
    selectedFileFallback: fileNavigation.selectedFileFallback,
    title: userProps.name,
    copyOpts,
  });

  // Editing can be toggled only where it's possible at all: a controller with `setCode`
  // is in scope and the block isn't hard-`disabled`. Otherwise `setEditable` is omitted,
  // so a host renders no toggle.
  const canToggleEditing = Boolean(controllerContext?.setCode) && !disabled;

  return {
    variants: variantSelection.variantKeys,
    selectedVariant: variantSelection.selectedVariantKey,
    selectVariant: variantSelection.selectVariant,
    files: fileNavigation.files,
    selectedFile: fileNavigation.selectedFileComponent,
    selectedFileLines: fileNavigation.selectedFileLines,
    selectedFileName: fileNavigation.selectedFileName,
    selectedFileUrl: fileNavigation.selectedFileUrl,
    selectedFileSlug: fileNavigation.selectedFileSlug,
    selectFileName: fileNavigation.selectFileName,
    allFilesSlugs: fileNavigation.allFilesSlugs,
    expanded: uiState.expanded,
    expand,
    setExpanded,
    copy: copyFunctionality.copy,
    copyMarkdown: copyFunctionality.copyMarkdown,
    availableTransforms: transformManagement.availableTransforms,
    selectedTransform: transformManagement.selectedTransform,
    selectTransform: transformManagement.selectTransform,
    pendingTransform: transformManagement.pendingTransform,
    editable: uiState.editable,
    setEditable: canToggleEditing ? uiState.setEditable : undefined,
    setSource: sourceEditing.setSource,
    reset: sourceEditing.reset,
    refresh: context?.refresh,
    userProps,
  };
}
