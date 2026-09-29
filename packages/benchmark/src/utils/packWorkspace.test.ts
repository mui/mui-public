import * as path from 'node:path';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';
import { makeTempDir } from './testUtils';
import { packRef, packWorkingTree } from './packWorkspace';

interface FixturePackage {
  dir: string;
  pkg: { name: string; version: string; private?: boolean };
}

const DEFAULT_PACKAGES: FixturePackage[] = [
  { dir: 'public', pkg: { name: '@fixture/public', version: '1.0.0' } },
  { dir: 'private', pkg: { name: '@fixture/private', version: '1.0.0', private: true } },
];

/**
 * Creates a git repository holding a pnpm workspace of `packages` — by default one publishable and
 * one private.
 *
 * The build command is a script that appends to `marker`, so a later assertion can tell whether a
 * build actually ran or the cache was reused.
 */
async function makeFixtureRepo(packages: FixturePackage[] = DEFAULT_PACKAGES) {
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
    packages.map(async ({ dir, pkg }) => {
      const pkgDir = path.join(repoRoot, 'packages', dir);
      await mkdir(pkgDir, { recursive: true });
      await writeFile(path.join(pkgDir, 'package.json'), JSON.stringify(pkg, null, 2));
      await writeFile(
        path.join(pkgDir, 'index.js'),
        `export default ${JSON.stringify(pkg.name)};\n`,
      );
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
      expect(packed.map((pkg) => pkg.name)).toEqual(['@fixture/public']);
      await expect(stat(packed[0].tarball)).resolves.toBeTruthy();
      expect(await readFile(marker, 'utf8')).toBe('built\n');

      // The temporary checkout is cleaned up, leaving the tarballs as the only artifact.
      const worktrees = await execa('git', ['worktree', 'list'], { cwd: repoRoot });
      expect(worktrees.stdout.trim().split('\n')).toHaveLength(1);

      // A second call for the same commit reuses the folder and never builds again.
      const again = await packRef({ repoRoot, ref: 'HEAD', outRoot, installCmd: '', buildCmd });
      expect(again).toEqual(packed);
      expect(await readFile(marker, 'utf8')).toBe('built\n');
    },
  );

  it(
    'reuses a cache restored under a different path, as a CI cache is',
    { timeout: 120_000 },
    async () => {
      const { repoRoot, marker, buildCmd } = await makeFixtureRepo();
      const outRoot = path.join(await makeTempDir(), 'cache');
      await packRef({ repoRoot, ref: 'HEAD', outRoot, installCmd: '', buildCmd });

      const restoredRoot = path.join(await makeTempDir(), 'restored');
      await rename(outRoot, restoredRoot);
      const restored = await packRef({
        repoRoot,
        ref: 'HEAD',
        outRoot: restoredRoot,
        installCmd: '',
        buildCmd,
      });

      expect(await readFile(marker, 'utf8')).toBe('built\n');
      expect(restored[0].tarball.startsWith(restoredRoot)).toBe(true);
      await expect(stat(restored[0].tarball)).resolves.toBeTruthy();
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

  it('rebuilds when a cached tarball has gone missing', { timeout: 120_000 }, async () => {
    const { repoRoot, marker, buildCmd } = await makeFixtureRepo();
    const outRoot = path.join(await makeTempDir(), 'cache');

    const packed = await packRef({ repoRoot, ref: 'HEAD', outRoot, installCmd: '', buildCmd });
    await rm(packed[0].tarball);
    const again = await packRef({ repoRoot, ref: 'HEAD', outRoot, installCmd: '', buildCmd });

    expect(await readFile(marker, 'utf8')).toBe('built\nbuilt\n');
    await expect(stat(again[0].tarball)).resolves.toBeTruthy();
  });

  it('leaves no staging directory behind', { timeout: 120_000 }, async () => {
    const { repoRoot, buildCmd } = await makeFixtureRepo();
    const outRoot = path.join(await makeTempDir(), 'cache');

    await packRef({ repoRoot, ref: 'HEAD', outRoot, installCmd: '', buildCmd });
    const { stdout: sha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: repoRoot });

    // The folder is assembled in a staging sibling and atomically renamed, so an interrupted run
    // can never leave something that looks like a cache hit.
    expect(await readdir(outRoot)).toEqual([sha.trim()]);
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
  it('keeps a tarball path until its content changes', { timeout: 120_000 }, async () => {
    const { repoRoot, buildCmd } = await makeFixtureRepo();
    const outRoot = path.join(await makeTempDir(), 'packed', 'current');

    const first = await packWorkingTree({ repoRoot, outRoot, buildCmd });
    const unchanged = await packWorkingTree({ repoRoot, outRoot, buildCmd });

    // An unchanged build keeps its path, so an install that depends on it has nothing to redo.
    expect(unchanged.map((pkg) => pkg.tarball)).toEqual(first.map((pkg) => pkg.tarball));
    await expect(stat(first[0].tarball)).resolves.toBeTruthy();

    await writeFile(path.join(repoRoot, 'packages', 'public', 'index.js'), 'export default 2;\n');
    const changed = await packWorkingTree({ repoRoot, outRoot, buildCmd });

    expect(changed[0].tarball).not.toBe(first[0].tarball);
    // The directory is replaced, so a stale tarball cannot accumulate or be resolved by mistake.
    expect(await readdir(outRoot)).toEqual([path.basename(changed[0].tarball)]);
  });

  it(
    'packs packages whose names only differ in their scope separately',
    { timeout: 120_000 },
    async () => {
      const { repoRoot, buildCmd } = await makeFixtureRepo([
        { dir: 'scoped', pkg: { name: '@mui/package', version: '1.0.0' } },
        { dir: 'unscoped', pkg: { name: 'mui-package', version: '1.0.0' } },
      ]);
      const outRoot = path.join(await makeTempDir(), 'packed', 'current');

      const packed = await packWorkingTree({ repoRoot, outRoot, buildCmd });

      expect(packed.map((pkg) => pkg.name).sort()).toEqual(['@mui/package', 'mui-package']);
      expect(new Set(packed.map((pkg) => pkg.tarball)).size).toBe(2);
      await Promise.all(packed.map((pkg) => expect(stat(pkg.tarball)).resolves.toBeTruthy()));
    },
  );
});
