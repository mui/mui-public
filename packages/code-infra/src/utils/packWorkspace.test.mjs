import * as path from 'node:path';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';
import { makeTempDir } from './testUtils.mjs';
import {
  packRef,
  packWorkingTree,
  readFreshCache,
  tarballFor,
  tarballName,
} from './packWorkspace.mjs';

describe('tarballName', () => {
  it('flattens a scoped name into a filesystem-safe basename', () => {
    expect(tarballName('@base-ui/mosaic')).toBe('base-ui-mosaic.tgz');
  });

  it('leaves an unscoped name alone', () => {
    expect(tarballName('mosaic')).toBe('mosaic.tgz');
  });
});

describe('tarballFor', () => {
  const packages = [{ name: '@scope/one', version: '1.0.0', tarball: '/tmp/scope-one.tgz' }];

  it('finds a packed package by name', () => {
    expect(tarballFor(packages, '@scope/one')).toBe('/tmp/scope-one.tgz');
  });

  it('lists what was packed when a package is missing', () => {
    // A workspace dependency that was never packed is a packaging bug in the ref — usually a
    // private package a public one depends on — so the message has to name what is available.
    expect(() => tarballFor(packages, '@scope/two')).toThrow(
      'Package "@scope/two" was not packed. Packed: @scope/one.',
    );
  });

  it('says so when nothing was packed at all', () => {
    expect(() => tarballFor([], '@scope/two')).toThrow(/Packed: \(none\)\./);
  });
});

describe('readFreshCache', () => {
  /**
   * Writes a packed folder with a manifest and its tarballs.
   *
   * @param {Object} options - Folder contents
   * @param {string} options.buildCmd - The build command to record
   * @param {boolean} [options.withTarball] - Whether to actually create the tarball file
   * @returns {Promise<string>} The folder
   */
  async function makePackedDir({ buildCmd, withTarball = true }) {
    const dir = await makeTempDir();
    await writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        ref: 'HEAD',
        sha: 'abc',
        buildCmd,
        packages: [{ name: '@scope/one', version: '1.0.0', tarball: 'scope-one.tgz' }],
      }),
    );
    if (withTarball) {
      await writeFile(path.join(dir, 'scope-one.tgz'), 'tarball');
    }
    return dir;
  }

  it('returns the manifest when the folder matches the requested build', async () => {
    const dir = await makePackedDir({ buildCmd: 'pnpm release:build' });

    expect(await readFreshCache(dir, 'pnpm release:build')).toMatchObject({ sha: 'abc' });
  });

  it('misses when the folder was built with a different command', async () => {
    const dir = await makePackedDir({ buildCmd: 'pnpm build' });

    expect(await readFreshCache(dir, 'pnpm release:build')).toBeNull();
  });

  it('misses when a referenced tarball has been evicted', async () => {
    const dir = await makePackedDir({ buildCmd: 'pnpm release:build', withTarball: false });

    expect(await readFreshCache(dir, 'pnpm release:build')).toBeNull();
  });

  it('misses when there is no manifest', async () => {
    expect(await readFreshCache(await makeTempDir(), 'pnpm release:build')).toBeNull();
  });
});

/**
 * Creates a git repository holding a two-package pnpm workspace: one publishable, one private.
 *
 * The build command is a script that appends to `marker`, so a later assertion can tell whether a
 * build actually ran or the cache was reused.
 *
 * @returns {Promise<{ repoRoot: string, marker: string, buildCmd: string }>}
 */
async function makeFixtureRepo() {
  const repoRoot = await makeTempDir();
  const marker = path.join(repoRoot, 'builds.log');

  await writeFile(path.join(repoRoot, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
  await writeFile(
    path.join(repoRoot, 'package.json'),
    JSON.stringify({ name: 'fixture-root', private: true, version: '0.0.0' }, null, 2),
  );
  // Appends one line per real build; a cache hit must not add one.
  await writeFile(
    path.join(repoRoot, 'build.mjs'),
    "import { appendFileSync } from 'node:fs';\nappendFileSync(process.argv[2], 'built\\n');\n",
  );

  await Promise.all(
    [
      { dir: 'public', pkg: { name: '@fixture/public', version: '1.0.0' } },
      { dir: 'private', pkg: { name: '@fixture/private', version: '1.0.0', private: true } },
    ].map(async ({ dir, pkg }) => {
      const pkgDir = path.join(repoRoot, 'packages', dir);
      await mkdir(pkgDir, { recursive: true });
      await writeFile(path.join(pkgDir, 'package.json'), JSON.stringify(pkg, null, 2));
      await writeFile(path.join(pkgDir, 'index.js'), 'export default 1;\n');
    }),
  );

  await execa('git', ['init', '--initial-branch=main'], { cwd: repoRoot });
  await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: repoRoot });
  await execa('git', ['config', 'user.name', 'Fixture'], { cwd: repoRoot });
  await execa('git', ['add', '.'], { cwd: repoRoot });
  await execa('git', ['commit', '-m', 'initial'], { cwd: repoRoot });

  return { repoRoot, marker, buildCmd: `node build.mjs ${marker}` };
}

describe('packRef', () => {
  it(
    'packs only the publishable packages, and caches by commit',
    { timeout: 120_000 },
    async () => {
      const { repoRoot, marker, buildCmd } = await makeFixtureRepo();
      const outRoot = path.join(await makeTempDir(), 'cache');

      const packed = await packRef({ repoRoot, ref: 'HEAD', outRoot, installCmd: '', buildCmd });

      // The private package is never packed: a release would not publish it.
      expect(packed.packages.map((pkg) => pkg.name)).toEqual(['@fixture/public']);
      expect(packed.dir).toBe(path.join(outRoot, packed.sha));
      await expect(stat(packed.packages[0].tarball)).resolves.toBeTruthy();

      // Tarball names are stored relative to the folder, so a cache restored under a different
      // absolute path still resolves.
      const manifest = JSON.parse(await readFile(path.join(packed.dir, 'manifest.json'), 'utf8'));
      expect(manifest.packages).toEqual([
        { name: '@fixture/public', version: '1.0.0', tarball: 'fixture-public.tgz' },
      ]);
      expect(manifest.buildCmd).toBe(buildCmd);

      expect(await readFile(marker, 'utf8')).toBe('built\n');

      // The temporary checkout is cleaned up, leaving the tarballs as the only artifact.
      const worktrees = await execa('git', ['worktree', 'list'], { cwd: repoRoot });
      expect(worktrees.stdout.trim().split('\n')).toHaveLength(1);

      // A second call for the same commit reuses the folder and never builds again.
      const again = await packRef({ repoRoot, ref: 'HEAD', outRoot, installCmd: '', buildCmd });
      expect(again.sha).toBe(packed.sha);
      expect(await readFile(marker, 'utf8')).toBe('built\n');
    },
  );

  it(
    'rebuilds when the cached folder used a different build command',
    { timeout: 120_000 },
    async () => {
      const { repoRoot, marker, buildCmd } = await makeFixtureRepo();
      const outRoot = path.join(await makeTempDir(), 'cache');

      await packRef({ repoRoot, ref: 'HEAD', outRoot, installCmd: '', buildCmd });
      await packRef({
        repoRoot,
        ref: 'HEAD',
        outRoot,
        installCmd: '',
        buildCmd: `${buildCmd} --other`,
      });

      expect(await readFile(marker, 'utf8')).toBe('built\nbuilt\n');
    },
  );

  it('leaves no staging directory behind', { timeout: 120_000 }, async () => {
    const { repoRoot, buildCmd } = await makeFixtureRepo();
    const outRoot = path.join(await makeTempDir(), 'cache');

    const packed = await packRef({ repoRoot, ref: 'HEAD', outRoot, installCmd: '', buildCmd });

    // The folder is assembled in a staging sibling and atomically renamed, so an interrupted run
    // can never leave something that looks like a cache hit.
    expect(await readdir(outRoot)).toEqual([packed.sha]);
  });

  it('reports a ref it cannot resolve', async () => {
    const { repoRoot, buildCmd } = await makeFixtureRepo();
    const outRoot = path.join(await makeTempDir(), 'cache');

    await expect(
      packRef({ repoRoot, ref: 'no-such-ref', outRoot, installCmd: '', buildCmd }),
    ).rejects.toThrow(/Could not resolve git ref "no-such-ref"/);
  });
});

describe('packWorkingTree', () => {
  it('names each tarball by a hash of its content', { timeout: 120_000 }, async () => {
    const { repoRoot, buildCmd } = await makeFixtureRepo();
    const outRoot = path.join(await makeTempDir(), 'packed', 'current');

    const first = await packWorkingTree({ repoRoot, outRoot, buildCmd });
    const unchanged = await packWorkingTree({ repoRoot, outRoot, buildCmd });

    // An unchanged build keeps its filename, which is what lets a consumer's isolated install
    // persist: the dependency path does not move, so pnpm has nothing to do.
    expect(first.map((pkg) => pkg.tarball)).toEqual(unchanged.map((pkg) => pkg.tarball));
    expect(path.basename(first[0].tarball)).toMatch(/^fixture-public-[0-9a-f]{12}\.tgz$/);
    await expect(stat(first[0].tarball)).resolves.toBeTruthy();
  });

  it('renames when the packed content changes', { timeout: 120_000 }, async () => {
    const { repoRoot, buildCmd } = await makeFixtureRepo();
    const outRoot = path.join(await makeTempDir(), 'packed', 'current');

    const before = await packWorkingTree({ repoRoot, outRoot, buildCmd });
    await writeFile(path.join(repoRoot, 'packages', 'public', 'index.js'), 'export default 2;\n');
    const after = await packWorkingTree({ repoRoot, outRoot, buildCmd });

    expect(after[0].tarball).not.toBe(before[0].tarball);
    // The directory is replaced, so a stale tarball cannot accumulate or be resolved by mistake.
    expect(await readdir(outRoot)).toEqual([path.basename(after[0].tarball)]);
  });
});
