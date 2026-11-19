import { describe, it, expect } from 'vitest';
import { resolveLanguage } from './languages';

describe('resolveLanguage', () => {
  it('resolves a language from a file extension', () => {
    expect(resolveLanguage('Button.tsx')).toBe('tsx');
    expect(resolveLanguage('styles.css')).toBe('css');
  });

  it('prefers an explicit language over the extension', () => {
    expect(resolveLanguage('snippet.txt', 'css')).toBe('css');
  });

  it('falls back to the extension when the language is unknown', () => {
    expect(resolveLanguage('Button.tsx', 'klingon')).toBe('tsx');
  });

  it('resolves from language alone when there is no file name', () => {
    expect(resolveLanguage(undefined, 'typescript')).toBe('ts');
  });

  it('returns undefined for unsupported extensions and for no inputs', () => {
    expect(resolveLanguage('data.bin')).toBeUndefined();
    expect(resolveLanguage()).toBeUndefined();
  });
});
