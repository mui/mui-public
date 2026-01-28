import { describe, expect, it } from 'vitest';
// eslint-disable-next-line import/extensions
import { filterCommits } from './filterCommits.mjs';
import type { FetchedCommitDetails, FilterConfig } from './types';

function createCommit(overrides: Partial<FetchedCommitDetails> = {}): FetchedCommitDetails {
  return {
    sha: 'abc123',
    message: 'test commit',
    labels: [],
    prNumber: 1,
    html_url: 'https://github.com/test/repo/pull/1',
    author: {
      login: 'testuser',
      association: 'contributor',
    },
    createdAt: '2025-01-01T00:00:00Z',
    mergedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('filterCommits', () => {
  describe('no filter config', () => {
    it('should return all commits when filterConfig is undefined', () => {
      const commits = [
        createCommit({ sha: '1' }),
        createCommit({ sha: '2' }),
        createCommit({ sha: '3' }),
      ];

      const result = filterCommits(commits, undefined);

      expect(result).toEqual(commits);
    });

    it('should return empty array for empty input', () => {
      const result = filterCommits([], undefined);

      expect(result).toEqual([]);
    });
  });

  describe('excludeCommitByAuthors', () => {
    it('should exclude commits by author login string match', () => {
      const commits = [
        createCommit({ sha: '1', author: { login: 'dependabot', association: 'contributor' } }),
        createCommit({ sha: '2', author: { login: 'human-user', association: 'contributor' } }),
        createCommit({
          sha: '3',
          author: { login: 'another-dependabot-account', association: 'contributor' },
        }),
      ];
      const filterConfig: FilterConfig = {
        excludeCommitByAuthors: ['dependabot'],
      };

      const result = filterCommits(commits, filterConfig);

      expect(result.map((c) => c.sha)).toEqual(['2']);
    });

    it('should exclude commits by author login regex match', () => {
      const commits = [
        createCommit({ sha: '1', author: { login: 'renovate[bot]', association: 'contributor' } }),
        createCommit({ sha: '2', author: { login: 'human-user', association: 'contributor' } }),
        createCommit({
          sha: '3',
          author: { login: 'dependabot[bot]', association: 'contributor' },
        }),
      ];
      const filterConfig: FilterConfig = {
        excludeCommitByAuthors: [/\[bot\]$/],
      };

      const result = filterCommits(commits, filterConfig);

      expect(result.map((c) => c.sha)).toEqual(['2']);
    });

    it('should handle commits with null author', () => {
      const commits = [
        createCommit({ sha: '1', author: null }),
        createCommit({ sha: '2', author: { login: 'dependabot', association: 'contributor' } }),
        createCommit({ sha: '3', author: { login: 'human-user', association: 'contributor' } }),
      ];
      const filterConfig: FilterConfig = {
        excludeCommitByAuthors: ['dependabot'],
      };

      const result = filterCommits(commits, filterConfig);

      expect(result.map((c) => c.sha)).toEqual(['1', '3']);
    });

    it('should handle multiple author exclusion patterns', () => {
      const commits = [
        createCommit({
          sha: '1',
          author: { login: 'dependabot[bot]', association: 'contributor' },
        }),
        createCommit({ sha: '2', author: { login: 'renovate', association: 'contributor' } }),
        createCommit({ sha: '3', author: { login: 'human-user', association: 'contributor' } }),
      ];
      const filterConfig: FilterConfig = {
        excludeCommitByAuthors: [/\[bot\]$/, 'renovate'],
      };

      const result = filterCommits(commits, filterConfig);

      expect(result.map((c) => c.sha)).toEqual(['3']);
    });

    it('should handle empty excludeCommitByAuthors array', () => {
      const commits = [createCommit({ sha: '1' }), createCommit({ sha: '2' })];
      const filterConfig: FilterConfig = {
        excludeCommitByAuthors: [],
      };

      const result = filterCommits(commits, filterConfig);

      expect(result.map((c) => c.sha)).toEqual(['1', '2']);
    });
  });

  describe('excludeCommitWithLabels', () => {
    it('should exclude commits with matching label string', () => {
      const commits = [
        createCommit({ sha: '1', labels: ['bug', 'skip-changelog'] }),
        createCommit({ sha: '2', labels: ['enhancement'] }),
        createCommit({ sha: '3', labels: ['internal', 'skip-changelog'] }),
      ];
      const filterConfig: FilterConfig = {
        excludeCommitWithLabels: ['skip-changelog'],
      };

      const result = filterCommits(commits, filterConfig);

      expect(result.map((c) => c.sha)).toEqual(['2']);
    });

    it('should exclude commits with matching label regex', () => {
      const commits = [
        createCommit({ sha: '1', labels: ['scope: docs'] }),
        createCommit({ sha: '2', labels: ['scope: core'] }),
        createCommit({ sha: '3', labels: ['enhancement'] }),
      ];
      const filterConfig: FilterConfig = {
        excludeCommitWithLabels: [/^scope: docs$/],
      };

      const result = filterCommits(commits, filterConfig);

      expect(result.map((c) => c.sha)).toEqual(['2', '3']);
    });

    it('should handle multiple label exclusion patterns', () => {
      const commits = [
        createCommit({ sha: '1', labels: ['skip-changelog'] }),
        createCommit({ sha: '2', labels: ['internal'] }),
        createCommit({ sha: '3', labels: ['enhancement'] }),
        createCommit({ sha: '4', labels: ['docs-only'] }),
      ];
      const filterConfig: FilterConfig = {
        excludeCommitWithLabels: ['skip-changelog', 'internal', /docs/],
      };

      const result = filterCommits(commits, filterConfig);

      expect(result.map((c) => c.sha)).toEqual(['3']);
    });

    it('should handle commits with empty labels array', () => {
      const commits = [
        createCommit({ sha: '1', labels: [] }),
        createCommit({ sha: '2', labels: ['skip-changelog'] }),
      ];
      const filterConfig: FilterConfig = {
        excludeCommitWithLabels: ['skip-changelog'],
      };

      const result = filterCommits(commits, filterConfig);

      expect(result.map((c) => c.sha)).toEqual(['1']);
    });

    it('should handle empty excludeCommitWithLabels array', () => {
      const commits = [
        createCommit({ sha: '1', labels: ['any-label'] }),
        createCommit({ sha: '2', labels: [] }),
      ];
      const filterConfig: FilterConfig = {
        excludeCommitWithLabels: [],
      };

      const result = filterCommits(commits, filterConfig);

      expect(result.map((c) => c.sha)).toEqual(['1', '2']);
    });
  });

  describe('customFilter', () => {
    it('should apply custom filter function', () => {
      const commits = [
        createCommit({ sha: '1', prNumber: 100 }),
        createCommit({ sha: '2', prNumber: 200 }),
        createCommit({ sha: '3', prNumber: 300 }),
      ];
      const filterConfig: FilterConfig = {
        customFilter: (commit) => commit.prNumber >= 200,
      };

      const result = filterCommits(commits, filterConfig);

      expect(result.map((c) => c.sha)).toEqual(['2', '3']);
    });

    it('should apply custom filter after author and label filters', () => {
      const commits = [
        createCommit({
          sha: '1',
          author: { login: 'bot', association: 'contributor' },
          prNumber: 100,
        }),
        createCommit({
          sha: '2',
          author: { login: 'human', association: 'contributor' },
          prNumber: 200,
        }),
        createCommit({
          sha: '3',
          author: { login: 'human', association: 'contributor' },
          prNumber: 300,
        }),
      ];
      const filterConfig: FilterConfig = {
        excludeCommitByAuthors: ['bot'],
        customFilter: (commit) => commit.prNumber >= 250,
      };

      const result = filterCommits(commits, filterConfig);

      // sha: '1' excluded by author filter
      // sha: '2' excluded by custom filter (prNumber < 250)
      // sha: '3' passes both filters
      expect(result.map((c) => c.sha)).toEqual(['3']);
    });

    it('should filter based on commit message content', () => {
      const commits = [
        createCommit({ sha: '1', message: '[skip ci] Update dependencies' }),
        createCommit({ sha: '2', message: 'Fix critical bug' }),
        createCommit({ sha: '3', message: 'chore: update config [skip ci]' }),
      ];
      const filterConfig: FilterConfig = {
        customFilter: (commit) => !commit.message.includes('[skip ci]'),
      };

      const result = filterCommits(commits, filterConfig);

      expect(result.map((c) => c.sha)).toEqual(['2']);
    });
  });

  describe('combined filters', () => {
    it('should apply all filters together', () => {
      const commits = [
        createCommit({
          sha: '1',
          author: { login: 'dependabot[bot]', association: 'contributor' },
          labels: ['dependencies'],
        }),
        createCommit({
          sha: '2',
          author: { login: 'human', association: 'team' },
          labels: ['skip-changelog'],
        }),
        createCommit({
          sha: '3',
          author: { login: 'human', association: 'team' },
          labels: ['bug'],
          prNumber: 50,
        }),
        createCommit({
          sha: '4',
          author: { login: 'human', association: 'contributor' },
          labels: ['enhancement'],
          prNumber: 200,
        }),
      ];
      const filterConfig: FilterConfig = {
        excludeCommitByAuthors: [/\[bot\]$/],
        excludeCommitWithLabels: ['skip-changelog'],
        customFilter: (commit) => commit.prNumber >= 100,
      };

      const result = filterCommits(commits, filterConfig);

      // sha: '1' excluded by author filter (bot)
      // sha: '2' excluded by label filter (skip-changelog)
      // sha: '3' excluded by custom filter (prNumber < 100)
      // sha: '4' passes all filters
      expect(result.map((c) => c.sha)).toEqual(['4']);
    });

    it('should return empty array when all commits are filtered', () => {
      const commits = [
        createCommit({ sha: '1', author: { login: 'bot', association: 'contributor' } }),
        createCommit({ sha: '2', labels: ['internal'] }),
      ];
      const filterConfig: FilterConfig = {
        excludeCommitByAuthors: ['bot'],
        excludeCommitWithLabels: ['internal'],
      };

      const result = filterCommits(commits, filterConfig);

      expect(result).toEqual([]);
    });
  });

  describe('edge cases', () => {
    it('should not mutate the original commits array', () => {
      const commits = [
        createCommit({ sha: '1', author: { login: 'bot', association: 'contributor' } }),
        createCommit({ sha: '2', author: { login: 'human', association: 'contributor' } }),
      ];
      const originalLength = commits.length;
      const filterConfig: FilterConfig = {
        excludeCommitByAuthors: ['bot'],
      };

      filterCommits(commits, filterConfig);

      expect(commits.length).toBe(originalLength);
    });

    it('should handle filterConfig with no filter properties set', () => {
      const commits = [createCommit({ sha: '1' }), createCommit({ sha: '2' })];
      const filterConfig: FilterConfig = {};

      const result = filterCommits(commits, filterConfig);

      expect(result.map((c) => c.sha)).toEqual(['1', '2']);
    });

    it('should use substring matching for string patterns in author exclusion', () => {
      const commits = [
        createCommit({ sha: '1', author: { login: 'my-bot-account', association: 'contributor' } }),
        createCommit({ sha: '2', author: { login: 'botuser', association: 'contributor' } }),
        createCommit({ sha: '3', author: { login: 'human', association: 'contributor' } }),
      ];
      const filterConfig: FilterConfig = {
        excludeCommitByAuthors: ['bot'],
      };

      const result = filterCommits(commits, filterConfig);

      // Both 'my-bot-account' and 'botuser' contain 'bot'
      expect(result.map((c) => c.sha)).toEqual(['3']);
    });
  });
});
