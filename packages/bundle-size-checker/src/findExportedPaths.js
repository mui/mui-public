/**
 * Resolves a package's subpath exports, expanding wildcard patterns (e.g. `./*`)
 * against the files present in the package directory.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import micromatch from 'micromatch';

/**
 * @typedef {{
 *   staticPaths: string[];
 *   wildcards: Array<{ key: string; target: string }>;
 *   negations: string[];
 * }} CollectedExports
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
 * Collects the subpath exports of a package, splitting them into concrete
 * paths, wildcard patterns to expand (e.g. `./*`), and negation patterns
 * (subpath keys mapped to `null`, which block matching paths).
 * @param {Record<string, unknown>} exportsObj
 * @returns {CollectedExports}
 */
function collectExports(exportsObj) {
  /** @type {CollectedExports} */
  const collected = { staticPaths: [], wildcards: [], negations: [] };
  for (const [key, value] of Object.entries(exportsObj)) {
    if (!key.startsWith('.')) {
      // Top-level condition sugar (e.g. `{ import, require }`); recurse to find
      // any nested subpath keys. Condition objects have none, so this is inert
      // for them, but preserves the previous flattening behavior.
      if (value && typeof value === 'object') {
        const nested = collectExports(/** @type {Record<string, unknown>} */ (value));
        collected.staticPaths.push(...nested.staticPaths);
        collected.wildcards.push(...nested.wildcards);
        collected.negations.push(...nested.negations);
      }
      continue;
    }

    if (key.includes('*')) {
      if (value === null) {
        collected.negations.push(key);
      } else {
        const target = findWildcardTarget(value);
        if (target) {
          collected.wildcards.push({ key, target });
        }
        // Without a resolvable wildcard target the pattern can't be expanded;
        // drop it rather than emit a bogus `pkg/*` entry.
      }
      continue;
    }

    // ignore null values
    if (value) {
      collected.staticPaths.push(key);
    }
  }
  return collected;
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
  const pkgPath = String(pkgJson);
  const pkgContent = await fs.readFile(pkgPath, 'utf8');
  const { exports = {} } = JSON.parse(pkgContent);
  const pkgDir = path.dirname(pkgPath);

  const { staticPaths, wildcards, negations } = collectExports(exports);

  const expandedGroups = await Promise.all(
    wildcards.map(({ key, target }) => expandWildcardKey(key, target, pkgDir)),
  );

  const allPaths = new Set(staticPaths);
  for (const group of expandedGroups) {
    for (const expandedPath of group) {
      allPaths.add(expandedPath);
    }
  }

  let result = [...allPaths];
  if (negations.length > 0) {
    // Subpath keys mapped to `null` block any matching path at runtime.
    const negationSubpaths = negations.map((key) => key.slice(2));
    result = result.filter((exportPath) => {
      const subpath = exportPath === '.' ? '.' : exportPath.slice(2);
      return !micromatch.isMatch(subpath, negationSubpaths);
    });
  }

  result.sort();
  return result;
}
