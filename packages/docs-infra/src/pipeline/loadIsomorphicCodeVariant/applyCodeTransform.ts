// Standalone (server/build) entry to the transform-application core. Binds the
// concrete `decodeHastSource` so callers that don't inject one — the
// `loadIsomorphicCodeVariant` pipeline, tests, and anything importing
// `@mui/internal-docs-infra/pipeline/loadIsomorphicCodeVariant` — keep the
// original API. The client-side `useCode/TransformEngine` instead imports the
// core (`./applyCodeTransformWithComments`) directly and injects the shell's
// already-loaded decoder, so the engine chunk never statically pulls
// `decodeHastSource` (and its `hastDecompress` dependency).

import type { VariantSource, Transforms, SourceComments } from '../../CodeHighlighter/types';
import type { FallbackNode } from '../../CodeHighlighter/fallbackFormat';
import { decodeHastSource } from './decodeHastSource';
import { frameFallbackFromSpans } from '../hastUtils';
import {
  applyCodeTransformWithComments as applyCodeTransformWithCommentsCore,
  applyCodeTransformsWithComments as applyCodeTransformsWithCommentsCore,
  type TransformRuntimeDeps,
} from './applyCodeTransformWithComments';

// The built-in hast helpers, bound once for callers that don't inject their own
// (the `loadIsomorphicCodeVariant` server/build pipeline, tests, etc.).
const builtinDeps: TransformRuntimeDeps = { decode: decodeHastSource, frameFallbackFromSpans };

/**
 * Applies a specific transform to a variant source and returns the transformed
 * source plus a remapped copy of the supplied `comments` map. See
 * {@link applyCodeTransformWithCommentsCore} for the full contract; this wrapper
 * binds the built-in `decodeHastSource`.
 *
 * @throws Error if the transform key doesn't exist or patching fails
 */
export function applyCodeTransformWithComments(
  source: VariantSource,
  transforms: Transforms,
  transformKey: string,
  comments?: SourceComments,
  fallback?: FallbackNode[],
): { source: VariantSource; comments?: SourceComments } {
  return applyCodeTransformWithCommentsCore(
    source,
    transforms,
    transformKey,
    builtinDeps,
    comments,
    fallback,
  );
}

/**
 * Applies multiple transforms to a variant source in sequence, shifting
 * comments through each hop. See {@link applyCodeTransformsWithCommentsCore};
 * this wrapper binds the built-in `decodeHastSource`.
 *
 * @throws Error if any transform key doesn't exist or patching fails
 */
export function applyCodeTransformsWithComments(
  source: VariantSource,
  transforms: Transforms,
  transformKeys: string[],
  comments?: SourceComments,
  fallback?: FallbackNode[],
): { source: VariantSource; comments?: SourceComments } {
  return applyCodeTransformsWithCommentsCore(
    source,
    transforms,
    transformKeys,
    builtinDeps,
    comments,
    fallback,
  );
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
