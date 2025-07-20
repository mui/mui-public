import { patch, clone } from 'jsondiffpatch';
import type { Nodes as HastNodes } from 'hast';
import type { VariantSource, Transforms } from './types';

/**
 * Applies a specific transform to a variant source and returns the transformed source
 * @param source - The original variant source (string, HastNodes, or hastJson object)
 * @param transforms - Object containing all available transforms
 * @param transformKey - The key of the specific transform to apply
 * @returns The transformed variant source in the same format as the input
 * @throws Error if the transform key doesn't exist or patching fails
 */
export function applyTransform(
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
    // For string sources, deltas are typically line-array based (from transformSource)
    const sourceLines = source.split('\n');
    const patched = patch(sourceLines, transform.delta);

    if (!Array.isArray(patched)) {
      throw new Error(`Patch for transform "${transformKey}" did not return an array`);
    }

    return patched.join('\n');
  }

  // For Hast node sources, deltas are typically node-based (from transformParsedSource)
  let sourceNodes: HastNodes;
  const isHastJson = 'hastJson' in source;

  if (isHastJson) {
    sourceNodes = JSON.parse(source.hastJson) as HastNodes;
  } else {
    sourceNodes = source as HastNodes;
  }

  // Apply the node-based delta
  const patchedNodes = patch(clone(sourceNodes), transform.delta);

  if (!patchedNodes) {
    throw new Error(`Patch for transform "${transformKey}" returned null/undefined`);
  }

  // Return in the same format as the input
  if (isHastJson) {
    return { hastJson: JSON.stringify(patchedNodes) };
  }

  return patchedNodes as HastNodes;
}

/**
 * Applies multiple transforms to a variant source in sequence
 * @param source - The original variant source
 * @param transforms - Object containing all available transforms
 * @param transformKeys - Array of transform keys to apply in order
 * @returns The transformed variant source in the same format as the input
 * @throws Error if any transform key doesn't exist or patching fails
 */
export function applyTransforms(
  source: VariantSource,
  transforms: Transforms,
  transformKeys: string[],
): VariantSource {
  let currentSource: VariantSource = source;

  for (const transformKey of transformKeys) {
    currentSource = applyTransform(currentSource, transforms, transformKey);
  }

  return currentSource;
}
