import { describe, it, expect } from 'vitest';
import { deriveRelativeUrls } from './deriveRelativeUrls';

describe('deriveRelativeUrls', () => {
  describe('JS imports (resolved file URLs)', () => {
    const sourceFileUrl = 'file:///src/lib/code.ts';

    it('returns relativeUrl for renamed entries in flat mode', () => {
      const flatExtraFiles = {
        './Component.js': 'file:///src/Component/index.js',
        './utils.ts': 'file:///src/lib/utils.ts',
      };

      const result = deriveRelativeUrls(sourceFileUrl, flatExtraFiles);

      // './Component.js' resolves to file:///src/lib/Component.js, but the actual file is
      // file:///src/Component/index.js — emit relativeUrl that round-trips to it.
      // './utils.ts' resolves to file:///src/lib/utils.ts which IS the file URL — omit.
      expect(result).toEqual({
        './Component.js': '../Component/index.js',
      });
    });

    it('omits relativeUrl in canonical mode where keys already resolve to file URL', () => {
      const canonicalExtraFiles = {
        '../Component/index.js': 'file:///src/Component/index.js',
        './utils.ts': 'file:///src/lib/utils.ts',
      };

      const result = deriveRelativeUrls(sourceFileUrl, canonicalExtraFiles);

      expect(result).toEqual({});
    });

    it('emits relativeUrl in import mode when key omits the index segment', () => {
      const importExtraFiles = {
        // '../Component.js' resolves to file:///src/Component.js, but the actual file is
        // file:///src/Component/index.js — needs relativeUrl.
        '../Component.js': 'file:///src/Component/index.js',
        // './utils.ts' resolves to file:///src/lib/utils.ts, matching the file URL — omit.
        './utils.ts': 'file:///src/lib/utils.ts',
      };

      const result = deriveRelativeUrls(sourceFileUrl, importExtraFiles);

      expect(result).toEqual({
        '../Component.js': '../Component/index.js',
      });
    });
  });

  describe('basic imports', () => {
    const sourceFileUrl = 'file:///src/lib/code.ts';

    it('returns relativeUrl for flattened entries', () => {
      const flatExtraFiles = {
        './styles.css': 'file:///src/styles.css',
        './theme.css': 'file:///src/lib/nested/theme.css',
      };

      const result = deriveRelativeUrls(sourceFileUrl, flatExtraFiles);

      // './styles.css' resolves to file:///src/lib/styles.css — wrong location → emit.
      // './theme.css' resolves to file:///src/lib/theme.css — wrong location → emit.
      expect(result).toEqual({
        './styles.css': '../styles.css',
        './theme.css': './nested/theme.css',
      });
    });

    it('omits relativeUrl when canonical key already matches the file URL', () => {
      const canonicalExtraFiles = {
        '../styles.css': 'file:///src/styles.css',
      };

      const result = deriveRelativeUrls(sourceFileUrl, canonicalExtraFiles);

      expect(result).toEqual({});
    });
  });

  describe('normalization', () => {
    it('always emits relativeUrl with a "./" or "../" prefix', () => {
      const sourceFileUrl = 'file:///src/code.ts';
      const flatExtraFiles = {
        // Renamed flat key.
        './lib-styles.css': 'file:///src/styles.css',
      };

      const result = deriveRelativeUrls(sourceFileUrl, flatExtraFiles);

      expect(result).toEqual({
        './lib-styles.css': './styles.css',
      });
    });
  });

  describe('edge cases', () => {
    it('returns empty result when extraFiles is empty', () => {
      expect(deriveRelativeUrls('file:///src/code.ts', {})).toEqual({});
    });

    it('computes a relativeUrl for any entry whose key does not resolve to the file URL', () => {
      const sourceFileUrl = 'file:///src/code.ts';
      const extraFiles = {
        './a.css': 'file:///src/a.css',
        // Synthetic entry whose key does not point at its actual file URL.
        './injected.css': 'file:///src/lib/injected.css',
      };

      const result = deriveRelativeUrls(sourceFileUrl, extraFiles);

      // './a.css' resolves correctly so it is omitted; './injected.css' does not
      // resolve to the actual file URL, so a relativeUrl is computed from the URLs.
      expect(result).toEqual({
        './injected.css': './lib/injected.css',
      });
    });

    it('skips entries with cross-origin file URLs (cannot produce a relative reference)', () => {
      const sourceFileUrl = 'file:///src/code.ts';
      const extraFiles = {
        './remote.js': 'https://cdn.example.com/lib/remote.js',
      };

      const result = deriveRelativeUrls(sourceFileUrl, extraFiles);

      expect(result).toEqual({});
    });

    it('produces a "./" relativeUrl when the file URL points at the source directory itself', () => {
      // Edge case: a synthetic entry whose URL is the source's directory URL
      // (ends in `/`). The computed relativeUrl is `./`, which round-trips
      // back to the directory URL via `new URL('./', sourceFileUrl)`.
      const sourceFileUrl = 'file:///src/lib/code.ts';
      const extraFiles = {
        './sentinel': 'file:///src/lib/',
      };

      const result = deriveRelativeUrls(sourceFileUrl, extraFiles);

      expect(result).toEqual({ './sentinel': './' });
      expect(new URL(result['./sentinel'], sourceFileUrl).href).toBe('file:///src/lib/');
    });
  });
});
