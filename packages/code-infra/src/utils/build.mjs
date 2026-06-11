import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { globby } from 'globby';
import * as semver from 'semver';

/**
 * @typedef {'esm' | 'cjs'} BundleType
 */

/**
 * @typedef {Object} BundleMeta
 * @property {BundleType} type
 * @property {string} dir
 * @property {'import' | 'require'} condition - The package.json condition this bundle maps to.
 * @property {string} outExtension
 * @property {string} typeOutExtension
 */

/**
 * Source files in JS/TS-like languages that the build compiles. These are the
 * only leaves that get an extension swap + `import`/`require`/`types` conditions.
 * Other files under `src/` (e.g. `.css`, `.json`) are copied verbatim and only
 * get their `./src/` prefix rewritten.
 */
const JS_TS_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

export const BASE_IGNORES = [
  '**/*.test.js',
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.spec.js',
  '**/*.spec.ts',
  '**/*.spec.tsx',
  '**/*.d.ts',
  '**/*.test/*.*',
  '**/test-cases/*.*',
];

/**
 * @param {BundleType} bundle
 * @param {Object} [options]
 * @param {boolean} [options.isType=false] - Whether to get the extension for type declaration files.
 * @param {boolean} [options.isFlat=false] - Whether to get the extension for a flat build structure.
 * @param {'module' | 'commonjs'} [options.packageType='commonjs'] - The package.json type field.
 * @returns {string}
 */
export function getOutExtension(bundle, options = {}) {
  const { isType = false, isFlat = false, packageType = 'commonjs' } = options;
  const normalizedPackageType = packageType === 'module' ? 'module' : 'commonjs';
  if (!isFlat) {
    return isType ? '.d.ts' : '.js';
  }
  if (isType) {
    if (normalizedPackageType === 'module') {
      return bundle === 'esm' ? '.d.ts' : '.d.cts';
    }
    return bundle === 'cjs' ? '.d.ts' : '.d.mts';
  }
  if (normalizedPackageType === 'module') {
    return bundle === 'esm' ? '.js' : '.cjs';
  }
  return bundle === 'cjs' ? '.js' : '.mjs';
}

/**
 * Returns a new object with `import` first, `require` second, `default` last,
 * and any other condition keys preserved in their original relative order in between.
 * @param {Record<string, any>} conditions
 * @returns {Record<string, any>}
 */
function sortExportConditions(conditions) {
  /** @type {Record<string, number | undefined>} */
  const order = { import: 0, require: 1, default: 3 };
  return Object.fromEntries(
    Object.entries(conditions).sort(([a], [b]) => (order[a] ?? 2) - (order[b] ?? 2)),
  );
}

/**
 * Recursively fills in the `default` condition and stabilizes key order for a
 * single condition value. Bundles run in parallel, so `import`/`require`
 * insertion order would otherwise depend on Promise timing. Nested condition
 * objects (e.g. `{ node: {...}, default: {...} }`) are handled at every level
 * that carries `import`/`require`. Non-condition values (plain strings, bare
 * specifiers, `null`) are returned untouched.
 * @param {any} value
 * @param {boolean} addTypes
 * @param {string} kind - Used for error messages, e.g. `export` or `import`.
 * @param {string} key - Used for error messages.
 * @returns {any}
 */
function finalizeConditionValue(value, addTypes, kind, key) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    throw new Error(
      `Array form of package.json ${kind}s is not supported yet. Found in ${kind} "${key}".`,
    );
  }

  for (const childKey of Object.keys(value)) {
    value[childKey] = finalizeConditionValue(value[childKey], addTypes, kind, key);
  }

  if (value.import || value.require) {
    // Synthesize `default` from import/require (preferring ESM), but never clobber
    // a user-authored `default` condition that sits alongside them.
    if (value.default === undefined) {
      const defaultExport = value.import || value.require;
      if (addTypes) {
        value.default = defaultExport;
      } else {
        value.default =
          defaultExport && typeof defaultExport === 'object' && 'default' in defaultExport
            ? defaultExport.default
            : defaultExport;
      }
    }
    return sortExportConditions(value);
  }

  return value;
}

/**
 * Applies {@link finalizeConditionValue} to every entry of a conditions map.
 * @param {import('../cli/packageJson').PackageJson.ExportConditions} conditionsMap
 * @param {boolean} addTypes
 * @param {string} kind - Used for error messages, e.g. `export` or `import`.
 * @returns {void}
 */
function finalizeConditions(conditionsMap, addTypes, kind) {
  for (const key of Object.keys(conditionsMap)) {
    conditionsMap[key] = finalizeConditionValue(conditionsMap[key], addTypes, kind, key);
  }
}

/**
 * Returns the path relative to `src/` if `leaf` points inside the source tree
 * (accepting both `./src/…` and `src/…`), otherwise `null`.
 * @param {string} leaf
 * @returns {string | null}
 */
function srcRelative(leaf) {
  if (leaf.startsWith('./src/')) {
    return leaf.slice('./src/'.length);
  }
  if (leaf.startsWith('src/')) {
    return leaf.slice('src/'.length);
  }
  return null;
}

/**
 * Maps a source-relative path to its built location, optionally swapping the
 * extension. `*` wildcards are preserved verbatim (Node resolves them at runtime).
 * @param {string} rel - Path relative to `src/`.
 * @param {string} dir - The bundle output dir (`.` for the root).
 * @param {string} ext - The current extension (from `path.extname`).
 * @param {string | null} newExt - The replacement extension, or `null` to keep `ext`.
 * @returns {string}
 */
function buildOutPath(rel, dir, ext, newExt) {
  const dirPrefix = dir === '.' ? '' : `${dir}/`;
  const base = `./${dirPrefix}${rel}`;
  return newExt ? `${base.slice(0, base.length - ext.length)}${newExt}` : base;
}

/**
 * @param {string} target
 * @returns {Promise<boolean>}
 */
function fileExists(target) {
  return fs.stat(target).then(
    (stats) => stats.isFile(),
    () => false,
  );
}

/**
 * @param {string} target
 * @returns {Promise<boolean>}
 */
function fileOrDirExists(target) {
  return fs.stat(target).then(
    (stats) => stats.isFile() || stats.isDirectory(),
    () => false,
  );
}

/**
 * Rewrites a single leaf path for every bundle. A source JS/TS path becomes a
 * per-bundle `{ types?, default }` (or bare out-path string when not adding
 * types). A source asset (e.g. `.css`) gets only its `./src/` prefix rewritten.
 * Anything else (a path already in the build output, or a bare specifier) is
 * passed through verbatim — the escape hatch for `--copy`'d/custom paths.
 * @param {string} leaf
 * @param {Object} ctx
 * @param {BundleMeta[]} ctx.bundleMetas
 * @param {boolean} ctx.addTypes
 * @param {string} ctx.cwd
 * @param {string} [ctx.outputDir]
 * @param {string} ctx.key
 * @param {string} ctx.kind
 * @returns {Promise<any>}
 */
async function rewriteLeaf(leaf, ctx) {
  const { bundleMetas, addTypes, cwd, outputDir, key, kind } = ctx;
  const rel = srcRelative(leaf);

  if (rel === null) {
    // Not a source path: it already names a path present in the published
    // output (via `--copy` or because it's there literally), or a bare
    // specifier (external package). Emit verbatim.
    if (outputDir && leaf.startsWith('.') && !leaf.includes('*')) {
      const exists = await fileOrDirExists(path.join(outputDir, leaf));
      if (!exists) {
        // `--copy` runs after package.json generation, so the file may legitimately
        // not be on disk yet — warn rather than fail.
        console.warn(
          `The ${kind} path "${leaf}" for "${key}" was not found in the build output. Ensure it is generated or copied into the output directory.`,
        );
      }
    }
    return leaf;
  }

  const hasGlob = leaf.includes('*');
  if (!hasGlob) {
    const exists = await fileOrDirExists(path.join(cwd, leaf));
    if (!exists) {
      throw new Error(
        `The path "${leaf}" for ${kind} "${key}" does not exist in the package. Either remove the ${kind} or add the file/folder to the package.`,
      );
    }
  }

  const ext = path.extname(rel);
  if (!JS_TS_EXTENSIONS.has(ext)) {
    // Asset copied verbatim into the output: only rewrite the `./src/` prefix.
    const meta = bundleMetas.find((bundle) => bundle.dir === '.') ?? bundleMetas[0];
    return buildOutPath(rel, meta.dir, ext, null);
  }

  /** @type {Record<string, any>} */
  const result = {};
  for (const meta of bundleMetas) {
    const outPath = buildOutPath(rel, meta.dir, ext, meta.outExtension);
    result[meta.condition] = addTypes
      ? { types: buildOutPath(rel, meta.dir, ext, meta.typeOutExtension), default: outPath }
      : outPath;
  }
  return result;
}

/**
 * Recursively rewrites an export/import entry value, rewriting every source-path
 * leaf (including those nested inside standard condition objects) into its built
 * equivalent. Condition keys and their order are preserved (conditions stay
 * outer; the build-owned `import`/`require` split lives at the leaves).
 * @param {import('../cli/packageJson').PackageJson.Exports} value
 * @param {Object} ctx
 * @param {BundleMeta[]} ctx.bundleMetas
 * @param {boolean} ctx.addTypes
 * @param {string} ctx.cwd
 * @param {string} [ctx.outputDir]
 * @param {string} ctx.key
 * @param {string} ctx.kind
 * @returns {Promise<any>}
 */
async function rewriteEntryValue(value, ctx) {
  if (value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    throw new Error(
      `Array form of package.json ${ctx.kind}s is not supported yet. Found in ${ctx.kind} "${ctx.key}".`,
    );
  }
  if (typeof value === 'string') {
    return rewriteLeaf(value, ctx);
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    const results = await Promise.all(entries.map(([, child]) => rewriteEntryValue(child, ctx)));
    /** @type {Record<string, any>} */
    const out = {};
    entries.forEach(([condition], index) => {
      out[condition] = results[index];
    });
    return out;
  }
  throw new Error(`Unsupported ${ctx.kind} value for "${ctx.key}".`);
}

/**
 * Rewrites every entry of a conditions map, preserving declared key order.
 * @param {import('../cli/packageJson').PackageJson.ExportConditions} conditionsMap
 * @param {Object} baseCtx - The {@link rewriteEntryValue} context minus `key`.
 * @param {BundleMeta[]} baseCtx.bundleMetas
 * @param {boolean} baseCtx.addTypes
 * @param {string} baseCtx.cwd
 * @param {string} [baseCtx.outputDir]
 * @param {string} baseCtx.kind
 * @returns {Promise<import('../cli/packageJson').PackageJson.ExportConditions>}
 */
async function rewriteConditionsMap(conditionsMap, baseCtx) {
  const keys = Object.keys(conditionsMap);
  const rewritten = await Promise.all(
    keys.map((key) => rewriteEntryValue(conditionsMap[key], { ...baseCtx, key })),
  );
  /** @type {import('../cli/packageJson').PackageJson.ExportConditions} */
  const result = {};
  keys.forEach((key, index) => {
    result[key] = rewritten[index];
  });
  return result;
}

/**
 * Splits a pattern around its first `*` wildcard.
 * @param {string} pattern
 * @returns {{ prefix: string; suffix: string }}
 */
function splitStar(pattern) {
  const star = pattern.indexOf('*');
  return { prefix: pattern.slice(0, star), suffix: pattern.slice(star + 1) };
}

/**
 * Finds the source glob to expand inside an entry value: the plain string, else
 * the `default` condition, else the first leaf that carries a `*`. The captured
 * stem is applied to every sibling leaf so all conditions expand consistently.
 * @param {import('../cli/packageJson').PackageJson.Exports} value
 * @returns {string | undefined}
 */
function primarySourcePattern(value) {
  if (typeof value === 'string') {
    return value.includes('*') ? value : undefined;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (typeof value.default === 'string' && value.default.includes('*')) {
      return value.default;
    }
    for (const child of Object.values(value)) {
      const found = primarySourcePattern(child);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

/**
 * Substitutes the matched stem into the `*` of every leaf string in a value.
 * @param {import('../cli/packageJson').PackageJson.Exports} value
 * @param {string} stem
 * @returns {any}
 */
function substituteStem(value, stem) {
  if (typeof value === 'string') {
    return value.replace('*', stem);
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    /** @type {Record<string, any>} */
    const out = {};
    for (const [condition, child] of Object.entries(value)) {
      out[condition] = substituteStem(child, stem);
    }
    return out;
  }
  return value;
}

/**
 * Drops source-path conditions whose file is missing for a glob-expanded entry,
 * so a sibling glob that doesn't match every stem of the primary pattern omits
 * that condition for the unmatched stems instead of failing the build. Only used
 * on glob-expanded values; explicit (non-glob) entries still validate strictly.
 * @param {import('../cli/packageJson').PackageJson.Exports} value
 * @param {string} cwd
 * @returns {Promise<any>}
 */
async function pruneMissingSourceConditions(value, cwd) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const entries = Object.entries(value);
  const resolved = await Promise.all(
    entries.map(async ([condition, child]) => {
      if (typeof child === 'string') {
        const rel = srcRelative(child);
        if (
          rel !== null &&
          !child.includes('*') &&
          !(await fileOrDirExists(path.join(cwd, child)))
        ) {
          return undefined;
        }
        return /** @type {[string, any]} */ ([condition, child]);
      }
      const pruned = await pruneMissingSourceConditions(child, cwd);
      if (
        pruned &&
        typeof pruned === 'object' &&
        !Array.isArray(pruned) &&
        Object.keys(pruned).length === 0
      ) {
        return undefined;
      }
      return /** @type {[string, any]} */ ([condition, pruned]);
    }),
  );
  /** @type {Record<string, any>} */
  const out = {};
  for (const entry of resolved) {
    if (entry) {
      out[entry[0]] = entry[1];
    }
  }
  return out;
}

/**
 * Tests whether a subpath-pattern (or exact) key matches a concrete subpath.
 * @param {string} key
 * @param {string} subpath
 * @returns {boolean}
 */
function keyMatches(key, subpath) {
  const star = key.indexOf('*');
  if (star === -1) {
    return key === subpath;
  }
  const base = key.slice(0, star);
  const suffix = key.slice(star + 1);
  return (
    subpath.length >= base.length + suffix.length &&
    subpath.startsWith(base) &&
    subpath.endsWith(suffix)
  );
}

/**
 * Selects the most-specific key that matches `subpath`, mirroring Node's
 * resolution: an exact key beats any pattern, and among patterns the longest
 * base (substring before `*`) wins, tie-broken by the longest suffix.
 * @param {string} subpath
 * @param {string[]} keys
 * @returns {string | null}
 */
function selectMostSpecificKey(subpath, keys) {
  /** @type {string | null} */
  let best = null;
  let bestBase = -1;
  let bestSuffix = -1;
  for (const key of keys) {
    if (!keyMatches(key, subpath)) {
      continue;
    }
    const star = key.indexOf('*');
    const base = star === -1 ? Infinity : star;
    const suffix = star === -1 ? 0 : key.length - star - 1;
    if (base > bestBase || (base === bestBase && suffix > bestSuffix)) {
      best = key;
      bestBase = base;
      bestSuffix = suffix;
    }
  }
  return best;
}

/**
 * Expands glob patterns (containing `*`) in export/import keys into concrete
 * entries resolved against files on disk. Each `*` matches a single path segment
 * (use `--no-expand` to keep the pattern as a Node runtime subpath, whose `*`
 * matches across `/`). Negation (`null`) keys are applied via most-specific-key
 * selection rather than cascade-subtraction, so a deeper positive pattern still
 * resolves under a shallower `null`, and a zero-match pattern warns instead of
 * silently dropping.
 * @param {import('../cli/packageJson').PackageJson.ExportConditions} originalExports
 * @param {string} cwd
 * @returns {Promise<import('../cli/packageJson').PackageJson.ExportConditions>}
 */
async function expandExportGlobs(originalExports, cwd) {
  const allKeys = Object.keys(originalExports);
  /** @type {import('../cli/packageJson').PackageJson.ExportConditions} */
  const expandedExports = {};

  /** @type {{ key: string; value: import('../cli/packageJson').PackageJson.Exports; srcPattern: string }[]} */
  const globEntries = [];

  for (const [key, value] of Object.entries(originalExports)) {
    if (!key.includes('*')) {
      // Exact keys (including exact `null` blocks) pass straight through.
      expandedExports[key] = value;
      continue;
    }
    if (value === null) {
      // Negation pattern: carried through after expansion (see below).
      continue;
    }
    const srcPattern = primarySourcePattern(value);
    if (typeof srcPattern !== 'string') {
      // Glob key whose value has no wildcard: pass through unchanged.
      expandedExports[key] = value;
      continue;
    }
    if (srcPattern.indexOf('*') !== srcPattern.lastIndexOf('*')) {
      console.warn(
        `The pattern "${srcPattern}" for "${key}" contains multiple "*" wildcards; only the first is supported.`,
      );
    }
    globEntries.push({ key, value, srcPattern });
  }

  const globResults = await Promise.all(
    globEntries.map(({ srcPattern }) => globby(srcPattern, { cwd, ignore: BASE_IGNORES })),
  );

  /** @type {Set<string>} */
  const usedNegations = new Set();
  /** @type {string[]} */
  const expandedObjectKeys = [];

  for (let i = 0; i < globEntries.length; i += 1) {
    const { key, value, srcPattern } = globEntries[i];
    const { prefix: srcPrefix, suffix: srcSuffix } = splitStar(srcPattern);
    const { prefix: keyPrefix, suffix: keySuffix } = splitStar(key);

    const stems = [];
    for (const match of globResults[i]) {
      if (match.startsWith(srcPrefix) && match.endsWith(srcSuffix)) {
        const stem = match.slice(srcPrefix.length, match.length - srcSuffix.length);
        if (stem) {
          stems.push(stem);
        }
      }
    }
    stems.sort();

    if (stems.length === 0) {
      console.warn(`No files matched the pattern "${srcPattern}" for "${key}".`);
      continue;
    }

    for (const stem of stems) {
      const concreteKey = `${keyPrefix}${stem}${keySuffix}`;
      // Honour Node's most-specific-wins resolution: only emit this concrete
      // entry when this positive pattern is the most-specific match. A deeper
      // positive pattern emits its own entries; a `null` blocks it entirely.
      const winner = selectMostSpecificKey(concreteKey, allKeys);
      if (winner !== key) {
        if (winner !== null && originalExports[winner] === null) {
          usedNegations.add(winner);
        }
        continue;
      }
      expandedExports[concreteKey] = substituteStem(value, stem);
      if (value && typeof value === 'object') {
        expandedObjectKeys.push(concreteKey);
      }
    }
  }

  // For glob-expanded condition objects, drop any condition whose source file is
  // absent for this stem (a sibling glob need not match every primary stem).
  await Promise.all(
    expandedObjectKeys.map(async (concreteKey) => {
      expandedExports[concreteKey] = await pruneMissingSourceConditions(
        expandedExports[concreteKey],
        cwd,
      );
    }),
  );

  // Carry through negation patterns that didn't claim any expanded entry so they
  // still block their subtree at runtime.
  for (const [key, value] of Object.entries(originalExports)) {
    if (value === null && key.includes('*') && !usedNegations.has(key)) {
      expandedExports[key] = null;
    }
  }

  return expandedExports;
}

/**
 * Builds the per-bundle metadata (output extensions + the `import`/`require`
 * condition each bundle maps to).
 * @param {{type: BundleType; dir: string}[]} bundles
 * @param {boolean} isFlat
 * @param {'module' | 'commonjs'} packageType
 * @returns {BundleMeta[]}
 */
function createBundleMetas(bundles, isFlat, packageType) {
  return bundles.map(({ type, dir }) => ({
    type,
    dir,
    condition: type === 'cjs' ? 'require' : 'import',
    outExtension: getOutExtension(type, { isFlat, packageType }),
    typeOutExtension: getOutExtension(type, { isFlat, isType: true, packageType }),
  }));
}

/**
 * @param {Object} param0
 * @param {import('../cli/packageJson').PackageJson['exports']} param0.exports
 * @param {{type: BundleType; dir: string}[]} param0.bundles
 * @param {string} param0.outputDir
 * @param {string} param0.cwd
 * @param {boolean} [param0.addTypes]
 * @param {boolean} [param0.isFlat]
 * @param {boolean} [param0.expand] - Whether to enumerate glob patterns into concrete entries.
 * @param {'module' | 'commonjs'} [param0.packageType]
 */
export async function createPackageExports({
  exports: packageExports,
  bundles,
  outputDir,
  cwd,
  addTypes = false,
  isFlat = false,
  expand = true,
  packageType = 'commonjs',
}) {
  const resolvedPackageType = packageType === 'module' ? 'module' : 'commonjs';
  /**
   * @type {import('../cli/packageJson').PackageJson.ExportConditions}
   */
  const rawExports =
    typeof packageExports === 'string' || Array.isArray(packageExports)
      ? { '.': packageExports }
      : packageExports || {};
  const originalExports = expand ? await expandExportGlobs(rawExports, cwd) : rawExports;
  const bundleMetas = createBundleMetas(bundles, isFlat, resolvedPackageType);
  /**
   * @type {import('../cli/packageJson').PackageJson.ExportConditions}
   */
  const newExports = {
    './package.json': './package.json',
  };
  /**
   * @type {{ main?: string; types?: string; exports: import('../cli/packageJson').PackageJson.ExportConditions }}
   */
  const result = {
    exports: newExports,
  };

  // Derive the `.` index entry (plus `main`/`types`) from the built index files.
  await Promise.all(
    bundleMetas.map(async (meta) => {
      const indexFileExists = await fileExists(
        path.join(outputDir, meta.dir, `index${meta.outExtension}`),
      );
      const typeFileExists =
        addTypes &&
        (await fileExists(path.join(outputDir, meta.dir, `index${meta.typeOutExtension}`)));
      const dirPrefix = meta.dir === '.' ? '' : `${meta.dir}/`;
      const exportDir = `./${dirPrefix}index${meta.outExtension}`;
      const typeExportDir = `./${dirPrefix}index${meta.typeOutExtension}`;

      if (indexFileExists) {
        // skip `packageJson.module` to support parcel and some older bundlers
        if (meta.type === 'cjs') {
          result.main = exportDir;
        }
        if (typeof newExports['.'] === 'string' || Array.isArray(newExports['.'])) {
          throw new Error(`The export "." is already defined as a string or Array.`);
        }
        newExports['.'] ??= {};
        newExports['.'][meta.condition] = typeFileExists
          ? { types: typeExportDir, default: exportDir }
          : exportDir;
      }
      if (typeFileExists && meta.type === 'cjs') {
        result.types = typeExportDir;
      }
    }),
  );

  // Rewrite the user-configured entries, preserving their declared order.
  Object.assign(
    newExports,
    await rewriteConditionsMap(originalExports, {
      bundleMetas,
      addTypes,
      cwd,
      outputDir,
      kind: 'export',
    }),
  );

  bundles.forEach(({ dir }) => {
    if (dir !== '.') {
      newExports[`./${dir}`] = null;
    }
  });

  finalizeConditions(newExports, addTypes, 'export');

  return result;
}

/**
 * Generates the package.json `imports` field for the built package, rewriting
 * internal subpath imports (keys starting with `#`) that point at source files
 * into their built equivalents with `import`/`require`/`types` conditions.
 *
 * Mirrors {@link createPackageExports} but without the `.` / `package.json` /
 * `main` / `types` index handling that only applies to public exports. Entries
 * that resolve to bare specifiers (e.g. an external package) are passed through
 * unchanged, since the `imports` field commonly aliases dependencies.
 * @param {Object} param0
 * @param {import('../cli/packageJson').PackageJson['imports']} param0.imports
 * @param {{type: BundleType; dir: string}[]} param0.bundles
 * @param {string} param0.cwd
 * @param {string} [param0.outputDir] - Used to verify non-source passthrough paths exist in the build output.
 * @param {boolean} [param0.addTypes]
 * @param {boolean} [param0.isFlat]
 * @param {boolean} [param0.expand] - Whether to enumerate glob patterns into concrete entries.
 * @param {'module' | 'commonjs'} [param0.packageType]
 * @returns {Promise<import('../cli/packageJson').PackageJson.Imports | undefined>}
 */
export async function createPackageImports({
  imports: packageImports,
  bundles,
  cwd,
  outputDir,
  addTypes = false,
  isFlat = false,
  expand = true,
  packageType = 'commonjs',
}) {
  if (!packageImports || Object.keys(packageImports).length === 0) {
    return undefined;
  }
  for (const key of Object.keys(packageImports)) {
    if (!key.startsWith('#')) {
      throw new Error(
        `Invalid import "${key}": all package.json "imports" keys must start with "#".`,
      );
    }
  }
  const resolvedPackageType = packageType === 'module' ? 'module' : 'commonjs';
  // `Imports` uses `#`-prefixed keys; treat it as a generic conditions map so the
  // same glob/condition helpers used for exports can process it.
  const rawImports = /** @type {import('../cli/packageJson').PackageJson.ExportConditions} */ (
    packageImports
  );
  const originalImports = expand ? await expandExportGlobs(rawImports, cwd) : rawImports;
  const bundleMetas = createBundleMetas(bundles, isFlat, resolvedPackageType);

  const newImports = await rewriteConditionsMap(originalImports, {
    bundleMetas,
    addTypes,
    cwd,
    outputDir,
    kind: 'import',
  });

  finalizeConditions(newImports, addTypes, 'import');

  return newImports;
}

/**
 * @param {Object} param0
 * @param {import('../cli/packageJson').PackageJson['bin']} param0.bin
 * @param {{type: BundleType; dir: string}[]} param0.bundles
 * @param {string} param0.cwd
 * @param {boolean} [param0.isFlat]
 * @param {'module' | 'commonjs'} [param0.packageType]
 */
export async function createPackageBin({ bin, bundles, cwd, isFlat = false, packageType }) {
  if (!bin) {
    return undefined;
  }
  // Use mjs files if present, otherwise fallback to the first bundle type
  const bundleToUse = bundles.find((b) => b.type === 'esm') || bundles[0];
  const binOutExtension = getOutExtension(bundleToUse.type, {
    isFlat,
    packageType,
  });

  const binsToProcess = typeof bin === 'string' ? { __bin__: bin } : bin;
  /**
   * @type {Record<string, string>}
   */
  const newBin = {};
  for (const [binKey, binPath] of Object.entries(binsToProcess)) {
    // make sure the actual file exists
    const binFileExists =
      binPath &&
      // eslint-disable-next-line no-await-in-loop
      (await fs.stat(path.join(cwd, binPath)).then(
        (stats) => stats.isFile(),
        () => false,
      ));
    if (!binFileExists) {
      throw new Error(
        `The bin file "${binPath}" for key "${binKey}" does not exist in the package. Please fix the "bin" field in package.json and point it to the source file.`,
      );
    }
    if (typeof binPath !== 'string') {
      throw new Error(`The bin path for "${binKey}" should be a string.`);
    }
    const ext = path.extname(binPath);
    newBin[binKey] = binPath
      .replace(/(\.\/)?src\//, bundleToUse.dir === '.' ? './' : `./${bundleToUse.dir}/`)
      .replace(new RegExp(`\\${ext}$`), binOutExtension);
  }
  // eslint-disable-next-line no-underscore-dangle
  if (Object.keys(newBin).length === 1 && newBin.__bin__) {
    // eslint-disable-next-line no-underscore-dangle
    return newBin.__bin__;
  }
  return newBin;
}

/**
 * Validates the package.json before building.
 * @param {Record<string, any>} packageJson
 * @param {Object} [options]
 * @param {boolean} [options.skipMainCheck=false] - Whether to skip checking for main field in package.json.
 * @param {boolean} [options.enableReactCompiler=false] - Whether to enable React compiler checks.
 */
export function validatePkgJson(packageJson, options = {}) {
  const { skipMainCheck = false, enableReactCompiler = false } = options;
  /**
   * @type {string[]}
   */
  const errors = [];
  const buildDirBase = packageJson.publishConfig?.directory;
  if (!buildDirBase) {
    errors.push(
      `No build directory specified in "${packageJson.name}" package.json. Specify it in the "publishConfig.directory" field.`,
    );
  }
  if (packageJson.private === false) {
    errors.push(
      `Remove the field "private": false from "${packageJson.name}" package.json. This is redundant.`,
    );
  }

  if (!skipMainCheck) {
    if (packageJson.main) {
      errors.push(
        `Remove the field "main" from "${packageJson.name}" package.json. Add it as "exports["."]" instead.`,
      );
    }

    if (packageJson.module) {
      errors.push(
        `Remove the field "module" from "${packageJson.name}" package.json. Add it as "exports["."]" instead.`,
      );
    }

    if (packageJson.types || packageJson.typings) {
      errors.push(
        `Remove the field "types/typings" from "${packageJson.name}" package.json. Add it as "exports["."]" instead.`,
      );
    }
  }

  const reactVersion = packageJson.peerDependencies?.react;
  if (enableReactCompiler) {
    if (!reactVersion) {
      errors.push(
        'When building with React compiler, "react" must be specified as a peerDependency in package.json.',
      );
    }
    const minSupportedReactVersion = semver.minVersion(reactVersion);
    if (!minSupportedReactVersion) {
      errors.push(
        `Unable to determine the minimum supported React version from the peerDependency range: "${reactVersion}".`,
      );
    } else if (
      semver.lt(minSupportedReactVersion, '19.0.0') &&
      !packageJson.peerDependencies?.['react-compiler-runtime'] &&
      !packageJson.dependencies?.['react-compiler-runtime']
    ) {
      errors.push(
        'When building with React compiler for React versions below 19, "react-compiler-runtime" must be specified as a dependency or peerDependency in package.json.',
      );
    }
  }

  if (errors.length > 0) {
    const error = new Error(errors.join('\n'));
    throw error;
  }
}

/**
 * Marks the start and end of a function execution for performance measurement.
 * Uses the Performance API to create marks and measure the duration.
 * @function
 * @template {() => Promise<any>} F
 * @param {string} label
 * @param {() => ReturnType<F>} fn
 * @returns {Promise<ReturnType<F>>}
 */
export async function markFn(label, fn) {
  const startMark = `${label}-start`;
  const endMark = `${label}-end`;
  performance.mark(startMark);
  const result = await fn();
  performance.mark(endMark);
  performance.measure(label, startMark, endMark);
  return result;
}

/**
 * @param {string} label
 */
export function measureFn(label) {
  const startMark = `${label}-start`;
  const endMark = `${label}-end`;
  return performance.measure(label, startMark, endMark);
}

/**
 * A utility to map a function over an array of items in a worker pool.
 *
 * This function will create a pool of workers and distribute the items to be processed among them.
 * Each worker will process items sequentially, but multiple workers will run in parallel.
 *
 * @function
 * @template T
 * @template R
 * @param {T[]} items
 * @param {(item: T) => Promise<R>} mapper
 * @param {number} concurrency
 * @returns {Promise<(R|Error)[]>}
 */
export async function mapConcurrently(items, mapper, concurrency) {
  if (!items.length) {
    return Promise.resolve([]); // nothing to do
  }
  const itemIterator = items.entries();
  const count = Math.min(concurrency, items.length);
  const workers = [];
  /**
   * @type {(R|Error)[]}
   */
  const results = new Array(items.length);
  for (let i = 0; i < count; i += 1) {
    const worker = Promise.resolve().then(async () => {
      for (const [index, item] of itemIterator) {
        // eslint-disable-next-line no-await-in-loop
        const res = await mapper(item);
        results[index] = res;
      }
    });
    workers.push(worker);
  }
  await Promise.all(workers);
  return results;
}
