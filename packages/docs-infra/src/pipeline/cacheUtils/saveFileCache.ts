import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { hashCacheContent } from './hashCacheContent';
import { resolveCachePath } from './resolveCachePath';
import type { FileCacheEntry, FileCacheRef } from './types';

/**
 * Writes a cache entry as `{ hash, data }`, where `hash` is the sha256 of `content`.
 * Creates the cache directory tree as needed.
 *
 * Fails fast: any filesystem error propagates so a misconfigured cache directory
 * surfaces loudly at build time rather than silently disabling the cache.
 */
export async function saveFileCache<T>(ref: FileCacheRef, content: string, data: T): Promise<void> {
  const cachePath = resolveCachePath(ref);
  const entry: FileCacheEntry<T> = { hash: hashCacheContent(content), data };
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(entry), 'utf-8');
}
