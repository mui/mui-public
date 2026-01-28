import { describe, expect, it } from 'vitest';
// eslint-disable-next-line import/extensions
import { sortSections } from './sortSections.mjs';
import type { ChangelogSection, CategorizationConfig, LabelConfig } from './types';

const baseLabelConfig: LabelConfig = {
  plan: {
    values: ['pro', 'premium'],
  },
};

function createSection(key: string, commits: number = 1): ChangelogSection {
  return {
    key,
    level: 3,
    commits: Array(commits).fill({
      sha: 'abc123',
      message: 'test commit',
      labels: [],
      prNumber: 1,
      html_url: 'https://github.com/test/repo/pull/1',
      author: null,
      createdAt: null,
      mergedAt: null,
      parsed: { scopes: [], components: [], flags: [] },
    }),
    pkgInfo: null,
  };
}

describe('sortSections', () => {
  describe('default ordering', () => {
    const config: CategorizationConfig = {
      strategy: 'component',
      labels: baseLabelConfig,
      sections: {
        fallbackSection: 'Other',
      },
    };

    it('should sort sections alphabetically by key when no order is specified', () => {
      const sections = [createSection('Zebra'), createSection('Apple'), createSection('Mango')];

      const result = sortSections(sections, config);

      expect(result.map((s) => s.key)).toEqual(['Apple', 'Mango', 'Zebra']);
    });

    it('should return empty array for empty input', () => {
      const result = sortSections([], config);

      expect(result).toEqual([]);
    });
  });

  describe('priority ordering', () => {
    it('should sort sections by order index (lower values first)', () => {
      const config: CategorizationConfig = {
        strategy: 'component',
        labels: baseLabelConfig,
        sections: {
          order: {
            Zebra: -1,
            Apple: 1,
            Mango: 0,
          },
          fallbackSection: 'Other',
        },
      };

      const sections = [createSection('Apple'), createSection('Zebra'), createSection('Mango')];

      const result = sortSections(sections, config);

      expect(result.map((s) => s.key)).toEqual(['Zebra', 'Mango', 'Apple']);
    });

    it('should sort alphabetically when order index is the same', () => {
      const config: CategorizationConfig = {
        strategy: 'component',
        labels: baseLabelConfig,
        sections: {
          order: {
            Zebra: 0,
            Apple: 0,
            Mango: 0,
          },
          fallbackSection: 'Other',
        },
      };

      const sections = [createSection('Zebra'), createSection('Apple'), createSection('Mango')];

      const result = sortSections(sections, config);

      expect(result.map((s) => s.key)).toEqual(['Apple', 'Mango', 'Zebra']);
    });

    it('should use default order index of 0 for sections not in order config', () => {
      const config: CategorizationConfig = {
        strategy: 'component',
        labels: baseLabelConfig,
        sections: {
          order: {
            Zebra: -1,
            Apple: 1,
          },
          fallbackSection: 'Other',
        },
      };

      const sections = [
        createSection('Apple'),
        createSection('Zebra'),
        createSection('Mango'), // Not in order config, defaults to 0
      ];

      const result = sortSections(sections, config);

      // Zebra (-1) < Mango (0) < Apple (1)
      expect(result.map((s) => s.key)).toEqual(['Zebra', 'Mango', 'Apple']);
    });

    it('should handle negative order indices', () => {
      const config: CategorizationConfig = {
        strategy: 'component',
        labels: baseLabelConfig,
        sections: {
          order: {
            First: -100,
            Second: -50,
            Third: 0,
            Last: 100,
          },
          fallbackSection: 'Other',
        },
      };

      const sections = [
        createSection('Last'),
        createSection('Third'),
        createSection('First'),
        createSection('Second'),
      ];

      const result = sortSections(sections, config);

      expect(result.map((s) => s.key)).toEqual(['First', 'Second', 'Third', 'Last']);
    });

    it('should not mutate the original array', () => {
      const config: CategorizationConfig = {
        strategy: 'component',
        labels: baseLabelConfig,
        sections: {
          order: {
            Zebra: -1,
          },
          fallbackSection: 'Other',
        },
      };

      const sections = [createSection('Apple'), createSection('Zebra')];
      const originalOrder = sections.map((s) => s.key);

      sortSections(sections, config);

      expect(sections.map((s) => s.key)).toEqual(originalOrder);
    });
  });

  describe('package strategy', () => {
    it('should sort package sections by order index', () => {
      const config: CategorizationConfig = {
        strategy: 'package',
        labels: baseLabelConfig,
        packageNaming: {
          mappings: {
            'data grid': '@mui/x-data-grid',
            charts: '@mui/x-charts',
          },
        },
        sections: {
          order: {
            '@mui/x-charts': -1,
            '@mui/x-data-grid': 1,
          },
          fallbackSection: 'Other',
        },
      };

      const sections = [createSection('@mui/x-data-grid'), createSection('@mui/x-charts')];

      const result = sortSections(sections, config);

      expect(result.map((s) => s.key)).toEqual(['@mui/x-charts', '@mui/x-data-grid']);
    });
  });
});
