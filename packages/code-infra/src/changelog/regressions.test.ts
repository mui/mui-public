import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Octokit } from '@octokit/rest';
import { execa } from 'execa';
import { expect, it, onTestFinished, vi } from 'vitest';
// eslint-disable-next-line import/extensions
import { generateChangelog, fetchCommitsBetweenRefs } from './index.mjs';
import type { ChangelogConfig } from './types';

const OK = 200;
const NO_CONTENT = 204;
const NOT_FOUND = 404;
const FORBIDDEN = 403;
const DATE = '2026-10-01T00:00:00Z';
const config: ChangelogConfig = {
  format: { changelogMessage: '{{scope}}: {{message}} (#{{prNumber}}) @{{author}}' },
  categorization: {
    strategy: 'flat',
    labels: {
      titleMappings: { Grid: ['scope: grid'] },
      categoryOverrides: { internal: 'Core' },
    },
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

it('renders title scopes and one flat list despite category overrides', async () => {
  const { cwd } = await repository();
  const octokit = new Octokit({
    request: {
      fetch: async (input: Parameters<typeof fetch>[0]) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const number = Number(url.pathname.split('/').at(-1));
        const data = url.pathname.includes('/compare/')
          ? {
              url: url.href,
              total_commits: 2,
              commits: [1, 2].map((n) => ({
                sha: String(n),
                commit: { message: `[Grid] Change ${n} (#${n})` },
              })),
            }
          : {
              title: `[Grid] Change ${number}`,
              labels: number === 1 ? [{ name: 'internal' }] : [],
              user: { login: 'author' },
              author_association: 'MEMBER',
              merged_at: DATE,
              created_at: DATE,
              body: '',
              html_url: url.href,
            };
        return Object.defineProperty(Response.json(data, { status: OK }), 'url', {
          value: url.href,
        });
      },
    },
  });
  const result = await generateChangelog({
    cwd,
    repo: 'test',
    config,
    octokit,
    lastRelease: 'v0',
    release: 'v1',
  });
  expect(result.markdown).toContain('grid: Change 2 (#2) @author');
  expect(result.sections).toHaveLength(1);
  expect(result.sections[0].commits).toHaveLength(2);
});

it('renders direct commit links with the documented message template', async () => {
  const { cwd } = await repository();
  const octokit = new Octokit({
    request: {
      fetch: async (input: Parameters<typeof fetch>[0]) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const data = {
          url: url.href,
          total_commits: 1,
          commits: [
            {
              sha: 'abcdef123456',
              html_url: 'https://github.com/mui/test/commit/abcdef123456',
              author: null,
              commit: { message: 'Direct change' },
            },
          ],
        };
        return Object.defineProperty(Response.json(data, { status: OK }), 'url', {
          value: url.href,
        });
      },
    },
  });
  const result = await generateChangelog({
    cwd,
    repo: 'test',
    config: {
      ...config,
      format: { changelogMessage: '{{message}} (#[{{prNumber}}]({{prUrl}}) by @{{author}})' },
    },
    octokit,
    lastRelease: 'v0',
    release: 'v1',
  });
  expect(result.markdown).toContain(
    'Direct change ([abcdef1](https://github.com/mui/test/commit/abcdef123456) by @unknown)',
  );
});

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
  await generateChangelog({ cwd, repo: 'test', config, octokit, lastRelease: 'v0', release });
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

it('omits merge bookkeeping and PR children without dropping mainline direct changes', async () => {
  const commits = [
    {
      sha: 'base',
      parents: [{ sha: 'outside' }],
      commit: { message: 'Direct mainline change' },
      author: null,
    },
    {
      sha: 'child',
      parents: [{ sha: 'outside' }],
      commit: { message: 'PR implementation' },
      author: null,
    },
    {
      sha: 'sync',
      parents: [{ sha: 'child' }, { sha: 'base' }],
      commit: { message: "Merge branch 'master' into feature" },
      author: null,
    },
    {
      sha: 'merge',
      parents: [{ sha: 'base' }, { sha: 'sync' }],
      commit: { message: 'Merge pull request #1 from feature' },
      author: null,
    },
    {
      sha: 'branch-change',
      parents: [{ sha: 'outside' }],
      commit: { message: 'Direct side-branch change' },
      author: null,
    },
    {
      sha: 'manual',
      parents: [{ sha: 'merge' }, { sha: 'branch-change' }],
      commit: { message: "Merge branch 'master' into v9.x" },
      author: null,
    },
    {
      sha: 'unresolved-child',
      parents: [{ sha: 'manual' }],
      commit: { message: 'Unresolved branch change' },
      author: null,
    },
    {
      sha: 'unresolved',
      parents: [{ sha: 'manual' }, { sha: 'unresolved-child' }],
      commit: { message: 'Merge pull request #999 from feature' },
      author: null,
    },
  ];
  const octokit = new Octokit({
    request: {
      fetch: async (input: Parameters<typeof fetch>[0]) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.pathname.endsWith('/999')) {
          return Response.json({ message: 'Not Found' }, { status: NOT_FOUND });
        }
        const data = url.pathname.includes('/compare/')
          ? { url: url.href, total_commits: commits.length, commits }
          : {
              title: '[Grid] Actual PR change',
              body: '',
              labels: [],
              user: { login: 'author' },
              author_association: 'MEMBER',
              merged_at: DATE,
              created_at: DATE,
              html_url: url.href,
            };
        return Object.defineProperty(Response.json(data, { status: OK }), 'url', {
          value: url.href,
        });
      },
    },
  });
  const result = await fetchCommitsBetweenRefs({
    octokit,
    repo: 'test',
    lastRelease: 'v0',
    release: 'v1',
  });
  expect(result.map((commit) => commit.sha)).toEqual([
    'base',
    'merge',
    'branch-change',
    'unresolved-child',
  ]);
  expect(result.find((commit) => commit.prNumber === 1)?.message).toBe(
    '[Grid] Actual PR change (#1)',
  );
});

it('classifies direct authors using organization membership', async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  onTestFinished(() => warning.mockRestore());
  const octokit = new Octokit({
    request: {
      fetch: async (input: Parameters<typeof fetch>[0]) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.pathname.includes('/members/')) {
          return url.pathname.endsWith('/team-member')
            ? new Response(null, { status: NO_CONTENT })
            : Response.json(
                { message: 'Not Found' },
                { status: url.pathname.endsWith('/restricted') ? FORBIDDEN : NOT_FOUND },
              );
        }
        const data = {
          url: url.href,
          total_commits: 3,
          commits: ['team-member', 'community-member', 'restricted'].map((login) => ({
            sha: login,
            author: { login },
            commit: { message: 'Direct change' },
          })),
        };
        return Object.defineProperty(Response.json(data, { status: OK }), 'url', {
          value: url.href,
        });
      },
    },
  });
  const result = await fetchCommitsBetweenRefs({
    octokit,
    repo: 'test',
    lastRelease: 'v0',
    release: 'v1',
  });
  expect(result.map((commit) => commit.author)).toEqual([
    { login: 'team-member', association: 'team' },
    { login: 'community-member', association: 'contributor' },
    { login: 'restricted', association: 'contributor' },
  ]);
  expect(warning).toHaveBeenCalledWith(
    expect.stringContaining('Cannot check membership for @restricted'),
  );
});

it('cleans human cherry-pick suffixes without changing attribution', async () => {
  const octokit = new Octokit({
    request: {
      fetch: async (input: Parameters<typeof fetch>[0]) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const data = url.pathname.includes('/compare/')
          ? {
              url: url.href,
              total_commits: 1,
              commits: [
                { sha: 'human-backport', commit: { message: 'Fix behavior (@original) (#1)' } },
              ],
            }
          : {
              title: 'Fix behavior (@original)',
              body: '',
              labels: [{ name: 'cherry-pick' }],
              user: { login: 'human' },
              author_association: 'MEMBER',
              created_at: DATE,
              merged_at: DATE,
              html_url: url.href,
            };
        return Object.defineProperty(Response.json(data, { status: OK }), 'url', {
          value: url.href,
        });
      },
    },
  });
  const [result] = await fetchCommitsBetweenRefs({
    octokit,
    repo: 'test',
    lastRelease: 'v0',
    release: 'v1',
  });
  expect(result.author?.login).toBe('human');
  expect(result.message).toBe('Fix behavior (#1)');
});

it('warns when unchanged-package comparison lacks a local base ref', async () => {
  const { cwd } = await repository();
  await fs.writeFile(path.join(cwd, 'pnpm-workspace.yaml'), "packages: ['packages/*']");
  const directory = path.join(cwd, 'packages/widget');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, 'package.json'),
    '{"name":"@test/widget","version":"1.0.0"}',
  );
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  onTestFinished(() => warning.mockRestore());
  const octokit = new Octokit({
    request: {
      fetch: async (input: Parameters<typeof fetch>[0]) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        return Object.defineProperty(
          Response.json({ url: url.href, commits: [], total_commits: 0 }, { status: OK }),
          'url',
          { value: url.href },
        );
      },
    },
  });
  const result = await generateChangelog({
    cwd,
    repo: 'test',
    octokit,
    lastRelease: 'remote-only',
    release: 'v1',
    config: {
      ...config,
      categorization: {
        ...config.categorization,
        strategy: 'package',
        packageNaming: { omitUnchanged: true, mappings: { widget: '@test/widget' } },
      },
    },
  });
  expect(result.markdown).toContain('@test/widget@1.0.0');
  expect(warning).toHaveBeenCalledWith(
    expect.stringContaining('Cannot compare package versions against remote-only'),
  );
});
