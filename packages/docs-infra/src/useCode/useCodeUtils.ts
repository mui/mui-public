import type {
  VariantSource,
  VariantCode,
  Code,
  Transforms,
  SourceComments,
} from '../CodeHighlighter/types';

export interface TransformedFile {
  name: string;
  originalName: string;
  source: VariantSource;
  /**
   * Comments map shifted onto the transformed source's line numbering.
   * Set only when the variant supplied a `comments` map for this file;
   * entries whose source line was wiped by the transform are dropped.
   */
  comments?: SourceComments;
}

export interface TransformedFiles {
  files: TransformedFile[];
  filenameMap: { [originalName: string]: string };
}

/**
 * Pure function to get available transforms from effective code data.
 *
 * Variant-level `transforms` is a manifest produced by `splitTransformsForEmbed`
 * (or by the legacy `Transforms` shape with deltas, for back-compat). Only
 * entries that produced a real source delta are reported here — rename-only
 * entries (manifest entries with `hasDelta: false`, kept around so the
 * runtime can still apply the rename based on user preference) are filtered
 * out so the transform toggle stays hidden when nothing meaningful changes.
 *
 * @param effectiveCode - The effective code object containing all variants
 * @param selectedVariantKey - The currently selected variant key
 * @returns Array of available transform keys (toggle-visible only)
 */
export function getAvailableTransforms(effectiveCode: Code, selectedVariantKey: string): string[] {
  return collectTransformKeys(effectiveCode, selectedVariantKey, { onlyWithDelta: true });
}

/**
 * Like `getAvailableTransforms` but also includes rename-only entries
 * (manifest entries with `hasDelta: false`). Used by the transform
 * resolution path so a stored preference can still apply a rename even
 * when its toggle is hidden because no actual delta exists.
 *
 * @param effectiveCode - The effective code object containing all variants
 * @param selectedVariantKey - The currently selected variant key
 * @returns Array of all applicable transform keys
 */
export function getApplicableTransforms(effectiveCode: Code, selectedVariantKey: string): string[] {
  return collectTransformKeys(effectiveCode, selectedVariantKey, { onlyWithDelta: false });
}

function collectTransformKeys(
  effectiveCode: Code,
  selectedVariantKey: string,
  { onlyWithDelta }: { onlyWithDelta: boolean },
): string[] {
  const transforms = new Set<string>();

  if (!effectiveCode || !selectedVariantKey) {
    return [];
  }

  const variantCode = effectiveCode[selectedVariantKey];
  if (!variantCode || typeof variantCode !== 'object') {
    return [];
  }

  const add = (entries: Transforms | undefined) => {
    if (!entries) {
      return;
    }
    for (const [transformKey, entry] of Object.entries(entries)) {
      if (!entry) {
        continue;
      }
      if (!onlyWithDelta) {
        transforms.add(transformKey);
        continue;
      }
      const inlineDelta =
        !!entry.delta && typeof entry.delta === 'object' && Object.keys(entry.delta).length > 0;
      if (entry.hasDelta || inlineDelta) {
        transforms.add(transformKey);
      }
    }
  };

  if ('transforms' in variantCode) {
    add(variantCode.transforms);
  }

  if ('extraFiles' in variantCode && variantCode.extraFiles) {
    for (const fileData of Object.values(variantCode.extraFiles)) {
      if (fileData && typeof fileData === 'object' && 'transforms' in fileData) {
        add(fileData.transforms);
      }
    }
  }

  return Array.from(transforms);
}

/**
 * Determines whether applying `transformKey` to `variant` would introduce
 * `.collapse` placeholders into the rendered hast tree — i.e. whether the
 * swap is layout-affecting and must run through the coordinated barrier.
 *
 * Reads the precomputed `hasCollapse` / `hasCollapseInFocus` flags
 * stored on each transform entry by the pipeline (`diffHast` sets them
 * directly, `splitTransformsForEmbed` propagates them onto the
 * manifest). No tree walking or delta decompression happens at runtime.
 *
 * The `mode` option controls *which* file's transform entry is consulted:
 *
 *   - `'selected'` (default) — Consults only the transform map for the
 *     file identified by `selectedFileName` (or `variant.transforms`
 *     when `selectedFileName === variant.fileName`). When
 *     `selectedFileName` is omitted, treats the variant's main file
 *     (`variant.fileName`) as the selection.
 *   - `'all'` — Iterates every transform map on the variant
 *     (`variant.transforms` + each `extraFiles[*].transforms`) and
 *     returns `true` if any one has `hasCollapse: true`. Useful for
 *     callers that render multiple files simultaneously and need to
 *     coordinate a swap whenever *any* file would shift.
 *   - `'focus'` — Like `'selected'`, but consults
 *     `hasCollapseInFocus` instead of `hasCollapse` whenever
 *     `expanded === false`. Lets consumers skip the coordinated
 *     barrier for transforms whose `.collapse` insertion lands
 *     outside the initially-visible region of a collapsed code block.
 *
 * Falls back to a conservative phase 1 classification for legacy
 * payloads that carry `hasDelta: true` without the precomputed flag —
 * i.e. transforms produced by an older build that predates
 * `hasCollapse`, or constructed by a direct caller bypassing the
 * pipeline. For `hasCollapseInFocus`, entries that lack the field fall
 * back to the value of `hasCollapse` (matching the embed-side default).
 *
 * Returns `false` when every consulted entry has `hasCollapse: false`
 * (or `hasCollapseInFocus: false` in focus mode while collapsed), is
 * rename-only, is absent, or the variant is `null`.
 *
 * @param variant - The variant whose transforms to inspect.
 * @param transformKey - The transform key to classify, or `null`.
 * @param opts - Optional mode + selected-file + expanded context.
 */
export function transformHasCollapsePlaceholder(
  variant: VariantCode | null,
  transformKey: string | null,
  opts?: {
    mode?: 'all' | 'selected' | 'focus';
    selectedFileName?: string | undefined;
    expanded?: boolean;
  },
): boolean {
  if (!variant || !transformKey) {
    return false;
  }

  const mode = opts?.mode ?? 'selected';
  const expanded = opts?.expanded ?? false;
  // `'selected'`/`'focus'` default to the variant's main file when no
  // selection is supplied. This lines up with the runtime's "render
  // the main file by default" behavior.
  let selectedFileName = opts?.selectedFileName;
  if (selectedFileName === undefined && mode !== 'all' && 'fileName' in variant) {
    selectedFileName = variant.fileName as string | undefined;
  }

  // In focus mode while collapsed, the relevant precomputed flag is
  // the focus-scoped one. Everywhere else we still consult plain
  // `hasCollapse`. The `useFocusFlag` decision is taken once up front
  // so the per-entry checks stay branch-free.
  const useFocusFlag = mode === 'focus' && !expanded;

  const checkEntry = (entry: Transforms[string] | undefined): boolean => {
    if (!entry) {
      return false;
    }
    if (useFocusFlag) {
      // Prefer the focus-scoped flag; legacy payloads (no
      // `hasCollapseInFocus` field) fall through to `hasCollapse`
      // which itself falls back to the conservative phase 1
      // classification below.
      if (entry.hasCollapseInFocus === true) {
        return true;
      }
      if (entry.hasCollapseInFocus === false) {
        return false;
      }
    }
    if (entry.hasCollapse === true) {
      return true;
    }
    // Legacy fallback: an older payload carries `hasDelta: true` with
    // neither an inline delta nor the precomputed flag. Classify
    // conservatively as phase 1 so the swap stays layout-stable.
    if (entry.hasCollapse === undefined && entry.hasDelta && !entry.delta) {
      return true;
    }
    return false;
  };

  // `'all'` mode walks every transform map on the variant.
  if (mode === 'all') {
    if ('transforms' in variant && variant.transforms) {
      if (checkEntry(variant.transforms[transformKey])) {
        return true;
      }
    }
    if ('extraFiles' in variant && variant.extraFiles) {
      for (const file of Object.values(variant.extraFiles)) {
        if (file && typeof file === 'object' && 'transforms' in file && file.transforms) {
          if (checkEntry(file.transforms[transformKey])) {
            return true;
          }
        }
      }
    }
    return false;
  }

  // `'selected'` / `'focus'` consult only the chosen file's transforms.
  // Main file is identified by `variant.fileName`; everything else is
  // looked up under `extraFiles`. `selectedFileName` is guaranteed to
  // be defined here (the default above falls back to `variant.fileName`).
  if (selectedFileName === undefined) {
    return false;
  }
  if ('fileName' in variant && selectedFileName === variant.fileName) {
    if ('transforms' in variant && variant.transforms) {
      return checkEntry(variant.transforms[transformKey]);
    }
    return false;
  }
  if ('extraFiles' in variant && variant.extraFiles) {
    const file = variant.extraFiles[selectedFileName];
    if (file && typeof file === 'object' && 'transforms' in file && file.transforms) {
      return checkEntry(file.transforms[transformKey]);
    }
  }
  return false;
}

/**
 * Description of a single transform entry that carries
 * `hasCollapseInFocus: true`. Returned by
 * `findCollapseInFocusTransforms` so callers can produce actionable
 * error messages without re-walking the variant tree.
 */
export interface CollapseInFocusOffender {
  variantName: string;
  fileName: string;
  transformKey: string;
}

/**
 * Walk every variant on `effectiveCode` and collect transform entries
 * whose precomputed `hasCollapseInFocus` flag is `true` — i.e. the
 * collapse placeholder introduced by the transform lands inside the
 * focus region that is visible while the surrounding code block is
 * un-expanded.
 *
 * Used by `useCode`'s `strictCollapseInFocus` option to throw with a
 * pointer to the offending variant/file/transform so the demo author
 * can narrow the `@focus` region (or the transform's edit range) until
 * the placeholder lands outside the visible window.
 *
 * Walks main files (`variant.transforms`) and `extraFiles[*].transforms`.
 * Returns an empty array when no entry has the flag set.
 */
export function findCollapseInFocusTransforms(effectiveCode: Code): CollapseInFocusOffender[] {
  const offenders: CollapseInFocusOffender[] = [];
  const collectFromMap = (
    variantName: string,
    fileName: string,
    transforms: Transforms | undefined,
  ) => {
    if (!transforms) {
      return;
    }
    for (const [transformKey, entry] of Object.entries(transforms)) {
      if (entry?.hasCollapseInFocus === true) {
        offenders.push({ variantName, fileName, transformKey });
      }
    }
  };
  for (const [variantName, variant] of Object.entries(effectiveCode)) {
    if (!variant || typeof variant !== 'object') {
      continue;
    }
    if ('transforms' in variant && variant.transforms) {
      const fileName = ('fileName' in variant && variant.fileName) || '<main>';
      collectFromMap(variantName, fileName, variant.transforms);
    }
    if ('extraFiles' in variant && variant.extraFiles) {
      for (const [fileName, file] of Object.entries(variant.extraFiles)) {
        if (file && typeof file === 'object' && 'transforms' in file) {
          collectFromMap(variantName, fileName, file.transforms);
        }
      }
    }
  }
  return offenders;
}

/**
 * Decide whether the rendered `<Pre>` should emit highlighted spans on
 * this render. Three gates compose:
 *
 * 1. `highlightReady` — the render-side readiness gate published by
 *    `CodeHighlighterClient`. `false` while the highlight trigger
 *    (`hydration` / `idle` / `visible`) hasn't fired yet *or* the
 *    sync `parseCode` pass hasn't resolved. The precomputed HAST on
 *    the published `code` would render highlighted spans on first
 *    paint otherwise — defeating the deferred trigger. Treated as
 *    `true` when undefined so legacy/test consumers without a
 *    surrounding context default to rendering highlighted.
 * 2. `deferHighlight` — the narrower pipeline-level signal published
 *    while the incoming variant's parse / transform deltas are still
 *    in flight. Always wins: if the tree isn't ready, highlighting
 *    can't happen.
 * 3. `pendingBootstrap` — set while a stored-preference variant swap
 *    is queued behind the initial mount. Suppresses the *outgoing*
 *    tree's highlighting so we don't burn cycles painting spans the
 *    user is about to swap away from.
 *
 * The bootstrap gate is skipped when `highlightAfter === 'init'`:
 * - the precomputed HAST already carries the spans (no "wasted work"),
 *   and
 * - leaving it on causes the *incoming* variant to render as plain
 *   text for the render between `pendingBootstrap` flipping and the
 *   bootstrap commit landing, producing a visible flash of unhighlighted
 *   code on first-paint variant swaps.
 */
export function shouldHighlightForRender(args: {
  deferHighlight: boolean | undefined;
  highlightReady?: boolean | undefined;
  pendingBootstrap: boolean;
  highlightAfter: 'init' | 'hydration' | 'idle' | undefined;
}): boolean {
  if (args.deferHighlight) {
    return false;
  }
  if (args.highlightReady === false) {
    return false;
  }
  if (args.highlightAfter === 'init') {
    return true;
  }
  return !args.pendingBootstrap;
}
