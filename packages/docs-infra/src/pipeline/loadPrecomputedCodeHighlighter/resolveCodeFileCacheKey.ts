// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import path from 'path';

/** Cache namespace for the per-file processed-result cache (mirrors `pages-index`/`types-text`). */
export const CODE_FILE_CACHE_NAMESPACE = 'code-file';

/**
 * Bump when the per-file processing output format changes in a way the file
 * content and options don't capture (e.g. the HAST shape, fallback format, or
 * transform-embedding scheme). Folded into the validating hash, so a bump
 * invalidates every entry. Routine pipeline-code edits are caught automatically by
 * the build fingerprint (see createServerFileCache); this is the manual escape hatch.
 */
export const CODE_FILE_CACHE_VERSION = 1;

/**
 * Derives the on-disk cache key for a processed file: simply its path relative to
 * the project root. The key is stable per source file (it does NOT encode the
 * per-call `variantKey` or content) so that a changed input — content, options,
 * version, or variantKey — is a hash mismatch that recomputes and **overwrites the
 * same entry**, rather than leaving an orphaned file behind. The validating hash
 * (built by the cache from the variantKey + options + content) is what guarantees a
 * hit only when the result would be identical.
 *
 * Returns `undefined` for files outside `rootContext` (e.g. linked dependencies):
 * their relative path would escape the cache dir, so they are left uncached.
 */
export function resolveCodeFileCacheKey(filePath: string, rootContext: string): string | undefined {
  const relative = path.relative(rootContext, filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return undefined;
  }
  return relative.split(path.sep).join('/');
}

/**
 * Serializes the build-wide options that affect every file's processed output, for
 * folding into the cache's validating hash. The loader and any test must build this
 * identically for hashes to match. Per-call inputs travel separately as the
 * `variantKey`; the file content is appended by the cache itself.
 */
export function buildCodeFileGlobalOptionsKey(options: {
  output?: string;
  transformTypescriptToJavascript?: boolean;
  emphasisOptions?: unknown;
  removeCommentsWithPrefix?: string[];
  notableCommentsPrefix?: string[];
}): string {
  // Note: NODE_ENV is deliberately NOT part of the key — the serialized output is
  // env-independent (compression is driven by `output`, not the environment), so a
  // dev build and a production build reuse each other's entries.
  return JSON.stringify({
    version: CODE_FILE_CACHE_VERSION,
    output: options.output ?? null,
    transformTypescriptToJavascript: Boolean(options.transformTypescriptToJavascript),
    emphasisOptions: options.emphasisOptions ?? null,
    removeCommentsWithPrefix: options.removeCommentsWithPrefix ?? null,
    notableCommentsPrefix: options.notableCommentsPrefix ?? null,
  });
}
