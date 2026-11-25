import { describe, expect, it } from 'vitest';
import { createData } from '../../src/changelog/__fixtures__/changes';
// eslint-disable-next-line import/extensions
import { formatChangelog, formatDocsPage } from './base-ui.mjs';

const DATA = createData([
  {
    number: 1,
    title: '[otp field][menu] Fix `it`',
    labels: ['component: otp field', 'component: menu'],
  },
  {
    number: 2,
    title: '[all components] Fix it',
    labels: ['scope: all components', 'component: menu'],
  },
  { number: 3, title: '[useRender] Rename it', labels: ['hook: useRender', 'breaking change'] },
  { number: 4, title: '[menu] Add it', labels: ['component: menu'], author: null },
  { number: 5, title: 'Fix typo', labels: ['docs'], author: { login: 'writer' } },
  { number: 6, title: 'Simplify', author: { login: 'Copilot' } },
]);

describe('Base UI changelog', () => {
  it('renders a release', () => {
    expect(formatChangelog(DATA)).toBe(`## v1.1.0

<!-- generated comparing v1.0.0...v1.1.0 -->

_Jan 2, 2026_

### General changes

- Fix it (#2) by @octocat
- Simplify (#6) by @Copilot

### Menu

- Fix \`it\` (#1) by @octocat
- Add it (#4)

### OTP Field

- Fix \`it\` (#1) by @octocat

### useRender

- 🚨 **Breaking change:** Rename it (#3) by @octocat

All contributors of this release in alphabetical order: @octocat`);
  });

  it('renders the page in the docs from the same data', () => {
    expect(formatDocsPage(DATA)).toBe(`# v1.1.0

<Subtitle>Jan 2, 2026</Subtitle>
<Meta name="description" content="v1.1.0 release notes. Jan 2, 2026." />

## General changes

- Fix it ([#2](https://github.com/mui/test/pull/2))
- Simplify ([#6](https://github.com/mui/test/pull/6))

## Menu

- Fix \`it\` ([#1](https://github.com/mui/test/pull/1))
- Add it ([#4](https://github.com/mui/test/pull/4))

## OTP Field

- Fix \`it\` ([#1](https://github.com/mui/test/pull/1))

## useRender

- 🚨 **Breaking change:** Rename it ([#3](https://github.com/mui/test/pull/3))`);
  });
});
