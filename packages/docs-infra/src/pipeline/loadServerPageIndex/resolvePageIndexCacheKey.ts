import { extractPrefixAndTitle } from './extractPrefixAndTitle';

/**
 * Cache namespace (subdirectory) for page-index entries. The `-v2` suffix is a schema version:
 * grouped indexes added always-present `sections` and per-page `section` fields to the cached
 * read-model, so a pre-existing `pages-index` entry (keyed only by content hash) could otherwise
 * survive a docs-infra upgrade and serve the old shape for an unchanged index file. Bumping the
 * namespace forces a clean miss the first time the new code runs. Bump again on any future
 * breaking change to the cached page-index shape.
 */
export const PAGE_INDEX_CACHE_NAMESPACE = 'pages-index-v2';

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
