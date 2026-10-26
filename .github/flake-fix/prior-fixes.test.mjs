// Unit test for the prior-fix PR filter. It narrows a `gh pr list` dump to the flake-fix PRs the
// triage agent should see: open ones, and ones merged within the last 24h.
//
// Run: pnpm test (vitest project; see vitest.config.mts).

import { describe, it, expect } from 'vitest';
import { recentFixPulls } from './prior-fixes.mjs';

const now = new Date('2026-10-26T12:00:00Z');
const hoursAgo = (hours) => new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();

const pull = (overrides) => ({
  number: 1,
  url: 'u1',
  title: 't1',
  state: 'OPEN',
  mergedAt: null,
  body: 'b1',
  ...overrides,
});

describe('recentFixPulls', () => {
  it('keeps open PRs', () => {
    const kept = recentFixPulls([pull({ number: 7, state: 'OPEN' })], now);
    expect(kept.map((item) => item.number)).toEqual([7]);
  });

  it('keeps a PR merged within the last 24h', () => {
    const kept = recentFixPulls([pull({ number: 8, state: 'MERGED', mergedAt: hoursAgo(5) })], now);
    expect(kept.map((item) => item.number)).toEqual([8]);
  });

  it('drops a PR merged more than 24h ago — CI has had time to catch up', () => {
    const kept = recentFixPulls(
      [pull({ number: 9, state: 'MERGED', mergedAt: hoursAgo(30) })],
      now,
    );
    expect(kept).toEqual([]);
  });

  it('drops a closed-but-unmerged PR — its fix was rejected', () => {
    expect(recentFixPulls([pull({ number: 10, state: 'CLOSED', mergedAt: null })], now)).toEqual(
      [],
    );
  });

  it('carries the fields the agent judges overlap from', () => {
    const kept = recentFixPulls(
      [
        pull({
          number: 11,
          url: 'u11',
          title: 'Fix the thing',
          state: 'OPEN',
          body: 'what it does',
        }),
      ],
      now,
    );
    expect(kept[0]).toEqual({
      number: 11,
      url: 'u11',
      title: 'Fix the thing',
      state: 'OPEN',
      mergedAt: null,
      body: 'what it does',
    });
  });
});
