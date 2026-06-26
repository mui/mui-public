import { hashCacheContent } from './hashCacheContent';
import { loadFileCacheEntry } from './loadFileCacheEntry';
import { saveFileCacheEntry } from './saveFileCache';
import type { FileCacheRef } from './types';

// Set DOCS_INFRA_CACHE_DEBUG=1 to log cache hit/miss and best-effort write failures.
const DEBUG = Boolean(process.env.DOCS_INFRA_CACHE_DEBUG);

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
 * 3. On a miss (or with no `ref`), run the processor and return its result.
 *
 * A rejection from `readOrigin`/`getCacheContent` surfaces to the caller; the in-flight cache read
 * is abandoned safely because {@link loadFileCacheEntry} never rejects. Populating the cache is
 * **best-effort** — a write failure (e.g. an unwritable cache dir) is swallowed (logged under
 * DEBUG) and the freshly computed result is returned regardless, so a cache hiccup never fails the
 * caller or drops its output. The explicit build/validate writers (syncPageIndex/syncTypes) call
 * {@link saveFileCache} directly and stay fail-fast.
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
  // Hash the cache content without binding it to a variable: the hash-input string can be large
  // (e.g. a multi-MB JSON of the loaded types), and it is only needed to compute the hash — so we
  // let it be collected immediately rather than retaining it through the cache read, the processor,
  // and the write. saveFileCacheEntry below reuses the hash, so the content is never needed again.
  const contentHash = hashCacheContent(getCacheContent(origin));
  let cacheEntry = await cacheEntryPromise;
  if (cacheEntry && cacheEntry.hash === contentHash) {
    if (DEBUG) {
      console.warn(`[docs-infra cache] hit ${ref.namespace}/${ref.cacheKey}`);
    }
    return cacheEntry.data;
  }

  // Distinguish a stale (warm-but-mismatched) miss from a cold one — a perpetual writer/reader hash
  // divergence surfaces here, and is exactly the failure DEBUG exists to make visible. Drop the
  // stale entry before the processor runs so its (possibly multi-MB) data is not retained alongside
  // the freshly computed result.
  const wasStale = Boolean(cacheEntry);
  cacheEntry = null;
  if (DEBUG && wasStale) {
    console.warn(
      `[docs-infra cache] stale ${ref.namespace}/${ref.cacheKey} (hash mismatch, recomputing)`,
    );
  }

  const data = await processor(origin);

  try {
    await saveFileCacheEntry(ref, { hash: contentHash, data });
    if (DEBUG) {
      console.warn(`[docs-infra cache] miss → wrote ${ref.namespace}/${ref.cacheKey}`);
    }
  } catch (error) {
    // Best-effort: any save failure — IO, the resolveCachePath traversal guard, or a serialization
    // error on non-JSON-safe data — is swallowed so a misconfigured cache can never drop a page or
    // fail a build; the computed result is returned regardless. The fail-fast writers (syncPageIndex
    // and syncTypes, via saveFileCache) surface these instead. DEBUG logs them here.
    if (DEBUG) {
      console.warn(`[docs-infra cache] write failed for ${ref.namespace}/${ref.cacheKey}:`, error);
    }
  }

  return data;
}
