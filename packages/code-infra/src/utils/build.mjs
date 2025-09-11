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
 * Creates a higher-order function that measures the execution time of the wrapped function.
 * Works with both synchronous and asynchronous functions.
 * @function
 * @template {(...args: any[]) => any} F
 * @param {string} label - The label for the performance measurement
 * @param {F} fn - The function to wrap and measure
 * @param {Object} [options={}]
 * @param {boolean} [options.shouldLog=false] - Whether to log the duration to the console after each execution
 * @returns {(this: ThisParameterType<F>, ...args: Parameters<F>) => ReturnType<F>} A new function that measures execution time and returns the same result as the original, with an additional getDuration method
 */
export function withPerformanceMeasurement(label, fn, options = {}) {
  const { shouldLog = false } = options;
  /**
   * @type {PerformanceMeasure | null}
   */
  let lastMeasurement = null;

  const startMark = `${label}-start`;
  const endMark = `${label}-end`;

  function markAndLog() {
    performance.mark(endMark);
    lastMeasurement = performance.measure(label, startMark, endMark);
    performance.clearMarks(startMark);
    performance.clearMarks(endMark);
    performance.clearMeasures(label);
    if (shouldLog && lastMeasurement) {
      // Log the duration to the console
      // eslint-disable-next-line no-console
      console.log(`⏰ Ran "${label}" for ${(lastMeasurement.duration / 1000).toFixed(3)}s.`);
    }
  }

  /**
   * @this {ThisParameterType<F>}
   * @param {...any} args
   */
  function withPerformanceMeasurementWrapper(...args) {
    performance.mark(startMark);

    const result = fn.apply(this, args);

    // Handle both sync and async functions
    if (result && typeof result.then === 'function') {
      return result.finally(() => {
        markAndLog();
      });
    }

    markAndLog();
    return result;
  }

  return withPerformanceMeasurementWrapper;
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
