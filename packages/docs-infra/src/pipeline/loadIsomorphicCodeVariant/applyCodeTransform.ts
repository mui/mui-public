import { patch, clone } from 'jsondiffpatch';
import type { Nodes, Root } from 'hast';
import type {
  HastRoot,
  VariantSource,
  Transforms,
  SourceComments,
} from '../../CodeHighlighter/types';
import { compressHast, decompressHast } from '../hastUtils';

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
 * Applies a specific transform to a variant source and returns the transformed source
 * along with a remapped copy of the supplied `comments` map (when any) shifted to
 * line up with the renumbered `dataLn` values in the transformed tree.
 *
 * @param source - The original variant source (string, HastNodes, or hastJson object)
 * @param transforms - Object containing all available transforms
 * @param transformKey - The key of the specific transform to apply
 * @param comments - Optional 1-indexed comment map keyed by the source's original
 *   line numbers. Returned shifted so each entry now sits on the line its
 *   original source line occupies in the transformed tree; entries whose
 *   source line was wiped by the transform are dropped.
 * @returns `{ source, comments }` where `source` is the transformed variant
 *   source in the same format as the input and `comments` is the remapped map
 *   (or `undefined` when no comments were passed).
 * @throws Error if the transform key doesn't exist or patching fails
 */
export function applyCodeTransformWithComments(
  source: VariantSource,
  transforms: Transforms,
  transformKey: string,
  comments?: SourceComments,
): { source: VariantSource; comments?: SourceComments } {
  const transform = transforms[transformKey];
  if (!transform) {
    throw new Error(`Transform "${transformKey}" not found in transforms`);
  }

  // Determine the format of the source and apply the appropriate transform strategy
  if (typeof source === 'string') {
    if (!transform.delta) {
      throw new Error(
        `Transform "${transformKey}" has no delta; string sources require an inline delta`,
      );
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

  // For Hast node sources, deltas are typically node-based (from diffHast)
  let sourceRoot: HastRoot;
  const isHastJson = 'hastJson' in source;
  const isHastCompressed = !isHastJson && 'hastCompressed' in source;

  if (isHastJson) {
    sourceRoot = JSON.parse(source.hastJson) as HastRoot;
  } else if (isHastCompressed) {
    sourceRoot = JSON.parse(decompressHast(source.hastCompressed)) as HastRoot;
  } else {
    sourceRoot = source as HastRoot;
  }

  // For serialized sources, the transform deltas are embedded inside
  // `root.data.transforms` (so they ride inside the compressed payload and
  // stay out of the rendered HTML). The variant-level `transforms` arg may
  // be a manifest with no `delta` field — fall back to the embedded copy.
  const embeddedTransforms = sourceRoot.data?.transforms;
  const delta = transform.delta ?? embeddedTransforms?.[transformKey]?.delta;

  if (!delta) {
    throw new Error(
      `Transform "${transformKey}" has no delta available (not on the manifest entry and not embedded in source.data.transforms)`,
    );
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

  // Return in the same format as the input
  if (isHastJson) {
    return { source: { hastJson: JSON.stringify(patchedNodes) }, comments: remappedComments };
  }

  if (isHastCompressed) {
    return {
      source: { hastCompressed: compressHast(JSON.stringify(patchedNodes)) },
      comments: remappedComments,
    };
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
): { source: VariantSource; comments?: SourceComments } {
  let currentSource: VariantSource = source;
  let currentComments: SourceComments | undefined = comments;

  for (const transformKey of transformKeys) {
    const result = applyCodeTransformWithComments(
      currentSource,
      transforms,
      transformKey,
      currentComments,
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
): VariantSource {
  return applyCodeTransformWithComments(source, transforms, transformKey).source;
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
): VariantSource {
  return applyCodeTransformsWithComments(source, transforms, transformKeys).source;
}
