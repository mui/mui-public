import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { withFileCache } from '../cacheUtils';
import type { FileCacheRef } from '../cacheUtils';
import type { TypesMeta } from '../loadServerTypesMeta';
import type { OrganizeTypesResult } from './organizeTypesByExport';
import { parseTypesMarkdown } from './parseTypesMarkdown';
import { TYPES_TEXT_CACHE_NAMESPACE, typesCacheKey, typesTextCacheContent } from './typesCacheKey';
import type { OrderingConfig } from './order';

/**
 * Common data returned by both syncTypes and loadServerTypesText.
 * This is the shared contract consumed by loadServerTypes.
 */
export interface TypesSourceData extends OrganizeTypesResult<TypesMeta> {
  /** External types discovered in the file */
  externalTypes: Record<string, string>;
  /**
   * Type name map (merged across all variants).
   * Maps flat names (like "AccordionTriggerState") to dotted names (like "Accordion.Trigger.State").
   */
  typeNameMap: Record<string, string>;
  /** All dependencies that should be watched for changes */
  allDependencies: string[];
  /** Whether the types.md file was updated (false if loaded from existing file) */
  updated: boolean;
}

/**
 * Options for the types.md parse cache.
 *
 * When both are set, the parse of types.md is cached at `{cacheDir}/types-text/{route}.json`,
 * keyed by the sha256 of the file content (plus ordering), mirroring the page-index cache.
 */
export interface LoadServerTypesTextCacheOptions {
  /** Directory for the sha256-validated JSON cache of parsed types.md files. */
  cacheDir?: string;
  /** Root context directory used to derive the cache key/route. */
  rootContext?: string;
}

/**
 * Load and parse a types.md file into TypesMeta[].
 *
 * @param fileUrl - file:// URL to the types.md file
 * @param ordering - optional ordering config that affects how types are sorted
 * @param cache - optional parse-cache configuration
 * @returns Parsed types and external types
 */
export function loadServerTypesText(
  fileUrl: string,
  ordering?: OrderingConfig,
  cache?: LoadServerTypesTextCacheOptions,
): Promise<TypesSourceData> {
  const filePath = fileURLToPath(fileUrl);

  const cacheRef: FileCacheRef | undefined =
    cache?.cacheDir && cache.rootContext
      ? {
          cacheDir: cache.cacheDir,
          namespace: TYPES_TEXT_CACHE_NAMESPACE,
          cacheKey: typesCacheKey(filePath, cache.rootContext),
        }
      : undefined;

  // The cache stores the parsed TypesSourceData keyed by the markdown + ordering hash, so a hit
  // skips parseTypesMarkdown (the expensive step).
  return withFileCache({
    ref: cacheRef,
    readOrigin: () => readFile(filePath, 'utf-8'),
    getCacheContent: (content) => typesTextCacheContent(content, ordering),
    processor: async (content) => ({
      ...(await parseTypesMarkdown(content, ordering)),
      allDependencies: [filePath],
      updated: false,
    }),
  });
}
