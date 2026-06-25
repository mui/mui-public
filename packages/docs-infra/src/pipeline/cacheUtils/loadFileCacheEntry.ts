import { readFile } from 'node:fs/promises';
import { resolveCachePath } from './resolveCachePath';
import type { FileCacheEntry, FileCacheRef } from './types';

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
 * Best-effort: a missing file, an unreadable file, or malformed JSON resolves to `null`
 * rather than throwing. Use this to read the cache in parallel with the source file, then
 * compare `entry.hash` against `hashCacheContent(content)` once both reads complete.
 */
export async function loadFileCacheEntry<T>(ref: FileCacheRef): Promise<FileCacheEntry<T> | null> {
  let raw: string;
  try {
    raw = await readFile(resolveCachePath(ref), 'utf-8');
  } catch {
    // Missing or unreadable cache file - treat as a miss.
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt cache file - treat as a miss; the next write will overwrite it.
    return null;
  }

  return isFileCacheEntry(parsed) ? (parsed as FileCacheEntry<T>) : null;
}
