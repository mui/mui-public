import { patch, clone } from 'jsondiffpatch';
import type { Nodes, Root } from 'hast';
import type { HastRoot, VariantSource, Transforms } from '../../CodeHighlighter/types';
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
 */
function renumberLines(root: Nodes) {
  if (root.type !== 'root') {
    return;
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
        child.properties.dataLn = lineNumber;
      }
    }
  }
  if (root.data && 'totalLines' in root.data) {
    (root.data as { totalLines: number }).totalLines = lineNumber;
  }
}

/**
 * Applies a specific transform to a variant source and returns the transformed source
 * @param source - The original variant source (string, HastNodes, or hastJson object)
 * @param transforms - Object containing all available transforms
 * @param transformKey - The key of the specific transform to apply
 * @returns The transformed variant source in the same format as the input
 * @throws Error if the transform key doesn't exist or patching fails
 */
export function applyCodeTransform(
  source: VariantSource,
  transforms: Transforms,
  transformKey: string,
): VariantSource {
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

    return patched.join('\n');
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

  // Reassign 1..N line numbers — `diffHast` stripped them before diffing.
  renumberLines(patchedRoot);

  // Return in the same format as the input
  if (isHastJson) {
    return { hastJson: JSON.stringify(patchedNodes) };
  }

  if (isHastCompressed) {
    return { hastCompressed: compressHast(JSON.stringify(patchedNodes)) };
  }

  return patchedNodes as HastRoot;
}

/**
 * Applies multiple transforms to a variant source in sequence
 * @param source - The original variant source
 * @param transforms - Object containing all available transforms
 * @param transformKeys - Array of transform keys to apply in order
 * @returns The transformed variant source in the same format as the input
 * @throws Error if any transform key doesn't exist or patching fails
 */
export function applyCodeTransforms(
  source: VariantSource,
  transforms: Transforms,
  transformKeys: string[],
): VariantSource {
  let currentSource: VariantSource = source;

  for (const transformKey of transformKeys) {
    currentSource = applyCodeTransform(currentSource, transforms, transformKey);
  }

  return currentSource;
}
