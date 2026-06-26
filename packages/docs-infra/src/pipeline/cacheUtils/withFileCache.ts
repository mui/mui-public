import { hashCacheContent } from './hashCacheContent';
import { loadFileCacheEntry } from './loadFileCacheEntry';
import { saveFileCache } from './saveFileCache';
import type { FileCacheRef } from './types';

/**
 * A read-through file cache task: fetch an origin, derive its validating content, and either
 * return the cached result or compute a fresh one.
 */
export interface FileCacheTask<TOrigin, TData> {
  /** The cache entry to use, or `undefined` to bypass the cache entirely. */
  ref: FileCacheRef | undefined;
  /** Fetches the origin (e.g. reads the source file). Runs concurrently with the cache read. */
  readOrigin: () => Promise<TOrigin> | TOrigin;
  /**
   * Derives the string whose sha256 validates the cache from the origin — e.g. the file content,
   * or the content combined with the options that affect the result. May differ from what the
   * processor consumes.
   */
  getCacheContent: (origin: TOrigin) => string;
  /** Computes the result from the origin on a cache miss. */
  processor: (origin: TOrigin) => Promise<TData> | TData;
}

/**
 * Standardizes the read-through cache flow shared by the page-index and types caches:
 *
 * 1. Read the cache entry while fetching and hashing the origin, so the two reads overlap and the
 *    hash is ready before the cache read resolves.
 * 2. On a hash match, return the cached data and skip the processor.
 * 3. On a miss (or with no `ref`), run the processor, cache its result, and return it.
 *
 * Cache reads are best-effort; cache writes fail fast (see {@link saveFileCache}).
 */
export async function withFileCache<TOrigin, TData>({
  ref,
  readOrigin,
  getCacheContent,
  processor,
}: FileCacheTask<TOrigin, TData>): Promise<TData> {
  if (!ref) {
    return processor(await readOrigin());
  }

  // Start the cache read so it overlaps fetching and hashing the origin.
  const cacheEntryPromise = loadFileCacheEntry<TData>(ref);
  const origin = await readOrigin();
  const content = getCacheContent(origin);
  const contentHash = hashCacheContent(content);
  const cacheEntry = await cacheEntryPromise;
  if (cacheEntry && cacheEntry.hash === contentHash) {
    return cacheEntry.data;
  }

  const data = await processor(origin);
  await saveFileCache(ref, content, data);
  return data;
}
