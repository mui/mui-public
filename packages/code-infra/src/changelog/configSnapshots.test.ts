import fs from 'node:fs/promises';
import { describe, expect, it, onTestFinished } from 'vitest';
// eslint-disable-next-line import/extensions
import { generateChangelog } from './index.mjs';
// eslint-disable-next-line import/extensions
import type { ChangelogConfig } from './index.mjs';
import { listRecordings, materialize, readRecording, replay } from './__fixtures__/recordings';

const BREAKING_CHANGE = 'breaking change';
const OTP = { 'component: otp field': 'OTP Field' };

/** `scripts/changelog.config.mjs` of Base UI; Plus, Mosaic and Charts differ only in `general` casing. */
function baseUiConfig(
  format: 'docs' | 'release',
  general: string,
  overrides: Record<string, string>,
): ChangelogConfig {
  return {
    format: {
      version: 'v{{version}}',
      dateFormat: format === 'docs' ? '**MMM DD, YYYY**' : '_MMM DD, YYYY_',
      changelogMessage:
        format === 'docs'
          ? '{{flagPrefix}} {{message}} ([#{{prNumber}}]({{prUrl}}))'
          : '{{flagPrefix}} {{message}} (#{{prNumber}}) by @{{author}}',
    },
    filter: {
      excludeCommitByAuthors: [/\[bot\]$/],
      excludeCommitWithLabels: [
        'internal',
        'dependencies',
        'scope: code-infra',
        'scope: docs-infra',
        'scope: support-infra',
        'test',
        'release',
        'docs',
        'website',
      ],
      excludeAuthorsFromContributors: ['Copilot'],
    },
    categorization: {
      strategy: 'component',
      labels: {
        plan: { values: [] },
        component: { prefix: ['component:', 'hook:'] },
        categoryOverrides: { 'scope: all components': general, ...overrides },
        flags: {
          [BREAKING_CHANGE]: { name: 'Breaking changes', prefix: '🚨 **Breaking change:**' },
        },
      },
      sections: { order: { [general]: -1 }, fallbackSection: general },
    },
  };
}

/** Package strategy with paid plans, as MUI X configured it before its bespoke layout. */
const packageConfig: ChangelogConfig = {
  format: {
    version: '{{version}}',
    changelogMessage: '{{message}} (#{{prNumber}}) @{{author}}',
    sectionTitle: { forPackage: '`{{package}}@{{version}}` {{planBadge}}' },
    planBadge: { pro: '[![pro](pro.svg)](pro)', premium: '[![premium](premium.svg)](premium)' },
    planMessage: {
      same: 'Same changes as in `{{previousPlan}}@{{previousPlanVersion}}`.',
      plus: 'Same changes as in `{{previousPlan}}@{{previousPlanVersion}}`, plus:',
    },
    showInternalChangesMessage: true,
  },
  intro: { thanksMessage: 'Thanks to the {{contributorCount}} contributors.' },
  contributors: {
    addContributorsToIntro: true,
    message: {
      community: { many: 'Community: {{community}}', one: 'Community member: {{community}}' },
      team: 'Team: {{team}}',
    },
  },
  filter: {
    excludeCommitWithLabels: ['dependencies'],
    excludeAuthorsFromContributors: [/renovate\[bot\]$/],
  },
  categorization: {
    strategy: 'package',
    labels: {
      plan: { values: ['pro', 'premium'] },
      categoryOverrides: {
        docs: 'docs',
        internal: 'core',
        'scope: code-infra': 'core',
        'scope: docs-infra': 'core',
        'scope: support-infra': 'core',
        'scope: x-license': 'core',
        'scope: x-telemetry': 'core',
        'scope: all components': 'core',
        'scope: design-kits': 'core',
      },
      extractLabelsFromTitle: (title) =>
        /^\[(?:DataGrid|data grid)/.test(title) ? ['scope: data grid'] : [],
    },
    packageNaming: {
      mappings: {
        'data grid': '@mui/x-data-grid',
        pickers: '@mui/x-date-pickers',
        charts: '@mui/x-charts',
        'tree view': '@mui/x-tree-view',
        scheduler: '@mui/x-scheduler',
        codemod: '@mui/x-codemod',
        chat: '@mui/x-chat',
        virtualizer: '@mui/x-virtualizer',
        'chat headless': '@mui/x-chat-headless',
        'charts vendor': '@mui/x-charts-vendor',
      },
      plans: {
        pro: {
          '@mui/x-data-grid': '@mui/x-data-grid-pro',
          '@mui/x-date-pickers': '@mui/x-date-pickers-pro',
          '@mui/x-charts': '@mui/x-charts-pro',
          '@mui/x-tree-view': '@mui/x-tree-view-pro',
        },
        premium: {
          '@mui/x-data-grid': '@mui/x-data-grid-premium',
          '@mui/x-charts': '@mui/x-charts-premium',
          '@mui/x-scheduler': '@mui/x-scheduler-premium',
        },
      },
      genericScopes: ['docs', 'core'],
    },
    sections: {
      fallbackSection: 'miscellaneous',
      order: { 'data grid': 0, pickers: 1, charts: 2, docs: 10, core: 11, miscellaneous: 12 },
      titles: { 'data grid': 'Data Grid', pickers: 'Date and Time Pickers', docs: 'Docs' },
    },
  },
};

const CASES: [string, string, ChangelogConfig][] = [
  ['base-ui', 'base-ui', baseUiConfig('release', 'General changes', OTP)],
  ['base-ui-docs', 'base-ui', baseUiConfig('docs', 'General changes', OTP)],
  ['base-ui-plus', 'base-ui', baseUiConfig('release', 'general changes', {})],
  ['package', 'x', packageConfig],
];

describe.each(CASES)('%s config', async (name, repo, config) => {
  it.each(await listRecordings(repo))('renders %s as before', async (file) => {
    const recording = await readRecording(file);
    const cwd = await materialize(recording);
    onTestFinished(() => fs.rm(cwd, { recursive: true, force: true }));

    const result = await generateChangelog({
      cwd,
      config,
      repo: recording.repo,
      octokit: replay(recording),
      lastRelease: recording.lastRelease,
      release: recording.release,
      version: recording.version,
      date: new Date(recording.date),
    }).then(
      ({ markdown }) => markdown,
      (error: Error) => `Error: ${error.message}\n`,
    );

    await expect(result).toMatchFileSnapshot(
      `./__fixtures__/snapshots/${name}/${recording.release}.md`,
    );
  });
});
