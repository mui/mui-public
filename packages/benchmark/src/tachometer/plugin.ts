import * as path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import type { Plugin } from 'vite';
import { discoverCases, pagesOf } from './discoverCases';
import type { BenchmarkCase } from './discoverCases';
import { buildsDirOf, prepareOutputDir } from './outputDir';

/**
 * Vite plugin for a tachometer benchmark harness.
 *
 * The harness keeps its own vite config and runs plain `vite` / `vite build` / `vite preview`; this
 * plugin only contributes what is derived from the benchmark cases:
 *
 * - `root` is the harness's `src/`, and the app is an MPA (vite defaults to `spa`, whose fallback
 *   would rewrite unmatched urls toward a root `index.html` that does not exist here).
 * - The build's entry points come from the `tachometer.json` files, so the configs are the single
 *   source of truth for which pages exist.
 * - The dev server serves a generated index listing every case, including cases that own no page of
 *   their own and only parameterise a sibling's.
 *
 * It deliberately never resolves refs, so a plain `vite build` needs no git history.
 */

export interface TachometerPluginOptions {
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

/**
 * Renders the case index: one link per case, carrying whatever query the case parameterises its
 * page with.
 */
function renderIndex(cases: BenchmarkCase[], note: string): string {
  const items = cases
    .map((entry) => {
      // A case's variants can point at several pages (a cross-library comparison) or at one page
      // with different queries (a parameterised case), so dedupe on the pair.
      const targets = [...new Set(entry.leaves.map((leaf) => `${leaf.page}${leaf.suffix}`))].sort();
      const links = targets
        .map((target) => `<li><a href="./${target}"><code>${target}</code></a></li>`)
        .join('\n        ');
      return `    <li>\n      <strong>${entry.name}</strong>\n      <ul>\n        ${links}\n      </ul>\n    </li>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Tachometer benchmark cases</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 48rem; line-height: 1.5; }
      ul { list-style: none; padding-left: 0; }
      ul ul { padding-left: 1rem; }
      li { margin: 0.25rem 0; }
      code { background: rgba(127, 127, 127, 0.15); padding: 0.1em 0.35em; border-radius: 3px; }
    </style>
  </head>
  <body>
    <h1>Tachometer benchmark cases</h1>
    <p>${note}</p>
    <ul>
${items}
    </ul>
  </body>
</html>
`;
}

/** Creates the tachometer harness plugin. */
export function tachometer(options: TachometerPluginOptions = {}): Plugin {
  const harnessDir = options.harnessDir ?? process.cwd();
  const srcDir = path.join(harnessDir, 'src');
  let buildCases: BenchmarkCase[] = [];

  return {
    name: 'mui-benchmark:tachometer',

    async config(userConfig, env) {
      const pkg = JSON.parse(await readFile(path.join(harnessDir, 'package.json'), 'utf8'));
      await assertWorkspaceDepsBuilt(harnessDir, {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      });

      // The run output directory, next to the per-ref directories the runner writes — vite would
      // otherwise default to `<root>/dist`, i.e. inside `src/` next to the case sources.
      //
      // Resolved for every command, not just `build`: `vite preview` runs as `serve` but serves
      // `build.outDir`, so leaving it unset there sends preview looking for `<root>/dist` and it
      // exits rather than serving the pages that were just built.
      //
      // Only fill it in when the caller said nothing: a plugin's returned config is merged *over*
      // the inline config, so unconditionally setting it here would silently override
      // `vite build --outDir`, which is exactly how `tacho run` directs each ref's build.
      const usingDefaultOutDir = userConfig.build?.outDir === undefined;
      const outDir = userConfig.build?.outDir ?? buildsDirOf(harnessDir, 'manual');
      // Mark the directory ignored from the inside before anything writes into it. `tacho run` does
      // this itself and passes its own `outDir`, but a plain `vite build` would otherwise leave a
      // harness that does not list `.tachometer` offering built pages for commit.
      if (usingDefaultOutDir) {
        await prepareOutputDir(harnessDir);
      }

      if (env.command !== 'build') {
        return { root: srcDir, appType: 'mpa', build: { outDir } };
      }

      const cases = await discoverCases({ harnessDir });
      buildCases = cases;
      // Key the input map by the page path without its extension. Vite emits each page at its path
      // relative to `root` regardless, so `<case>/index.html` lands at `<outDir>/<case>/index.html`;
      // a distinct key per page is what lets one case folder hold several pages — a cross-library
      // comparison with `mosaic.html` and `tanstack.html` side by side — without them colliding.
      const input = Object.fromEntries(
        pagesOf(cases).map((page) => [page.replace(/\.html$/, ''), path.join(srcDir, page)]),
      );

      return {
        root: srcDir,
        appType: 'mpa',
        // Relative asset urls: tachometer serves the build directory and the pages live under
        // `<outDir>/<case>/`, so absolute "/assets/…" paths would 404.
        base: './',
        build: {
          outDir,
          // The output directory sits outside `root`, which is `src/`; allow vite to clean it anyway.
          emptyOutDir: true,
          chunkSizeWarningLimit: 9999,
          rollupOptions: { input },
        },
      };
    },

    // The same index the dev server renders, emitted as a real file so the built directory is
    // navigable too — under `vite preview`, under any static server, or opened from disk. A page-less
    // case is only reachable through this list, so a build without it can only be entered by typing
    // urls from memory.
    generateBundle() {
      // A `tachometer.json` directly in `src/` is a supported layout, and such a case can own
      // `index.html` — which rollup emits under that very name. Rollup then drops this emit with no
      // error and no warning, so the list simply vanishes; say so instead. The case's page is the
      // landing page in that layout anyway.
      if (pagesOf(buildCases).includes('index.html')) {
        this.warn(
          'A case owns index.html, so the case list was not emitted. Move the case into a subfolder of src/ to get it back.',
        );
        return;
      }

      this.emitFile({
        type: 'asset',
        fileName: 'index.html',
        source: renderIndex(
          buildCases,
          'These are production bundles — the same build tachometer measures.',
        ),
      });
    },

    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url ?? '/').split('?')[0];
        if (url !== '/' && url !== '/index.html') {
          next();
          return;
        }
        try {
          const cases = await discoverCases({ harnessDir });
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(
            renderIndex(
              cases,
              "Pages are served from the working tree's build of the library. Rebuild it and reload to pick up a source change.",
            ),
          );
        } catch (error) {
          next(error);
        }
      });
    },
  };
}
