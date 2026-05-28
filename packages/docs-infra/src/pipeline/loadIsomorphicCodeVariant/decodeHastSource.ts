import { decompressHast } from '../hastUtils';
import type { HastRoot, VariantSource } from '../../CodeHighlighter/types';

/**
 * WeakMap cache of decoded `HastRoot` keyed on the raw source payload
 * object. Variant source payloads are stable references across renders
 * (they live on the precomputed manifest / context), so identity-keying
 * is safe and lets us amortize the decompress + `JSON.parse` cost across
 * every consumer that reads the same variant during a render cycle.
 */
const decodedHastCache = new WeakMap<object, HastRoot>();

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
 * **The returned tree must be treated as read-only.** Multiple consumers
 * share the same object; mutating it would leak across them. Callers that
 * need to mutate the HAST (e.g. the enhancer pipeline in
 * `useSourceEnhancing`) must clone before mutating, and should not use
 * this cache.
 */
export function decodeHastSource(source: VariantSource | null | undefined): HastRoot | null {
  if (source == null || typeof source === 'string') {
    return null;
  }
  const cached = decodedHastCache.get(source);
  if (cached) {
    return cached;
  }
  let root: HastRoot;
  try {
    if ('hastJson' in source) {
      root = JSON.parse(source.hastJson) as HastRoot;
    } else if ('hastCompressed' in source) {
      root = JSON.parse(decompressHast(source.hastCompressed)) as HastRoot;
    } else if (isHastRoot(source)) {
      root = source;
    } else {
      return null;
    }
  } catch {
    return null;
  }
  decodedHastCache.set(source, root);
  return root;
}
