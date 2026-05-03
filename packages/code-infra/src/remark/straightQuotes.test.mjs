import { describe, it, expect } from 'vitest';
import { createLintTester } from './createLintTester.mjs';
import plugin from './straightQuotes.mjs';

const lint = createLintTester(plugin);

describe('remark-lint-mui-straight-quotes', () => {
  it('accepts straight quotes', () => {
    expect(lint(`# Title\n\nA paragraph with "straight" and 'simple' quotes.\n`)).toEqual([]);
  });

  it('flags curly double quotes with correct location', () => {
    const messages = lint(`# Title\n\nA paragraph with “curly” quotes.\n`);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ line: 3, column: 18 });
    expect(messages[1]).toMatchObject({ line: 3, column: 24 });
  });

  it('flags curly single quotes', () => {
    const messages = lint(`Use ‘single’ curly quotes too.\n`);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ line: 1, column: 5 });
    expect(messages[1]).toMatchObject({ line: 1, column: 12 });
  });
});
