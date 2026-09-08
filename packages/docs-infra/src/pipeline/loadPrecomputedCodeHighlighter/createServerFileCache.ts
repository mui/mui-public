// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import { readFile } from 'fs/promises';
// eslint-disable-next-line n/prefer-node-protocol
import { statSync } from 'fs';
// eslint-disable-next-line n/prefer-node-protocol
import { fileURLToPath } from 'url';
import { withFileCache } from '../cacheUtils';
import type { LoadFileCache } from '../../CodeHighlighter/types';
import { CODE_FILE_CACHE_NAMESPACE, resolveCodeFileCacheKey } from './resolveCodeFileCacheKey';

// Build fingerprint: the mtime of this module's own build file. `pnpm docs:lib`
// recompiles every file under build/, so this changes on each rebuild and busts the
// cache when the highlight/enhance/diff pipeline code changes — without a manual
// version bump. Computed once per process.
let buildFingerprint: string | undefined;
function getBuildFingerprint(): string {
  if (buildFingerprint === undefined) {
    try {
      buildFingerprint = String(statSync(fileURLToPath(import.meta.url)).mtimeMs);
    } catch {
      // No build file to stat (e.g. running from source in tests) — fall back to a
      // constant so caching still works within a single run.
      buildFingerprint = 'src';
    }
  }
  return buildFingerprint;
}

export interface ServerFileCacheOptions {
  /** Root cache directory (e.g. `.next/cache/docs-infra`). */
  cacheDir: string;
  /** Project root; file paths are keyed relative to it. */
  rootContext: string;
  /**
   * Serialized build-wide options that affect every file's output
   * (see {@link buildCodeFileGlobalOptionsKey}). Folded into the validating hash.
   */
  globalOptionsKey: string;
}

/**
 * Creates a disk-backed {@link LoadFileCache} for the per-file processed result
 * (load + transform + highlight + enhance). Entries live at
 * `{cacheDir}/code-file/{relativePath}.{variantHash}.json`, validated by the sha256
 * of the build fingerprint + build-wide options + per-call `variantKey` + file
 * content — so an edit, an option change, or a pipeline rebuild all invalidate
 * naturally. Best-effort: a cache read/write failure never breaks a build (see
 * {@link withFileCache}).
 */
export function createServerFileCache({
  cacheDir,
  rootContext,
  globalOptionsKey,
}: ServerFileCacheOptions): LoadFileCache {
  const fingerprint = getBuildFingerprint();

  return ({ url, variantKey, compute }) => {
    const filePath = fileURLToPath(url);
    // Stable key per file: a changed variantKey/content/options is a hash mismatch
    // that overwrites this same entry (see resolveCodeFileCacheKey) — the variantKey
    // lives in the validating hash below, not the path, so nothing accumulates.
    const cacheKey = resolveCodeFileCacheKey(filePath, rootContext);
    if (!cacheKey) {
      // File outside the project root — don't cache it (its key would escape the
      // cache dir). Run uncached without the extra origin read.
      return compute();
    }

    return withFileCache({
      ref: { cacheDir, namespace: CODE_FILE_CACHE_NAMESPACE, cacheKey },
      readOrigin: () => readFile(filePath, 'utf-8'),
      getCacheContent: (content) =>
        `${fingerprint}\n${globalOptionsKey}\n${variantKey}\n${content}`,
      processor: () => compute(),
    });
  };
}
