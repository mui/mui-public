import { describe, expect, it } from 'vitest';
// eslint-disable-next-line import/extensions
import { parseCommitLabels } from './parseCommitLabels.mjs';
import type { FetchedCommitDetails, LabelConfig } from './types';

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

const baseLabelConfig: LabelConfig = {
  plan: {
    values: ['pro', 'premium'],
  },
};

describe('parseCommitLabels', () => {
  describe('basic parsing', () => {
    it('should return empty arrays when commit has no labels', () => {
      const commit = createCommit({ labels: [] });

      const result = parseCommitLabels(commit, baseLabelConfig);

      expect(result).toEqual({
        scopes: [],
        components: [],
        flags: [],
      });
    });

    it('should ignore unrecognized labels', () => {
      const commit = createCommit({ labels: ['random-label', 'another-label'] });

      const result = parseCommitLabels(commit, baseLabelConfig);

      expect(result).toEqual({
        scopes: [],
        components: [],
        flags: [],
      });
    });
  });

  describe('scope parsing', () => {
    it('should parse scope label with default prefix', () => {
      const commit = createCommit({ labels: ['scope: data-grid'] });

      const result = parseCommitLabels(commit, baseLabelConfig);

      expect(result.scopes).toEqual(['data-grid']);
    });

    it('should parse multiple scope labels', () => {
      const commit = createCommit({ labels: ['scope: data-grid', 'scope: charts'] });

      const result = parseCommitLabels(commit, baseLabelConfig);

      expect(result.scopes).toEqual(['data-grid', 'charts']);
    });

    it('should parse scope labels with custom prefix', () => {
      const commit = createCommit({ labels: ['package: core', 'package: utils'] });
      const config: LabelConfig = {
        ...baseLabelConfig,
        scope: {
          prefix: ['package:'],
        },
      };

      const result = parseCommitLabels(commit, config);

      expect(result.scopes).toEqual(['core', 'utils']);
    });

    it('should support multiple scope prefixes', () => {
      const commit = createCommit({ labels: ['scope: data-grid', 'package: utils'] });
      const config: LabelConfig = {
        ...baseLabelConfig,
        scope: {
          prefix: ['scope:', 'package:'],
        },
      };

      const result = parseCommitLabels(commit, config);

      expect(result.scopes).toEqual(['data-grid', 'utils']);
    });

    it('should trim whitespace from scope values', () => {
      const commit = createCommit({ labels: ['scope:  data-grid  '] });

      const result = parseCommitLabels(commit, baseLabelConfig);

      expect(result.scopes).toEqual(['data-grid']);
    });
  });

  describe('component parsing', () => {
    it('should parse component label with default prefix', () => {
      const commit = createCommit({ labels: ['component: Button'] });

      const result = parseCommitLabels(commit, baseLabelConfig);

      expect(result.components).toEqual(['Button']);
    });

    it('should parse multiple component labels', () => {
      const commit = createCommit({ labels: ['component: Button', 'component: TextField'] });

      const result = parseCommitLabels(commit, baseLabelConfig);

      expect(result.components).toEqual(['Button', 'TextField']);
    });

    it('should parse component labels with custom prefix', () => {
      const commit = createCommit({ labels: ['comp: Button', 'comp: Input'] });
      const config: LabelConfig = {
        ...baseLabelConfig,
        component: {
          prefix: ['comp:'],
        },
      };

      const result = parseCommitLabels(commit, config);

      expect(result.components).toEqual(['Button', 'Input']);
    });

    it('should support multiple component prefixes', () => {
      const commit = createCommit({ labels: ['component: Button', 'widget: Slider'] });
      const config: LabelConfig = {
        ...baseLabelConfig,
        component: {
          prefix: ['component:', 'widget:'],
        },
      };

      const result = parseCommitLabels(commit, config);

      expect(result.components).toEqual(['Button', 'Slider']);
    });

    it('should trim whitespace from component values', () => {
      const commit = createCommit({ labels: ['component:  Button  '] });

      const result = parseCommitLabels(commit, baseLabelConfig);

      expect(result.components).toEqual(['Button']);
    });
  });

  describe('plan parsing', () => {
    it('should parse plan label', () => {
      const commit = createCommit({ labels: ['plan: pro'] });

      const result = parseCommitLabels(commit, baseLabelConfig);

      expect(result.plan).toBe('pro');
    });

    it('should normalize plan value to lowercase', () => {
      const commit = createCommit({ labels: ['plan: PRO'] });

      const result = parseCommitLabels(commit, baseLabelConfig);

      expect(result.plan).toBe('pro');
    });

    it('should only accept configured plan values', () => {
      const commit = createCommit({ labels: ['plan: enterprise'] });

      const result = parseCommitLabels(commit, baseLabelConfig);

      expect(result.plan).toBeUndefined();
    });

    it('should accept plan values from config', () => {
      const commit = createCommit({ labels: ['plan: enterprise'] });
      const config: LabelConfig = {
        plan: {
          values: ['pro', 'premium', 'enterprise'],
        },
      };

      const result = parseCommitLabels(commit, config);

      expect(result.plan).toBe('enterprise');
    });

    it('should use the last plan label when multiple are present', () => {
      const commit = createCommit({ labels: ['plan: pro', 'plan: premium'] });

      const result = parseCommitLabels(commit, baseLabelConfig);

      expect(result.plan).toBe('premium');
    });
  });

  describe('category overrides', () => {
    it('should detect category override labels', () => {
      const commit = createCommit({ labels: ['all components'] });
      const config: LabelConfig = {
        ...baseLabelConfig,
        categoryOverrides: {
          'all components': 'General changes',
        },
      };

      const result = parseCommitLabels(commit, config);

      expect(result.categoryOverride).toBe('General changes');
    });

    it('should use the last category override when multiple are present', () => {
      const commit = createCommit({ labels: ['all components', 'docs'] });
      const config: LabelConfig = {
        ...baseLabelConfig,
        categoryOverrides: {
          'all components': 'General changes',
          docs: 'Documentation',
        },
      };

      const result = parseCommitLabels(commit, config);

      expect(result.categoryOverride).toBe('Documentation');
    });

    it('should not set categoryOverride when no matching labels', () => {
      const commit = createCommit({ labels: ['scope: core'] });
      const config: LabelConfig = {
        ...baseLabelConfig,
        categoryOverrides: {
          'all components': 'General changes',
        },
      };

      const result = parseCommitLabels(commit, config);

      expect(result.categoryOverride).toBeUndefined();
    });
  });

  describe('flags parsing', () => {
    it('should parse configured flag labels', () => {
      const commit = createCommit({ labels: ['breaking change', 'enhancement'] });
      const config: LabelConfig = {
        ...baseLabelConfig,
        flags: {
          'breaking change': { name: 'Breaking' },
          enhancement: { name: 'Enhancement' },
        },
      };

      const result = parseCommitLabels(commit, config);

      expect(result.flags).toEqual(['breaking change', 'enhancement']);
    });

    it('should only include explicitly configured flags', () => {
      const commit = createCommit({ labels: ['breaking change', 'random-label', 'bug'] });
      const config: LabelConfig = {
        ...baseLabelConfig,
        flags: {
          'breaking change': { name: 'Breaking' },
          bug: { name: 'Bug fix' },
        },
      };

      const result = parseCommitLabels(commit, config);

      expect(result.flags).toEqual(['breaking change', 'bug']);
    });

    it('should return empty flags array when no flags configured', () => {
      const commit = createCommit({ labels: ['breaking change'] });

      const result = parseCommitLabels(commit, baseLabelConfig);

      expect(result.flags).toEqual([]);
    });

    it('should return empty flags array when flags config is empty object', () => {
      const commit = createCommit({ labels: ['breaking change'] });
      const config: LabelConfig = {
        ...baseLabelConfig,
        flags: {},
      };

      const result = parseCommitLabels(commit, config);

      expect(result.flags).toEqual([]);
    });
  });

  describe('extractLabelsFromTitle', () => {
    it('should extract labels from commit title', () => {
      const commit = createCommit({ message: '[core] Fix bug in Button', labels: [] });
      const config: LabelConfig = {
        ...baseLabelConfig,
        extractLabelsFromTitle: (title) => {
          const match = title.match(/^\[([^\]]+)\]/);
          return match ? [`scope: ${match[1]}`] : [];
        },
      };

      const result = parseCommitLabels(commit, config);

      expect(result.scopes).toEqual(['core']);
      expect(commit.labels).toContain('scope: core');
    });

    it('should merge extracted labels with existing labels', () => {
      const commit = createCommit({
        message: '[charts] Add new feature',
        labels: ['enhancement'],
      });
      const config: LabelConfig = {
        ...baseLabelConfig,
        extractLabelsFromTitle: (title) => {
          const match = title.match(/^\[([^\]]+)\]/);
          return match ? [`scope: ${match[1]}`] : [];
        },
      };

      const result = parseCommitLabels(commit, config);

      expect(result.scopes).toEqual(['charts']);
      expect(commit.labels).toContain('scope: charts');
      expect(commit.labels).toContain('enhancement');
    });

    it('should deduplicate labels when extracting from title', () => {
      const commit = createCommit({
        message: '[core] Fix bug',
        labels: ['scope: core'],
      });
      const config: LabelConfig = {
        ...baseLabelConfig,
        extractLabelsFromTitle: (title) => {
          const match = title.match(/^\[([^\]]+)\]/);
          return match ? [`scope: ${match[1]}`] : [];
        },
      };

      parseCommitLabels(commit, config);

      const scopeLabels = commit.labels.filter((l) => l === 'scope: core');
      expect(scopeLabels).toHaveLength(1);
    });

    it('should use only first line of commit message for title extraction', () => {
      const commit = createCommit({
        message: '[core] Fix bug\n\nThis is a longer description with [charts] mentioned',
        labels: [],
      });
      const config: LabelConfig = {
        ...baseLabelConfig,
        extractLabelsFromTitle: (title) => {
          const matches = title.match(/\[([^\]]+)\]/g);
          return matches ? matches.map((m) => `scope: ${m.slice(1, -1)}`) : [];
        },
      };

      const result = parseCommitLabels(commit, config);

      expect(result.scopes).toEqual(['core']);
    });

    it('should handle extractLabelsFromTitle returning empty array', () => {
      const commit = createCommit({ message: 'Fix bug without scope', labels: ['enhancement'] });
      const config: LabelConfig = {
        ...baseLabelConfig,
        extractLabelsFromTitle: () => [],
      };

      parseCommitLabels(commit, config);

      expect(commit.labels).toEqual(['enhancement']);
    });

    it('should not call extractLabelsFromTitle if not a function', () => {
      const commit = createCommit({ message: '[core] Fix bug', labels: [] });
      const config: LabelConfig = {
        ...baseLabelConfig,
        // extractLabelsFromTitle not defined
      };

      const result = parseCommitLabels(commit, config);

      expect(result.scopes).toEqual([]);
      expect(commit.labels).toEqual([]);
    });
  });

  describe('combined parsing', () => {
    it('should parse all label types together', () => {
      const commit = createCommit({
        labels: [
          'scope: data-grid',
          'component: DataGrid',
          'plan: pro',
          'breaking change',
          'enhancement',
        ],
      });
      const config: LabelConfig = {
        ...baseLabelConfig,
        flags: {
          'breaking change': { name: 'Breaking' },
          enhancement: { name: 'Enhancement' },
        },
      };

      const result = parseCommitLabels(commit, config);

      expect(result.scopes).toEqual(['data-grid']);
      expect(result.components).toEqual(['DataGrid']);
      expect(result.plan).toBe('pro');
      expect(result.flags).toEqual(['breaking change', 'enhancement']);
    });

    it('should handle complex real-world label combinations', () => {
      const commit = createCommit({
        message: '[data-grid] Fix row selection bug',
        labels: [
          'scope: data-grid',
          'component: DataGrid',
          'plan: premium',
          'bug',
          'breaking change',
        ],
      });
      const config: LabelConfig = {
        plan: {
          values: ['pro', 'premium'],
        },
        flags: {
          bug: { name: 'Bug fix' },
          'breaking change': { name: 'Breaking', prefix: '💥 ' },
        },
        extractLabelsFromTitle: (title) => {
          const match = title.match(/^\[([^\]]+)\]/);
          return match ? [`scope: ${match[1]}`] : [];
        },
      };

      const result = parseCommitLabels(commit, config);

      expect(result.scopes).toEqual(['data-grid']);
      expect(result.components).toEqual(['DataGrid']);
      expect(result.plan).toBe('premium');
      expect(result.flags).toEqual(['bug', 'breaking change']);
    });
  });

  describe('edge cases', () => {
    it('should handle labels with colons in the value', () => {
      const commit = createCommit({ labels: ['scope: foo:bar'] });

      const result = parseCommitLabels(commit, baseLabelConfig);

      expect(result.scopes).toEqual(['foo:bar']);
    });

    it('should handle empty string labels', () => {
      const commit = createCommit({ labels: ['', 'scope: core'] });

      const result = parseCommitLabels(commit, baseLabelConfig);

      expect(result.scopes).toEqual(['core']);
    });

    it('should handle scope prefix without value', () => {
      const commit = createCommit({ labels: ['scope:'] });

      const result = parseCommitLabels(commit, baseLabelConfig);

      expect(result.scopes).toEqual(['']);
    });

    it('should mutate the original commit labels array when extracting from title', () => {
      const commit = createCommit({ message: '[core] Fix bug', labels: [] });
      const config: LabelConfig = {
        ...baseLabelConfig,
        extractLabelsFromTitle: (title) => {
          const match = title.match(/^\[([^\]]+)\]/);
          return match ? [`scope: ${match[1]}`] : [];
        },
      };

      parseCommitLabels(commit, config);

      expect(commit.labels).toEqual(['scope: core']);
    });
  });
});
