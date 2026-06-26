import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { hashCacheContent } from './hashCacheContent';
import { resolveCachePath } from './resolveCachePath';
import type { FileCacheEntry, FileCacheRef } from './types';

let tempCounter = 0;

/**
 * Writes a precomputed cache entry (`{ hash, data }`) atomically (temp file + rename) so a
 * concurrent reader never observes a half-written file. Creates the cache directory tree as needed.
 *
 * Fails fast: any filesystem error propagates so a misconfigured cache directory surfaces loudly at
 * build time. Callers that treat the write as best-effort (e.g. {@link withFileCache}) catch it.
 *
 * Use this (rather than {@link saveFileCache}) when the hash is already known, so the (possibly
 * large) hash-input string does not have to be retained just to be re-hashed here.
 */
export async function saveFileCacheEntry<T>(
  ref: FileCacheRef,
  entry: FileCacheEntry<T>,
): Promise<void> {
  const cachePath = resolveCachePath(ref);
  await mkdir(dirname(cachePath), { recursive: true });

  // Write to a unique temp file then atomically rename over the target, so a torn write can never
  // corrupt the cache file an in-flight reader is parsing. The serialized string is transient.
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

/**
 * Writes a cache entry as `{ hash: sha256(content), data }`. Convenience over
 * {@link saveFileCacheEntry} for callers that hold the source `content` and want it hashed here.
 */
export async function saveFileCache<T>(ref: FileCacheRef, content: string, data: T): Promise<void> {
  return saveFileCacheEntry(ref, { hash: hashCacheContent(content), data });
}
