import { hashCacheContent } from './hashCacheContent';
import { loadFileCacheEntry } from './loadFileCacheEntry';
import type { FileCacheRef } from './types';

/**
 * Reads a cache entry and returns its data only when the stored hash matches the
 * current content.
 *
 * Best-effort by design: a missing file, an unreadable file, malformed JSON, or a
 * hash mismatch all resolve to `null` (a cache miss) rather than throwing, so a
 * stale or corrupt cache can never break a build — it is simply recomputed.
 *
 * To overlap the cache read with reading the source file, use {@link loadFileCacheEntry}
 * directly and compare the hash yourself.
 */
export async function loadFileCache<T>(ref: FileCacheRef, content: string): Promise<T | null> {
  const entry = await loadFileCacheEntry<T>(ref);
  if (!entry || entry.hash !== hashCacheContent(content)) {
    return null;
  }
  return entry.data;
}
