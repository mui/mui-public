import { describe, expect, it } from 'vitest';
import { createChange } from './__fixtures__/changes';
import {
  bulletList,
  formatAuthor,
  formatDate,
  formatReference,
  joinBlocks,
  joinWords,
  section,
  // eslint-disable-next-line import/extensions
} from './index.mjs';

describe('joinBlocks', () => {
  it('puts one blank line between blocks, whatever is in them', () => {
    const condition = false;

    expect(
      joinBlocks('\n\n## 1.0.0\n', '', condition && 'never', null, undefined, '  \n', [
        'One\n\n',
        [],
        ['Two', joinBlocks('Three', 'Four')],
      ]),
    ).toBe('## 1.0.0\n\nOne\n\nTwo\n\nThree\n\nFour');
  });

  it('keeps blank lines and indentation inside a block', () => {
    const code = '  ```js\n  a();\n\n\n  b();\n  ```';

    expect(joinBlocks('Before', code, 'After')).toBe(`Before\n\n${code}\n\nAfter`);
  });

  it('is empty without content', () => {
    expect(joinBlocks()).toBe('');
    expect(joinBlocks(null, ['', [false]])).toBe('');
  });
});

describe('section', () => {
  it('has a heading when there is something below it', () => {
    expect(section('### Docs', null, '- One')).toBe('### Docs\n\n- One');
  });

  it('is left out when there is nothing below it', () => {
    expect(section('### Docs', null, bulletList([]), [section('#### Nested', '')])).toBe('');
  });
});

describe('bulletList', () => {
  it('lists items', () => {
    expect(bulletList(['One', '', null, 'Two'])).toBe('- One\n- Two');
  });

  it('keeps the lines of an item together', () => {
    expect(bulletList(['One\n\n```js\na();\n```\n', 'Two'])).toBe(
      '- One\n\n  ```js\n  a();\n  ```\n- Two',
    );
  });
});

describe('the line of a change', () => {
  const format = (change: ReturnType<typeof createChange>) =>
    joinWords(change.title, `(${formatReference(change)})`, formatAuthor(change.author));

  it('has the title as the author wrote it', () => {
    const title = '[docs] Fix `<Foo  bar />` **and** `a_b` *c* [link](https://mui.com) \\_ <kbd>';

    expect(format(createChange({ number: 1, title }))).toBe(`${title} (#1) @octocat`);
  });

  it('has a SHA without a pull request', () => {
    expect(format(createChange({ number: null, title: 'Fix it', sha: 'abcdef0123456789' }))).toBe(
      'Fix it (abcdef0) @octocat',
    );
  });

  it('has the name of an author without an account', () => {
    const title = 'Fix it';

    expect(format(createChange({ number: 1, title, author: { login: null, name: 'Jane' } }))).toBe(
      'Fix it (#1) Jane',
    );
    expect(
      format(createChange({ number: 1, title, author: { login: null, name: '_J_ <b> [x]' } })),
    ).toBe('Fix it (#1) \\_J\\_ \\<b\\> \\[x\\]');
  });

  it.each([null, { login: null, name: null }])('has no author when it is unknown', (author) => {
    expect(format(createChange({ number: 1, title: 'Fix it', author }))).toBe('Fix it (#1)');
  });
});

describe('formatDate', () => {
  it('does not depend on the time zone', () => {
    expect(formatDate('2026-11-05T00:30:00.000Z')).toBe('Nov 5, 2026');
    expect(formatDate('2026-11-05T23:30:00.000Z')).toBe('Nov 5, 2026');
  });
});
