import { describe, expect, it } from 'vitest';
import { createChange } from './__fixtures__/changes';
// eslint-disable-next-line import/extensions
import { creditAuthors, groupBy, labelValues, readLabels, sortByTitle } from './index.mjs';

const PREFIXES = {
  DataGrid: ['scope: data grid'],
  DataGridPro: ['scope: data grid', 'plan: pro'],
  charts: ['scope: charts'],
  docs: ['docs'],
};

describe('readLabels', () => {
  it('reads labels and the meaning of prefixes', () => {
    const change = { title: '[docs][DataGridPro] Fix it', labels: ['breaking change'] };

    expect(readLabels(change, PREFIXES)).toEqual([
      'breaking change',
      'docs',
      'scope: data grid',
      'plan: pro',
    ]);
    expect(readLabels(change)).toEqual(['breaking change']);
  });

  it('lets labels win over prefixes of the same kind', () => {
    const title = '[docs][DataGridPro] Fix it';

    expect(readLabels({ title, labels: ['scope: charts'] }, PREFIXES)).toEqual([
      'scope: charts',
      'docs',
      'plan: pro',
    ]);
    expect(readLabels({ title, labels: ['plan: premium'] }, PREFIXES)).toEqual([
      'plan: premium',
      'docs',
      'scope: data grid',
    ]);
    expect(readLabels({ title, labels: ['docs'] }, PREFIXES)).toEqual([
      'docs',
      'scope: data grid',
      'plan: pro',
    ]);
  });

  it('recognizes prefixes in any spelling', () => {
    expect(readLabels({ title: '[data grid pro] Fix it', labels: [] }, PREFIXES)).toEqual([
      'scope: data grid',
      'plan: pro',
    ]);
  });

  it('ignores prefixes without a meaning', () => {
    expect(readLabels({ title: '[constructor][l10n] Fix it', labels: [] }, PREFIXES)).toEqual([]);
  });

  it('does not duplicate what several prefixes mean', () => {
    expect(readLabels({ title: '[DataGrid][DataGridPro] Fix it', labels: [] }, PREFIXES)).toEqual([
      'scope: data grid',
      'plan: pro',
    ]);
  });
});

describe('labelValues', () => {
  it('returns the values of a kind', () => {
    const labels = ['scope: data grid', 'scopes: none', 'plan: Pro', 'docs', 'scope:charts'];

    expect(labelValues(labels, 'scope')).toEqual(['data grid', 'charts']);
    expect(labelValues(labels, 'component')).toEqual([]);
  });
});

describe('groupBy', () => {
  it('puts items in several groups, or in none', () => {
    const groups = groupBy(['ab', 'b', '', 'bb'], (item) => [...item]);

    expect(Object.fromEntries(groups)).toEqual({ a: ['ab'], b: ['ab', 'b', 'bb'] });
  });

  it('accepts a single group or nothing', () => {
    const groups = groupBy([1, 2, 3], (item) => (item === 2 ? null : 'odd'));

    expect(Object.fromEntries(groups)).toEqual({ odd: [1, 3] });
  });

  it('keeps the type of the groups', () => {
    const groups = groupBy([1, 2], (item) => (item === 1 ? 'docs' : ['core']));

    expect(groups.get('docs')).toEqual([1]);
    // @ts-expect-error -- not a group
    expect(groups.get('dosc')).toBeUndefined();
  });
});

describe('sortByTitle', () => {
  const changes = [
    createChange({ number: 1, title: 'Without a prefix' }),
    createChange({ number: 2, title: '[charts] Add `a` to B' }),
    createChange({ number: 3, title: '[charts] Fix step 2' }),
    createChange({ number: 4, title: '[charts] Fix step 10' }),
    createChange({ number: 7, title: '[charts] Same', sha: 'f'.repeat(40) }),
    createChange({ number: 12, title: '[charts] Same', sha: 'e'.repeat(40) }),
    createChange({ number: null, title: '[charts] Same commit', sha: 'a'.repeat(40) }),
    createChange({ number: null, title: '[charts] Same commit', sha: 'b'.repeat(40) }),
    createChange({ number: 5, title: '[charts][docs] Add it' }),
    createChange({ number: 6, title: '[tree view] Add it' }),
  ];

  it('gives the same order no matter how the changes are ordered', () => {
    expect(sortByTitle(changes)).toEqual(changes);
    expect(sortByTitle([...changes].reverse())).toEqual(changes);
  });

  it('does not change what it is given', () => {
    const reversed = [...changes].reverse();
    sortByTitle(reversed);
    expect(reversed[0]).toBe(changes.at(-1));
  });
});

describe('creditAuthors', () => {
  const credit = (
    authors: Parameters<typeof createChange>[0]['author'][],
    options?: Parameters<typeof creditAuthors>[1],
  ) => {
    const { all, team, community } = creditAuthors(
      authors.map((author, index) => createChange({ number: index, author })),
      options,
    );
    const names = (list: typeof all) => list.map(({ login, name }) => login ?? name);
    return { all: names(all), team: names(team), community: names(community) };
  };

  it('credits everyone once, as team or community', () => {
    expect(
      credit([
        { login: 'zoe', association: 'team' },
        { login: 'Bob', association: 'first-timer' },
        { login: 'alice' },
        { login: 'zoe', association: 'team' },
        { login: 'Alice' },
      ]),
    ).toEqual({ all: ['alice', 'Bob', 'zoe'], team: ['zoe'], community: ['alice', 'Bob'] });
  });

  it.each([
    ['first', ['team', 'community'] as const],
    ['last', ['community', 'team'] as const],
  ])('credits someone as team when that comes %s', (position, associations) => {
    expect(credit(associations.map((association) => ({ login: 'zoe', association })))).toEqual({
      all: ['zoe'],
      team: ['zoe'],
      community: [],
    });
  });

  it('leaves out excluded logins', () => {
    expect(
      credit([{ login: 'renovate[bot]' }, { login: 'Copilot' }, { login: 'bob' }], {
        exclude: ['renovate[bot]', 'copilot'],
      }).all,
    ).toEqual(['bob']);
  });

  it('credits authors without an account by name, and skips unknown ones', () => {
    expect(
      credit([
        { login: null, name: 'Jane Doe' },
        { login: null, name: 'Jane Doe' },
        { login: null, name: null },
        null,
      ]).all,
    ).toEqual(['Jane Doe']);
  });

  it('does not take a name for the login of someone else', () => {
    expect(credit([{ login: null, name: 'bob' }, { login: 'bob' }]).all).toHaveLength(2);
  });
});
