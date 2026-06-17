/**
 * Resolves a package's subpath exports, expanding wildcard patterns (e.g. `./*`)
 * against the files present in the package directory.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * @typedef {{ key: string; isNull: boolean }} ExactExport
 * @typedef {{
 *   key: string;
 *   prefix: string;
 *   suffix: string;
 *   base: number;
 *   isNull: boolean;
 *   target: string | undefined;
 * }} PatternExport
 * @typedef {{ exact: ExactExport[]; patterns: PatternExport[] }} CollectedExports
 */

/**
 * Resolves an export value to the first target path string containing a `*`,
 * following condition objects and arrays. Node requires every condition of a
 * subpath pattern to place the `*` identically, so any matching target is
 * enough to enumerate the available stems.
 * @param {unknown} value
 * @returns {string | undefined}
 */
function findWildcardTarget(value) {
  if (typeof value === 'string') {
    return value.includes('*') ? value : undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const target = findWildcardTarget(item);
      if (target) {
        return target;
      }
    }
    return undefined;
  }
  if (value && typeof value === 'object') {
    // Prefer runtime conditions; `types` resolves to .d.ts files, which aren't
    // what gets bundled, so only fall back to it when nothing else matches.
    let typesFallback;
    for (const [condition, conditionValue] of Object.entries(value)) {
      const target = findWildcardTarget(conditionValue);
      if (target) {
        if (condition === 'types') {
          typesFallback = typesFallback ?? target;
        } else {
          return target;
        }
      }
    }
    return typesFallback;
  }
  return undefined;
}

/**
 * Collects the subpath exports of a package, splitting them into exact keys and
 * wildcard pattern keys. Both kinds keep their `null` (blocking) state so the
 * resolver can reproduce Node's most-specific-match semantics.
 * @param {Record<string, unknown>} exportsObj
 * @returns {CollectedExports}
 */
function collectExports(exportsObj) {
  /** @type {CollectedExports} */
  const collected = { exact: [], patterns: [] };
  for (const [key, value] of Object.entries(exportsObj)) {
    if (!key.startsWith('.')) {
      // Top-level condition sugar (e.g. `{ import, require }`); recurse to find
      // any nested subpath keys. Condition objects have none, so this is inert
      // for them, but preserves the previous flattening behavior.
      if (value && typeof value === 'object') {
        const nested = collectExports(/** @type {Record<string, unknown>} */ (value));
        collected.exact.push(...nested.exact);
        collected.patterns.push(...nested.patterns);
      }
      continue;
    }

    const isNull = value === null;
    if (key.includes('*')) {
      const starIndex = key.indexOf('*');
      collected.patterns.push({
        key,
        prefix: key.slice(0, starIndex),
        suffix: key.slice(starIndex + 1),
        // The length of the static prefix decides specificity: a longer prefix
        // is a more specific match (matches Node's PATTERN_KEY_COMPARE).
        base: starIndex,
        isNull,
        target: isNull ? undefined : findWildcardTarget(value),
      });
    } else {
      collected.exact.push({ key, isNull });
    }
  }
  return collected;
}

/**
 * Finds the most specific pattern matching an export path, mirroring Node's
 * resolution: the pattern with the longest static prefix wins, then the longest
 * key. The `*` placeholder may span path separators.
 * @param {string} exportPath
 * @param {PatternExport[]} patterns
 * @returns {PatternExport | undefined}
 */
function bestPatternMatch(exportPath, patterns) {
  let best;
  for (const pattern of patterns) {
    if (
      exportPath.length >= pattern.prefix.length + pattern.suffix.length &&
      exportPath.startsWith(pattern.prefix) &&
      exportPath.endsWith(pattern.suffix)
    ) {
      if (
        !best ||
        pattern.base > best.base ||
        (pattern.base === best.base && pattern.key.length > best.key.length)
      ) {
        best = pattern;
      }
    }
  }
  return best;
}

/**
 * Expands a single wildcard subpath export (e.g. key `./*`, target
 * `./dist/*.js`) into concrete subpath keys by globbing the package directory.
 * Mirrors Node's subpath pattern semantics where `*` is a substring
 * placeholder that may span path separators.
 * @param {string} key
 * @param {string} target
 * @param {string} pkgDir
 * @returns {Promise<string[]>}
 */
async function expandWildcardKey(key, target, pkgDir) {
  const keyStarIndex = key.indexOf('*');
  const keyPrefix = key.slice(0, keyStarIndex);
  const keySuffix = key.slice(keyStarIndex + 1);

  const targetStarIndex = target.indexOf('*');
  const targetPrefix = target.slice(0, targetStarIndex);
  const targetSuffix = target.slice(targetStarIndex + 1);

  // Limit the filesystem walk to the static directory portion of the target.
  const dirEnd = targetPrefix.lastIndexOf('/');
  const globDir = dirEnd >= 0 ? targetPrefix.slice(0, dirEnd + 1) : '';
  const globPattern = `${globDir.startsWith('./') ? globDir.slice(2) : globDir}**`;

  const expanded = [];
  for await (const dirent of fs.glob(globPattern, { cwd: pkgDir, withFileTypes: true })) {
    if (!dirent.isFile()) {
      continue;
    }
    const absPath = path.join(dirent.parentPath, dirent.name);
    const relPath = `./${path.relative(pkgDir, absPath).split(path.sep).join('/')}`;
    if (relPath.startsWith('./node_modules/')) {
      continue;
    }
    if (relPath.startsWith(targetPrefix) && relPath.endsWith(targetSuffix)) {
      const stem =
        targetSuffix.length > 0
          ? relPath.slice(targetPrefix.length, relPath.length - targetSuffix.length)
          : relPath.slice(targetPrefix.length);
      if (stem.length > 0) {
        expanded.push(`${keyPrefix}${stem}${keySuffix}`);
      }
    }
  }
  return expanded;
}

/**
 * Reads a package's `exports` field and returns its concrete subpath export
 * paths, expanding any wildcard subpath patterns (e.g. `./*`) against the
 * files present in the package directory.
 * @param {string} pkgJson - Path to the package's package.json
 * @returns {Promise<string[]>}
 */
export async function findExportedPaths(pkgJson) {
  const pkgContent = await fs.readFile(pkgJson, 'utf8');
  const { exports = {} } = JSON.parse(pkgContent);
  const pkgDir = path.dirname(pkgJson);

  const { exact, patterns } = collectExports(exports);
  const exactIsNullByKey = new Map(exact.map((entry) => [entry.key, entry.isNull]));

  // Candidate export paths: explicit (non-null) exact exports, plus everything
  // produced by expanding the non-null wildcard patterns against the files on
  // disk. Null patterns are never expanded; they only ever block.
  const candidates = new Set();
  for (const entry of exact) {
    if (!entry.isNull) {
      candidates.add(entry.key);
    }
  }
  const expandedGroups = await Promise.all(
    patterns
      .filter((pattern) => !pattern.isNull && pattern.target)
      .map((pattern) =>
        expandWildcardKey(pattern.key, /** @type {string} */ (pattern.target), pkgDir),
      ),
  );
  for (const group of expandedGroups) {
    for (const exportPath of group) {
      candidates.add(exportPath);
    }
  }

  // Keep each candidate only if its most specific matching export key is not
  // blocked by `null`. Exact keys take priority over patterns; among patterns
  // the longest static prefix wins. This reproduces Node's cascade, where a
  // deeper non-null pattern un-blocks paths under a shallower null pattern.
  const result = [];
  for (const exportPath of candidates) {
    const exactIsNull = exactIsNullByKey.get(exportPath);
    let exported;
    if (exactIsNull !== undefined) {
      exported = !exactIsNull;
    } else {
      const best = bestPatternMatch(exportPath, patterns);
      exported = best ? !best.isNull : false;
    }
    if (exported) {
      result.push(exportPath);
    }
  }

  result.sort();
  return result;
}
