import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Octokit } from '@octokit/rest';
import { execa } from 'execa';
import { expect, it, onTestFinished } from 'vitest';
// eslint-disable-next-line import/extensions
import { generateChangelog, loadChangelogConfig } from './index.mjs';
// eslint-disable-next-line import/extensions
import type { ChangelogConfig } from './index.mjs';

const OK = 200;
const RELEASE_DATE = '2026-10-01T00:00:00Z';
const gitEnv = {
  GIT_AUTHOR_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.com',
  GIT_COMMITTER_NAME: 'Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
};

it('generates package and flat entries through the same API', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'changelog-'));
  onTestFinished(() => fs.rm(cwd, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(cwd, 'package.json'),
    JSON.stringify({ name: 'fixture', private: true, version: '2.0.0' }),
  );
  await fs.writeFile(path.join(cwd, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
  const names = [
    'widget',
    'widget-premium',
    'second',
    'unchanged',
    'bumped',
    'private',
    'paid',
    'paid-premium',
  ];
  await Promise.all(
    names.map(async (name) => {
      const directory = path.join(cwd, 'packages', name);
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(
        path.join(directory, 'package.json'),
        JSON.stringify({ name: `@test/${name}`, version: '1.0.0', private: name === 'private' }),
      );
    }),
  );
  const git = (...args: string[]) => execa('git', args, { cwd, env: gitEnv });
  await git('init');
  await git('add', '.');
  await git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'Initial packages');
  await git('tag', 'v1');
  await fs.writeFile(
    path.join(cwd, 'packages/bumped/package.json'),
    JSON.stringify({ name: '@test/bumped', version: '2.0.0' }),
  );

  await fs.writeFile(
    path.join(cwd, 'packages/paid-premium/package.json'),
    JSON.stringify({ name: '@test/paid-premium', version: '2.0.0' }),
  );

  const pulls = [
    {
      number: 1,
      title: '[Old][details.v2] Fix behavior',
      labels: ['scope: widget', 'scope: second', 'scope: widget', 'component: control'],
      login: 'visible',
    },
    { number: 2, title: '[WidgetPremium] Fix paid behavior', labels: [], login: 'visible' },
    { number: 3, title: 'Update dependencies', labels: ['dependencies'], login: 'hidden' },
  ];
  const octokit = new Octokit({
    request: {
      fetch: async (input: Parameters<typeof fetch>[0]) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const data = url.pathname.includes('/compare/')
          ? {
              url: url.href,
              total_commits: 4,
              commits: [
                ...pulls.map((pull) => ({
                  sha: `sha-${pull.number}`,
                  html_url: `https://github.com/mui/test/commit/sha-${pull.number}`,
                  commit: { message: `${pull.title} (#${pull.number})` },
                })),
                {
                  sha: 'abcdef1234',
                  html_url: 'https://github.com/mui/test/commit/abcdef1234',
                  author: { login: 'direct' },
                  commit: { message: 'Direct change', author: { date: RELEASE_DATE } },
                },
              ],
            }
          : (() => {
              const pull = pulls.find(
                (item) => item.number === Number(url.pathname.split('/').at(-1)),
              );
              if (!pull) {
                throw new Error(`Unexpected request: ${url}`);
              }
              return {
                ...pull,
                labels: pull.labels.map((name) => ({ name })),
                user: { login: pull.login },
                author_association: pull.number === 2 ? 'MEMBER' : 'CONTRIBUTOR',
                body: '',
                merged_at: RELEASE_DATE,
                created_at: RELEASE_DATE,
                html_url: `https://github.com/mui/test/pull/${pull.number}`,
              };
            })();
        return Object.defineProperty(Response.json(data, { status: OK }), 'url', {
          value: url.href,
        });
      },
    },
  });
  const config: ChangelogConfig = {
    format: {
      preservePrefixes: true,
      changelogMessage: '{{message}} (#{{prNumber}}) @{{author}}',
      showInternalChangesMessage: true,
      planMessage: { same: 'Same as {{previousPlan}}.', plus: 'Same as {{previousPlan}}, plus:' },
    },
    contributors: { source: 'all' },
    filter: { excludeCommitWithLabels: ['dependencies'] },
    categorization: {
      strategy: 'package',
      labels: {
        plan: { values: ['pro', 'premium'] },
        titleMappings: {
          Widget: ['scope: widget'],
          WidgetPremium: ['scope: widget', 'plan: premium'],
          Second: ['scope: second'],
          Old: ['scope: old', 'component: control'],
        },
      },
      packageNaming: {
        omitUnchanged: true,
        omitUnavailable: true,
        mappings: {
          widget: '@test/widget',
          second: '@test/second',
          unchanged: '@test/unchanged',
          bumped: '@test/bumped',
          private: '@test/private',
          paid: '@test/paid',
          missing: '@test/missing',
        },
        plans: {
          premium: { '@test/widget': '@test/widget-premium', '@test/paid': '@test/paid-premium' },
        },
      },
      sections: { fallbackSection: 'Other' },
    },
  };
  const options = {
    cwd,
    repo: 'test',
    octokit,
    config,
    lastRelease: 'v1',
    release: 'HEAD',
    date: new Date(RELEASE_DATE),
  };
  const result = await generateChangelog(options);
  expect(result.markdown).toContain('## v2.0.0');
  expect(result.markdown).toContain(
    '[details.v2][Widget][Second][control] Fix behavior (#1) @visible',
  );
  expect(result.markdown).not.toContain('[Old]');
  expect(result.markdown.match(/Fix behavior \(#1\)/g)).toHaveLength(2);
  expect(result.markdown).toContain('Same as @test/widget, plus:');
  expect(result.markdown).not.toContain('@test/unchanged');
  expect(result.markdown).toContain('@test/bumped@2.0.0');
  expect(result.markdown).not.toContain('@test/private');
  expect(result.markdown).toContain('@test/paid-premium@2.0.0');
  expect(result.markdown).not.toContain('@test/missing');
  expect(result.markdown).toContain('Internal changes.');
  expect(result.markdown).toContain(
    '[abcdef1](https://github.com/mui/test/commit/abcdef1234) @direct',
  );
  expect(result.contributors.all).toContain('hidden');
  expect(result.contributors.all.filter((author) => author === 'visible')).toHaveLength(1);

  const additional = await generateChangelog({
    ...options,
    config: {
      ...config,
      categorization: {
        ...config.categorization,
        packageNaming: {
          ...config.categorization.packageNaming!,
          additionalPackages: (commit) =>
            commit.prNumber === 1 ? ['@test/bumped', '@test/widget', '@test/private'] : [],
        },
      },
    },
  });
  const extraPackage = additional.sections.find((section) => section.key === 'bumped');
  expect(extraPackage?.subsections?.[0].commits.map((commit) => commit.prNumber)).toEqual([1]);
  expect(additional.markdown.match(/Fix behavior \(#1\)/g)).toHaveLength(3);
  expect(additional.markdown).not.toContain('@test/private');

  const generic = await generateChangelog({
    ...options,
    config: {
      ...config,
      categorization: {
        ...config.categorization,
        labels: {
          ...config.categorization.labels,
          categoryOverrides: { 'scope: second': 'Core' },
        },
      },
    },
  });
  expect(generic.markdown).toContain('Fix behavior (#1) @visible');

  const withoutDirect = await generateChangelog({
    ...options,
    config: {
      ...config,
      filter: { ...config.filter, customFilter: (commit) => commit.prNumber !== null },
    },
  });
  expect(withoutDirect.sections.some((section) => section.key === 'Other')).toBe(false);

  const flat = await generateChangelog({
    ...options,
    config: {
      ...config,
      contributors: { source: 'filtered' },
      categorization: { ...config.categorization, strategy: 'flat' },
    },
  });
  expect(flat.markdown).not.toContain('###');
  expect(flat.markdown.match(/Fix behavior \(#1\)/g)).toHaveLength(1);
  expect(flat.contributors.all).not.toContain('hidden');

  const configPath = path.join(cwd, 'changelog.config.mjs');
  await fs.writeFile(configPath, `export default ${JSON.stringify(config)}`);
  expect((await loadChangelogConfig('changelog.config.mjs', cwd)).categorization.strategy).toBe(
    'package',
  );
  await fs.mkdir(path.join(cwd, 'scripts'));
  await fs.copyFile(configPath, path.join(cwd, 'scripts/changelog.config.mjs'));
  const fromDefault = await generateChangelog({ ...options, config: undefined });
  expect(fromDefault.markdown).toBe(result.markdown);
});
