import type { VariantSource } from '../../CodeHighlighter/types';
import type { FallbackNode } from '../../CodeHighlighter/fallbackFormat';
import { decodeHastSource } from './decodeHastSource';

/**
 * Decode a `VariantSource` into a form that carries no serialization: a plain
 * string stays a string, while a serialized `hastCompressed` / `hastJson`
 * payload (or a live `HastRoot`) resolves to a live `HastRoot`. The
 * `{ hastJson }` / `{ hastCompressed }` shapes never leak out, so consumers can
 * read the source as text (`stringOrHastToString`) or inspect / transform the
 * HAST tree directly without handling a DEFLATE dictionary.
 *
 * Decoding reuses the shared `decodeHastSource` cache — so a source already
 * decoded for rendering is not inflated again — then returns a
 * `structuredClone` of the tree. The clone matters: `decodeHastSource` hands
 * back a read-only tree shared with the live render, and the result here is
 * handed to user code (the `transformVariant` hook), which must be able to
 * mutate it without corrupting that shared tree. `fallback` is the DEFLATE
 * dictionary for a `hastCompressed` source.
 */
export function decodeSource(source: VariantSource, fallback?: FallbackNode[]): VariantSource {
  if (typeof source === 'string') {
    return source;
  }

  const root = decodeHastSource(source, fallback);
  return root ? structuredClone(root) : source;
}
