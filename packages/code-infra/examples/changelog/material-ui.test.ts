import { describe, expect, it } from 'vitest';
import { createData } from '../../src/changelog/__fixtures__/changes';
import type { ChangeFixture } from '../../src/changelog/__fixtures__/changes';
// eslint-disable-next-line import/extensions
import { formatChangelog } from './material-ui.mjs';

const COMPONENTS = {
  Autocomplete: '@mui/material',
  ButtonBase: '@mui/material',
  SpeedDial: '@mui/material',
  Masonry: '@mui/lab',
};

/** What is between the highlights and the contributors. */
function formatSections(changes: ChangeFixture[]) {
  const markdown = formatChangelog(createData(changes), COMPONENTS);
  return markdown.slice(markdown.indexOf('\n### ') + 1, markdown.indexOf('\n\nAll contributors'));
}

describe('Material UI changelog', () => {
  it('renders a release', () => {
    const data = createData(
      [
        {
          number: 1,
          title: '[Autocomplete] Change elevation',
          labels: ['breaking change', 'scope: autocomplete'],
        },
        { number: 2, title: '[button base] Fix `ripple`', author: { login: 'Zoe' } },
        { number: 3, title: '[SpeedDial][autocomplete] Fix types', author: { login: 'bob' } },
        { number: 4, title: '[utils] Improve performance', labels: ['package: utils'] },
        { number: 5, title: '[masonry] Fix styles', author: { login: 'Zoe', association: 'team' } },
        { number: 6, title: '[docs][masonry] Fix typo', labels: ['docs', 'scope: docs-infra'] },
        { number: 7, title: '[docs-infra] Speed up', labels: ['docs'] },
        { number: 8, title: '[test][SpeedDial] Add tests', labels: ['scope: speed dial'] },
      ],
      {
        packages: [
          {
            name: '@mui/lab',
            version: '1.1.0-beta.0',
            private: false,
            path: 'packages/mui-lab',
            changed: true,
          },
        ],
      },
    );

    expect(formatChangelog(data, COMPONENTS)).toBe(`## 1.1.0

<!-- generated comparing v1.0.0..v1.1.0 -->

_Jan 2, 2026_

A big thanks to the 3 contributors who made this release possible. Here are some highlights ✨:

TODO INSERT HIGHLIGHTS

### \`@mui/material@1.1.0\`

#### Breaking Changes

- [autocomplete] Change elevation (#1) @octocat

#### Changes

- [buttonbase] Fix \`ripple\` (#2) @Zoe
- [speeddial][autocomplete] Fix types (#3) @bob

### \`@mui/utils@1.1.0\`

- Improve performance (#4) @octocat

### \`@mui/lab@1.1.0-beta.0\`

- [masonry] Fix styles (#5) @Zoe

### Docs

- [masonry] Fix typo (#6) @octocat

### Core

- [docs-infra] Speed up (#7) @octocat
- [test][speeddial] Add tests (#8) @octocat

All contributors of this release in alphabetical order: @bob, @octocat, @Zoe`);
  });

  it('lets labels win over the title', () => {
    expect(
      formatSections([{ number: 1, title: '[Masonry] Fix it', labels: ['scope: autocomplete'] }]),
    ).toBe('### `@mui/material@1.1.0`\n\n- [masonry] Fix it (#1) @octocat');
  });

  it('prefers the package over the components in it', () => {
    expect(formatSections([{ number: 1, title: '[codemod][Masonry] Fix it' }])).toBe(
      '### `@mui/codemod@1.1.0`\n\n- [masonry] Fix it (#1) @octocat',
    );
  });

  it('has an entry in every package that it is about', () => {
    expect(
      formatSections([
        { number: 1, title: 'Fix it', labels: ['component: ButtonBase', 'scope: masonry'] },
      ]),
    ).toBe(`### \`@mui/material@1.1.0\`

- Fix it (#1) @octocat

### \`@mui/lab@1.1.0\`

- Fix it (#1) @octocat`);
  });

  it('leaves out releases and bumps, and not all changes of bots or to dependencies', () => {
    expect(
      formatSections([
        { number: 1, title: 'Bump foo', labels: ['dependencies'], author: { login: 'ren[bot]' } },
        { number: 2, title: '[release] v1.1.0', labels: ['release'] },
        { number: 3, title: '[website] Fix it' },
        { number: 4, title: '[core] Upgrade foo', labels: ['dependencies'] },
        { number: 5, title: '[core] Fix flake', author: { login: 'github-actions[bot]' } },
      ]),
    ).toBe(`### Core

- [core] Fix flake (#5) @github-actions[bot]
- [core] Upgrade foo (#4) @octocat`);
  });
});
