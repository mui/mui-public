import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

import { readPackageJson } from '../utils/pnpm.mjs';
import { createTestRegistry, makeTempDir, writePackage } from '../utils/testUtils.mjs';

const CLI_PATH = fileURLToPath(new URL('../../bin/code-infra.mjs', import.meta.url));

/**
 * Create a real workspace with registry credentials and a local release tag.
 * @param {Awaited<ReturnType<typeof createTestRegistry>>} registry
 * @param {Record<string, string>} versions
 */
async function createPublishWorkspace(registry, versions) {
  const root = await makeTempDir();
  const { packageManager } = await readPackageJson(
    fileURLToPath(new URL('../../../../', import.meta.url)),
  );
  await writePackage(root, '.', {
    name: 'test-workspace',
    version: '1.0.0',
    private: true,
    packageManager,
  });
  await fs.writeFile(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
  await fs.writeFile(
    path.join(root, '.npmrc'),
    `registry=${registry.url}\n${registry.url.slice('http:'.length)}:_authToken=${registry.token}\n`,
  );
  await Promise.all(
    Object.entries(versions).map(([name, version], index) =>
      writePackage(root, `packages/package-${index}`, {
        name,
        version,
        publishConfig: { registry: registry.url },
      }),
    ),
  );
  // The command checks for an existing release tag after publishing. Keep that
  // check local, and do not require the developer's signing key for the fixture.
  await execa('git', ['init'], { cwd: root });
  await execa(
    'git',
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.com',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--allow-empty',
      '-m',
      'fixture',
    ],
    { cwd: root },
  );
  await execa('git', ['-c', 'tag.gpgsign=false', 'tag', 'v1.0.0'], { cwd: root });
  await execa('git', ['remote', 'add', 'origin', root], { cwd: root });
  return root;
}

/**
 * Invoke the actual CLI and pnpm publisher against the fixture's local registry.
 * @param {string} cwd
 * @param {string[]} [args]
 * @param {NodeJS.ProcessEnv} [env]
 */
function publish(cwd, args = [], env = {}) {
  return execa(process.execPath, [CLI_PATH, 'publish', '--ci', ...args], {
    cwd,
    env,
    reject: false,
  });
}

describe('publish', () => {
  it('rejects a conflicting default latest release before publishing any package', async () => {
    const registry = await createTestRegistry({
      '@scope/first': { tags: { latest: '2.0.0' } },
      '@scope/legacy': { tags: { latest: '2.0.0' } },
    });
    const root = await createPublishWorkspace(registry, {
      '@scope/first': '2.1.0',
      '@scope/legacy': '1.1.0',
    });

    const result = await publish(root);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('wrong release line');
    expect(result.stderr).toContain(
      '@scope/legacy: "latest" can only move to a newer version, but 1.1.0 is lower than the current 2.0.0',
    );
    expect(registry.published).toEqual([]);
  });

  it.each(['next', 'latest-v2'])(
    'rejects a conflicting %s release before publishing any package',
    async (tag) => {
      const registry = await createTestRegistry({
        '@scope/first': { tags: { latest: '2.0.0', [tag]: '2.4.0' } },
        '@scope/second': { tags: { latest: '2.0.0', [tag]: '2.4.0' } },
      });
      const root = await createPublishWorkspace(registry, {
        '@scope/first': '2.5.0',
        '@scope/second': '2.3.0',
      });

      const result = await publish(root, ['--tag', tag]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain(`Publishing with the "${tag}" dist-tag`);
      expect(result.stderr).toContain(
        `@scope/second: "${tag}" can only move to a newer version, but 2.3.0 is lower than the current 2.4.0`,
      );
      expect(registry.published).toEqual([]);
    },
  );

  it('publishes an older release with an explicit legacy tag', async () => {
    const registry = await createTestRegistry(
      { '@scope/example': { tags: { latest: '2.0.0' } } },
      { authenticate: 'bearer' },
    );
    const root = await createPublishWorkspace(registry, { '@scope/example': '1.1.0' });

    const result = await publish(root, ['--tag', 'latest-v1']);

    expect(result).toMatchObject({ exitCode: 0 });
    expect(registry.published).toEqual([
      { name: '@scope/example', tags: { 'latest-v1': '1.1.0' } },
    ]);
  });

  it('publishes a newer latest release using configured registry credentials', async () => {
    const registry = await createTestRegistry(
      { '@scope/example': { tags: { latest: '2.0.0' } } },
      { authenticate: 'bearer' },
    );
    const root = await createPublishWorkspace(registry, { '@scope/example': '2.1.0' });

    const result = await publish(root);

    expect(result).toMatchObject({ exitCode: 0 });
    expect(registry.published).toEqual([{ name: '@scope/example', tags: { latest: '2.1.0' } }]);
  });

  it.each([
    {
      action: 'publishes a newer release',
      version: '2.1.0',
      published: true,
      expectedResult: { exitCode: 0 },
    },
    {
      action: 'rejects an unpublished downgrade',
      version: '1.1.0',
      published: false,
      expectedResult: {
        exitCode: 1,
        stderr: expect.stringContaining(
          '@scope/example: "latest" can only move to a newer version, but 1.1.0 is lower than the current 2.0.0',
        ),
      },
    },
    {
      action: 'skips an already-published older release',
      version: '1.0.0',
      published: false,
      expectedResult: { exitCode: 0 },
    },
  ])(
    '$action using user-level Basic credentials and a build directory',
    async ({ version, published, expectedResult }) => {
      const registry = await createTestRegistry(
        { '@scope/example': { tags: { latest: '2.0.0' }, versions: ['1.0.0', '2.0.0'] } },
        { authenticate: 'basic' },
      );
      const defaultRegistry = await createTestRegistry({});
      const root = await createPublishWorkspace(registry, { '@scope/example': version });
      await fs.rm(path.join(root, '.npmrc'));
      const userConfig = path.join(await makeTempDir(), '.npmrc');
      await fs.writeFile(
        userConfig,
        `registry=${defaultRegistry.url}\n@scope:registry=${registry.url}\n${registry.url.slice('http:'.length)}:_auth=${registry.token}\n`,
      );
      const packageJson = await readPackageJson(path.join(root, 'packages/package-0'));
      await writePackage(root, 'packages/package-0/build', packageJson);
      await writePackage(root, 'packages/package-0', {
        ...packageJson,
        publishConfig: { ...packageJson.publishConfig, directory: 'build' },
      });

      const result = await publish(root, [], {
        NPM_CONFIG_USERCONFIG: userConfig,
        npm_config_userconfig: undefined,
        npm_config_registry: defaultRegistry.url,
        // The fixture registry cannot serve pnpm's own bootstrap package.
        PNPM_CONFIG_PM_ON_FAIL: 'ignore',
      });

      expect(result).toMatchObject(expectedResult);
      expect(registry.published).toEqual(
        published ? [{ name: '@scope/example', tags: { latest: version } }] : [],
      );
      expect(defaultRegistry.published).toEqual([]);
    },
  );
});
