import { resolve, sep } from 'node:path';
import type { FileCacheRef } from './types';

/**
 * Resolves the absolute path of a cache entry: `{cacheDir}/{namespace}/{cacheKey}.json`.
 *
 * Relative `cacheDir` values resolve against the current working directory so that readers and
 * writers running from the same project root agree on the location. `cacheKey` may contain `/`
 * separators, which become nested directories.
 *
 * Fails fast if a `namespace`/`cacheKey` segment (e.g. a `..`) would escape the cache directory,
 * so a malformed route can never read or write outside `{cacheDir}`.
 */
export function resolveCachePath({ cacheDir, namespace, cacheKey }: FileCacheRef): string {
  const base = resolve(cacheDir);
  const full = resolve(base, namespace, `${cacheKey}.json`);
  const baseWithSep = base.endsWith(sep) ? base : `${base}${sep}`;
  if (!full.startsWith(baseWithSep)) {
    throw new Error(
      `Cache path for "${namespace}/${cacheKey}" escapes the cache directory "${cacheDir}".`,
    );
  }
  return full;
}
