import * as path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { discoverCases, pagesOf } from './discoverCases.mjs';
import { OUTPUT_DIR } from './outputDir.mjs';

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

/**
 * @typedef {Object} TachometerPluginOptions
 * @property {string} [harnessDir] - The harness package directory. Defaults to the current working directory, which is where vite is run from
 */

/**
 * Checks that the workspace packages the harness links to have actually been built.
 *
 * A harness depends on the library under test via `workspace:*`, and `publishConfig.directory`
 * makes that link point at the package's build output — which does not exist until the library is
 * built. The symlink is then dangling, and vite's failure ("failed to resolve import") does not
 * say why.
 *
 * @param {string} harnessDir - The harness package directory
 * @param {Record<string, string>} deps - The harness's combined dependency map
 * @returns {Promise<void>}
 */
async function assertWorkspaceDepsBuilt(harnessDir, deps) {
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
 * Renders the dev-server index: one link per case, carrying whatever query the case parameterises
 * its page with.
 *
 * @param {import('./discoverCases.mjs').BenchmarkCase[]} cases - Discovered cases
 * @returns {string} An HTML document
 */
function renderIndex(cases) {
  const items = cases
    .map((entry) => {
      // A case's variants can point at several pages (a cross-library comparison) or at one page
      // with different queries (a parameterised case), so dedupe on the pair.
      const targets = [...new Set(entry.leaves.map((leaf) => `${leaf.page}${leaf.suffix}`))].sort();
      const links = targets
        .map((target) => `<li><a href="/${target}"><code>${target}</code></a></li>`)
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
    <p>Pages are served from the working tree's build of the library. Rebuild it and reload to pick up a source change.</p>
    <ul>
${items}
    </ul>
  </body>
</html>
`;
}

/**
 * Creates the tachometer harness plugin.
 *
 * @param {TachometerPluginOptions} [options] - Plugin options
 * @returns {import('vite').Plugin}
 */
export function tachometer(options = {}) {
  const harnessDir = options.harnessDir ?? process.cwd();
  const srcDir = path.join(harnessDir, 'src');

  return {
    name: 'mui-code-infra:tachometer',

    async config(userConfig, env) {
      const pkg = JSON.parse(await readFile(path.join(harnessDir, 'package.json'), 'utf8'));
      await assertWorkspaceDepsBuilt(harnessDir, {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      });

      if (env.command !== 'build') {
        return { root: srcDir, appType: 'mpa' };
      }

      const cases = await discoverCases({ harnessDir });
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
          // A plain `vite build` lands in the run output directory, next to the per-ref
          // directories the runner writes. Without this it would default to `<root>/dist` — inside
          // `src/`, next to the case sources.
          //
          // Only fill it in when the caller said nothing: a plugin's returned config is merged
          // *over* the inline config, so unconditionally setting it here would silently override
          // `vite build --outDir`, which is exactly how `tacho run` directs each ref's build.
          outDir: userConfig.build?.outDir ?? path.join(harnessDir, OUTPUT_DIR, 'builds', 'manual'),
          // The output directory is outside `root` — and, for an isolated ref build, outside the
          // temporary package entirely; allow vite to clean it anyway.
          emptyOutDir: true,
          chunkSizeWarningLimit: 9999,
          rollupOptions: { input },
        },
      };
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
          res.end(renderIndex(cases));
        } catch (error) {
          next(error);
        }
      });
    },
  };
}
