import { $ } from 'execa';
import { globby } from 'globby';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as semver from 'semver';

/**
 * @typedef {'esm' | 'cjs'} BundleType
 */
export const isMjsBuild = !!process.env.MUI_EXPERIMENTAL_MJS;
export const DTS_REGEX = /\.d\.[m|c]?ts$/;

/**
 * @param {BundleType} bundle
 */
export function getOutExtension(bundle, isType = false) {
  if (isType) {
    if (!isMjsBuild) {
      return '.d.ts';
    }
    return bundle === 'esm' ? '.d.mts' : '.d.ts';
  }
  if (!isMjsBuild) {
    return '.js';
  }
  return bundle === 'esm' ? '.mjs' : '.js';
}

/**
 * @typedef {Object} BuildOptions
 * @property {boolean} [watch=false] - Whether to watch files for changes.
 * @property {boolean} [verbose=false] - Whether to enable verbose logging.
 * @property {boolean} [sourceMap=false] - Whether to generate source maps.
 */

/**
 * @typedef {Record<string, string | null | Record<string, string>>} Exports
 */

/**
 * @param {Record<string, string>} entryMap
 * @param {string} key
 * @param {string} value
 */
function addEntry(entryMap, key, value) {
  const finalKey = key.startsWith('./') ? key.slice(2) : key;
  entryMap[finalKey] = value;
}

/**
 * @param {Record<string, string | Record<string, string>> | undefined} pkgExports
 * @param {{ buildDirBase: string }} options
 * @returns {[Record<string, string | Record<string, Record<string, string>>>, {main: string | undefined; module: string | undefined;types: string| undefined}]}
 */
export function processExports(pkgExports, { buildDirBase }) {
  /**
   * @type {{main: string| undefined; module: string | undefined;types: string| undefined}}
   */
  const topLevel = {
    main: undefined,
    module: undefined,
    types: undefined,
  };
  /**
   * @type {Record<string, string | Record<string, Record<string, string>>>}
   */
  const outExports = {};
  if (pkgExports && typeof pkgExports === 'object' && Object.keys(pkgExports).length > 0) {
    Object.entries(pkgExports).forEach(([key, value]) => {
      const buildDirRegex = new RegExp(`^./${buildDirBase}/`);
      if (value && typeof value === 'object') {
        /**
         * @type {Record<string, Record<string, string>>}
         */
        const newKey = {};
        Object.entries(value).forEach(([subKey, subValue]) => {
          const filePath = subValue.replace(buildDirRegex, './');
          const pathExt = path.extname(subValue);
          let typeExt = pathExt === '.mjs' ? '.d.mts' : '.d.ts';
          if (pathExt === '.cjs') {
            typeExt = '.d.cts';
          }
          // outExports[key][subKey] = subValue.replace(/^\.\/build\//, './');
          newKey[subKey] = newKey[subKey] ?? {};
          newKey[subKey].types = `${filePath.replace(new RegExp(`${pathExt}$`), typeExt)}`;
          newKey[subKey].default = filePath;

          if (key === '.' && subKey === 'require') {
            topLevel.main = newKey[subKey].default;
            topLevel.types = newKey[subKey].types;
          }
        });
        outExports[key] = newKey;
      } else if (typeof value === 'string') {
        outExports[key] = value.replace(buildDirRegex, './');
      }
    });
  }
  return [outExports, topLevel];
}

/**
 *
 * @param {string} pkgVersion
 * @returns {Record<string, string>}
 */
export function getVersionEnvVariables(pkgVersion) {
  if (!pkgVersion) {
    throw new Error('No version found in package.json');
  }

  const [versionNumber, prerelease] = pkgVersion.split('-');
  const [major, minor, patch] = versionNumber.split('.');

  if (!major || !minor || !patch) {
    throw new Error(`Couldn't parse version from package.json`);
  }

  /**
   * @type {Record<string, string>}
   */
  const res = {
    MUI_VERSION: pkgVersion,
    MUI_MAJOR_VERSION: major,
    MUI_MINOR_VERSION: minor,
    MUI_PATCH_VERSION: patch,
    MUI_PRERELEASE: prerelease ?? 'undefined',
  };
  return res;
}

/**
 * Processes the exports field of a package.json file and maps them to entry points to be used by tsdown.
 * Expands glob patterns and resolves file paths.
 * @param {Exports} pkgExports
 * @param {string | Record<string, string>} pkgBin
 * @param {{ cwd: string }} options
 * @returns {Promise<[Record<string, string>, string[], Record<string, string>]>}
 */
export async function generateEntriesFromExports(pkgExports, pkgBin, { cwd }) {
  /**
   * @type {Record<string, string>}
   */
  const entries = {};
  /**
   * @type {Record<string, string>}
   */
  const binEntries = {};
  /**
   * @type {string[]}
   */
  const nullEntries = [];

  if (typeof pkgBin === 'string') {
    addEntry(binEntries, 'bin', pkgBin);
  } else if (pkgBin && typeof pkgBin === 'object') {
    Object.entries(pkgBin).forEach(([key, value]) => {
      addEntry(binEntries, `bin/${key}`, value);
    });
  }

  if (typeof pkgExports === 'object' && pkgExports && Object.keys(pkgExports).length > 0) {
    await Promise.all(
      Object.entries(pkgExports).map(async ([key, value]) => {
        if (!value) {
          nullEntries.push(key);
          return;
        }
        if (key.endsWith('.json') || key.endsWith('.css')) {
          return;
        }
        let entryValue = '';
        if (typeof value === 'string') {
          entryValue = value;
        } else if (value && typeof value === 'object') {
          // entries[key] = processExportsToEntry(value)[0];
          // @TODO
          if (value.default && typeof value.default === 'string') {
            entryValue = value.default;
          } else {
            throw new Error('TODO: Objects in exports are not supported yet.');
          }
        }
        if (entryValue.includes('*')) {
          if (
            entryValue.includes('**') ||
            entryValue.indexOf('*') !== entryValue.lastIndexOf('*')
          ) {
            throw new Error(
              `Unsupported glob pattern: ${entryValue} in "exports.${key}". Please use single asterisks (*) for glob patterns.`,
            );
          }
          const files = await globby(entryValue, {
            cwd,
            globstar: false,
          });
          files.forEach((file) => {
            const fileName = path.basename(file);
            const ext = path.extname(file);
            if (fileName.replace(ext, '') === 'index') {
              const fileKey = file
                .replace(/^(src|\.\/src)\//, '')
                .replace(new RegExp(`\\${ext}$`), '');
              addEntry(entries, fileKey, file);
            } else {
              const fileKey = file
                .replace(/^(src|\.\/src)\//, '')
                .replace(new RegExp(`\\${ext}$`), '');
              addEntry(entries, fileKey, file);
            }
          });
        } else {
          const fileName = path.basename(entryValue);
          const ext = path.extname(entryValue);
          const entryKey = key === '.' ? 'index' : key;
          if (fileName.replace(ext, '') === 'index' && key !== '.') {
            addEntry(entries, `${entryKey}/index`, entryValue);
          } else {
            addEntry(entries, entryKey, entryValue);
          }
        }
      }),
    );
  }
  if (Object.keys(entries).length === 0 && Object.keys(binEntries).length === 0) {
    throw new Error('No entries found in exports or bin field of package.json');
  }
  return [entries, nullEntries, binEntries];
} /**
 * @typedef {import('rolldown').RolldownOutput['output']} RolldownOutput
 */
/**
 * @typedef {{directory?: string}} PublishConfig
 */
/**
 * @typedef {Object} OutChunk
 * @property {string} fileName
 * @property {string} name
 * @property {boolean} isEntry
 */
/**
 * @typedef {{esm: OutChunk[], cjs: OutChunk[], bin: OutChunk[]}} OutChunks
 */

/**
 * @param {Record<string, any>} basePkgJson
 * @param {Record<string, {paths: string[]; isBin?: boolean}>} chunks
 * @param {string[]} [nullEntries]
 * @param {{ usePkgType?: boolean }} [options]
 * @returns {Promise<void>}
 */
export async function writePkgJson(basePkgJson, chunks, nullEntries = [], options = {}) {
  const usePkgType = options.usePkgType || false;
  const cwd = process.cwd();
  const outPath = path.join(
    cwd,
    /** @type {{directory: string}} */ (basePkgJson.publishConfig).directory,
    'package.json',
  );
  delete basePkgJson.publishConfig?.directory;
  delete basePkgJson.scripts;
  delete basePkgJson.devDependencies;
  delete basePkgJson.publishConfig;
  delete basePkgJson.exports;
  delete basePkgJson.bin;
  if (basePkgJson.packageScripts) {
    delete basePkgJson.scripts;
    basePkgJson.scripts = basePkgJson.packageScripts;
    delete basePkgJson.packageScripts;
  }
  basePkgJson.sideEffects ??= false;
  basePkgJson.type ??= 'commonjs';
  const isModule = basePkgJson.type === 'module';

  /**
   * @type {Record<string, Partial<Record<'default' | 'import' | 'require' | 'react-server', Record<string, string | undefined> | undefined>>>}
   */
  const newExports = {};
  /**
   * @type {null | Record<string, string>}
   */
  let newBin = null;

  Object.entries(chunks).forEach(([key, chunk]) => {
    if (chunk.isBin) {
      newBin = newBin || {};
      newBin[key.substring('bin/'.length)] =
        `./${isModule ? chunk.paths.find((p) => p.endsWith('.mjs') || p.endsWith('.js')) : chunk.paths.find((p) => p.endsWith('.cjs') || p.endsWith('.js'))}`;
    } else {
      const pathKey =
        key === 'index'
          ? '.'
          : `./${key.endsWith('/index') ? key.substring(0, key.length - '/index'.length) : key}`;
      const cjsExtension = usePkgType && isModule ? '.cjs' : '.js';
      const cjsDtsExtension = usePkgType && isModule ? '.d.cts' : '.d.ts';
      const mjsExtension = usePkgType && !isModule ? '.mjs' : '.js';
      const mjsDtsExtension = usePkgType && !isModule ? '.d.mts' : '.d.ts';
      const requireTypePath = chunk.paths.find((p) => p.endsWith(cjsDtsExtension));
      const importTypePath = chunk.paths.find((p) => p.endsWith(mjsDtsExtension));
      const requirePath = chunk.paths.find((p) => p.endsWith(cjsExtension));
      const importPath = chunk.paths.find((p) => p.endsWith(mjsExtension));
      newExports[pathKey] = {
        require: requirePath
          ? {
              types: requireTypePath ? `./${requireTypePath}` : undefined,
              default: requirePath ? `./${requirePath}` : undefined,
            }
          : undefined,
        import: importPath
          ? {
              types: importTypePath ? `./${importTypePath}` : undefined,
              default: importPath ? `./${importPath}` : undefined,
            }
          : undefined,
      };
      if (newExports[pathKey].import) {
        newExports[pathKey].default = newExports[pathKey].import;
        if (pathKey === '.') {
          basePkgJson.module = newExports[pathKey].import.default;
        }
        delete newExports[pathKey].import;
      } else if (newExports[pathKey].require) {
        newExports[pathKey].default = newExports[pathKey].require;
        if (pathKey === '.') {
          basePkgJson.main = newExports[pathKey].require.default;
          basePkgJson.types = newExports[pathKey].require.types;
        }
        delete newExports[pathKey].require;
      }
    }
  });

  if (Object.keys(newExports).length) {
    const dotExport = newExports['.'];
    delete newExports['.'];
    // stringify and parse to remove undefined values
    basePkgJson.exports = JSON.parse(
      JSON.stringify({
        './package.json': './package.json',
        ...(dotExport ? { '.': dotExport } : {}),
        ...newExports,
      }),
    );

    Object.keys(basePkgJson.exports).forEach((key) => {
      const value = basePkgJson.exports[key];
      if (typeof value === 'string') {
        return;
      }
      // clean up entries with only one option
      if (value && typeof value === 'object') {
        const objKeys = Object.keys(value);
        if (objKeys.length === 1) {
          const exportValue = value[objKeys[0]];
          if (
            exportValue &&
            typeof exportValue === 'object' &&
            Object.keys(exportValue).length === 1 &&
            exportValue.default
          ) {
            basePkgJson.exports[key] = exportValue.default;
            return;
          }
          basePkgJson.exports[key] = value[objKeys[0]];
        }
      }
    });

    if (dotExport) {
      const mainExport = dotExport;
      if (mainExport.require) {
        basePkgJson.main = mainExport.require.default;
        basePkgJson.types = mainExport.require.types;
      }
      if (mainExport.default) {
        basePkgJson.module = mainExport.default.default;
      }
    }
  }

  if (nullEntries.length) {
    basePkgJson.exports = basePkgJson.exports || {};
    nullEntries.forEach((key) => {
      const pathKey = key.startsWith('./') ? key : `./${key}`;
      basePkgJson.exports[pathKey] = null;
    });
  }

  if (newBin) {
    basePkgJson.bin = newBin;
  }

  await fs.writeFile(outPath, `${JSON.stringify(basePkgJson, null, 2)}\n`);
}

const TS_CONFIG_PATHS = ['tsconfig.build.json', 'tsconfig.json'];

/**
 * Checks for the existence of tsconfig.build.json or tsconfig.json in the given directory.
 * Returns the path of the first found file, or null if neither file exists.
 * @param {string} cwd
 * @returns {Promise<string|null>}
 */
export async function getTsConfigPath(cwd) {
  for (const configPath of TS_CONFIG_PATHS) {
    const fullPath = path.join(cwd, configPath);
    if (
      // eslint-disable-next-line no-await-in-loop
      await fs
        .stat(fullPath)
        .then((stat) => stat.isFile())
        .catch(() => false)
    ) {
      return configPath;
    }
  }
  return null;
}

/**
 * Validates the package.json before building.
 * @param {Record<string, any>} packageJson
 * @param {Object} [options]
 * @param {boolean} [options.skipMainCheck=false] - Whether to skip checking for main field in package.json.
 * @param {boolean} [options.enableReactCompiler=false] - Whether to enable React compiler checks.
 * @param {boolean} [options.skipBabelRuntimeCheck=false]
 */
export async function validatePkgJson(packageJson, options = {}) {
  const {
    skipMainCheck = false,
    enableReactCompiler = false,
    skipBabelRuntimeCheck = false,
  } = options;
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

  let babelRuntimeVersion = packageJson.dependencies['@babel/runtime'];
  if (babelRuntimeVersion === 'catalog:') {
    // resolve the version from the given package
    // outputs the pnpm-workspace.yaml config as json
    const { stdout: configStdout } = await $`pnpm config list --json`;
    const pnpmWorkspaceConfig = JSON.parse(configStdout);
    babelRuntimeVersion = pnpmWorkspaceConfig.catalog['@babel/runtime'];
  }

  if (!babelRuntimeVersion && !skipBabelRuntimeCheck) {
    errors.push(
      'package.json needs to have a dependency on `@babel/runtime` when building with `@babel/plugin-transform-runtime`.',
    );
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
