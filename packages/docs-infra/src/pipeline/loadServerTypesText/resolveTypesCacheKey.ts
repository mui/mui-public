import { extractPrefixAndTitle } from '../loadServerPageIndex/extractPrefixAndTitle';
import type { OrderingConfig } from './order';

/** Cache namespace for the types.md parse cache (TypesSourceData), mirroring the page-index cache. */
export const TYPES_TEXT_CACHE_NAMESPACE = 'types-text';

/**
 * Derives the cache key for a types.md file from its path, reusing the page route
 * derivation so a writer (syncTypes) and reader (loadServerTypesText) of the same
 * types.md agree on the cache location.
 *
 * @example
 * resolveTypesCacheKey('/root/src/app/components/accordion/types.md', '/root') // 'components/accordion'
 */
export function resolveTypesCacheKey(typesMarkdownPath: string, rootContext: string): string {
  const { prefix } = extractPrefixAndTitle(typesMarkdownPath, rootContext);
  const segments = prefix.split('/').filter(Boolean);
  return segments.length > 0 ? segments.join('/') : 'index';
}

/**
 * Builds the hash-validation content for the types.md parse cache. Includes the
 * ordering config because it changes `parseTypesMarkdown`'s output, so the cache is
 * invalidated when either the markdown or the ordering changes. The writer (syncTypes)
 * and reader (loadServerTypesText) must build this identically for their hashes to match.
 */
export function buildTypesTextCacheContent(markdown: string, ordering?: OrderingConfig): string {
  return `${JSON.stringify(ordering ?? null)}\n${markdown}`;
}
