import { describe, it, expect } from 'vitest';
import {
  getAvailableTransforms,
  createTransformedFiles,
  applyTransformToSource,
} from './useCodeUtils';
import type { Code, VariantCode } from '../CodeHighlighter/types';

describe('useCodeUtils', () => {
  describe('getAvailableTransforms', () => {
    it('should return empty array when no transforms available', () => {
      const effectiveCode: Code = {
        Default: {
          source: 'const x = 1;',
          fileName: 'test.js',
        },
      };

      const result = getAvailableTransforms(effectiveCode, 'Default');
      expect(result).toEqual([]);
    });

    it('should return transforms with deltas from main variant', () => {
      const effectiveCode: Code = {
        Default: {
          source: 'const x = 1;',
          fileName: 'test.js',
          transforms: {
            'js-to-ts': {
              delta: { 0: ['const x: number = 1;'] },
              fileName: 'test.ts',
            },
            'no-delta': {
              delta: {}, // Empty delta - should not be included
              fileName: 'test.renamed.js',
            },
          },
        },
      };

      const result = getAvailableTransforms(effectiveCode, 'Default');
      expect(result).toEqual(['js-to-ts']);
    });

    it('should return transforms with deltas from extraFiles', () => {
      const effectiveCode: Code = {
        Default: {
          source: 'const x = 1;',
          fileName: 'test.js',
          extraFiles: {
            'utils.js': {
              source: 'export const util = () => {};',
              transforms: {
                'add-types': {
                  delta: { 0: ['export const util = (): void => {};'] },
                  fileName: 'utils.ts',
                },
              },
            },
          },
        },
      };

      const result = getAvailableTransforms(effectiveCode, 'Default');
      expect(result).toEqual(['add-types']);
    });

    it('should combine transforms from main variant and extraFiles', () => {
      const effectiveCode: Code = {
        Default: {
          source: 'const x = 1;',
          fileName: 'test.js',
          transforms: {
            'main-transform': {
              delta: { 0: ['const x: number = 1;'] },
            },
          },
          extraFiles: {
            'utils.js': {
              source: 'export const util = () => {};',
              transforms: {
                'extra-transform': {
                  delta: { 0: ['export const util = (): void => {};'] },
                },
              },
            },
          },
        },
      };

      const result = getAvailableTransforms(effectiveCode, 'Default');
      expect(result).toEqual(['main-transform', 'extra-transform']);
    });
  });

  describe('applyTransformToSource', () => {
    it('should return original source when no transforms provided', () => {
      const result = applyTransformToSource('const x = 1;', 'test.js', undefined, 'nonexistent');

      expect(result).toEqual({
        transformedSource: 'const x = 1;',
        transformedName: 'test.js',
      });
    });

    it('should return original source when transform has no delta', () => {
      const transforms = {
        'rename-only': {
          delta: {}, // Empty delta
          fileName: 'renamed.js',
        },
      };

      const result = applyTransformToSource('const x = 1;', 'test.js', transforms, 'rename-only');

      expect(result).toEqual({
        transformedSource: 'const x = 1;',
        transformedName: 'test.js',
      });
    });
  });

  describe('createTransformedFiles', () => {
    it('should return undefined when no variant provided', () => {
      const result = createTransformedFiles(null, 'some-transform');
      expect(result).toBeUndefined();
    });

    it('should return undefined when no transform selected', () => {
      const variant: VariantCode = {
        source: 'const x = 1;',
        fileName: 'test.js',
      };

      const result = createTransformedFiles(variant, null);
      expect(result).toBeUndefined();
    });

    it('should return empty files when no fileName in variant', () => {
      const variant: VariantCode = {
        source: 'const x = 1;',
        // No fileName
      };

      const result = createTransformedFiles(variant, 'some-transform');
      expect(result).toEqual({ files: [], filenameMap: {} });
    });
  });
});
