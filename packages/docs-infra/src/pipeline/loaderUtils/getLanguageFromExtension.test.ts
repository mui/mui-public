import { describe, it, expect } from 'vitest';
import {
  getLanguageFromExtension,
  languageMap,
  normalizeLanguage,
  languageAliasMap,
} from './getLanguageFromExtension';

describe('getLanguageFromExtension', () => {
  describe('returns correct language for known extensions', () => {
    it.each([
      ['.js', 'javascript'],
      ['.ts', 'typescript'],
      ['.jsx', 'jsx'],
      ['.tsx', 'tsx'],
      ['.json', 'json'],
      ['.md', 'markdown'],
      ['.mdx', 'mdx'],
      ['.html', 'html'],
      ['.css', 'css'],
      ['.sh', 'shell'],
      ['.yaml', 'yaml'],
    ])('returns "%s" for extension "%s"', (extension, expectedLanguage) => {
      expect(getLanguageFromExtension(extension)).toBe(expectedLanguage);
    });
  });

  describe('returns undefined for unknown extensions', () => {
    it.each([
      ['.py'],
      ['.rb'],
      ['.go'],
      ['.rs'],
      ['.vue'],
      ['.svelte'],
      ['.unknown'],
      [''],
      ['js'], // missing dot
      ['tsx'], // missing dot
    ])('returns undefined for "%s"', (extension) => {
      expect(getLanguageFromExtension(extension)).toBeUndefined();
    });
  });

  describe('languageMap consistency', () => {
    it('should have entries for all common web development extensions', () => {
      const expectedExtensions = [
        '.js',
        '.ts',
        '.jsx',
        '.tsx',
        '.json',
        '.md',
        '.mdx',
        '.html',
        '.css',
        '.sh',
        '.yaml',
      ];

      for (const ext of expectedExtensions) {
        expect(languageMap[ext]).toBeDefined();
      }
    });

    it('should use descriptive language names', () => {
      // Verify we're using longer, more descriptive names where applicable
      expect(languageMap['.js']).toBe('javascript');
      expect(languageMap['.ts']).toBe('typescript');
      expect(languageMap['.md']).toBe('markdown');
      expect(languageMap['.sh']).toBe('shell');
    });
  });
});

describe('normalizeLanguage', () => {
  describe('normalizes short aliases to canonical names', () => {
    it.each([
      ['js', 'javascript'],
      ['ts', 'typescript'],
      ['md', 'markdown'],
      ['sh', 'shell'],
      ['bash', 'shell'],
      ['yml', 'yaml'],
    ])('normalizes "%s" to "%s"', (alias, canonicalName) => {
      expect(normalizeLanguage(alias)).toBe(canonicalName);
    });
  });

  describe('returns canonical names unchanged', () => {
    it.each([
      ['javascript', 'javascript'],
      ['typescript', 'typescript'],
      ['jsx', 'jsx'],
      ['tsx', 'tsx'],
      ['json', 'json'],
      ['markdown', 'markdown'],
      ['mdx', 'mdx'],
      ['html', 'html'],
      ['css', 'css'],
      ['shell', 'shell'],
      ['yaml', 'yaml'],
    ])('returns "%s" unchanged as "%s"', (language, expected) => {
      expect(normalizeLanguage(language)).toBe(expected);
    });
  });

  describe('returns unknown languages unchanged', () => {
    it.each([['python'], ['ruby'], ['go'], ['rust'], ['unknown'], ['someLang']])(
      'returns "%s" unchanged',
      (language) => {
        expect(normalizeLanguage(language)).toBe(language);
      },
    );
  });

  describe('languageAliasMap consistency', () => {
    it('should include all common aliases', () => {
      const expectedAliases = [
        'js',
        'ts',
        'javascript',
        'typescript',
        'jsx',
        'tsx',
        'json',
        'md',
        'markdown',
        'mdx',
        'html',
        'css',
        'sh',
        'bash',
        'shell',
        'yaml',
        'yml',
      ];

      for (const alias of expectedAliases) {
        expect(languageAliasMap[alias]).toBeDefined();
      }
    });

    it('should map aliases to the same values as languageMap', () => {
      // Verify consistency between extension map and alias map
      expect(languageAliasMap.js).toBe(languageMap['.js']);
      expect(languageAliasMap.ts).toBe(languageMap['.ts']);
      expect(languageAliasMap.md).toBe(languageMap['.md']);
      expect(languageAliasMap.sh).toBe(languageMap['.sh']);
      expect(languageAliasMap.yaml).toBe(languageMap['.yaml']);
    });
  });
});
