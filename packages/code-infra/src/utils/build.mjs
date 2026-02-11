import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { globby } from 'globby';
import { minimatch } from 'minimatch';
import * as semver from 'semver';

/**
 * @typedef {'esm' | 'cjs'} BundleType
 */

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
 * @param {Object} param0
 * @param {NonNullable<import('../cli/packageJson').PackageJson.Exports>} param0.importPath
 * @param {string} param0.key
 * @param {string} param0.cwd
 * @param {string} param0.dir
 * @param {string} param0.type
 * @param {import('../cli/packageJson').PackageJson.ExportConditions} param0.newExports
 * @param {string} param0.typeOutExtension
 * @param {string} param0.outExtension
 * @param {boolean} param0.addTypes
 * @returns {Promise<void>}
 */
async function createExportsFor({
  importPath,
  key,
  cwd,
  dir,
  type,
  newExports,
  typeOutExtension,
  outExtension,
  addTypes,
}) {
  if (Array.isArray(importPath)) {
    throw new Error(
      `Array form of package.json exports is not supported yet. Found in export "${key}".`,
    );
  }

  let srcPath = typeof importPath === 'string' ? importPath : importPath['mui-src'];
  const rest = typeof importPath === 'string' ? {} : { ...importPath };
  delete rest['mui-src'];

  if (typeof srcPath !== 'string') {
    throw new Error(
      `Unsupported export for "${key}". Only a string or an object with "mui-src" field is supported for now.`,
    );
  }

  const exportFileExists = srcPath.includes('*')
    ? true
    : await fs.stat(path.join(cwd, srcPath)).then(
        (stats) => stats.isFile() || stats.isDirectory(),
        () => false,
      );
  if (!exportFileExists) {
    throw new Error(
      `The import path "${srcPath}" for export "${key}" does not exist in the package. Either remove the export or add the file/folder to the package.`,
    );
  }
  srcPath = srcPath.replace(/\.\/src\//, `./${dir === '.' ? '' : `${dir}/`}`);
  const ext = path.extname(srcPath);

  if (ext === '.css') {
    newExports[key] = srcPath;
    return;
  }

  if (typeof newExports[key] === 'string' || Array.isArray(newExports[key])) {
    throw new Error(`The export "${key}" is already defined as a string or Array.`);
  }

  newExports[key] ??= {};
  const exportPath = srcPath.replace(ext, outExtension);
  // eslint-disable-next-line no-nested-ternary
  newExports[key][type === 'cjs' ? 'require' : 'import'] = addTypes
    ? {
        ...rest,
        types: srcPath.replace(ext, typeOutExtension),
        default: exportPath,
      }
    : Object.keys(rest).length
      ? {
          ...rest,
          default: exportPath,
        }
      : exportPath;
}

/**
 * Expands glob patterns (containing `*`) in package.json export keys/values
 * into concrete entries by resolving them against actual files on disk.
 * @param {import('../cli/packageJson').PackageJson.ExportConditions} originalExports
 * @param {string} cwd
 * @returns {Promise<import('../cli/packageJson').PackageJson.ExportConditions>}
 */
async function expandExportGlobs(originalExports, cwd) {
  /** @type {import('../cli/packageJson').PackageJson.ExportConditions} */
  const expandedExports = {};

  /**
   * @typedef {{
   *   value: import('../cli/packageJson').PackageJson.Exports;
   *   srcPattern: string;
   *   srcPrefix: string;
   *   srcSuffix: string;
   *   keyPrefix: string;
   *   keySuffix: string;
   * }} GlobEntry
   */

  // Collect entries that need glob expansion
  /** @type {GlobEntry[]} */
  const globEntries = [];

  // Collect negation patterns (glob keys with null values)
  /** @type {string[]} */
  const negationPatterns = [];

  for (const [key, value] of Object.entries(originalExports)) {
    // Null value acts as a negation/exclusion
    if (value === null) {
      if (key.includes('*')) {
        negationPatterns.push(key);
      } else {
        delete expandedExports[key];
      }
      continue;
    }

    if (!key.includes('*')) {
      expandedExports[key] = value;
      continue;
    }

    // Extract the source pattern from the value
    /** @type {string | undefined} */
    let srcPattern;
    if (typeof value === 'string') {
      srcPattern = value;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      srcPattern = /** @type {string | undefined} */ (value['mui-src']);
    }

    if (typeof srcPattern !== 'string' || !srcPattern.includes('*')) {
      expandedExports[key] = value;
      continue;
    }

    // Split patterns around the * wildcard
    const srcStarIndex = srcPattern.indexOf('*');
    const srcPrefix = srcPattern.substring(0, srcStarIndex);
    const srcSuffix = srcPattern.substring(srcStarIndex + 1);

    const keyStarIndex = key.indexOf('*');
    const keyPrefix = key.substring(0, keyStarIndex);
    const keySuffix = key.substring(keyStarIndex + 1);

    globEntries.push({
      value,
      srcPattern,
      srcPrefix,
      srcSuffix,
      keyPrefix,
      keySuffix,
    });
  }

  // Resolve all globby calls in parallel
  const globResults = await Promise.all(
    globEntries.map(({ srcPattern }) => globby(srcPattern, { cwd })),
  );

  for (let i = 0; i < globEntries.length; i += 1) {
    const { value, srcPrefix, srcSuffix, keyPrefix, keySuffix } = globEntries[i];
    const matches = globResults[i];

    const stems = [];
    for (const match of matches) {
      if (match.startsWith(srcPrefix) && match.endsWith(srcSuffix)) {
        const stem =
          srcSuffix.length > 0
            ? match.substring(srcPrefix.length, match.length - srcSuffix.length)
            : match.substring(srcPrefix.length);
        if (stem.length > 0) {
          stems.push(stem);
        }
      }
    }

    stems.sort();

    for (const stem of stems) {
      const expandedKey = `${keyPrefix}${stem}${keySuffix}`;
      const expandedSrcPath = `${srcPrefix}${stem}${srcSuffix}`;

      if (typeof value === 'string') {
        expandedExports[expandedKey] = expandedSrcPath;
      } else {
        expandedExports[expandedKey] = {
          ...value,
          'mui-src': expandedSrcPath,
        };
      }
    }
  }

  // Apply negation patterns: remove any expanded keys that match a null-valued glob
  for (const pattern of negationPatterns) {
    for (const expandedKey of Object.keys(expandedExports)) {
      if (minimatch(expandedKey, pattern)) {
        delete expandedExports[expandedKey];
      }
    }
  }

  return expandedExports;
}

/**
 * @param {Object} param0
 * @param {import('../cli/packageJson').PackageJson['exports']} param0.exports
 * @param {{type: BundleType; dir: string}[]} param0.bundles
 * @param {string} param0.outputDir
 * @param {string} param0.cwd
 * @param {boolean} [param0.addTypes]
 * @param {boolean} [param0.isFlat]
 * @param {'module' | 'commonjs'} [param0.packageType]
 */
export async function createPackageExports({
  exports: packageExports,
  bundles,
  outputDir,
  cwd,
  addTypes = false,
  isFlat = false,
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
  const originalExports = await expandExportGlobs(rawExports, cwd);
  /**
   * @type {import('../cli/packageJson').PackageJson.ExportConditions}
   */
  const newExports = {
    './package.json': './package.json',
  };
  /**
   * @type {{ main?: string; module?: string; types?: string; exports: import('../cli/packageJson').PackageJson.ExportConditions }}
   */
  const result = {
    exports: newExports,
  };

  await Promise.all(
    bundles.map(async ({ type, dir }) => {
      const outExtension = getOutExtension(type, {
        isFlat,
        packageType: resolvedPackageType,
      });
      const typeOutExtension = getOutExtension(type, {
        isFlat,
        isType: true,
        packageType: resolvedPackageType,
      });
      const indexFileExists = await fs.stat(path.join(outputDir, dir, `index${outExtension}`)).then(
        (stats) => stats.isFile(),
        () => false,
      );
      const typeFileExists =
        addTypes &&
        (await fs.stat(path.join(outputDir, dir, `index${typeOutExtension}`)).then(
          (stats) => stats.isFile(),
          () => false,
        ));
      const dirPrefix = dir === '.' ? '' : `${dir}/`;
      const exportDir = `./${dirPrefix}index${outExtension}`;
      const typeExportDir = `./${dirPrefix}index${typeOutExtension}`;

      if (indexFileExists) {
        // skip `packageJson.module` to support parcel and some older bundlers
        if (type === 'cjs') {
          result.main = exportDir;
        }

        if (typeof newExports['.'] === 'string' || Array.isArray(newExports['.'])) {
          throw new Error(`The export "." is already defined as a string or Array.`);
        }

        newExports['.'] ??= {};
        newExports['.'][type === 'cjs' ? 'require' : 'import'] = typeFileExists
          ? {
              types: typeExportDir,
              default: exportDir,
            }
          : exportDir;
      }
      if (typeFileExists && type === 'cjs') {
        result.types = typeExportDir;
      }
      const exportKeys = Object.keys(originalExports);
      // need to maintain the order of exports
      for (const key of exportKeys) {
        const importPath = originalExports[key];
        if (!importPath) {
          newExports[key] = null;
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        await createExportsFor({
          importPath,
          key,
          cwd,
          dir,
          type,
          newExports,
          typeOutExtension,
          outExtension,
          addTypes,
        });
      }
    }),
  );

  bundles.forEach(({ dir }) => {
    if (dir !== '.') {
      newExports[`./${dir}`] = null;
    }
  });

  // Transform import/require to default/require pattern
  Object.keys(newExports).forEach((key) => {
    const exportVal = newExports[key];
    if (Array.isArray(exportVal)) {
      throw new Error(
        `Array form of package.json exports is not supported yet. Found in export "${key}".`,
      );
    }
    if (exportVal && typeof exportVal === 'object' && (exportVal.import || exportVal.require)) {
      // Use ESM (import) for default if available, otherwise use require
      const defaultExport = exportVal.import || exportVal.require;

      if (addTypes) {
        exportVal.default = defaultExport;
      } else {
        exportVal.default =
          defaultExport && typeof defaultExport === 'object' && 'default' in defaultExport
            ? defaultExport.default
            : defaultExport;
      }
    }
  });

  return result;
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
