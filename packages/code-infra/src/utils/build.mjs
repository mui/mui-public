import * as semver from 'semver';

/**
 * @typedef {'esm' | 'cjs'} BundleType
 */

/**
 * @param {BundleType} bundle
 * @param {Object} [options]
 * @param {boolean} [options.isType=false] - Whether to get the extension for type declaration files.
 * @param {boolean} [options.isFlat=false] - Whether to get the extension for a flat build structure.
 * @returns {string}
 */
export function getOutExtension(bundle, options = {}) {
  const { isType = false, isFlat = false } = options;
  if (isType) {
    if (!isFlat) {
      return '.d.ts';
    }
    return bundle === 'esm' ? '.d.mts' : '.d.cts';
  }
  if (isFlat) {
    return bundle === 'esm' ? '.mjs' : '.cjs';
  }
  return '.js';
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
