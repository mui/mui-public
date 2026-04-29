/**
 * Derives `relativeUrl` values for `extraFiles` entries whose key, when
 * resolved against the source file's URL, does not point at the file itself.
 *
 * Given the URL of the file these extra files were extracted from and the
 * `extraFiles` map produced by `processRelativeImports`, this returns a record
 * of `extraFileKey -> relativeUrl` for entries where
 * `new URL(extraFileKey, sourceFileUrl)` does not equal the actual file URL.
 *
 * `relativeUrl` is normalized to always start with `./` or `../` so consumers
 * can derive the original file URL via `new URL(relativeUrl, sourceFileUrl)`.
 *
 * Entries whose key already resolves to the file URL (typically `canonical`
 * mode) are omitted to keep the serialized payload small.
 */
export function deriveRelativeUrls(
  sourceFileUrl: string,
  extraFiles: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [extraFileKey, fileUrl] of Object.entries(extraFiles)) {
    let resolvedFromKey: string;
    try {
      resolvedFromKey = new URL(extraFileKey, sourceFileUrl).href;
    } catch {
      continue;
    }

    if (resolvedFromKey === fileUrl) {
      // Key already resolves to the file URL; no relativeUrl needed.
      continue;
    }

    // Compute the relative path from the source file URL to the actual file
    // URL so that `new URL(relativeUrl, sourceFileUrl)` round-trips back to
    // `fileUrl`. The original import specifier (e.g. `'../helper'`) cannot be
    // used because it may omit the extension.
    const computed = computeRelativeUrl(sourceFileUrl, fileUrl);
    if (computed !== undefined) {
      result[extraFileKey] = computed;
    }
  }

  return result;
}

/**
 * Computes a URL-style relative path from `sourceFileUrl` (the URL of a file)
 * to `targetFileUrl` such that `new URL(result, sourceFileUrl).href === targetFileUrl`.
 *
 * Returns `undefined` if the URLs differ in scheme or origin, in which case
 * a relative reference cannot be produced.
 */
function computeRelativeUrl(sourceFileUrl: string, targetFileUrl: string): string | undefined {
  let source: URL;
  let target: URL;
  try {
    source = new URL(sourceFileUrl);
    target = new URL(targetFileUrl);
  } catch {
    return undefined;
  }

  if (source.protocol !== target.protocol || source.host !== target.host) {
    return undefined;
  }

  const sourceSegments = source.pathname.split('/');
  const targetSegments = target.pathname.split('/');
  // Drop the source file segment so we walk from its containing directory.
  sourceSegments.pop();

  let commonLength = 0;
  while (
    commonLength < sourceSegments.length &&
    commonLength < targetSegments.length - 1 &&
    sourceSegments[commonLength] === targetSegments[commonLength]
  ) {
    commonLength += 1;
  }

  const upSegments = sourceSegments.length - commonLength;
  const downSegments = targetSegments.slice(commonLength);
  const prefix = upSegments === 0 ? './' : '../'.repeat(upSegments);
  return `${prefix}${downSegments.join('/')}`;
}

/**
 * Ensures a relative path starts with `./` or `../`. Absolute paths and full
 * URLs are returned unchanged. An empty path becomes `./`.
 *
 * Exported so other parts of the pipeline (e.g., `loadCodeVariant`) can keep
 * their `relativeUrl` invariants in sync with `deriveRelativeUrls`.
 */
export function normalizeRelativePath(relativePath: string): string {
  if (relativePath.startsWith('./') || relativePath.startsWith('../')) {
    return relativePath;
  }
  // Leave absolute paths and full URLs alone.
  if (relativePath.startsWith('/') || relativePath.includes('://')) {
    return relativePath;
  }
  return relativePath === '' ? './' : `./${relativePath}`;
}
