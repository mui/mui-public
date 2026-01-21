/* eslint-disable testing-library/render-result-naming-convention */
import { describe, expect, it } from 'vitest';
// eslint-disable-next-line import/extensions
import { renderChangelog } from './renderChangelog.mjs';
import type { ChangelogSection, CategorizedCommit, ChangelogConfig } from './types';

function createCommit(
  prNumber: number,
  message: string,
  mergedAt?: string,
  author?: string,
): CategorizedCommit {
  return {
    sha: `sha-${prNumber}`,
    message,
    labels: [],
    prNumber,
    html_url: `https://github.com/mui/mui-x/pull/${prNumber}`,
    author: author ? { login: author, association: 'team' } : null,
    createdAt: null,
    mergedAt: mergedAt || null,
    parsed: {
      scopes: [],
      components: [],
      flags: [],
    },
  };
}

function createSection(commits: CategorizedCommit[]): ChangelogSection {
  return {
    key: 'features',
    level: 3,
    commits,
    pkgInfo: null,
  };
}

const baseConfig: ChangelogConfig = {
  format: {
    version: 'v{{version}}',
    dateFormat: '_MMM DD, YYYY_',
    changelogMessage: '{{flagPrefix}}{{message}} (#{{prNumber}})',
  },
  categorization: {
    strategy: 'component',
    sections: {
      fallbackSection: 'Other',
      titles: {},
    },
    labels: {
      plan: {
        values: [],
      },
    },
  },
};

describe('renderChangelog - commit sorting by tags', () => {
  describe('sorting commits with tags', () => {
    it('should group commits by their starting tags', () => {
      const commits = [
        createCommit(
          1,
          '[internal] Remove local Claude settings from the repo',
          '2025-01-10T00:00:00Z',
          'cherniavskii',
        ),
        createCommit(2, '[code-infra] Update codeowners', '2025-01-01T00:00:00Z', 'JCQuintas'),
        createCommit(
          3,
          '[code-infra] Fix `material-ui/disallow-react-api-in-server-components`',
          '2025-01-05T00:00:00Z',
          'JCQuintas',
        ),
        createCommit(4, '[code-infra] Prepare for v9', '2025-01-02T00:00:00Z', 'JCQuintas'),
        createCommit(5, '[docs-infra] Fix two broken links', '2025-01-08T00:00:00Z', 'Janpot'),
        createCommit(
          6,
          '[docs-infra] Fix missing slots section on API page',
          '2025-01-09T00:00:00Z',
          'Janpot',
        ),
      ];

      const section = createSection(commits);
      const result = renderChangelog(
        [section],
        baseConfig,
        {
          version: '1.0.0',
          lastRelease: 'v0.1.0',
          release: 'v1.0.0',
          date: new Date('2025-01-15'),
        },
        { team: [], community: [], all: [] },
      );

      // Extract the commit messages from the rendered output
      const lines = result.split('\n').filter((line) => line.startsWith('- '));

      // All code-infra commits should come first (sorted by tag), then docs-infra, then internal
      expect(lines[0]).toContain('Update codeowners');
      expect(lines[1]).toContain('Prepare for v9');
      expect(lines[2]).toContain('Fix `material-ui/disallow-react-api-in-server-components`');
      expect(lines[3]).toContain('Fix two broken links');
      expect(lines[4]).toContain('Fix missing slots section on API page');
      expect(lines[5]).toContain('Remove local Claude settings from the repo');
    });

    it('should sort commits with same tags by merge time', () => {
      const commits = [
        createCommit(1, '[code-infra] Commit 1', '2025-01-10T00:00:00Z'),
        createCommit(2, '[code-infra] Commit 2', '2025-01-05T00:00:00Z'),
        createCommit(3, '[code-infra] Commit 3', '2025-01-08T00:00:00Z'),
      ];

      const section = createSection(commits);
      const result = renderChangelog(
        [section],
        baseConfig,
        {
          version: '1.0.0',
          lastRelease: 'v0.1.0',
          release: 'v1.0.0',
          date: new Date('2025-01-15'),
        },
        { team: [], community: [], all: [] },
      );

      const lines = result.split('\n').filter((line) => line.startsWith('- '));

      expect(lines[0]).toContain('Commit 2');
      expect(lines[1]).toContain('Commit 3');
      expect(lines[2]).toContain('Commit 1');
    });

    it('should handle commits with multiple tags', () => {
      const commits = [
        createCommit(1, '[code-infra] Update codeowners', '2025-01-01T00:00:00Z', 'JCQuintas'),
        createCommit(
          2,
          '[code-infra][docs] V9 charts migration doc kickoff',
          '2025-01-11T00:00:00Z',
          'JCQuintas',
        ),
        createCommit(3, '[docs-infra] Fix two broken links', '2025-01-08T00:00:00Z', 'Janpot'),
      ];

      const section = createSection(commits);
      const result = renderChangelog(
        [section],
        baseConfig,
        {
          version: '1.0.0',
          lastRelease: 'v0.1.0',
          release: 'v1.0.0',
          date: new Date('2025-01-15'),
        },
        { team: [], community: [], all: [] },
      );

      const lines = result.split('\n').filter((line) => line.startsWith('- '));

      // [code-infra] should come before [code-infra][docs]
      expect(lines[0]).toContain('Update codeowners');
      expect(lines[1]).toContain('V9 charts migration doc kickoff');
      expect(lines[2]).toContain('Fix two broken links');
    });

    it('should handle commits without tags', () => {
      const commits = [
        createCommit(1, '[code-infra] Update codeowners', '2025-01-05T00:00:00Z'),
        createCommit(2, 'No tag commit', '2025-01-01T00:00:00Z'),
        createCommit(3, 'Another no tag commit', '2025-01-02T00:00:00Z'),
      ];

      const section = createSection(commits);
      const result = renderChangelog(
        [section],
        baseConfig,
        {
          version: '1.0.0',
          lastRelease: 'v0.1.0',
          release: 'v1.0.0',
          date: new Date('2025-01-15'),
        },
        { team: [], community: [], all: [] },
      );

      const lines = result.split('\n').filter((line) => line.startsWith('- '));

      // Tagged commits should come before untagged
      expect(lines[0]).toContain('Update codeowners');
      expect(lines[1]).toContain('No tag commit');
      expect(lines[2]).toContain('Another no tag commit');
    });

    it('should match the user-provided example output order', () => {
      const commits = [
        createCommit(
          20853,
          '[internal] Remove local Claude settings from the repo',
          '2025-01-01T00:00:00Z',
          'cherniavskii',
        ),
        createCommit(20886, '[code-infra] Update codeowners', '2025-01-02T00:00:00Z', 'JCQuintas'),
        createCommit(
          20909,
          '[code-infra] Fix `material-ui/disallow-react-api-in-server-components`',
          '2025-01-03T00:00:00Z',
          'JCQuintas',
        ),
        createCommit(20860, '[code-infra] Prepare for v9', '2025-01-04T00:00:00Z', 'JCQuintas'),
        createCommit(20914, '[docs-infra] Fix two broken links', '2025-01-05T00:00:00Z', 'Janpot'),
        createCommit(
          20915,
          '[docs-infra] Fix missing slots section on API page',
          '2025-01-06T00:00:00Z',
          'Janpot',
        ),
        createCommit(
          20922,
          '[code-infra] Github action to sync title and label',
          '2025-01-07T00:00:00Z',
          'brijeshb42',
        ),
        createCommit(
          20934,
          '[code-infra] Fix the label comparison to use lower case',
          '2025-01-08T00:00:00Z',
          'brijeshb42',
        ),
        createCommit(
          20973,
          '[code-infra][docs] V9 charts migration doc kickoff',
          '2025-01-09T00:00:00Z',
          'JCQuintas',
        ),
        createCommit(
          20932,
          '[internal] Set up shared instructions for coding agents',
          '2025-01-10T00:00:00Z',
          'cherniavskii',
        ),
        createCommit(20928, '[code-infra] V9 preparation', '2025-01-11T00:00:00Z', 'JCQuintas'),
        createCommit(
          20977,
          '[code-infra] Fix `renameImports` codemod not preserving comments',
          '2025-01-12T00:00:00Z',
          'JCQuintas',
        ),
        createCommit(
          20982,
          '[code-infra] Ignore scheduler demo with random data',
          '2025-01-13T00:00:00Z',
          'JCQuintas',
        ),
      ];

      const section = createSection(commits);
      const result = renderChangelog(
        [section],
        baseConfig,
        {
          version: '1.0.0',
          lastRelease: 'v0.1.0',
          release: 'v1.0.0',
          date: new Date('2025-01-15'),
        },
        { team: [], community: [], all: [] },
      );

      const lines = result.split('\n').filter((line) => line.startsWith('- '));

      // Expected order: all [code-infra] commits sorted by merge time (chronological),
      // then [code-infra][docs] (which has code-infra as first tag, followed by docs),
      // then [docs-infra], then [internal]
      expect(lines[0]).toContain('20886'); // [code-infra] 2025-01-02
      expect(lines[1]).toContain('20909'); // [code-infra] 2025-01-03
      expect(lines[2]).toContain('20860'); // [code-infra] 2025-01-04
      expect(lines[3]).toContain('20922'); // [code-infra] 2025-01-07
      expect(lines[4]).toContain('20934'); // [code-infra] 2025-01-08
      expect(lines[5]).toContain('20928'); // [code-infra] 2025-01-11
      expect(lines[6]).toContain('20977'); // [code-infra] 2025-01-12
      expect(lines[7]).toContain('20982'); // [code-infra] 2025-01-13
      expect(lines[8]).toContain('20973'); // [code-infra][docs] 2025-01-09
      expect(lines[9]).toContain('20914'); // [docs-infra] 2025-01-05
      expect(lines[10]).toContain('20915'); // [docs-infra] 2025-01-06
      expect(lines[11]).toContain('20853'); // [internal] 2025-01-01
      expect(lines[12]).toContain('20932'); // [internal] 2025-01-10
    });

    it('should handle tags with spaces and hyphens', () => {
      const commits = [
        createCommit(1, '[my-scope] Commit 1', '2025-01-05T00:00:00Z'),
        createCommit(2, '[my scope] Commit 2', '2025-01-01T00:00:00Z'),
        createCommit(3, '[my-scope] Commit 3', '2025-01-02T00:00:00Z'),
      ];

      const section = createSection(commits);
      const result = renderChangelog(
        [section],
        baseConfig,
        {
          version: '1.0.0',
          lastRelease: 'v0.1.0',
          release: 'v1.0.0',
          date: new Date('2025-01-15'),
        },
        { team: [], community: [], all: [] },
      );

      const lines = result.split('\n').filter((line) => line.startsWith('- '));

      // All commits with same tag should be together
      expect(lines[0]).toContain('Commit 2');
      expect(lines[1]).toContain('Commit 3');
      expect(lines[2]).toContain('Commit 1');
    });

    it('should handle case-insensitive tag matching', () => {
      const commits = [
        createCommit(1, '[CODE-INFRA] Uppercase tag', '2025-01-01T00:00:00Z'),
        createCommit(2, '[code-infra] Lowercase tag', '2025-01-02T00:00:00Z'),
        createCommit(3, '[Code-Infra] Mixed case tag', '2025-01-03T00:00:00Z'),
      ];

      const section = createSection(commits);
      const result = renderChangelog(
        [section],
        baseConfig,
        {
          version: '1.0.0',
          lastRelease: 'v0.1.0',
          release: 'v1.0.0',
          date: new Date('2025-01-15'),
        },
        { team: [], community: [], all: [] },
      );

      const lines = result.split('\n').filter((line) => line.startsWith('- '));

      // All should be treated as the same tag and sorted by merge time
      expect(lines[0]).toContain('Uppercase tag');
      expect(lines[1]).toContain('Lowercase tag');
      expect(lines[2]).toContain('Mixed case tag');
    });

    it('should sort commits with merge time fallback to prNumber', () => {
      const commits = [
        createCommit(1, '[code-infra] Commit with mergedAt', null),
        createCommit(3, '[code-infra] Commit 3', null),
        createCommit(2, '[code-infra] Commit 2', null),
      ];

      const section = createSection(commits);
      const result = renderChangelog(
        [section],
        baseConfig,
        {
          version: '1.0.0',
          lastRelease: 'v0.1.0',
          release: 'v1.0.0',
          date: new Date('2025-01-15'),
        },
        { team: [], community: [], all: [] },
      );

      const lines = result.split('\n').filter((line) => line.startsWith('- '));

      // Should be sorted by prNumber when mergedAt is null
      expect(lines[0]).toContain('Commit with mergedAt');
      expect(lines[1]).toContain('Commit 2');
      expect(lines[2]).toContain('Commit 3');
    });
  });
});
