import { describe, expect, it } from 'vitest';
// eslint-disable-next-line import/extensions
import { mapPrefixes, matchPrefix, parseTitle } from './index.mjs';

describe('parseTitle', () => {
  it.each([
    ['[docs][tree view] Fix typo', { prefixes: ['docs', 'tree view'], text: 'Fix typo' }],
    ['[docs] [charts]Fix typo', { prefixes: ['docs', 'charts'], text: 'Fix typo' }],
    ['Fix typo', { prefixes: [], text: 'Fix typo' }],
    ['Fix `[docs]` prefix', { prefixes: [], text: 'Fix `[docs]` prefix' }],
    ['[] is not a prefix', { prefixes: [], text: '[] is not a prefix' }],
    ['[docs]', { prefixes: ['docs'], text: '' }],
  ])('splits %s', (title, expected) => {
    expect(parseTitle(title)).toEqual(expected);
  });
});

describe('matchPrefix', () => {
  it.each(['tree view', 'TreeView', 'tree-view', 'Tree_View'])(
    'recognizes %s as a spelling of the candidate',
    (prefix) => {
      expect(matchPrefix(prefix, ['treeview pro', 'tree view'])).toBe('tree view');
    },
  );

  it('matches whole prefixes only', () => {
    expect(matchPrefix('charts', ['charts-pro'])).toBeUndefined();
    expect(matchPrefix('charts-pro', ['charts'])).toBeUndefined();
  });
});

describe('mapPrefixes', () => {
  it('makes the spelling of prefixes consistent', () => {
    const spellings = ['DataGrid', 'tree view'];
    const respell = (title: string) =>
      mapPrefixes(title, (prefix) => matchPrefix(prefix, spellings) ?? prefix);

    expect(respell('[data grid] Fix it')).toBe('[DataGrid] Fix it');
    expect(respell('[data-grid][TreeView][docs] Fix it')).toBe(
      '[DataGrid][tree view][docs] Fix it',
    );
  });

  it('leaves out duplicates and empty prefixes', () => {
    expect(mapPrefixes('[a][A][b] Fix it', (prefix) => prefix.toLowerCase())).toBe('[a][b] Fix it');
    expect(mapPrefixes('[docs] Fix it', () => '')).toBe('Fix it');
  });

  it('does not touch the rest of the title', () => {
    const text = 'Fix `<Foo  bar={["a"]} />` and **bold** [link](https://mui.com) &nbsp; \\_';
    expect(mapPrefixes(`[docs] ${text}`, (prefix) => prefix)).toBe(`[docs] ${text}`);
  });
});
