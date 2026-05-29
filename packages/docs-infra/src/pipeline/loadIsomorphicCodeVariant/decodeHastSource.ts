import { decompressHast } from '../hastUtils';
import { fallbackToText, redistributeRootFallback } from '../../CodeHighlighter/fallbackFormat';
import type { FallbackNode } from '../../CodeHighlighter/fallbackFormat';
import type { HastRoot, VariantSource } from '../../CodeHighlighter/types';

/**
 * WeakMap cache of decoded `HastRoot` keyed on the raw source payload
 * object. Variant source payloads are stable references across renders
 * (they live on the precomputed manifest / context), so identity-keying
 * is safe and lets us amortize the decompress + `JSON.parse` cost across
 * every consumer that reads the same variant during a render cycle.
 */
const decodedHastCache = new WeakMap<object, HastRoot>();

/**
 * WeakMap cache of the DEFLATE dictionary text derived from a variant's
 * root `fallback`. `fallbackToText` walks the whole fallback tree, so we
 * memoize it per fallback array — the same array is reused for the variant's
 * compressed source decode and any later re-decodes.
 */
const fallbackTextCache = new WeakMap<FallbackNode[], string>();

function getFallbackText(fallback: FallbackNode[]): string {
  let text = fallbackTextCache.get(fallback);
  if (text === undefined) {
    text = fallbackToText(fallback);
    fallbackTextCache.set(fallback, text);
  }
  return text;
}

function isHastRoot(value: object): value is HastRoot {
  return 'type' in value && (value as HastRoot).type === 'root';
}

/**
 * Resolves a `VariantSource` to a live `HastRoot`, sharing one decode per
 * source payload across all consumers (`Pre`, `useFileNavigation`,
 * `sourceLineCounts`, …). Decompresses `hastCompressed`, parses `hastJson`,
 * and returns live HAST trees unchanged. Returns `null` for string sources
 * or unrecognized shapes.
 *
 * When a variant-level `fallback` is provided, the compressed payload is
 * decompressed using the fallback text as a DEFLATE dictionary (matching the
 * encoder), and each `span.frame` of a freshly decoded tree gets its
 * per-frame `data.fallback` restored via `redistributeRootFallback`. Live
 * HAST trees are returned untouched — they already carry their per-frame
 * fallback and are shared, read-only inputs.
 *
 * **The returned tree must be treated as read-only.** Multiple consumers
 * share the same object; mutating it would leak across them. Callers that
 * need to mutate the HAST (e.g. the enhancer pipeline in
 * `useSourceEnhancing`) must clone before mutating, and should not use
 * this cache.
 */
export function decodeHastSource(
  source: VariantSource | null | undefined,
  fallback?: FallbackNode[],
): HastRoot | null {
  if (source == null || typeof source === 'string') {
    return null;
  }
  const cached = decodedHastCache.get(source);
  if (cached) {
    return cached;
  }
  let root: HastRoot;
  let decoded = false;
  try {
    if ('hastJson' in source) {
      root = JSON.parse(source.hastJson) as HastRoot;
      decoded = true;
    } else if ('hastCompressed' in source) {
      const dictionary = fallback ? getFallbackText(fallback) : undefined;
      root = JSON.parse(decompressHast(source.hastCompressed, dictionary)) as HastRoot;
      decoded = true;
    } else if (isHastRoot(source)) {
      root = source;
    } else {
      return null;
    }
  } catch (error) {
    // The "not a HAST source" cases (string / null / unrecognized shape) already
    // returned `null` above — so reaching here means a present `hastJson` /
    // `hastCompressed` payload failed to parse or decompress. That's a real bug
    // (most often a missing or mismatched `fallback` dictionary for
    // `hastCompressed`), so throw rather than returning `null`: a swallowed
    // error here only resurfaces far away as a blank render or a `null.data`
    // crash, which is what makes it hard to track down.
    throw new Error(
      `Failed to decode the source HAST payload${
        'hastCompressed' in source
          ? ' — a hastCompressed payload needs a matching fallback dictionary'
          : ''
      }: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  // Freshly decoded trees are owned by this cache, so it is safe to restore
  // the per-frame `data.fallback` that was stripped before serialization.
  // Live HAST inputs are shared and already carry their per-frame fallback.
  if (decoded && fallback) {
    redistributeRootFallback(root, fallback);
  }
  decodedHastCache.set(source, root);
  return root;
}
