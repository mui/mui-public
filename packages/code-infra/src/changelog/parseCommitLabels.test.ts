import { describe, expect, it } from 'vitest';
// eslint-disable-next-line import/extensions
import { parseCommitLabels } from './parseCommitLabels.mjs';
import type { FetchedCommitDetails, LabelConfig } from './types';

const baseLabelConfig: LabelConfig = {
  scope: {
    prefix: 'scope:',
    required: false,
  },
  component: {
    prefix: 'component:',
    required: false,
  },
  plan: {
    prefix: 'plan:',
    values: ['pro', 'premium'],
  },
  flags: {
    'breaking change': { name: 'breaking change' },
  },
};

function createCommit(labels: string[]): FetchedCommitDetails {
  return {
    sha: 'sha',
    message: 'message',
    labels,
    prNumber: 1,
    html_url: 'https://example.com',
    author: { login: 'dev', association: 'team' },
    createdAt: null,
    mergedAt: null,
  };
}

describe('parseCommitLabels', () => {
  it('supports multiple string prefixes with first match wins', () => {
    const config: LabelConfig = {
      ...baseLabelConfig,
      scope: {
        prefix: ['scope:', 'pkg:'],
        required: false,
      },
    };

    const parsed = parseCommitLabels(createCommit(['pkg: charts', 'component: axis']), config);

    expect(parsed.scopes).toEqual(['charts']);
    expect(parsed.components).toEqual(['axis']);
  });

  it('supports regex prefixes for scope and component', () => {
    const config: LabelConfig = {
      ...baseLabelConfig,
      scope: {
        prefix: [/^scope:\s*/i],
        required: false,
      },
      component: {
        prefix: [/^component:\s*/, /^cmp:\s*/i],
        required: false,
      },
    };

    const parsed = parseCommitLabels(createCommit(['Scope: utils', 'cmp: tooltip']), config);

    expect(parsed.scopes).toEqual(['utils']);
    expect(parsed.components).toEqual(['tooltip']);
  });

  it('prefers the first matching prefix when multiple prefixes match', () => {
    const config: LabelConfig = {
      ...baseLabelConfig,
      scope: {
        prefix: [/^scope:\s*component:/, 'scope:'],
        required: false,
      },
    };

    const parsed = parseCommitLabels(createCommit(['scope: component:charts']), config);

    expect(parsed.scopes).toEqual(['charts']);
  });
});
