import { describe, expect, it } from 'vitest';
import { createData } from '../../src/changelog/__fixtures__/changes';
import type { ChangeFixture } from '../../src/changelog/__fixtures__/changes';
// eslint-disable-next-line import/extensions
import type { ChangelogPackage } from '../../src/changelog/index.mjs';
// eslint-disable-next-line import/extensions
import { formatChangelog } from './mui-x.mjs';

const PRO = "[![pro](https://mui.com/r/x-pro-svg)](https://mui.com/r/x-pro-svg-link 'Pro plan')";
const PREMIUM =
  "[![premium](https://mui.com/r/x-premium-svg)](https://mui.com/r/x-premium-svg-link 'Premium plan')";

function createPackages(changed: boolean | null, names: string[]): ChangelogPackage[] {
  return names.map((name) => ({
    name,
    version: name.startsWith('@mui/x-chat') ? '9.0.0-alpha.1' : '9.1.0',
    private: false,
    path: `packages/${name.slice('@mui/'.length)}`,
    changed,
  }));
}

/** What is below the contributors. */
function formatSections(changes: ChangeFixture[], packages: ChangelogPackage[] = []) {
  const markdown = formatChangelog(createData(changes, { version: '9.1.0', packages }));
  return markdown.slice(markdown.indexOf('\n### ') + 1);
}

describe('MUI X changelog', () => {
  it('renders a release', () => {
    const data = createData(
      [
        {
          number: 1,
          title: '[data grid] Fix `foo`',
          labels: ['scope: data grid'],
          author: { login: 'member', association: 'team' },
        },
        {
          number: 2,
          title: '[DataGridPro] Add bar',
          author: { login: 'newcomer', association: 'first-timer' },
        },
        { number: 3, title: '[docs][charts] Fix typo', labels: ['docs', 'scope: charts'] },
        { number: 4, title: '[ci] Speed up', labels: ['scope: code-infra'] },
        { number: 5, title: '[test] Fix flaky grid test', labels: ['scope: data grid'] },
        { number: null, title: 'Commit', sha: 'abcdef01', author: { login: null, name: 'Jane' } },
      ],
      { version: '9.1.0', date: '2026-11-13T00:00:00.000Z' },
    );

    expect(formatChangelog(data)).toBe(`## 9.1.0

<!-- generated comparing v1.0.0..v1.1.0 -->

_Nov 13, 2026_

We'd like to extend a big thank you to the 4 contributors who made this release possible. Here are some highlights ✨:

TODO INSERT HIGHLIGHTS

Special thanks go out to these community members for their valuable contributions:
Jane, @newcomer, @octocat

The following team members contributed to this release:
@member

### Data Grid

#### \`@mui/x-data-grid@9.1.0\`

- [DataGrid] Fix \`foo\` (#1) @member

#### \`@mui/x-data-grid-pro@9.1.0\` ${PRO}

Same changes as in \`@mui/x-data-grid@9.1.0\`, plus:

- [DataGridPro] Add bar (#2) @newcomer

#### \`@mui/x-data-grid-premium@9.1.0\` ${PREMIUM}

Same changes as in \`@mui/x-data-grid-pro@9.1.0\`.

### Docs

- [docs][charts] Fix typo (#3) @octocat

### Core

- [ci] Speed up (#4) @octocat

### Miscellaneous

- Commit (abcdef0) Jane
- [test] Fix flaky grid test (#5) @octocat`);
  });

  it('lets labels win over the title', () => {
    expect(
      formatSections([
        { number: 1, title: '[charts] Fix it', labels: ['scope: scheduler', 'plan: Premium'] },
      ]),
    ).toBe(`### Scheduler

#### \`@mui/x-scheduler@9.1.0\`

Internal changes.

#### \`@mui/x-scheduler-premium@9.1.0\` ${PREMIUM}

Same changes as in \`@mui/x-scheduler@9.1.0\`, plus:

- [charts] Fix it (#1) @octocat`);
  });

  it('only gives a plan to its product in a change to several', () => {
    const sections = formatSections([
      {
        number: 1,
        title: '[charts][DataGridPremium] Fix it',
        labels: ['scope: charts', 'scope: data grid'],
      },
    ]);

    expect(sections).toContain('#### `@mui/x-charts@9.1.0`\n\n- [charts][DataGridPremium] Fix it');
    expect(sections).toContain(
      'Same changes as in `@mui/x-data-grid-pro@9.1.0`, plus:\n\n- [charts][DataGridPremium] Fix it',
    );
    expect(sections.match(/Fix it/g)).toHaveLength(2);
  });

  it.each([
    ['changed', true, true],
    ['may have changed', null, true],
    ['did not change', false, false],
  ])('shows a package without changes when its version %s', (_, changed, isShown) => {
    expect(
      formatSections([], createPackages(changed, ['@mui/x-chat'])).startsWith('### Chat'),
    ).toBe(isShown);
  });

  it('has an entry in the base package and the companion package that it is about', () => {
    const sections = formatSections(
      [
        {
          number: 1,
          title: '[chat] Fix it',
          body: 'Adds `fix()` to `@mui/x-chat-headless`.',
        },
        { number: 2, title: '[chat] Other', body: 'See `packages/x-chat-headless-foo`.' },
      ],
      createPackages(true, ['@mui/x-chat', '@mui/x-chat-headless']),
    );

    expect(sections).toBe(`### Chat

#### \`@mui/x-chat@9.0.0-alpha.1\`

- [chat] Fix it (#1) @octocat
- [chat] Other (#2) @octocat

#### \`@mui/x-chat-headless@9.0.0-alpha.1\`

- [chat] Fix it (#1) @octocat`);
  });

  it('leaves out entries by label, and not the ones of all bots', () => {
    const sections = formatSections([
      { number: 1, title: 'Bump foo', labels: ['dependencies'], author: { login: 'bob' } },
      { number: 2, title: '[release] v9.1.0', labels: ['release'] },
      { number: 3, title: '[chat] Fix flake', author: { login: 'github-actions[bot]' } },
    ]);

    expect(sections).toContain('- [chat] Fix flake (#3) @github-actions[bot]');
    expect(sections).not.toMatch(/#[12]\b/);
  });

  it('does not count excluded contributors', () => {
    const markdown = formatChangelog(
      createData([
        { number: 1, author: { login: 'github-actions[bot]' } },
        { number: 2, author: { login: 'bob' } },
      ]),
    );

    expect(markdown).toContain('thank you to the 1 contributor who');
    expect(markdown).toContain('community member @bob for their valuable contribution.');
    expect(markdown).not.toContain('team members');
  });
});
