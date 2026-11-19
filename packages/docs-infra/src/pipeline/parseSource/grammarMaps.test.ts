import { describe, it, expect } from 'vitest';
import { resolveGrammarScope } from './grammarMaps';

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
