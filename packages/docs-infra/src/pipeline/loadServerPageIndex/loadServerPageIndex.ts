import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { markdownToMetadata } from '../syncPageIndex/metadataToMarkdown';
import { withFileCache } from '../cacheUtils';
import type { FileCacheRef } from '../cacheUtils';
import { enrichPageIndex } from './enrichPageIndex';
import { resolvePageIndexCacheKey, PAGE_INDEX_CACHE_NAMESPACE } from './resolvePageIndexCacheKey';
import type { SitemapSectionData } from '../../createSitemap/types';

/**
 * Options for creating a loadServerPageIndex function
 */
export interface CreateLoadServerPageIndexOptions {
  /**
   * The root context directory for resolving relative paths.
   * Defaults to process.cwd().
   */
  rootContext?: string;
  /**
   * Directory for the sha256-validated JSON cache of parsed page indexes.
   *
   * When set, a read first checks `{cacheDir}/pages-index/{route}.json`; on a hash
   * match it returns the cached data and skips the markdown parse, and on a miss it
   * parses, writes the cache, and returns. When unset, no cache is read or written.
   */
  cacheDir?: string;
}

/**
 * Function type for loading page index data from a markdown file
 */
export type LoadServerPageIndex = (filePath: string) => Promise<SitemapSectionData | null>;

/**
 * Default loadServerPageIndex function that loads page index data from a markdown file.
 * This function uses process.cwd() as the root context for resolving relative paths.
 */
export const loadServerPageIndex: LoadServerPageIndex = createLoadServerPageIndex();

/**
 * Creates a loadServerPageIndex function with custom options.
 *
 * This factory function creates a LoadServerPageIndex implementation that:
 * 1. Reads the markdown file from the provided file path
 * 2. Returns a cached `SitemapSectionData` when `cacheDir` is set and the markdown is unchanged
 * 3. Otherwise parses the markdown to extract metadata using markdownToMetadata
 * 4. Enriches the metadata with prefix and title derived from the file path
 * 5. Pre-populates the cache (when `cacheDir` is set) for the next cold read
 *
 * @param options - Configuration options for the loader
 * @returns LoadServerPageIndex function that takes a file path and returns Promise<SitemapSectionData | null>
 */
export function createLoadServerPageIndex(
  options: CreateLoadServerPageIndexOptions = {},
): LoadServerPageIndex {
  const rootContext = options.rootContext ?? process.cwd();
  const { cacheDir } = options;

  return function loadPageIndex(filePath: string): Promise<SitemapSectionData | null> {
    // Convert file:// URLs to proper file system paths for reading the file.
    // Using fileURLToPath handles Windows drive letters correctly (e.g., file:///C:/... → C:\...)
    const absolutePath = filePath.startsWith('file://') ? fileURLToPath(filePath) : filePath;

    const cacheRef: FileCacheRef | undefined = cacheDir
      ? {
          cacheDir,
          namespace: PAGE_INDEX_CACHE_NAMESPACE,
          cacheKey: resolvePageIndexCacheKey(absolutePath, rootContext),
        }
      : undefined;

    // The cache stores the enriched read-model keyed by the markdown hash, so a hit skips the
    // markdownToMetadata parse.
    return withFileCache({
      ref: cacheRef,
      readOrigin: () => fs.readFile(absolutePath, 'utf-8'),
      getCacheContent: (markdownContent) => markdownContent,
      processor: async (markdownContent) => {
        const metadata = await markdownToMetadata(markdownContent);
        if (!metadata) {
          return null;
        }
        return enrichPageIndex(metadata, absolutePath, rootContext);
      },
    });
  };
}
