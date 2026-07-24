import { describe, expect, it } from 'vitest';
import { LANGUAGES } from './highlight';
import type { Token } from './highlight';
import { extractEmphasis, resolveTextHighlightRanges, splitTokensAtRanges } from './emphasis';

describe('extractEmphasis', () => {
  it('strips and maps single-line and range highlights', () => {
    const source = [
      'const a = 1; // @highlight',
      '// @highlight-start',
      'const b = 2;',
      'const c = 3;',
      '// @highlight-end',
      '',
    ].join('\n');
    const result = extractEmphasis(source, LANGUAGES.ts);
    expect(result.source).not.toContain('@highlight');
    expect([...result.highlightLines]).toEqual([1, 2, 3]);
  });

  it('combines focus padding with text targets', () => {
    const source = [
      'const a = 1;',
      '// @highlight-start @focus @padding 1',
      'const b = value; // @highlight-text "value"',
      '// @highlight-end',
      'const c = 3;',
      '',
    ].join('\n');
    const result = extractEmphasis(source, LANGUAGES.ts);
    expect(result.focusRange).toEqual({ start: 1, end: 3 });
    expect(Object.fromEntries(result.textHighlights)).toEqual({ 2: ['value'] });
  });

  it('ignores unmatched and prefix-sharing directives', () => {
    const source = ['// @focused on performance', '// @highlight-end', 'const a = 1;'].join('\n');
    const result = extractEmphasis(source, LANGUAGES.ts);
    expect(result.source).toContain('@focused');
    expect(result.highlightLines.size).toBe(0);
    expect(result.focusRange).toBeNull();
  });
});

describe('resolveTextHighlightRanges', () => {
  it('finds repeated targets without overlapping prior matches', () => {
    expect(resolveTextHighlightRanges('value value', new Map([[1, ['value', 'value']]]))).toEqual([
      { from: 0, to: 5 },
      { from: 6, to: 11 },
    ]);
  });
});

describe('splitTokensAtRanges', () => {
  it('preserves token classes across a range spanning tokens', () => {
    const tokens: Token[] = [
      { text: 'foo', classes: 'pl-a' },
      { text: 'bar', classes: 'pl-b' },
    ];
    expect(splitTokensAtRanges(tokens, [{ from: 2, to: 5 }])).toEqual([
      { text: 'fo', classes: 'pl-a' },
      { text: 'o', classes: 'pl-a', mark: true },
      { text: 'ba', classes: 'pl-b', mark: true },
      { text: 'r', classes: 'pl-b' },
    ]);
  });
});
