/**
 * @typedef {'esm' | 'cjs'} BundleType
 */
export const isMjsBuild = !!process.env.MUI_EXPERIMENTAL_MJS;

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
 * Validates the package.json before building.
 * @param {Record<string, any>} packageJson
 * @param {Object} [options]
 * @param {boolean} [options.skipMainCheck=false] - Whether to skip checking for main field in package.json.
 */
export function validatePkgJson(packageJson, options = {}) {
  const { skipMainCheck = false } = options;
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

  if (errors.length > 0) {
    const error = new Error(errors.join('\n'));
    throw error;
  }
}

/**
 * Measures the performance of a function.
 * @param {string} label - The label for the performance measurement.
 * @param {Function} fn - The function to measure.
 * @returns {Promise<number>} - The duration of the function execution in milliseconds.
 */
export async function measurePerf(label, fn) {
  performance.mark(`${label}-start`);
  await Promise.resolve(fn());
  performance.mark(`${label}-end`);
  const measurement = performance.measure(label, `${label}-start`, `${label}-end`);
  return measurement.duration;
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
 * A utility to wrap a function in a worker pool.
 *
 * This function will create a pool of workers and distribute the items to be processed among them.
 * Each worker will process items sequentially, but multiple workers will run in parallel.
 * @function
 * @template T
 * @param {(item: T) => Promise<void>} fn
 * @param {Object} options
 * @param {T[]} options.items
 * @param {number} [options.defaultConcurrency=50]
 * @param {'all' | 'allSettled'} [options.promiseMethod='all']
 * @returns {Promise<void>}
 */
export async function wrapInWorker(fn, options) {
  const { defaultConcurrency = 50, items = [], promiseMethod = 'all' } = options ?? {};
  if (items.length === 0) {
    return;
  }
  const itemIterator = items[Symbol.iterator]();
  const concurrency = Math.min(defaultConcurrency, items.length);
  const workers = [];
  for (let i = 0; i < concurrency; i += 1) {
    const worker = Promise.resolve().then(async () => {
      for (const item of itemIterator) {
        // eslint-disable-next-line no-await-in-loop
        await fn(item);
      }
    });
    workers.push(worker);
  }
  await (promiseMethod === 'all' ? Promise.all(workers) : Promise.allSettled(workers));
}
