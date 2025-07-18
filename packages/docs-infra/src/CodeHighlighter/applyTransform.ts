import { patch } from 'jsondiffpatch';
import { toText } from 'hast-util-to-text';
import type { Nodes as HastNodes } from 'hast';
import type { VariantSource, Transforms } from './types';

/**
 * Applies a specific transform to a variant source and returns the transformed source
 * @param source - The original variant source (string, HastNodes, or hastJson object)
 * @param transforms - Object containing all available transforms
 * @param transformKey - The key of the specific transform to apply
 * @returns The transformed variant source as a string
 * @throws Error if the transform key doesn't exist or patching fails
 */
export function applyTransform(
  source: VariantSource,
  transforms: Transforms,
  transformKey: string,
): string {
  const transform = transforms[transformKey];
  if (!transform) {
    throw new Error(`Transform "${transformKey}" not found in transforms`);
  }

  // Convert variant source to string
  let sourceString: string;
  if (typeof source === 'string') {
    sourceString = source;
  } else if ('hastJson' in source) {
    sourceString = toText(JSON.parse(source.hastJson) as HastNodes);
  } else {
    sourceString = toText(source);
  }

  // Apply the transform delta to the source
  const sourceLines = sourceString.split('\n');
  const patched = patch(sourceLines, transform.delta);

  if (!Array.isArray(patched)) {
    throw new Error(`Patch for transform "${transformKey}" did not return an array`);
  }

  return patched.join('\n');
}

/**
 * Applies multiple transforms to a variant source in sequence
 * @param source - The original variant source
 * @param transforms - Object containing all available transforms
 * @param transformKeys - Array of transform keys to apply in order
 * @returns The transformed variant source as a string
 * @throws Error if any transform key doesn't exist or patching fails
 */
export function applyTransforms(
  source: VariantSource,
  transforms: Transforms,
  transformKeys: string[],
): string {
  let currentSource: VariantSource = source;

  for (const transformKey of transformKeys) {
    currentSource = applyTransform(currentSource, transforms, transformKey);
  }

  return currentSource as string;
}

/**
 * Gets all available transform keys from a transforms object
 * @param transforms - Object containing transforms
 * @returns Array of transform keys
 */
export function getTransformKeys(transforms: Transforms): string[] {
  return Object.keys(transforms);
}

/**
 * Checks if a transform key exists in the transforms object
 * @param transforms - Object containing transforms
 * @param transformKey - The key to check
 * @returns True if the transform exists, false otherwise
 */
export function hasTransform(transforms: Transforms, transformKey: string): boolean {
  return transformKey in transforms;
}
