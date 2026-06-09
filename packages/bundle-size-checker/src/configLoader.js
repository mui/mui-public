/**
 * Utility to load the bundle-size-checker configuration
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import envCi from 'env-ci';
import * as module from 'node:module';
import * as url from 'node:url';
import micromatch from 'micromatch';

/**
 * @typedef {import('./types.js').BundleSizeCheckerConfigObject} BundleSizeCheckerConfigObject
 * @typedef {import('./types.js').UploadConfig} UploadConfig
 * @typedef {import('./types.js').NormalizedUploadConfig} NormalizedUploadConfig
 * @typedef {import('./types.js').EntryPoint} EntryPoint
 * @typedef {import('./types.js').ObjectEntry} ObjectEntry
 * @typedef {import('./types.js').NormalizedBundleSizeCheckerConfig} NormalizedBundleSizeCheckerConfig
 */

/**
 * Attempts to load and parse a single config file
 * @param {string} configPath - Path to the configuration file
 * @returns {Promise<BundleSizeCheckerConfigObject | null>} The parsed config or null if file doesn't exist
 * @throws {Error} If the file exists but has invalid format
 */
async function loadConfigFile(configPath) {
  try {
    // Dynamic import for ESM
    const configUrl = new URL(`file://${configPath}`);
    const { default: config } = await import(configUrl.href);

    /** @type {BundleSizeCheckerConfigObject | null} */
    let resolvedConfig = null;
    // Handle configs that might be Promise-returning functions
    if (config instanceof Promise) {
      resolvedConfig = await config;
    } else if (typeof config === 'function') {
      resolvedConfig = await config();
    } else {
      // Handle plain config objects
      resolvedConfig = config;
    }

    return resolvedConfig;
  } catch (/** @type {any} */ error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') {
      return null;
    }

    throw error;
  }
}

/**
 * Validates and normalizes an upload configuration object
 * @param {UploadConfig} uploadConfig - The upload configuration to normalize
 * @param {Object} ciInfo - CI environment information
 * @param {string} [ciInfo.branch] - Branch name from CI environment
 * @param {boolean} [ciInfo.isPr] - Whether this is a pull request from CI environment
 * @param {string} [ciInfo.prBranch] - PR branch name from CI environment
 * @param {string} [ciInfo.slug] - Repository slug from CI environment
 * @param {string} [ciInfo.pr] - Pull request number from CI environment
 * @returns {NormalizedUploadConfig} - Normalized upload config
 * @throws {Error} If required fields are missing
 */
export function applyUploadConfigDefaults(uploadConfig, ciInfo) {
  const { slug, branch: ciBranch, isPr, prBranch, pr } = ciInfo;

  // Get repo from config or environment
  const repo = uploadConfig.repo || slug;
  if (!repo) {
    throw new Error(
      'Missing required field: upload.repo. Please specify a repository (e.g., "mui/material-ui").',
    );
  }

  // Get branch from config or environment
  const branch = uploadConfig.branch || (isPr ? prBranch : ciBranch);
  if (!branch) {
    throw new Error('Missing required field: upload.branch. Please specify a branch name.');
  }

  const apiUrl =
    uploadConfig.apiUrl || process.env.CI_REPORT_API_URL || 'https://frontend-public.mui.com';

  // Return the normalized config
  /** @type {NormalizedUploadConfig} */
  const result = {
    repo,
    branch,
    isPullRequest:
      uploadConfig.isPullRequest !== undefined
        ? Boolean(uploadConfig.isPullRequest)
        : Boolean(isPr),
    apiUrl,
  };

  // Add PR number from CI environment if available
  if (pr) {
    result.prNumber = String(pr);
  }

  return result;
}

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

/**
 * Checks if the given import source is a top-level package
 * @param {string} importSrc - The import source string
 * @returns {boolean} - True if it's a top-level package, false otherwise
 */
function isPackageTopLevel(importSrc) {
  const parts = importSrc.split('/');
  return parts.length === 1 || (parts.length === 2 && parts[0].startsWith('@'));
}

/**
 * Normalizes entries to ensure they have a consistent format and ids are unique
 * @param {EntryPoint[]} entries - The array of entries from the config
 * @param {string} configPath - The path to the configuration file
 * @returns {Promise<ObjectEntry[]>} - Normalized entries with uniqueness enforced
 */
async function normalizeEntries(entries, configPath) {
  const usedIds = new Set();

  const result = (
    await Promise.all(
      entries.map(async (entry) => {
        if (typeof entry === 'string') {
          entry = { id: entry };
        }

        entry = { ...entry };

        if (!entry.id) {
          throw new Error('Object entries must have an id property');
        }

        if (!entry.code && !entry.import) {
          // Transform string entries into object entries
          const [importSrc, importName] = entry.id.split('#');
          entry.import = importSrc;
          if (importName) {
            entry.importedNames = [importName];
          }
          if (isPackageTopLevel(entry.import) && !entry.importedNames) {
            entry.track = true;
          }
        }

        if (entry.expand) {
          if (!entry.import || !isPackageTopLevel(entry.import)) {
            throw new Error(
              `Entry "${entry.id}": expand can only be used with top-level package imports`,
            );
          }
          if (!module.findPackageJSON) {
            throw new Error(
              "Your Node.js version doesn't support `module.findPackageJSON`, which is required to expand entries.",
            );
          }
          const pkgJson = module.findPackageJSON(entry.import, url.pathToFileURL(configPath));
          if (!pkgJson) {
            throw new Error(`Can't find package.json for entry "${entry.id}".`);
          }
          const exportedPaths = await findExportedPaths(pkgJson);

          const excludePatterns =
            typeof entry.expand === 'object' && entry.expand.exclude ? entry.expand.exclude : [];

          const expandedEntries = [];
          for (const exportPath of exportedPaths) {
            if (exportPath === './package.json') {
              continue;
            }
            const subpath = exportPath === '.' ? '.' : exportPath.slice(2);
            if (excludePatterns.length > 0 && micromatch.isMatch(subpath, excludePatterns)) {
              continue;
            }
            const importSrc = entry.import + exportPath.slice(1);
            expandedEntries.push({
              id: importSrc,
              import: importSrc,
              track: isPackageTopLevel(importSrc),
            });
          }
          return expandedEntries;
        }

        return [entry];
      }),
    )
  ).flat();

  for (const entry of result) {
    if (entry.id.startsWith('_')) {
      throw new Error(
        `Entry id "${entry.id}" must not start with "_". Ids starting with "_" are reserved for internal metadata.`,
      );
    }
    if (usedIds.has(entry.id)) {
      throw new Error(`Duplicate entry id found: "${entry.id}". Entry ids must be unique.`);
    }
    usedIds.add(entry.id);
  }

  return result;
}

/**
 * Apply default values to the configuration using CI environment
 * @param {BundleSizeCheckerConfigObject} config - The loaded configuration
 * @param {string} configPath - The path to the configuration file
 * @returns {Promise<NormalizedBundleSizeCheckerConfig>} Configuration with defaults applied
 * @throws {Error} If required fields are missing
 */
async function applyConfigDefaults(config, configPath) {
  // Get environment CI information
  /** @type {{ branch?: string, isPr?: boolean, prBranch?: string, slug?: string}} */
  const ciInfo = envCi();

  // Basic validation to ensure entries have the required structure
  // More detailed validation will be done in the worker
  for (const entry of config.entrypoints) {
    if (typeof entry !== 'string' && (!entry || typeof entry !== 'object')) {
      throw new Error('Each entry must be either a string or an object');
    }
  }

  // Clone the config to avoid mutating the original
  /** @type {NormalizedBundleSizeCheckerConfig} */
  const result = {
    entrypoints: await normalizeEntries(config.entrypoints, configPath),
    upload: null, // Default to disabled
    comment: config.comment !== undefined ? config.comment : true, // Default to enabled
    replace: config.replace || {}, // String replacements, default to empty object
  };

  // Handle different types of upload value
  if (typeof config.upload === 'boolean') {
    // If upload is false, leave as null
    if (config.upload === false) {
      return result;
    }

    // If upload is true, create empty object and apply defaults
    if (!ciInfo.slug) {
      throw new Error(
        'Upload enabled but repository not found in CI environment. Please specify upload.repo in config.',
      );
    }

    if (!ciInfo.branch && !(ciInfo.isPr && ciInfo.prBranch)) {
      throw new Error(
        'Upload enabled but branch not found in CI environment. Please specify upload.branch in config.',
      );
    }

    // Apply defaults to an empty object
    result.upload = applyUploadConfigDefaults({}, ciInfo);
  } else if (config.upload) {
    // It's an object, apply defaults
    result.upload = applyUploadConfigDefaults(config.upload, ciInfo);
  }

  return result;
}

/**
 * Attempts to load the config file from the given directory
 * @param {string} rootDir - The directory to search for the config file
 * @returns {Promise<NormalizedBundleSizeCheckerConfig>} A promise that resolves to the normalized config object
 */
export async function loadConfig(rootDir) {
  const configPaths = [
    path.join(rootDir, 'bundle-size-checker.config.js'),
    path.join(rootDir, 'bundle-size-checker.config.mjs'),
  ];

  for (const configPath of configPaths) {
    // eslint-disable-next-line no-await-in-loop
    const config = await loadConfigFile(configPath);
    if (config) {
      // Apply defaults and return the config
      return applyConfigDefaults(config, configPath);
    }
  }

  // Error out if no config file exists
  throw new Error(
    'No bundle-size-checker configuration file found. Please create a bundle-size-checker.config.js or bundle-size-checker.config.mjs file in your project root.',
  );
}
