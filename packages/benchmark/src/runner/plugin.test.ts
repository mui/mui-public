import * as path from 'node:path';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { makeTempDir } from '../utils/testUtils';
import { benchmarkPlugin } from './plugin';

/** Builds a throwaway harness with a package.json, so the plugin can read its dependencies. */
async function makeHarness({
  benchFiles = ['button/button.bench.tsx'],
  dependencies = {},
}: {
  benchFiles?: string[];
  dependencies?: Record<string, string>;
} = {}): Promise<string> {
  const harnessDir = await makeTempDir();
  await writeFile(
    path.join(harnessDir, 'package.json'),
    JSON.stringify({ name: 'harness', private: true, dependencies }, null, 2),
  );
  await Promise.all(
    benchFiles.map(async (file) => {
      const absolute = path.join(harnessDir, 'src', file);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, '');
    }),
  );
  return harnessDir;
}

/** Invokes the plugin's `config` hook. */
async function callConfig(
  harnessDir: string,
  command: 'build' | 'serve',
  userConfig: any = {},
): Promise<any> {
  const plugin = benchmarkPlugin({ harnessDir });
  const hook = plugin.config as any;
  return hook(userConfig, { command, mode: command === 'build' ? 'production' : 'development' });
}

describe('benchmarkPlugin', () => {
  describe('config hook', () => {
    it('roots the app at src and declares it multi-page', async () => {
      const harnessDir = await makeHarness();

      const config = await callConfig(harnessDir, 'serve');

      expect(config.root).toBe(path.join(harnessDir, 'src'));
      // Vite defaults to 'spa', whose fallback rewrites unmatched urls toward a root index.html
      // that does not exist in this harness.
      expect(config.appType).toBe('mpa');
    });

    it('derives no build input while serving', async () => {
      const harnessDir = await makeHarness();

      const config = await callConfig(harnessDir, 'serve');

      expect(config.build?.rolldownOptions).toBeUndefined();
    });

    it('points serving at the output directory too, so preview finds the built pages', async () => {
      // `vite preview` runs as `serve` but serves `build.outDir`. Leaving it unset there sends
      // preview to `<root>/dist` — inside `src/` — and it exits instead of serving the build.
      const harnessDir = await makeHarness();

      const config = await callConfig(harnessDir, 'serve');

      expect(config.build?.outDir).toBe(path.join(harnessDir, '.benchmark', 'builds', 'manual'));
    });

    it('uses relative asset urls for a build', async () => {
      // The runner serves each ref's build under its own path, so absolute "/assets/…" paths
      // would 404.
      const harnessDir = await makeHarness();

      const config = await callConfig(harnessDir, 'build');

      expect(config.base).toBe('./');
    });

    it('leaves an output directory the caller chose alone', async () => {
      // A plugin's returned config is merged *over* the inline config, so defaulting this
      // unconditionally would silently override `vite build --outDir` — which is how
      // the `benchmark` CLI directs each ref's build into its own directory.
      const harnessDir = await makeHarness();

      const config = await callConfig(harnessDir, 'build', {
        build: { outDir: '/somewhere/builds/current' },
      });

      expect(config.build.outDir).toBe('/somewhere/builds/current');
    });

    it('builds a generated page per benchmark file', async () => {
      const harnessDir = await makeHarness({
        benchFiles: ['button/button.bench.tsx', 'grid/grid.bench.tsx'],
      });

      const config = await callConfig(harnessDir, 'build');

      expect(config.build.rolldownOptions.input).toEqual({
        '__bench__/button-button': path.join(harnessDir, 'src', '__bench__', 'button-button.html'),
        '__bench__/grid-grid': path.join(harnessDir, 'src', '__bench__', 'grid-grid.html'),
      });
    });

    it('refuses a harness without benchmark files', async () => {
      const harnessDir = await makeHarness({ benchFiles: [] });

      await expect(callConfig(harnessDir, 'build')).rejects.toThrow(/No \*\.bench\.tsx file/);
    });
  });

  describe('workspace link check', () => {
    it('passes when the harness links to nothing', async () => {
      const harnessDir = await makeHarness();

      await expect(callConfig(harnessDir, 'serve')).resolves.toBeTruthy();
    });

    it('explains that the library has to be built when its link dangles', async () => {
      // A harness resolves the library through its build output, so before the first build the
      // link points at a directory that does not exist yet.
      const harnessDir = await makeHarness({ dependencies: { '@scope/library': 'workspace:*' } });
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
