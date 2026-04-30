import type { Code, VariantCode } from '../CodeHighlighter/types';

/**
 * Configuration for rewriting URL prefixes on code data.
 *
 * Useful for translating local `file://` URLs gathered at build time into
 * publicly-accessible URLs (for example `https://github.com/owner/repo/tree/<branch>/`)
 * before they reach the client.
 */
export type UrlPrefix = {
  /** URL prefix to strip (e.g. `file:///path/to/project/`). */
  from: string;
  /** Replacement URL prefix (e.g. `https://github.com/owner/repo/tree/main/`). */
  to: string;
};

/**
 * Replaces `urlPrefix.from` with `urlPrefix.to` at the start of `url`.
 * Returns the original value when `url` is falsy or doesn't start with `from`.
 */
export function replaceUrlPrefix(
  url: string | undefined,
  urlPrefix: UrlPrefix,
): string | undefined {
  if (!url || !url.startsWith(urlPrefix.from)) {
    return url;
  }
  return urlPrefix.to + url.slice(urlPrefix.from.length);
}

/**
 * Returns a new `VariantCode` with `url` and any string-form `extraFiles`
 * entries rewritten via `urlPrefix`. Object-form `extraFiles` entries are
 * left untouched because their effective URL is derived from the variant
 * `url` and `relativeUrl` at consumption time.
 */
export function applyUrlPrefixToVariant(variant: VariantCode, urlPrefix: UrlPrefix): VariantCode {
  const nextUrl = replaceUrlPrefix(variant.url, urlPrefix);

  let nextExtraFiles = variant.extraFiles;
  if (variant.extraFiles) {
    let changed = false;
    const updated: NonNullable<VariantCode['extraFiles']> = {};
    for (const [name, entry] of Object.entries(variant.extraFiles)) {
      if (typeof entry === 'string') {
        const replaced = replaceUrlPrefix(entry, urlPrefix);
        if (replaced !== entry) {
          changed = true;
        }
        updated[name] = replaced ?? entry;
      } else {
        updated[name] = entry;
      }
    }
    if (changed) {
      nextExtraFiles = updated;
    }
  }

  if (nextUrl === variant.url && nextExtraFiles === variant.extraFiles) {
    return variant;
  }
  return { ...variant, url: nextUrl, extraFiles: nextExtraFiles };
}

/**
 * Returns a new `Code` map with each variant's URLs rewritten via `urlPrefix`.
 * Returns the original reference when nothing changes so identity-based memos
 * downstream don't invalidate.
 */
export function applyUrlPrefixToCode(code: Code, urlPrefix: UrlPrefix): Code {
  const result: Code = {};
  let changed = false;
  for (const [key, value] of Object.entries(code)) {
    if (value && typeof value === 'object') {
      const next = applyUrlPrefixToVariant(value, urlPrefix);
      if (next !== value) {
        changed = true;
      }
      result[key] = next;
    } else {
      result[key] = value;
    }
  }
  return changed ? result : code;
}

/**
 * Rewrites entries in a `globalsCode`-style array. String entries are treated
 * as URLs; `Code` entries are recursed into via `applyUrlPrefixToCode`.
 */
export function applyUrlPrefixToGlobalsCode<T extends Code | string>(
  globalsCode: Array<T>,
  urlPrefix: UrlPrefix,
): Array<T> {
  let changed = false;
  const result = globalsCode.map((item) => {
    if (typeof item === 'string') {
      const replaced = replaceUrlPrefix(item, urlPrefix);
      if (replaced !== item) {
        changed = true;
      }
      return (replaced ?? item) as T;
    }
    const next = applyUrlPrefixToCode(item, urlPrefix);
    if (next !== item) {
      changed = true;
    }
    return next as T;
  });
  return changed ? result : globalsCode;
}
