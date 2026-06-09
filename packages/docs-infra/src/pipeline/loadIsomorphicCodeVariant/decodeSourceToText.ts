import { toText } from 'hast-util-to-text';
import type { VariantSource } from '../../CodeHighlighter/types';
import type { FallbackNode } from '../../CodeHighlighter/fallbackFormat';
import { decodeHastSource } from './decodeHastSource';

/**
 * Decode a `VariantSource` to its plain text, reusing the shared
 * `decodeHastSource` cache so a `hastCompressed` / `hastJson` payload that was
 * already decoded for rendering is not inflated and parsed a second time.
 *
 * String sources are returned unchanged and need no `fallback`. For an encoded
 * source, `fallback` supplies the DEFLATE dictionary required to decode a
 * `hastCompressed` payload (the file's compact fallback text); omitting it for
 * such a payload surfaces a descriptive error from `decodeHastSource` rather
 * than a cryptic inflate failure.
 *
 * `null` / `undefined` sources resolve to an empty string so callers can treat
 * a missing source the same as an empty file.
 */
export function decodeSourceToText(
  source: VariantSource | null | undefined,
  fallback?: FallbackNode[],
): string {
  if (source == null || typeof source === 'string') {
    return source ?? '';
  }

  const root = decodeHastSource(source, fallback);
  return root ? toText(root, { whitespace: 'pre' }) : '';
}
