import { patch, clone } from 'jsondiffpatch';
import type { Element, Nodes, Root } from 'hast';
import { frameFallbackFromSpans } from '../hastUtils';
import type {
  HastRoot,
  VariantSource,
  Transforms,
  SourceComments,
} from '../../CodeHighlighter/types';
import type { FallbackNode } from '../../CodeHighlighter/fallbackFormat';
import { decodeHastSource } from './decodeHastSource';
import { findExpandingRanges } from './findExpandingRanges';

/**
 * Reassign sequential 1-indexed `dataLn` values to every `.line` element in
 * the tree. The build-side `diffHast` strips line numbers before computing
 * the delta (so adding/removing a line doesn't make every subsequent line
 * differ), and we restore them here on the patched output. Also refreshes
 * `data.totalLines` on the root if present.
 *
 * Walks `root.children → frame.children` directly — never descends into a
 * line's syntax-highlighted content (the bulk of the tree's nodes), since
 * `addLineGutters` always emits lines as direct children of frames.
 *
 * Returns a map from each surviving line's original `dataLn` (preserved
 * through `patch` because the diff was computed on a stripped tree) to
 * the new sequential 1-indexed `dataLn` written here. Caller uses it to
 * shift any 1-indexed payload keyed by source line number (e.g. the
 * variant's `comments` map) so it lines up with the renumbered tree.
 */
function renumberLines(root: Nodes): Map<number, number> {
  const lineMap = new Map<number, number>();
  if (root.type !== 'root') {
    return lineMap;
  }
  let lineNumber = 0;
  const frames = (root as Root).children;
  for (let f = 0; f < frames.length; f += 1) {
    const frame = frames[f];
    if (frame.type !== 'element') {
      continue;
    }
    const children = frame.children;
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (
        child.type === 'element' &&
        child.properties != null &&
        child.properties.className === 'line'
      ) {
        lineNumber += 1;
        const previous = child.properties.dataLn;
        if (typeof previous === 'number') {
          lineMap.set(previous, lineNumber);
        }
        child.properties.dataLn = lineNumber;
      }
    }
  }
  if (root.data && 'totalLines' in root.data) {
    (root.data as { totalLines: number }).totalLines = lineNumber;
  }
  return lineMap;
}

/**
 * Rewrite a 1-indexed comments map so each entry moves from the source
 * line it was attached to onto the line that source line now occupies in
 * the renumbered tree. Comments attached to lines the transform wiped
 * (no entry in `lineMap`) are dropped — the line they annotated is gone.
 */
function remapComments(comments: SourceComments, lineMap: Map<number, number>): SourceComments {
  const remapped: SourceComments = {};
  for (const [key, value] of Object.entries(comments)) {
    const oldLine = Number(key);
    const newLine = lineMap.get(oldLine);
    if (newLine !== undefined) {
      remapped[newLine] = value;
    }
  }
  return remapped;
}

/**
 * Walk a freshly-renumbered hast tree and set `dataExpanding: ''` on
 * every `.line` element whose 1-indexed `dataLn` falls inside one of
 * `ranges`. The attribute is the hook the runtime CSS uses to animate
 * transformer-added lines in (entry: height 0 → line-height) and out
 * (exit: line-height → 0). The `.collapse` placeholder element family
 * is reserved for transformer-removed lines.
 *
 * Like `renumberLines`, walks only `root.children → frame.children`
 * — line elements are always direct children of frames in the trees
 * produced by `addLineGutters`, so we never descend into syntax-
 * highlighted content. No-op when `ranges` is empty.
 */
function markAddedLinesInPlace(root: Nodes, ranges: Array<[number, number]>): void {
  if (ranges.length === 0 || root.type !== 'root') {
    return;
  }
  const frames = (root as Root).children;
  for (let f = 0; f < frames.length; f += 1) {
    const frame = frames[f];
    if (frame.type !== 'element') {
      continue;
    }
    const children = frame.children;
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (
        child.type !== 'element' ||
        child.properties == null ||
        child.properties.className !== 'line'
      ) {
        continue;
      }
      const lineNumber = child.properties.dataLn;
      if (typeof lineNumber !== 'number') {
        continue;
      }
      for (const [start, end] of ranges) {
        if (lineNumber >= start && lineNumber <= end) {
          child.properties.dataExpanding = '';
          break;
        }
      }
    }
  }
}

/**
 * Regenerate `data.fallback` for every frame the transform rewrote.
 *
 * `diffHast` encodes each rewritten frame as a content-less fallback *delete*
 * (and leaves untouched frames' fallback alone), so after `patch` exactly the
 * changed frames are missing their fallback while the rest keep the inherited
 * one. For each missing frame we rebuild the fallback the same way the renderer
 * derives it lazily — `stripHighlightingSpans` over the frame's post-transform
 * children — so the pre-hydration render matches the highlighted output
 * (including `.collapse` placeholders) without a layout shift, and any consumer
 * reading `data.fallback` (e.g. `buildRootFallback`) sees the post-transform
 * text rather than the stale original.
 *
 * Walks `root.children` only; descends into a changed frame's children once via
 * `stripHighlightingSpans`. Untouched frames are skipped entirely.
 */
function regenerateMissingFrameFallbacksInPlace(root: Nodes): void {
  if (root.type !== 'root') {
    return;
  }
  const frames = (root as Root).children;
  for (let f = 0; f < frames.length; f += 1) {
    const frame = frames[f];
    if (
      frame.type !== 'element' ||
      frame.properties?.className !== 'frame' ||
      frame.data?.fallback !== undefined
    ) {
      continue;
    }
    if (!frame.data) {
      frame.data = {} as Element['data'] & {};
    }
    frame.data.fallback = frameFallbackFromSpans(frame.children);
  }
}

/**
 * Applies a specific transform to a variant source and returns the transformed source
 * along with a remapped copy of the supplied `comments` map (when any) shifted to
 * line up with the renumbered `dataLn` values in the transformed tree.
 *
 * **Return shape, by input shape:**
 * - `string` input → `string` output.
 * - HAST-backed input (`HastRoot`, `{ hastJson }`, or `{ hastCompressed }`)
 *   that actually applies a delta → live `HastRoot` output, regardless of the
 *   input wire shape. The serialized wire shapes are *not* re-emitted: every
 *   downstream reader in this package funnels through `decodeHastSource`,
 *   which accepts a live root directly, so re-stringifying / re-compressing
 *   here would just be undone by the next consumer (and would defeat the
 *   shared decode cache, which is keyed on payload identity). Callers
 *   outside this package that need a serialized payload must re-encode
 *   the returned root themselves.
 * - Rename-only entries (`hasDelta: false`) and unknown-transform passthrough
 *   return the original `source` object untouched (same shape and identity).
 *
 * @param source - The original variant source (string, `HastRoot`,
 *   `{ hastJson }`, or `{ hastCompressed }`)
 * @param transforms - Object containing all available transforms
 * @param transformKey - The key of the specific transform to apply
 * @param comments - Optional 1-indexed comment map keyed by the source's original
 *   line numbers. Returned shifted so each entry now sits on the line its
 *   original source line occupies in the transformed tree; entries whose
 *   source line was wiped by the transform are dropped.
 * @returns `{ source, comments }` where `source` is the transformed variant
 *   source (see "Return shape" above) and `comments` is the remapped map
 *   (or `undefined` when no comments were passed).
 * @throws Error if the transform key doesn't exist or patching fails
 */
export function applyCodeTransformWithComments(
  source: VariantSource,
  transforms: Transforms,
  transformKey: string,
  comments?: SourceComments,
  fallback?: FallbackNode[],
): { source: VariantSource; comments?: SourceComments } {
  const transform = transforms[transformKey];
  if (!transform) {
    throw new Error(`Transform "${transformKey}" not found in transforms`);
  }

  // Determine the format of the source and apply the appropriate transform strategy
  if (typeof source === 'string') {
    if (!transform.delta) {
      // Rename-only transform (manifest entry with `hasDelta: false`): no
      // source change to apply. Surface the explicit `comments` map if
      // the transformer provided one, otherwise pass the input through.
      return { source, comments: transform.comments ?? comments };
    }
    // For string sources, deltas are typically line-array based (from transformSource)
    const sourceLines = source.split('\n');
    const patched = patch(sourceLines, transform.delta);

    if (!Array.isArray(patched)) {
      throw new Error(`Patch for transform "${transformKey}" did not return an array`);
    }

    // String transforms only wipe lines (never insert/reorder), so the
    // 1-indexed mapping is identity for surviving non-empty lines and
    // dropped for wiped ones. Build the map by walking both arrays.
    // If the transformer supplied an explicit `comments` map for this
    // entry, use it verbatim instead of auto-shifting.
    let remappedComments: SourceComments | undefined;
    if (transform.comments) {
      remappedComments = transform.comments;
    } else if (comments) {
      const lineMap = new Map<number, number>();
      const limit = Math.min(sourceLines.length, patched.length);
      for (let i = 0; i < limit; i += 1) {
        if (patched[i] !== '' || sourceLines[i] === '') {
          lineMap.set(i + 1, i + 1);
        }
      }
      remappedComments = remapComments(comments, lineMap);
    }

    return { source: patched.join('\n'), comments: remappedComments };
  }

  // For Hast node sources, deltas are typically node-based (from diffHast).
  // The patched tree is returned as a live `HastRoot` regardless of the input
  // wire shape (`hastJson` / `hastCompressed` / live root). Re-serializing
  // and re-compressing here would just be undone by the very next consumer:
  // every reader funnels through `decodeHastSource`, which already accepts
  // live roots, and the `decodedHastCache` it maintains is keyed on the
  // source-payload identity — a freshly re-encoded payload would be a brand
  // new object that the cache couldn't help anyway. The original input
  // payload stays compressed in memory; only the transformed working copy
  // lives as a tree.
  const sourceRoot = decodeHastSource(source, fallback);
  if (!sourceRoot) {
    // `decodeHastSource` returns `null` when a `hastCompressed` payload can't be
    // decompressed — almost always a missing/mismatched `fallback` dictionary
    // (e.g. an extra file whose fallback wasn't threaded through). Fail with a
    // clear message instead of a downstream "Cannot read properties of null".
    throw new Error(
      `Cannot apply transform "${transformKey}": failed to decode the source. A compressed payload needs its fallback dictionary to decompress.`,
    );
  }

  // For serialized sources, the transform deltas are embedded inside
  // `root.data.transforms` (so they ride inside the compressed payload and
  // stay out of the rendered HTML). The variant-level `transforms` arg may
  // be a manifest with no `delta` field — fall back to the embedded copy.
  const embeddedTransforms = sourceRoot.data?.transforms;
  const delta = transform.delta ?? embeddedTransforms?.[transformKey]?.delta;

  if (!delta) {
    // Rename-only transform (manifest entry with `hasDelta: false`): no
    // delta exists on the manifest entry or embedded in the source's
    // `data.transforms`. Return the source untouched (in the same wire
    // shape we received it) and surface the transformer's explicit
    // `comments` map if one was provided. No patching happened, so the
    // original payload is still the cheapest thing to hand back.
    return { source, comments: transform.comments ?? comments };
  }

  // Apply the node-based delta
  const patchedNodes = patch(clone(sourceRoot), delta);

  if (!patchedNodes) {
    throw new Error(`Patch for transform "${transformKey}" returned null/undefined`);
  }

  // Strip embedded transforms from the patched root so the output doesn't
  // re-embed deltas that have already been applied — and so subsequent
  // applies against the patched root start from a clean slate.
  const patchedRoot = patchedNodes as HastRoot;
  if (patchedRoot.data?.transforms) {
    const { transforms: droppedTransforms, ...restData } = patchedRoot.data;
    patchedRoot.data = Object.keys(restData).length > 0 ? restData : undefined;
  }

  // Regenerate the per-frame fallback for any frame the transform rewrote. The
  // delta carries a content-less delete for those frames (built by `diffHast`),
  // so `patch` left them without a fallback; rebuild it from the live
  // post-transform spans. Untouched frames keep their inherited fallback.
  regenerateMissingFrameFallbacksInPlace(patchedRoot);

  // Reassign 1..N line numbers — `diffHast` stripped them before diffing,
  // so each surviving line's `dataLn` still holds its original source
  // line number. Capture that mapping while overwriting it so we can shift
  // the caller's comments map onto the new numbering. When the transform
  // entry carries an explicit `comments` map (set by a transformer that
  // adds lines or fully replaces the file), use it verbatim instead.
  const lineMap = renumberLines(patchedRoot);
  let remappedComments: SourceComments | undefined;
  if (transform.comments) {
    remappedComments = transform.comments;
  } else if (comments) {
    remappedComments = remapComments(comments, lineMap);
  }

  // Decorate transformer-added lines with `data-expanding=""` so the
  // runtime CSS can animate them in (entry, post-swap) and out (exit,
  // pre-swap). The `.collapse` placeholder family is reserved for
  // transformer-removed lines. Markers are paired
  // `@expanding-start`/`@expanding-end` substrings inside the comments
  // map the transformer returned; the map has already been renumbered
  // above so the ranges point at the final post-transform line numbers.
  const addedLineRanges = findExpandingRanges(remappedComments);
  if (addedLineRanges.length > 0) {
    markAddedLinesInPlace(patchedRoot, addedLineRanges);
  }

  return { source: patchedNodes as HastRoot, comments: remappedComments };
}

/**
 * Applies multiple transforms to a variant source in sequence. Comments are
 * shifted by each transform in turn so the returned map lines up with the
 * fully-transformed source.
 *
 * @param source - The original variant source
 * @param transforms - Object containing all available transforms
 * @param transformKeys - Array of transform keys to apply in order
 * @param comments - Optional 1-indexed comment map for the original source
 * @returns `{ source, comments }` after applying every transform in order
 * @throws Error if any transform key doesn't exist or patching fails
 */
export function applyCodeTransformsWithComments(
  source: VariantSource,
  transforms: Transforms,
  transformKeys: string[],
  comments?: SourceComments,
  fallback?: FallbackNode[],
): { source: VariantSource; comments?: SourceComments } {
  // The single-call helper strips `data.transforms` from each patched
  // root so subsequent applies start from a clean slate AND so the final
  // output doesn't re-embed deltas that have already been applied. That
  // means a manifest-only call chain (`transforms` arg carries no
  // `delta` fields, deltas live inside `source.data.transforms`) would
  // break on the second hop: the first hop reads the embedded delta,
  // strips the map, and the second hop has nowhere left to look. Pull
  // the embedded deltas once up front and merge them into a resolved
  // transforms map so every hop sees inline deltas.
  let resolvedTransforms = transforms;
  if (transformKeys.length > 1 && typeof source !== 'string') {
    const sourceRoot = decodeHastSource(source, fallback) as HastRoot | undefined;
    const embeddedTransforms = sourceRoot?.data?.transforms;
    if (embeddedTransforms) {
      const merged: Transforms = { ...transforms };
      for (const [key, embeddedEntry] of Object.entries(embeddedTransforms)) {
        const manifestEntry = merged[key];
        if (manifestEntry && !manifestEntry.delta && embeddedEntry?.delta) {
          merged[key] = { ...manifestEntry, delta: embeddedEntry.delta };
        } else if (!manifestEntry && embeddedEntry) {
          merged[key] = embeddedEntry;
        }
      }
      resolvedTransforms = merged;
    }
  }

  let currentSource: VariantSource = source;
  let currentComments: SourceComments | undefined = comments;

  for (const transformKey of transformKeys) {
    const result = applyCodeTransformWithComments(
      currentSource,
      resolvedTransforms,
      transformKey,
      currentComments,
      fallback,
    );
    currentSource = result.source;
    currentComments = result.comments;
  }

  return { source: currentSource, comments: currentComments };
}

/**
 * Convenience wrapper around {@link applyCodeTransformWithComments} for
 * callers that don't need the shifted comments map. Returns the transformed
 * `VariantSource` directly.
 */
export function applyCodeTransform(
  source: VariantSource,
  transforms: Transforms,
  transformKey: string,
  fallback?: FallbackNode[],
): VariantSource {
  return applyCodeTransformWithComments(source, transforms, transformKey, undefined, fallback)
    .source;
}

/**
 * Convenience wrapper around {@link applyCodeTransformsWithComments} for
 * callers that don't need the shifted comments map. Returns the transformed
 * `VariantSource` directly.
 */
export function applyCodeTransforms(
  source: VariantSource,
  transforms: Transforms,
  transformKeys: string[],
  fallback?: FallbackNode[],
): VariantSource {
  return applyCodeTransformsWithComments(source, transforms, transformKeys, undefined, fallback)
    .source;
}
