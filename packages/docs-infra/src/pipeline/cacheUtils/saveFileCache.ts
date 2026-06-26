import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { hashCacheContent } from './hashCacheContent';
import { resolveCachePath } from './resolveCachePath';
import type { FileCacheEntry, FileCacheRef } from './types';

let tempCounter = 0;

/**
 * Writes a cache entry as `{ hash, data }`, where `hash` is the sha256 of `content` (or the
 * precomputed `hash` when supplied, to avoid hashing the content twice). Creates the cache
 * directory tree as needed and writes atomically (temp file + rename) so a concurrent reader
 * never observes a half-written file.
 *
 * Fails fast: any filesystem error propagates so a misconfigured cache directory surfaces
 * loudly at build time rather than silently disabling the cache. Callers that treat the write
 * as best-effort (e.g. {@link withFileCache}) catch it themselves.
 */
export async function saveFileCache<T>(
  ref: FileCacheRef,
  content: string,
  data: T,
  hash?: string,
): Promise<void> {
  const cachePath = resolveCachePath(ref);
  const entry: FileCacheEntry<T> = { hash: hash ?? hashCacheContent(content), data };
  await mkdir(dirname(cachePath), { recursive: true });

  // Write to a unique temp file then atomically rename over the target, so a torn write can
  // never corrupt the cache file an in-flight reader is parsing.
  tempCounter += 1;
  const tempPath = `${cachePath}.${process.pid}.${tempCounter}.tmp`;
  try {
    await writeFile(tempPath, JSON.stringify(entry), 'utf-8');
    await rename(tempPath, cachePath);
  } catch (error) {
    try {
      await rm(tempPath, { force: true });
    } catch {
      // Best-effort cleanup of the temp file; ignore.
    }
    throw error;
  }
}
