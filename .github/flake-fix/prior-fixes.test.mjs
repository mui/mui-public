// Unit test for the prior-fix coverage collector. It turns a `gh pr list` dump into the set of
// fingerprints already handled by an open or merged flake-fix PR.
//
// Run: pnpm test (vitest project; see vitest.config.mts).

import { describe, it, expect } from 'vitest';
import { covered } from './prior-fixes.mjs';

const body = (...fingerprints) =>
  `Some PR description.\n\ncc @mui/infra\n\n<!-- flake-fix:resolves\n${fingerprints.join('\n')}\n-->\n`;

describe('covered', () => {
  it('extracts each fingerprint from an open PR, with the PR and state', () => {
    const entries = covered([
      {
        number: 7,
        url: 'https://x/pull/7',
        state: 'OPEN',
        mergedAt: null,
        body: body('boom', 'bang'),
      },
    ]);
    expect(entries).toEqual([
      { fingerprint: 'boom', state: 'OPEN', mergedAt: null, pr: 'https://x/pull/7' },
      { fingerprint: 'bang', state: 'OPEN', mergedAt: null, pr: 'https://x/pull/7' },
    ]);
  });

  it('carries mergedAt for a merged PR', () => {
    const entries = covered([
      {
        number: 8,
        url: 'u8',
        state: 'MERGED',
        mergedAt: '2026-10-26T09:00:00Z',
        body: body('boom'),
      },
    ]);
    expect(entries).toEqual([
      { fingerprint: 'boom', state: 'MERGED', mergedAt: '2026-10-26T09:00:00Z', pr: 'u8' },
    ]);
  });

  it('ignores a closed-but-unmerged PR — its fix was rejected', () => {
    expect(
      covered([{ number: 9, url: 'u9', state: 'CLOSED', mergedAt: null, body: body('boom') }]),
    ).toEqual([]);
  });

  it('returns nothing for a PR with no resolves marker', () => {
    expect(
      covered([{ number: 10, url: 'u10', state: 'OPEN', mergedAt: null, body: 'no marker here' }]),
    ).toEqual([]);
  });

  it('trims whitespace and drops blank lines in the marker', () => {
    const withBlanks = {
      number: 11,
      url: 'u11',
      state: 'OPEN',
      mergedAt: null,
      body: '<!-- flake-fix:resolves\n  boom  \n\n  bang\n-->',
    };
    expect(covered([withBlanks]).map((entry) => entry.fingerprint)).toEqual(['boom', 'bang']);
  });
});
