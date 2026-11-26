import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
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
const ASSET_PUBLIC_PATH = '/docs/_next/';
const HTTP_UNAVAILABLE = 503;
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

function expectDeferredDependencies(stats: Stats, directory: string) {
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
}

function runCompiler(compiler: webpackCompiler.Compiler) {
  return new Promise<Stats>((resolve, reject) => {
    compiler.run((error, stats) => {
      try {
        checkStats(error, stats);
        resolve(stats);
      } catch (failure) {
        reject(failure);
      }
    });
  });
}

/** Loads the new bundle without reusing the previous watch build's module. */
function readDemo(directory: string) {
  const outputPath = path.join(directory, 'dist/main.cjs');
  delete require.cache[outputPath];

  // eslint-disable-next-line import/no-dynamic-require -- Loads the emitted fixture bundle.
  return require(outputPath).default;
}

async function readVariants(directory: string) {
  return readDemo(directory).loadPrecompute();
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
            expectDeferredDependencies(stats, directory);
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
    expectDeferredDependencies(await runCompiler(compiler), directory);
    const variants = await readVariants(directory);
    expect(variants.Default.source.type).toBe('root');
  } finally {
    await new Promise<void>((resolve) => {
      compiler.close(() => resolve());
    });
  }
});

it('reuses deferred output when options contain undefined values', async () => {
  const { directory, loader } = await createFixture();
  const compiler = webpack(
    createConfig(directory, [
      {
        test: /index\.ts$/,
        use: [
          { loader, options: { deferPrecompute: true, output: 'hast', performance: undefined } },
        ],
      },
    ]),
  );
  const priorMeasures = performance.getEntriesByName(VARIANT_MEASURE).length;
  try {
    expectDeferredDependencies(await runCompiler(compiler), directory);
    expect(performance.getEntriesByName(VARIANT_MEASURE).length - priorMeasures).toBe(1);
    const variants = await readVariants(directory);
    expect(variants.Default.source.type).toBe('root');
  } finally {
    await new Promise<void>((resolve) => {
      compiler.close(() => resolve());
    });
  }
});

/** Serves emitted files over HTTP rather than substituting fetch. */
async function createAssetServer(directory: string, behavior: 'retry' | 'serve') {
  const requests: string[] = [];

  const server = createServer(async (request, response) => {
    requests.push(request.url ?? '');

    if (behavior === 'retry' && requests.length === 1) {
      response.writeHead(HTTP_UNAVAILABLE);
      response.end();

      return;
    }

    const asset = request.url?.replace(ASSET_PUBLIC_PATH, '');
    response.setHeader('Content-Type', 'application/json');
    response.end(await readFile(path.join(directory, 'dist', asset ?? '')));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();

  if (!address || typeof address === 'string') {
    throw new Error('Expected an HTTP server address');
  }

  return {
    server,
    requests,
    publicPath: `http://127.0.0.1:${address.port}${ASSET_PUBLIC_PATH}`,
  };
}

it('loads JSON assets lazily using webpack publicPath and caches successful requests', async () => {
  const { directory, loader } = await createFixture();

  const moduleCompiler = webpack(
    createConfig(directory, [
      { test: /index\.ts$/, use: [{ loader, options: { deferPrecompute: true } }] },
    ]),
  );

  let moduleDemo: ReturnType<typeof readDemo>;
  let moduleVariants: Awaited<ReturnType<typeof readVariants>>;

  try {
    await runCompiler(moduleCompiler);
    moduleDemo = readDemo(directory);
    moduleVariants = await moduleDemo.loadPrecompute();
  } finally {
    await new Promise<void>((resolve) => {
      moduleCompiler.close(() => resolve());
    });
  }

  const { server, requests, publicPath } = await createAssetServer(directory, 'retry');

  const config = createConfig(directory, [
    { test: /index\.ts$/, use: [{ loader, options: { deferPrecompute: 'asset' } }] },
  ]);

  config.target = 'web';
  config.output = {
    ...config.output,
    publicPath,
  };
  const compiler = webpack(config);

  try {
    const stats = await runCompiler(compiler);
    const assets = stats.toJson({ all: false, assets: true }).assets ?? [];
    const metadata = assets.filter((asset) => asset.name.endsWith('.json'));
    expect(metadata).toHaveLength(1);
    expect(stats.compilation.chunks.size).toBe(1);
    expect(metadata[0].name).toMatch(/^static\/media\/docs-precompute\.[a-f0-9]+\.json$/);
    expect(
      [...stats.compilation.modules].some((module) => module.identifier().includes(DEFERRED_QUERY)),
    ).toBe(false);

    const demo = readDemo(directory);
    expect(requests).toHaveLength(0);
    expect(demo.precompute).toEqual(moduleDemo.precompute);
    await expect(demo.loadPrecompute()).rejects.toThrow(String(HTTP_UNAVAILABLE));
    const firstLoad = demo.loadPrecompute();
    const secondLoad = demo.loadPrecompute();
    expect(firstLoad).toBe(secondLoad);
    const variants = await firstLoad;
    expect(variants).toEqual(moduleVariants);
    expect(JSON.stringify(variants)).toContain('Before');
    expect(await demo.loadPrecompute()).toBe(variants);
    expect(requests).toEqual(Array(2).fill(`${ASSET_PUBLIC_PATH}${metadata[0].name}`));
  } finally {
    await new Promise<void>((resolve) => {
      compiler.close(() => resolve());
    });
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);

          return;
        }

        resolve();
      });
    });
  }
});

it('changes the JSON asset URL when imported source changes', async () => {
  const { directory, loader } = await createFixture();
  const { server, requests, publicPath } = await createAssetServer(directory, 'serve');

  const config = createConfig(directory, [
    { test: /index\.ts$/, use: [{ loader, options: { deferPrecompute: 'asset' } }] },
  ]);

  config.target = 'web';
  config.output = { ...config.output, publicPath };
  const compiler = webpack(config);
  let watching: Watching | undefined;
  let previousAsset: string | undefined;

  try {
    await new Promise<void>((resolve, reject) => {
      watching = compiler.watch({ aggregateTimeout: WATCH_AGGREGATE_MS }, (error, stats) => {
        void (async () => {
          checkStats(error, stats);
          const assets = stats.toJson({ all: false, assets: true }).assets ?? [];
          const metadata = assets.find((asset) => asset.name.endsWith('.json'));

          if (!metadata) {
            throw new Error('Missing JSON metadata asset');
          }

          const contents = JSON.stringify(await readVariants(directory));
          expect(requests.at(-1)).toBe(`${ASSET_PUBLIC_PATH}${metadata.name}`);

          if (!previousAsset) {
            previousAsset = metadata.name;
            expect(contents).toContain('Before');
            await writeFile(path.join(directory, 'helper.js'), 'export const label = "After";\n');

            return;
          }

          expect(metadata.name).not.toBe(previousAsset);
          expect(contents).toContain('After');
          expect(contents).not.toContain('Before');
          resolve();
        })().catch(reject);
      });
    });
  } finally {
    await new Promise<void>((resolve) => {
      if (!watching) {
        resolve();

        return;
      }

      watching.close(() => resolve());
    });
    await new Promise<void>((resolve) => {
      compiler.close(() => resolve());
    });
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);

          return;
        }

        resolve();
      });
    });
  }
});
