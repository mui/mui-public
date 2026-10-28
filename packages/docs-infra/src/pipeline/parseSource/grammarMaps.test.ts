import { describe, it, expect } from 'vitest';
import { resolveGrammarScope, normalizeToScopes } from './grammarMaps';

describe('resolveGrammarScope', () => {
  it('resolves a scope from a file extension', () => {
    expect(resolveGrammarScope('Button.tsx')).toBe('source.tsx');
    expect(resolveGrammarScope('styles.css')).toBe('source.css');
  });

  it('prefers an explicit language over the extension', () => {
    expect(resolveGrammarScope('snippet.txt', 'css')).toBe('source.css');
  });

  it('falls back to the extension when the language is unknown', () => {
    expect(resolveGrammarScope('Button.tsx', 'klingon')).toBe('source.tsx');
  });

  it('resolves from language alone when there is no file name', () => {
    expect(resolveGrammarScope(undefined, 'typescript')).toBe('source.ts');
  });

  it('returns undefined for unsupported extensions and for no inputs', () => {
    expect(resolveGrammarScope('data.bin')).toBeUndefined();
    expect(resolveGrammarScope()).toBeUndefined();
  });
});

describe('normalizeToScopes', () => {
  it('maps language names to scopes', () => {
    expect(normalizeToScopes(['tsx', 'css'])).toEqual(['source.tsx', 'source.css']);
  });

  it('passes scope names through unchanged', () => {
    expect(normalizeToScopes(['source.tsx'])).toEqual(['source.tsx']);
  });

  it('dedupes the language and scope forms of the same grammar', () => {
    expect(normalizeToScopes(['tsx', 'source.tsx'])).toEqual(['source.tsx']);
  });

  it('passes unrecognized entries through (ignored downstream — no loader)', () => {
    expect(normalizeToScopes(['klingon'])).toEqual(['klingon']);
  });
});
