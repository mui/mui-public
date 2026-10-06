import * as path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import type { Plugin } from 'vite';
import { escapeHtml } from '../utils/html';
import { discoverBenchFiles, writeBenchPages } from './benchFiles';
import type { BenchFile } from './benchFiles';
import { buildsDirOf, prepareOutputDir } from './outputDir';

/**
 * Vite plugin for a benchmark harness.
 *
 * The harness keeps its own vite config and runs plain `vite` / `vite build` / `vite preview`; this
 * plugin only contributes what is derived from its `*.bench.tsx` files:
 *
 * - A generated page per benchmark file, under `src/__bench__/`, and those pages as the build's
 *   entry points.
 * - A clear error when a page imports Vitest, or the Vitest entry of this package instead of
 *   `@mui/internal-benchmark/page`.
 * - `root` at the harness's `src/`, as an MPA (vite defaults to `spa`, whose fallback would rewrite
 *   unmatched urls toward a root `index.html` that does not exist here), and an index page listing
 *   the benchmark files.
 *
 * It deliberately never resolves refs, so a plain `vite build` needs no git history.
 */

export interface BenchmarkPluginOptions {
  /**
   * The harness package directory. Defaults to the current working directory, which is where vite
   * is run from.
   */
  harnessDir?: string;
}

/**
 * Checks that the workspace packages the harness links to have actually been built.
 *
 * A harness depends on the library under test via `workspace:*`, and `publishConfig.directory`
 * makes that link point at the package's build output — which does not exist until the library is
 * built. The symlink is then dangling, and vite's failure ("failed to resolve import") does not
 * say why.
 */
async function assertWorkspaceDepsBuilt(
  harnessDir: string,
  deps: Record<string, string>,
): Promise<void> {
  const linked = Object.entries(deps).filter(([, version]) => version.startsWith('workspace:'));
  await Promise.all(
    linked.map(async ([name]) => {
      try {
        await realpath(path.join(harnessDir, 'node_modules', ...name.split('/')));
      } catch {
        throw new Error(
          `"${name}" is linked into ${harnessDir} but its target does not exist. ` +
            `Build the workspace packages first (e.g. \`pnpm release:build\`) — the harness ` +
            `resolves the library through its build output, not its source.`,
        );
      }
    }),
  );
}

/** The index page: one link per benchmark file's page. */
function renderIndex(benchFiles: BenchFile[], note: string): string {
  const items = benchFiles
    .map(
      (benchFile) =>
        `      <li><a href="./${escapeHtml(benchFile.page)}"><code>${escapeHtml(benchFile.file)}</code></a></li>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Benchmarks</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 48rem; line-height: 1.5; }
      ul { list-style: none; padding-left: 0; }
      li { margin: 0.25rem 0; }
      code { background: rgba(127, 127, 127, 0.15); padding: 0.1em 0.35em; border-radius: 3px; }
    </style>
  </head>
  <body>
    <h1>Benchmarks</h1>
    <p>${note}</p>
    <ul>
${items}
    </ul>
  </body>
</html>
`;
}

/** Creates the benchmark harness plugin. */
export function benchmarkPlugin(options: BenchmarkPluginOptions = {}): Plugin {
  const harnessDir = options.harnessDir ?? process.cwd();
  const srcDir = path.join(harnessDir, 'src');
  let benchFiles: BenchFile[] = [];

  return {
    name: 'mui-benchmark:pages',
    // Ahead of vite's own resolver, so the errors below win over the package's `exports`.
    enforce: 'pre',

    // Tests are not benchmarks, so a page has no Vitest to import — nor this package's Vitest entry,
    // which imports it.
    async resolveId(source, importer) {
      if (source === '@mui/internal-benchmark') {
        this.error(
          `${importer ?? 'A benchmark page'} imports "@mui/internal-benchmark", the Vitest ` +
            'harness. Benchmark files for the `benchmark` CLI import "@mui/internal-benchmark/page".',
        );
      }
      if (source === 'vitest' || source.startsWith('vitest/')) {
        this.error(
          `${importer ?? 'A benchmark page'} imports "${source}". Benchmark files run outside ` +
            'Vitest: define cases with benchmark(), reactBenchmark() or compare(), and use the ' +
            'interaction context (input, waitForElementTiming, …) instead of Vitest APIs.',
        );
      }
      return null;
    },

    async config(userConfig, env) {
      const pkg = JSON.parse(await readFile(path.join(harnessDir, 'package.json'), 'utf8'));
      await assertWorkspaceDepsBuilt(harnessDir, {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      });

      // Set for every command, since `vite preview` serves `build.outDir` too; only when the caller
      // gave none, because returned config is merged over `vite build --outDir`.
      const outDir = userConfig.build?.outDir ?? path.join(buildsDirOf(harnessDir), 'manual');

      // Written for every command, so the dev server serves a benchmark file's page as well.
      benchFiles = await discoverBenchFiles({ harnessDir });
      if (benchFiles.length === 0) {
        throw new Error(`No *.bench.tsx file found under ${srcDir}.`);
      }
      await writeBenchPages(harnessDir, benchFiles);
      // One React for the harness, its benchmark files and the page runtime they run under.
      const base = {
        root: srcDir,
        appType: 'mpa' as const,
        resolve: { dedupe: ['react', 'react-dom'] },
      };

      if (env.command !== 'build') {
        return { ...base, build: { outDir } };
      }

      // A plain `vite build` into the output directory marks it ignored, as the `benchmark` CLI does.
      if (!userConfig.build?.outDir) {
        await prepareOutputDir(harnessDir);
      }

      const input = Object.fromEntries(
        benchFiles.map((benchFile) => [
          benchFile.page.replace(/\.html$/, ''),
          path.join(srcDir, benchFile.page),
        ]),
      );

      return {
        ...base,
        // Relative asset urls: the runner serves each ref's build under its own path, so absolute
        // "/assets/…" paths would 404.
        base: './',
        build: {
          outDir,
          // The output directory sits outside `root`, which is `src/`; allow vite to clean it anyway.
          emptyOutDir: true,
          chunkSizeWarningLimit: 9999,
          // Function names survive into CPU profiles and stack traces: a name's length costs a
          // page nothing once it is parsed, and parsing happens on load, before a sample.
          // Compression stays on, so the code is the production code otherwise.
          sourcemap: true,
          rolldownOptions: { input, output: { minify: { compress: true, mangle: false } } },
        },
      };
    },

    // The same index the dev server renders, emitted as a real file so the built directory is
    // navigable too — under `vite preview`, under any static server, or opened from disk.
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'index.html',
        source: renderIndex(
          benchFiles,
          'These are production bundles — the same build the `benchmark` CLI measures.',
        ),
      });
    },

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '/').split('?')[0];
        if (url !== '/' && url !== '/index.html') {
          next();
          return;
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(
          renderIndex(
            benchFiles,
            "Pages are served from the working tree's build of the library. Rebuild it and reload to pick up a source change.",
          ),
        );
      });
    },
  };
}
