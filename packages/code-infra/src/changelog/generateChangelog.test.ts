import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Octokit } from '@octokit/rest';
import { execa } from 'execa';
import { expect, it, onTestFinished } from 'vitest';
// eslint-disable-next-line import/extensions
import { generateChangelog } from './index.mjs';
// eslint-disable-next-line import/extensions
import type { ChangelogConfig } from './index.mjs';

const OK = 200;
const NOT_FOUND = 404;

const componentConfig: ChangelogConfig = {
  format: { changelogMessage: '{{scope}}: {{message}} (#{{prNumber}}) @{{author}}' },
  categorization: {
    strategy: 'component',
    labels: { plan: { values: [] } },
    sections: { fallbackSection: 'Changes' },
  },
};

async function repository() {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'changelog-regression-'));
  onTestFinished(() => fs.rm(cwd, { recursive: true, force: true }));
  await fs.writeFile(path.join(cwd, 'package.json'), '{"version":"1.0.0"}');

  const git = (...args: string[]) =>
    execa('git', args, {
      cwd,
      env: { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
    });

  await git('init');
  await git('add', '.');
  await git(
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.com',
    'commit',
    '-m',
    'Initial',
  );

  return { cwd, sha: (await git('rev-parse', 'HEAD')).stdout };
}

it.each([undefined, 'HEAD'])('resolves local HEAD for release %s', async (release) => {
  const { cwd, sha } = await repository();
  const paths: string[] = [];

  const octokit = new Octokit({
    request: {
      fetch: async (input: Parameters<typeof fetch>[0]) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        paths.push(decodeURIComponent(url.pathname));

        return Object.defineProperty(
          Response.json({ url: url.href, total_commits: 0, commits: [] }, { status: OK }),
          'url',
          { value: url.href },
        );
      },
    },
  });

  await generateChangelog({
    cwd,
    repo: 'test',
    config: componentConfig,
    octokit,
    lastRelease: 'v0',
    release,
  });
  expect(paths).toEqual([`/repos/mui/test/compare/v0...${sha}`]);
});

it('resolves explicit CLI config paths from the process directory', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'changelog-cli-'));
  onTestFinished(() => fs.rm(cwd, { recursive: true, force: true }));
  const configPath = path.join(cwd, 'chosen.mjs');
  await fs.writeFile(
    configPath,
    'export default { format: {}, categorization: { strategy: "chosen-invalid-strategy" } }',
  );
  const target = path.join(cwd, 'target');
  await fs.mkdir(target);
  const commandUrl = new URL('../cli/cmdGenerateChangelog.mjs', import.meta.url).href;

  const result = await execa(process.execPath, ['--input-type=module'], {
    cwd,
    input: `import command from ${JSON.stringify(commandUrl)}; await command.handler({cwd: ${JSON.stringify(target)}, config: 'chosen.mjs'});`,
    reject: false,
  });

  expect(result.stderr).toContain('categorization.strategy must be');
});

it('explains a failed comparison against local HEAD without masking explicit refs', async () => {
  const { cwd } = await repository();

  const octokit = new Octokit({
    request: { fetch: async () => Response.json({ message: 'Not Found' }, { status: NOT_FOUND }) },
  });

  await expect(
    generateChangelog({ cwd, repo: 'test', config: componentConfig, octokit, lastRelease: 'v0' }),
  ).rejects.toThrow('Push HEAD or pass --release');
  await expect(
    generateChangelog({
      cwd,
      repo: 'test',
      config: componentConfig,
      octokit,
      lastRelease: 'v0',
      release: 'v1',
    }),
  ).rejects.toMatchObject({ status: NOT_FOUND });
});

it('renders a preset exported from the config path', async () => {
  const { cwd } = await repository();
  await fs.mkdir(path.join(cwd, 'scripts'));
  await fs.writeFile(
    path.join(cwd, 'scripts/changelog.config.mjs'),
    'export default { groom: (facts) => facts.version, view: (version) => "## " + version + "\\n" };',
  );

  const octokit = new Octokit({
    request: {
      fetch: async (input: Parameters<typeof fetch>[0]) => {
        const url = new URL(input instanceof Request ? input.url : String(input));

        return Object.defineProperty(
          Response.json({ url: url.href, total_commits: 0, commits: [] }, { status: OK }),
          'url',
          { value: url.href },
        );
      },
    },
  });

  const result = await generateChangelog({ cwd, repo: 'test', octokit, lastRelease: 'v0' });

  expect(result).toMatchObject({ markdown: '## 1.0.0\n', groomed: '1.0.0' });
});
