import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { webpack as nextWebpack } from 'next/dist/compiled/webpack/webpack';
import type webpackCompiler from 'webpack';
import type { Configuration, NormalModule, Stats, Watching } from 'webpack';

const webpack: typeof webpackCompiler = nextWebpack;
const require = createRequire(import.meta.url);
const directories: string[] = [];
const DEFERRED_QUERY = '?mui-deferred-precompute';
const WATCH_TIMEOUT_MS = 30_000;
const WATCH_AGGREGATE_MS = 20;
const VARIANT_MEASURE =
  '| Load Precomputed Code Highlighter | Complete Variants Loading - index.ts';

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

/** Runs the source loader in webpack rather than substituting its context. */
async function createFixture() {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'docs-precompute-')));
  directories.push(directory);
  const loader = path.join(directory, 'loader.mjs');
  const source = fileURLToPath(new URL('./loadPrecomputedCodeHighlighter.ts', import.meta.url));
  await writeFile(
    loader,
    `import { createJiti } from ${JSON.stringify(require.resolve('jiti'))};\nconst jiti = createJiti(import.meta.url);\nconst { loadPrecomputedCodeHighlighter } = await jiti.import(${JSON.stringify(source)});\nexport default loadPrecomputedCodeHighlighter;\n`,
  );
  await writeFile(path.join(directory, 'helper.js'), 'export const label = "Before";\n');
  await writeFile(
    path.join(directory, 'Demo.js'),
    'import { label } from "./helper";\nexport default function Demo() { return label; }\n',
  );
  await writeFile(
    path.join(directory, 'factory.js'),
    'export function createDemo(url, demo, options) { return options; }\n',
  );
  await writeFile(
    path.join(directory, 'index.ts'),
    'import { createDemo } from "./factory";\nimport Demo from "./Demo";\nexport default createDemo(import.meta.url, Demo, {});\n',
  );
  return { directory, loader };
}

/** Keeps compilation and output settings identical across invalidation tests. */
function createConfig(
  directory: string,
  rule: NonNullable<Configuration['module']>['rules'],
): Configuration {
  return {
    mode: 'development',
    target: 'node',
    context: directory,
    entry: './index.ts',
    output: {
      path: path.join(directory, 'dist'),
      filename: 'main.cjs',
      chunkFilename: '[id].[contenthash].cjs',
      library: { type: 'commonjs2' },
    },
    resolve: { extensions: ['.ts', '.js'] },
    module: { rules: rule },
    optimization: { minimize: false },
    devtool: false,
  };
}

/** Fails on loader errors before attempting to read emitted demo source. */
function checkStats(
  error: Error | null | undefined,
  stats: Stats | undefined,
): asserts stats is Stats {
  if (error) {
    throw error;
  }
  if (!stats || stats.hasErrors()) {
    throw new Error(stats?.toString({ all: false, errors: true }) ?? 'Missing webpack stats');
  }
}

/** Loads the new bundle without reusing the previous watch build's module. */
async function readVariants(directory: string) {
  const outputPath = path.join(directory, 'dist/main.cjs');
  delete require.cache[outputPath];
  // eslint-disable-next-line import/no-dynamic-require -- Loads the emitted fixture bundle.
  return require(outputPath).default.loadPrecompute();
}

it(
  'invalidates deferred source when a transitive dependency changes',
  async () => {
    const { directory, loader } = await createFixture();
    const compiler = webpack(
      createConfig(directory, [
        {
          test: /index\.ts$/,
          use: [{ loader, options: { deferPrecompute: true, output: 'hast' } }],
        },
      ]),
    );
    let watching: Watching | undefined;
    let builds = 0;
    const priorMeasures = performance.getEntriesByName(VARIANT_MEASURE).length;
    try {
      await new Promise<void>((resolve, reject) => {
        watching = compiler.watch({ aggregateTimeout: WATCH_AGGREGATE_MS }, (error, stats) => {
          void (async () => {
            checkStats(error, stats);
            const deferred = [...stats.compilation.modules].find(
              (module): module is NormalModule =>
                'resource' in module &&
                typeof module.resource === 'string' &&
                module.resource.endsWith(DEFERRED_QUERY),
            );
            expect(deferred).toBeDefined();
            const dependencies = new Set(deferred?.buildInfo?.snapshot?.getFileIterable());
            expect(dependencies.has(path.join(directory, 'Demo.js'))).toBe(true);
            expect(dependencies.has(path.join(directory, 'helper.js'))).toBe(true);
            const serialized = JSON.stringify(await readVariants(directory));
            builds += 1;
            expect(performance.getEntriesByName(VARIANT_MEASURE).length - priorMeasures).toBe(
              builds,
            );
            if (builds === 1) {
              expect(serialized).toContain('Before');
              await writeFile(path.join(directory, 'helper.js'), 'export const label = "After";\n');
              return;
            }
            expect(serialized).toContain('After');
            expect(serialized).not.toContain('Before');
            resolve();
          })().catch(reject);
        });
      });
    } finally {
      await new Promise<void>((resolve) => {
        if (watching) {
          watching.close(() => resolve());
        } else {
          resolve();
        }
      });
      await new Promise<void>((resolve) => {
        compiler.close(() => resolve());
      });
    }
  },
  WATCH_TIMEOUT_MS,
);

it('preserves deferred options omitted by JSON serialization', async () => {
  const { directory, loader } = await createFixture();
  const deferredOptions = { deferPrecompute: true };
  Object.defineProperty(deferredOptions, 'output', { value: 'hast' });
  const compiler = webpack(
    createConfig(directory, [
      {
        test: /index\.ts$/,
        oneOf: [
          { resourceQuery: /mui-deferred-precompute/, use: [{ loader, options: deferredOptions }] },
          { use: [{ loader, options: { deferPrecompute: true } }] },
        ],
      },
    ]),
  );
  try {
    await new Promise<void>((resolve, reject) => {
      compiler.run((error, stats) => {
        try {
          checkStats(error, stats);
          resolve();
        } catch (failure) {
          reject(failure);
        }
      });
    });
    const variants = await readVariants(directory);
    expect(variants.Default.source.type).toBe('root');
  } finally {
    await new Promise<void>((resolve) => {
      compiler.close(() => resolve());
    });
  }
});
