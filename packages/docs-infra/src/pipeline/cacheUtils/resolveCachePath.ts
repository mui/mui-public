import { resolve } from 'node:path';
import type { FileCacheRef } from './types';

/**
 * Resolves the absolute path of a cache entry: `{cacheDir}/{namespace}/{cacheKey}.json`.
 *
 * Relative `cacheDir` values resolve against the current working directory so that
 * readers and writers running from the same project root agree on the location.
 * `cacheKey` may contain `/` separators, which become nested directories.
 */
export function resolveCachePath({ cacheDir, namespace, cacheKey }: FileCacheRef): string {
  return resolve(cacheDir, namespace, `${cacheKey}.json`);
}
