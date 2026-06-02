import { describe, it, expect, vi } from 'vitest';
import {
  createTransformedFiles,
  applyTransformToSource,
  type TransformRuntimeDeps,
} from './TransformEngine';
import { decodeHastSource } from '../pipeline/loadIsomorphicCodeVariant/decodeHastSource';
import { frameFallbackFromSpans } from '../pipeline/hastUtils';
import type { VariantCode } from '../CodeHighlighter/types';

// Real hast helpers the engine takes injected (no mocks, per convention 3.5).
const deps: TransformRuntimeDeps = { decode: decodeHastSource, frameFallbackFromSpans };

describe('TransformEngine', () => {
  describe('applyTransformToSource', () => {
    it('should return original source when no transforms provided', () => {
      const result = applyTransformToSource(
        'const x = 1;',
        'test.js',
        undefined,
        'nonexistent',
        deps,
      );

      expect(result).toEqual({
        transformedSource: 'const x = 1;',
        transformedName: 'test.js',
      });
    });

    it('should return original source when transform key not present in manifest', () => {
      // Under the embed-split contract, absence of the key means "no
      // meaningful transform" — equivalent to the legacy "empty delta" case.
      const transforms = {
        'other-transform': { fileName: 'other.js' },
      };

      const result = applyTransformToSource(
        'const x = 1;',
        'test.js',
        transforms,
        'rename-only',
        deps,
      );

      expect(result).toEqual({
        transformedSource: 'const x = 1;',
        transformedName: 'test.js',
      });
    });
  });

  describe('createTransformedFiles', () => {
    it('should return undefined when no variant provided', () => {
      const result = createTransformedFiles(null, 'some-transform', deps);
      expect(result).toBeUndefined();
    });

    it('should return undefined when no transform selected', () => {
      const variant: VariantCode = {
        source: 'const x = 1;',
        fileName: 'test.js',
      };

      const result = createTransformedFiles(variant, null, deps);
      expect(result).toBeUndefined();
    });

    it('should return empty files when no fileName and no extraFiles with transforms', () => {
      const variant: VariantCode = {
        source: 'const x = 1;',
        // No fileName and no extraFiles with meaningful transforms
      };

      const result = createTransformedFiles(variant, 'some-transform', deps);
      expect(result).toEqual({ files: [], filenameMap: {} });
    });

    it('should transform main file with transforms', () => {
      const variant: VariantCode = {
        source: 'const x = 1;',
        fileName: 'test.js',
        transforms: {
          'js-to-ts': {
            delta: { 0: ['const x: number = 1;'] },
            fileName: 'test.ts',
          },
        },
      } as any;

      const result = createTransformedFiles(variant, 'js-to-ts', deps);

      expect(result).toBeDefined();
      expect(result!.files).toHaveLength(1);
      expect(result!.files[0].name).toBe('test.ts');
      expect(result!.files[0].source).toBeDefined();
    });

    it('should return files from extraFiles when main file has no transform key', () => {
      // Under the embed-split contract, absence of a key in the manifest
      // means the file has no meaningful transform for that key (it was
      // dropped at producer time because the delta was empty).
      const variant: VariantCode = {
        source: 'const x = 1;',
        fileName: 'test.js',
        // No `transforms` for the main file — manifest doesn't list js-to-ts
        extraFiles: {
          'utils.js': {
            source: 'export const util = () => {};',
            transforms: {
              'js-to-ts': {
                delta: { 0: ['export const util = (): void => {};'] },
                fileName: 'utils.ts',
              },
            },
          },
        },
      } as any;

      const result = createTransformedFiles(variant, 'js-to-ts', deps);

      expect(result).toBeDefined();
      expect(result!.files).toHaveLength(2);
      // Both files should be included — main file untransformed, utils.js transformed
      expect(result!.files.map((f) => f.name)).toEqual(['test.js', 'utils.ts']);
      expect(result!.files.map((f) => f.originalName)).toEqual(['test.js', 'utils.js']);
      expect(result!.filenameMap).toEqual({
        'test.js': 'test.js', // Untransformed
        'utils.js': 'utils.ts', // Transformed
      });
    });

    it('should return files from extraFiles when main file has no fileName', () => {
      const variant: VariantCode = {
        source: 'const x = 1;',
        // No fileName for main file
        extraFiles: {
          'config.js': {
            source: 'module.exports = {};',
            transforms: {
              'js-to-ts': {
                delta: { 0: ['export default {};'] },
                fileName: 'config.ts',
              },
            },
          },
          'helper.js': {
            source: 'function help() {}',
            transforms: {
              'js-to-ts': {
                delta: { 0: ['function help(): void {}'] },
                fileName: 'helper.ts',
              },
            },
          },
        },
      } as any;

      const result = createTransformedFiles(variant, 'js-to-ts', deps);

      expect(result).toBeDefined();
      expect(result!.files).toHaveLength(2);
      expect(result!.files.map((f) => f.name)).toEqual(['config.ts', 'helper.ts']);
      expect(result!.files.map((f) => f.originalName)).toEqual(['config.js', 'helper.js']);
      expect(result!.filenameMap).toEqual({
        'config.js': 'config.ts',
        'helper.js': 'helper.ts',
      });
    });

    it('should include all files when at least one has meaningful transform deltas', () => {
      const variant: VariantCode = {
        source: 'const x = 1;',
        fileName: 'test.js',
        transforms: {
          'js-to-ts': {
            delta: { 0: ['const x: number = 1;'] },
            fileName: 'test.ts',
          },
        },
        extraFiles: {
          'utils.js': {
            source: 'export const util = () => {};',
            transforms: {
              'js-to-ts': {
                delta: { 0: ['export const util = (): void => {};'] },
                fileName: 'utils.ts',
              },
            },
          },
          'config.js': {
            source: 'module.exports = {};',
            // No `js-to-ts` entry in manifest — file is included but untransformed
          },
          'readme.md': 'Simple string file', // No transforms - should still be included
        },
      } as any;

      const result = createTransformedFiles(variant, 'js-to-ts', deps);

      expect(result).toBeDefined();
      expect(result!.files).toHaveLength(4);
      expect(result!.files.map((f) => f.name)).toEqual([
        'test.ts',
        'utils.ts',
        'config.js',
        'readme.md',
      ]);
      expect(result!.files.map((f) => f.originalName)).toEqual([
        'test.js',
        'utils.js',
        'config.js',
        'readme.md',
      ]);
      expect(result!.filenameMap).toEqual({
        'test.js': 'test.ts', // Transformed
        'utils.js': 'utils.ts', // Transformed
        'config.js': 'config.js', // Untransformed (empty delta)
        'readme.md': 'readme.md', // Untransformed (no transforms)
      });
    });

    it('should return empty when no file has the selected transform key in its manifest', () => {
      // After the embed split, variant-level `transforms` is a manifest with
      // no `delta` field. The producer drops entries with empty deltas before
      // emitting the manifest, so absence of the key here means "no transform
      // available" — equivalent to the legacy "empty delta" case.
      const variant: VariantCode = {
        source: 'const x = 1;',
        fileName: 'test.js',
        transforms: {
          'other-transform': { fileName: 'test.other.ts' },
        },
        extraFiles: {
          'config.js': {
            source: 'module.exports = {};',
            transforms: {
              'other-transform': { fileName: 'config.other.ts' },
            },
          },
          'readme.md': 'Simple string file', // No transforms
        },
      } as any;

      const result = createTransformedFiles(variant, 'js-to-ts', deps);

      expect(result).toEqual({ files: [], filenameMap: {} });
    });

    it('should handle mixed scenarios with main file and extraFiles transforms', () => {
      const variant: VariantCode = {
        source: 'const x = 1;',
        fileName: 'test.js',
        transforms: {
          // No `js-to-ts` entry — main file unchanged for that transform
          'add-strict': {
            delta: { 0: ['"use strict"; const x = 1;'] }, // But has delta for different transform
            fileName: 'test.js',
          },
        },
        extraFiles: {
          'utils.js': {
            source: 'export const util = () => {};',
            transforms: {
              'js-to-ts': {
                delta: { 0: ['export const util = (): void => {};'] },
                fileName: 'utils.ts',
              },
            },
          },
          'types.js': {
            source: 'export const types = {};',
            transforms: {
              'different-transform': {
                delta: { 0: ['export const types: {} = {};'] },
                fileName: 'types.ts',
              },
            },
          },
        },
      } as any;

      // Test with 'js-to-ts' transform - utils.js should be transformed, main file should be untransformed
      const result1 = createTransformedFiles(variant, 'js-to-ts', deps);
      expect(result1).toBeDefined();
      expect(result1!.files).toHaveLength(3); // All files included
      expect(result1!.files.map((f) => f.name)).toEqual(['test.js', 'utils.ts', 'types.js']);
      expect(result1!.filenameMap).toEqual({
        'test.js': 'test.js', // Untransformed (empty delta)
        'utils.js': 'utils.ts', // Transformed
        'types.js': 'types.js', // Untransformed (no transform for this key)
      });

      // Test with 'add-strict' transform - only main file should be transformed
      const result2 = createTransformedFiles(variant, 'add-strict', deps);
      expect(result2).toBeDefined();
      expect(result2!.files).toHaveLength(3); // All files included
      expect(result2!.files.map((f) => f.name)).toEqual(['test.js', 'utils.js', 'types.js']);
      expect(result2!.filenameMap).toEqual({
        'test.js': 'test.js', // Transformed (but same name)
        'utils.js': 'utils.js', // Untransformed (no transform for this key)
        'types.js': 'types.js', // Untransformed (no transform for this key)
      });

      // Test with 'different-transform' - only types.js should be transformed
      const result3 = createTransformedFiles(variant, 'different-transform', deps);
      expect(result3).toBeDefined();
      expect(result3!.files).toHaveLength(3); // All files included
      expect(result3!.files.map((f) => f.name)).toEqual(['test.js', 'utils.js', 'types.ts']);
      expect(result3!.filenameMap).toEqual({
        'test.js': 'test.js', // Untransformed (no transform for this key)
        'utils.js': 'utils.js', // Untransformed (no transform for this key)
        'types.js': 'types.ts', // Transformed
      });
    });

    it('should handle filename conflicts by skipping conflicting files', () => {
      const variant: VariantCode = {
        source: 'const x = 1;',
        fileName: 'test.js',
        transforms: {
          'js-to-ts': {
            delta: { 0: ['const x: number = 1;'] },
            fileName: 'utils.ts', // This will conflict with extraFile
          },
        },
        extraFiles: {
          'utils.js': {
            source: 'export const util = () => {};',
            transforms: {
              'js-to-ts': {
                delta: { 0: ['export const util = (): void => {};'] },
                fileName: 'utils.ts', // Same name as main file transform
              },
            },
          },
        },
      } as any;

      // Mock console.warn to verify warning is logged
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = createTransformedFiles(variant, 'js-to-ts', deps);

      expect(result).toBeDefined();
      expect(result!.files).toHaveLength(1);
      // Main file should be included (processed first)
      expect(result!.files[0].name).toBe('utils.ts');
      expect(result!.files[0].originalName).toBe('test.js');

      // Warning should be logged for the conflicting extraFile
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Transform conflict: utils.js would transform to utils.ts but that name is already taken',
        ),
      );

      consoleSpy.mockRestore();
    });
  });
});
