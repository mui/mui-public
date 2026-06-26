import { readFile } from 'node:fs/promises';
import { resolveCachePath } from './resolveCachePath';
import type { FileCacheEntry, FileCacheRef } from './types';

// Set DOCS_INFRA_CACHE_DEBUG=1 to surface non-missing read failures and corrupt entries.
const DEBUG = Boolean(process.env.DOCS_INFRA_CACHE_DEBUG);

function isFileCacheEntry(value: unknown): value is FileCacheEntry<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'hash' in value &&
    'data' in value &&
    typeof value.hash === 'string'
  );
}

/**
 * Reads and parses a cache entry without validating it against any content.
 *
 * Best-effort: a missing file, an unreadable file, malformed JSON, or a path-containment failure
 * all resolve to `null` (a cache miss) rather than throwing — so a stale or corrupt cache never
 * breaks a build. Use this to read the cache in parallel with the source file, then compare
 * `entry.hash` against `hashCacheContent(content)` once both reads complete.
 *
 * A non-missing read failure (e.g. a permissions error silently disabling the cache) is logged
 * under DEBUG rather than masquerading as a cold cache.
 */
export async function loadFileCacheEntry<T>(ref: FileCacheRef): Promise<FileCacheEntry<T> | null> {
  let raw: string;
  try {
    raw = await readFile(resolveCachePath(ref), 'utf-8');
  } catch (error) {
    const isMissing = error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT';
    if (DEBUG && !isMissing) {
      console.warn(`[docs-infra cache] read failed for ${ref.namespace}/${ref.cacheKey}:`, error);
    }
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    if (DEBUG) {
      console.warn(`[docs-infra cache] ignoring corrupt entry ${ref.namespace}/${ref.cacheKey}`);
    }
    return null;
  }

  if (!isFileCacheEntry(parsed)) {
    if (DEBUG) {
      console.warn(`[docs-infra cache] ignoring malformed entry ${ref.namespace}/${ref.cacheKey}`);
    }
    return null;
  }

  return parsed as FileCacheEntry<T>;
}
