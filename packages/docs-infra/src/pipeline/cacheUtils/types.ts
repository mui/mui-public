/**
 * Reference to a single cache entry on disk.
 *
 * The entry is stored at `{cacheDir}/{namespace}/{cacheKey}.json`. `cacheKey` may
 * contain `/` separators to nest entries (e.g. `utilities/parsing`).
 */
export interface FileCacheRef {
  /** Root cache directory. Relative paths resolve against the current working directory. */
  cacheDir: string;
  /** Subdirectory grouping related entries (e.g. `pages-index`). */
  namespace: string;
  /** Entry key, used as the file name without extension. May contain `/` for nesting. */
  cacheKey: string;
}

/**
 * On-disk shape of a cache entry: the validating content hash plus the cached value.
 */
export interface FileCacheEntry<T> {
  /** sha256 hex digest of the source content the cached value was derived from. */
  hash: string;
  /** The cached value. */
  data: T;
}
