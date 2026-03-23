import { describe, expect, it } from 'vitest';
// eslint-disable-next-line import/extensions
import { categorizeCommits } from './categorizeCommits.mjs';
import type { FetchedCommitDetails, CategorizationConfig, LabelConfig } from './types';

const baseLabelConfig: LabelConfig = {
  plan: {
    values: ['pro', 'premium'],
  },
  flags: {
    'breaking change': { name: 'breaking change' },
  },
};

function createCommit(
  prNumber: number,
  labels: string[],
  overrides?: Partial<FetchedCommitDetails>,
): FetchedCommitDetails {
  return {
    sha: `sha-${prNumber}`,
    message: `feat: feature for PR #${prNumber}`,
    labels,
    prNumber,
    html_url: `https://github.com/mui/mui-x/pull/${prNumber}`,
    author: { login: 'dev', association: 'team' },
    createdAt: null,
    mergedAt: null,
    ...overrides,
  };
}

describe('categorizeCommits', () => {
  describe('component strategy', () => {
    const componentConfig: CategorizationConfig = {
      strategy: 'component',
      labels: baseLabelConfig,
      sections: {
        fallbackSection: 'Other',
      },
    };

    it('should categorize commits by component label', () => {
      const commits = [
        createCommit(1, ['component: Button']),
        createCommit(2, ['component: Checkbox']),
        createCommit(3, ['component: Button']),
      ];

      const result = categorizeCommits(commits, componentConfig);

      expect(result.size).toBe(2);
      // Component labels are normalized to lowercase by parseCommitLabels
      expect(result.get('Button')).toHaveLength(2);
      expect(result.get('Checkbox')).toHaveLength(1);
    });

    it('should place commits without component labels in fallback section', () => {
      const commits = [createCommit(1, []), createCommit(2, ['breaking change'])];

      const result = categorizeCommits(commits, componentConfig);

      expect(result.size).toBe(1);
      expect(result.get('Other')).toHaveLength(2);
    });

    it('should place commits with multiple component labels in multiple sections', () => {
      const commits = [createCommit(1, ['component: Button', 'component: Checkbox'])];

      const result = categorizeCommits(commits, componentConfig);

      expect(result.size).toBe(2);
      // Component labels are normalized to lowercase by parseCommitLabels
      expect(result.get('Button')).toHaveLength(1);
      expect(result.get('Checkbox')).toHaveLength(1);
      // Same commit object in both categories
      expect(result.get('Button')?.[0].prNumber).toBe(1);
      expect(result.get('Checkbox')?.[0].prNumber).toBe(1);
    });

    it('should use categoryOverride when present', () => {
      const configWithOverrides: CategorizationConfig = {
        ...componentConfig,
        labels: {
          ...baseLabelConfig,
          categoryOverrides: {
            'all components': 'General changes',
          },
        },
      };

      const commits = [
        createCommit(1, ['component: Button', 'all components']),
        createCommit(2, ['component: Checkbox']),
        createCommit(3, ['component: Button', 'all components']),
      ];

      const result = categorizeCommits(commits, configWithOverrides);

      expect(result.size).toBe(2);
      expect(result.get('General changes')).toHaveLength(2);
      expect(result.get('General changes')?.[0].prNumber).toBe(1);
      expect(result.get('General changes')?.[1].prNumber).toBe(3);
      // Component labels are normalized to lowercase by parseCommitLabels
      expect(result.get('Checkbox')).toHaveLength(1);
    });
  });

  describe('package strategy', () => {
    const packageConfig: CategorizationConfig = {
      strategy: 'package',
      labels: baseLabelConfig,
      packageNaming: {
        mappings: {
          'data grid': '@mui/x-data-grid',
          charts: '@mui/x-charts',
          pickers: '@mui/x-date-pickers',
        },
        genericScopes: ['docs', 'code-infra'],
        plans: {
          pro: {
            '@mui/x-data-grid': '@mui/x-data-grid-pro',
            '@mui/x-charts': '@mui/x-charts-pro',
            '@mui/x-date-pickers': '@mui/x-date-pickers-pro',
          },
          premium: {
            '@mui/x-data-grid': '@mui/x-data-grid-premium',
          },
        },
      },
      sections: {
        fallbackSection: 'Other',
      },
    };

    it('should categorize commits by scope to package mapping', () => {
      const commits = [
        createCommit(1, ['scope: data grid']),
        createCommit(2, ['scope: charts']),
        createCommit(3, ['scope: data grid']),
      ];

      const result = categorizeCommits(commits, packageConfig);

      expect(result.size).toBe(2);
      expect(result.get('@mui/x-data-grid')).toHaveLength(2);
      expect(result.get('@mui/x-charts')).toHaveLength(1);
    });

    it('should place commits without scope in fallback section', () => {
      const commits = [createCommit(1, []), createCommit(2, ['breaking change'])];

      const result = categorizeCommits(commits, packageConfig);

      expect(result.size).toBe(1);
      expect(result.get('Other')).toHaveLength(2);
    });

    it('should place commits with multiple scope labels in multiple sections', () => {
      const commits = [createCommit(1, ['scope: data grid', 'scope: charts'])];

      const result = categorizeCommits(commits, packageConfig);

      expect(result.size).toBe(2);
      expect(result.get('@mui/x-data-grid')).toHaveLength(1);
      expect(result.get('@mui/x-charts')).toHaveLength(1);
    });

    it('should use generic scopes directly as section names', () => {
      const commits = [createCommit(1, ['scope: docs']), createCommit(2, ['scope: code-infra'])];

      const result = categorizeCommits(commits, packageConfig);

      expect(result.size).toBe(2);
      expect(result.get('docs')).toHaveLength(1);
      expect(result.get('code-infra')).toHaveLength(1);
    });

    it('should apply plan to package name when plan label is present', () => {
      const commits = [
        createCommit(1, ['scope: data grid', 'plan: pro']),
        createCommit(2, ['scope: data grid', 'plan: premium']),
        createCommit(3, ['scope: data grid']),
      ];

      const result = categorizeCommits(commits, packageConfig);

      expect(result.size).toBe(3);
      expect(result.get('@mui/x-data-grid-pro')).toHaveLength(1);
      expect(result.get('@mui/x-data-grid-premium')).toHaveLength(1);
      expect(result.get('@mui/x-data-grid')).toHaveLength(1);
    });

    it('should throw error when scope mapping is not found', () => {
      const commits = [createCommit(42, ['scope: unknown-package'])];

      expect(() => categorizeCommits(commits, packageConfig)).toThrow(
        'No package mapping found for scope "unknown-package" in commit #42',
      );
    });

    it('should throw error when plan mapping is not found for package', () => {
      const commits = [createCommit(42, ['scope: charts', 'plan: premium'])];

      expect(() => categorizeCommits(commits, packageConfig)).toThrow(
        'No premium plan package mapping found for base package "@mui/x-charts" in commit #42',
      );
    });

    it('should throw error when package naming config is missing', () => {
      const configWithoutNaming: CategorizationConfig = {
        strategy: 'package',
        labels: baseLabelConfig,
        sections: {
          fallbackSection: 'Other',
        },
      };

      const commits = [createCommit(1, ['scope: data grid'])];

      expect(() => categorizeCommits(commits, configWithoutNaming)).toThrow(
        'Package naming configuration is required for package-first strategy',
      );
    });

    it('should use categoryOverride when present', () => {
      const configWithOverrides: CategorizationConfig = {
        ...packageConfig,
        labels: {
          ...baseLabelConfig,
          categoryOverrides: {
            'all packages': 'General changes',
          },
        },
      };

      const commits = [
        createCommit(1, ['scope: data grid', 'all packages']),
        createCommit(2, ['scope: charts']),
      ];

      const result = categorizeCommits(commits, configWithOverrides);

      expect(result.size).toBe(2);
      expect(result.get('General changes')).toHaveLength(1);
      expect(result.get('@mui/x-charts')).toHaveLength(1);
    });
  });

  describe('unknown strategy', () => {
    it('should throw error for unknown strategy', () => {
      const invalidConfig = {
        strategy: 'invalid' as 'component',
        labels: baseLabelConfig,
        sections: {
          fallbackSection: 'Other',
        },
      };

      const commits = [createCommit(1, [])];

      expect(() => categorizeCommits(commits, invalidConfig)).toThrow(
        'Unknown categorization strategy: invalid',
      );
    });
  });

  describe('parsed labels', () => {
    const config: CategorizationConfig = {
      strategy: 'component',
      labels: {
        ...baseLabelConfig,
        flags: {
          'breaking change': { name: 'breaking change' },
          enhancement: { name: 'enhancement' },
        },
      },
      sections: {
        fallbackSection: 'Other',
      },
    };

    it('should include parsed labels in categorized commits', () => {
      const commits = [createCommit(1, ['component: Button', 'breaking change', 'enhancement'])];

      const result = categorizeCommits(commits, config);

      const categorizedCommit = result.get('Button')?.[0];
      expect(categorizedCommit?.parsed.components).toEqual(['Button']);
      expect(categorizedCommit?.parsed.flags).toEqual(['breaking change', 'enhancement']);
    });

    it('should include plan in parsed labels', () => {
      const commits = [createCommit(1, ['component: Button', 'plan: pro'])];

      const result = categorizeCommits(commits, config);

      // Component labels are normalized to lowercase by parseCommitLabels
      const categorizedCommit = result.get('Button')?.[0];
      expect(categorizedCommit?.parsed.plan).toBe('pro');
    });
  });

  describe('empty input', () => {
    const config: CategorizationConfig = {
      strategy: 'component',
      labels: baseLabelConfig,
      sections: {
        fallbackSection: 'Other',
      },
    };

    it('should return empty map for empty commits array', () => {
      const result = categorizeCommits([], config);

      expect(result.size).toBe(0);
    });
  });
});
