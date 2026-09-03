import * as path from 'node:path';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { makeTempDir } from '../utils/testUtils.mjs';
import { tachometer } from './plugin.mjs';

/**
 * Builds a throwaway harness with a package.json, so the plugin can read its dependencies.
 *
 * @param {Object} options - Harness contents
 * @param {Record<string, { config: any, pages?: string[] }>} options.cases - Case folders to create
 * @param {Record<string, string>} [options.dependencies] - The harness's dependencies
 * @returns {Promise<string>} The harness directory
 */
async function makeHarness({ cases, dependencies = {} }) {
  const harnessDir = await makeTempDir();
  await writeFile(
    path.join(harnessDir, 'package.json'),
    JSON.stringify({ name: 'harness', private: true, dependencies }, null, 2),
  );
  await Promise.all(
    Object.entries(cases).map(async ([name, { config, pages = [] }]) => {
      const caseDir = path.join(harnessDir, 'src', name);
      await mkdir(caseDir, { recursive: true });
      await writeFile(path.join(caseDir, 'tachometer.json'), JSON.stringify(config, null, 2));
      await Promise.all(
        pages.map((page) => writeFile(path.join(caseDir, page), '<!doctype html>\n')),
      );
    }),
  );
  return harnessDir;
}

/**
 * Invokes the plugin's `config` hook.
 *
 * @param {string} harnessDir - The harness directory
 * @param {'build' | 'serve'} command - Which vite command is running
 * @returns {Promise<any>}
 */
async function callConfig(harnessDir, command, userConfig = {}) {
  const plugin = tachometer({ harnessDir });
  const hook = /** @type {any} */ (plugin.config);
  return hook(userConfig, { command, mode: command === 'build' ? 'production' : 'development' });
}

const oneCase = {
  alpha: {
    config: { benchmarks: [{ name: 'alpha', url: './index.html' }] },
    pages: ['index.html'],
  },
};

describe('tachometer plugin', () => {
  describe('config hook', () => {
    it('roots the app at src and declares it multi-page', async () => {
      const harnessDir = await makeHarness({ cases: oneCase });

      const config = await callConfig(harnessDir, 'serve');

      expect(config.root).toBe(path.join(harnessDir, 'src'));
      // Vite defaults to 'spa', whose fallback rewrites unmatched urls toward a root index.html
      // that does not exist in this harness.
      expect(config.appType).toBe('mpa');
    });

    it('derives no build input while serving', async () => {
      const harnessDir = await makeHarness({ cases: oneCase });

      const config = await callConfig(harnessDir, 'serve');

      expect(config.build).toBeUndefined();
    });

    it('uses relative asset urls for a build', async () => {
      // Tachometer serves the build directory and pages live under <outDir>/<case>/, so absolute
      // "/assets/…" paths would 404.
      const harnessDir = await makeHarness({ cases: oneCase });

      const config = await callConfig(harnessDir, 'build');

      expect(config.base).toBe('./');
    });

    it('defaults the output directory to the run output folder, outside the source root', async () => {
      // Vite would otherwise emit into <root>/dist, i.e. inside src/ next to the case sources.
      const harnessDir = await makeHarness({ cases: oneCase });

      const config = await callConfig(harnessDir, 'build');

      expect(config.build.outDir).toBe(path.join(harnessDir, '.tachometer', 'builds', 'manual'));
    });

    it('leaves an output directory the caller chose alone', async () => {
      // A plugin's returned config is merged *over* the inline config, so defaulting this
      // unconditionally would silently override `vite build --outDir` — which is how `tacho run`
      // directs each ref's build into its own directory.
      const harnessDir = await makeHarness({ cases: oneCase });

      const config = await callConfig(harnessDir, 'build', {
        build: { outDir: '/somewhere/builds/current' },
      });

      expect(config.build.outDir).toBe('/somewhere/builds/current');
    });

    it('derives the build input from the discovered cases', async () => {
      const harnessDir = await makeHarness({ cases: oneCase });

      const config = await callConfig(harnessDir, 'build');

      expect(config.build.rollupOptions.input).toEqual({
        'alpha/index': path.join(harnessDir, 'src', 'alpha', 'index.html'),
      });
    });

    it('keys several pages in one case folder separately', async () => {
      // A distinct key per page is what stops a cross-library case's two pages colliding into one
      // entry.
      const harnessDir = await makeHarness({
        cases: {
          libs: {
            config: {
              benchmarks: [
                {
                  name: 'libs',
                  expand: [
                    { name: 'libs [ours]', url: './ours.html' },
                    { name: 'libs [theirs]', url: './theirs.html' },
                  ],
                },
              ],
            },
            pages: ['ours.html', 'theirs.html'],
          },
        },
      });

      const config = await callConfig(harnessDir, 'build');

      expect(Object.keys(config.build.rollupOptions.input).sort()).toEqual([
        'libs/ours',
        'libs/theirs',
      ]);
    });
  });

  describe('workspace link check', () => {
    it('passes when the harness links to nothing', async () => {
      const harnessDir = await makeHarness({ cases: oneCase });

      await expect(callConfig(harnessDir, 'serve')).resolves.toBeTruthy();
    });

    it('explains that the library has to be built when its link dangles', async () => {
      // A harness resolves the library through its build output, so before the first build the
      // link points at a directory that does not exist yet.
      const harnessDir = await makeHarness({
        cases: oneCase,
        dependencies: { '@scope/library': 'workspace:*' },
      });
      await mkdir(path.join(harnessDir, 'node_modules', '@scope'), { recursive: true });
      await symlink(
        path.join(harnessDir, 'packages', 'library', 'build'),
        path.join(harnessDir, 'node_modules', '@scope', 'library'),
      );

      await expect(callConfig(harnessDir, 'serve')).rejects.toThrow(
        /"@scope\/library" is linked into .* but its target does not exist/,
      );
    });
  });
});
