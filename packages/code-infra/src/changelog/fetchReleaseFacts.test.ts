import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Octokit } from '@octokit/rest';
import { execa } from 'execa';
import { expect, it, onTestFinished } from 'vitest';
// eslint-disable-next-line import/extensions
import { fetchReleaseFacts } from './index.mjs';

const OK = 200;

interface Manifest {
  name: string;
  version: string;
  private?: boolean;
}

/** Serves JSON bodies by request path. */
function octokit(responses: Record<string, string>) {
  return new Octokit({
    request: {
      fetch: async (input: Parameters<typeof fetch>[0]) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const body: string | undefined = responses[url.pathname];

        if (!body) {
          throw new Error(`Unexpected request: ${url}`);
        }

        return Object.defineProperty(
          new Response(body, { status: OK, headers: { 'content-type': 'application/json' } }),
          'url',
          {
            value: url.href,
          },
        );
      },
    },
  });
}

async function write(file: string, json: Manifest) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(json));
}

it('normalizes entries and compares nested workspace manifests', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'release-facts-')));
  onTestFinished(() => fs.rm(root, { recursive: true, force: true }));

  const git = (...args: string[]) =>
    execa('git', ['-c', 'user.name=Fixture', '-c', 'user.email=f@example.com', ...args], {
      cwd: root,
      env: { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
    });

  const cwd = path.join(root, 'workspace');
  await git('init', '-q');
  await fs.mkdir(cwd);
  await fs.writeFile(path.join(cwd, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
  await write(path.join(cwd, 'package.json'), { name: 'root', version: '1.1.0', private: true });
  await write(path.join(cwd, 'packages/a/package.json'), { name: 'a', version: '1.0.0' });
  await write(path.join(cwd, 'packages/b/package.json'), { name: 'b', version: '2.0.0' });
  // Same path from the repository root: reading it would hide the bump of `a`.
  await write(path.join(root, 'packages/a/package.json'), { name: 'a', version: '1.1.0' });
  await git('add', '-A');
  await git('commit', '-q', '-m', 'v1');
  await git('tag', 'v1');
  await write(path.join(cwd, 'packages/a/package.json'), { name: 'a', version: '1.1.0' });
  await write(path.join(cwd, 'packages/c/package.json'), {
    name: 'c',
    version: '0.0.0',
    private: true,
  });

  const facts = await fetchReleaseFacts({
    cwd,
    repo: 'test',
    lastRelease: 'v1',
    release: 'v2',
    date: '2026-10-01T12:00:00.000Z',
    includeDirectCommits: true,
    octokit: octokit({
      '/repos/mui/test/compare/v1...v2': JSON.stringify({
        url: 'https://api.github.com/repos/mui/test/compare/v1...v2',
        total_commits: 2,
        commits: [
          { sha: 'a'.repeat(40), commit: { message: '[Grid][l10n] Fix #12 (#3) (#5)\n\nBody' } },
          {
            sha: 'b'.repeat(40),
            html_url: 'https://github.com/mui/test/commit/b',
            author: null,
            commit: { message: 'Bump (#3) directly', author: { name: 'Jane', date: '2026-09-30' } },
          },
        ],
      }),
      '/repos/mui/test/pulls/5': JSON.stringify({
        title: 'Fix',
        body: 'Details',
        labels: [{ name: 'scope: grid' }],
        user: { login: 'first' },
        author_association: 'FIRST_TIME_CONTRIBUTOR',
        html_url: 'https://github.com/mui/test/pull/5',
        merged_at: '2026-09-29T00:00:00Z',
        created_at: null,
      }),
    }),
  });

  expect(facts).toMatchObject({
    repo: { owner: 'mui', name: 'test' },
    lastRelease: 'v1',
    release: 'v2',
    version: '1.1.0',
    date: '2026-10-01T12:00:00.000Z',
  });
  expect(facts.entries).toEqual([
    expect.objectContaining({
      pr: 5,
      title: 'Fix #12',
      prefixes: ['Grid', 'l10n'],
      labels: ['scope: grid'],
      body: 'Details',
      author: { login: 'first', association: 'first-timer' },
    }),
    expect.objectContaining({
      pr: null,
      title: 'Bump (#3) directly',
      url: 'https://github.com/mui/test/commit/b',
      author: { login: null, name: 'Jane', association: 'community' },
    }),
  ]);
  expect([...facts.packages].sort((x, y) => x.path.localeCompare(y.path))).toEqual([
    { name: 'root', version: '1.1.0', private: true, path: '.', changed: false },
    { name: 'a', version: '1.1.0', private: false, path: 'packages/a', changed: true },
    { name: 'b', version: '2.0.0', private: false, path: 'packages/b', changed: false },
    { name: 'c', version: '0.0.0', private: true, path: 'packages/c', changed: true },
  ]);
});
