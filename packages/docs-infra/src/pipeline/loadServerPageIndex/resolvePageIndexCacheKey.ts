import { extractPrefixAndTitle } from './extractPrefixAndTitle';

/** Cache namespace (subdirectory) for page-index entries. */
export const PAGE_INDEX_CACHE_NAMESPACE = 'pages-index';

/**
 * Derives the cache key for a page-index file from its path, reusing the same
 * route derivation as the loaded data so a writer and reader of the same index
 * agree on the cache location.
 *
 * @example
 * resolvePageIndexCacheKey('/root/src/app/components/page.mdx', '/root') // 'components'
 * resolvePageIndexCacheKey('/root/app/utilities/parsing/page.mdx', '/root') // 'utilities/parsing'
 * resolvePageIndexCacheKey('/root/app/page.mdx', '/root') // 'index' (root)
 */
export function resolvePageIndexCacheKey(absolutePath: string, rootContext: string): string {
  const { prefix } = extractPrefixAndTitle(absolutePath, rootContext);
  // prefix is like '/components/' or '/utilities/parsing/' (or '/' for the root index).
  const segments = prefix.split('/').filter(Boolean);
  return segments.length > 0 ? segments.join('/') : 'index';
}
