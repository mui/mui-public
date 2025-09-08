/**
 * Tests for flattenVariant functionality
 * Focuses on testing the flattening output format where keys are file paths from addPathsToVariant
 */

import { describe, it, expect } from 'vitest';
import { flattenVariant } from './flattenVariant';
import type { VariantCode } from '../CodeHighlighter/types';
import { addPathsToVariant } from '../CodeHighlighter/addPathsToVariant';

describe('flattenVariant', () => {
  describe('basic flattening functionality', () => {
    it('should flatten variant with no extra files', () => {
      const variant: VariantCode = {
        fileName: 'index.ts',
        source: "console.log('index.ts')",
      };

      const result = flattenVariant(variant);

      expect(result).toEqual({
        'index.ts': { source: "console.log('index.ts')" },
      });
    });

    it('should flatten variant with extra files using their paths', () => {
      const variant: VariantCode = {
        fileName: 'Demo.tsx',
        source: "console.log('Demo.tsx')",
        extraFiles: {
          'utils.ts': { source: "console.log('utils.ts')" },
          'helper.ts': "console.log('helper.ts as string')",
        },
      };

      const result = flattenVariant(variant);

      expect(result).toEqual({
        'Demo.tsx': { source: "console.log('Demo.tsx')" },
        'utils.ts': { source: "console.log('utils.ts')" },
        'helper.ts': { source: "console.log('helper.ts as string')" },
      });
    });

    it('should preserve metadata property in flattened output', () => {
      const variant: VariantCode = {
        fileName: 'index.ts',
        source: "console.log('index.ts')",
        extraFiles: {
          'package.json': { source: '{"name": "test"}', metadata: true },
          'helper.ts': { source: "console.log('helper.ts')" },
        },
      };

      const result = flattenVariant(variant);

      expect(result).toEqual({
        'index.ts': { source: "console.log('index.ts')" },
        'package.json': { source: '{"name": "test"}', metadata: true },
        'helper.ts': { source: "console.log('helper.ts')" },
      });
    });
  });

  describe('source handling', () => {
    it('should handle empty source gracefully', () => {
      const variant: VariantCode = {
        fileName: 'Demo.tsx',
        source: "console.log('Demo.tsx')",
        extraFiles: {
          'helper.ts': { source: '' },
          'utils.ts': {},
        },
      };

      const result = flattenVariant(variant);

      expect(result).toEqual({
        'Demo.tsx': { source: "console.log('Demo.tsx')" },
        'helper.ts': { source: '' },
        // utils.ts should be excluded due to no source
      });
    });

    it('should handle variant with no main source', () => {
      const variant: VariantCode = {
        fileName: 'Demo.tsx',
        extraFiles: {
          'helper.ts': { source: "console.log('helper.ts')" },
        },
      };

      const result = flattenVariant(variant);

      expect(result).toEqual({
        'helper.ts': { source: "console.log('helper.ts')" },
        // Main file should be excluded due to no source
      });
    });

    it('should handle variant with no fileName', () => {
      const variant: VariantCode = {
        source: "console.log('no fileName')",
      };

      const result = flattenVariant(variant);

      expect(result).toEqual({});
    });

    it('should convert string extraFiles to object format', () => {
      const variant: VariantCode = {
        fileName: 'index.ts',
        source: "console.log('index.ts')",
        extraFiles: {
          'helper.ts': "console.log('helper.ts as string')",
          'utils.ts': { source: "console.log('utils.ts as object')" },
        },
      };

      const result = flattenVariant(variant);

      expect(result).toEqual({
        'index.ts': { source: "console.log('index.ts')" },
        'helper.ts': { source: "console.log('helper.ts as string')" },
        'utils.ts': { source: "console.log('utils.ts as object')" },
      });
    });
  });

  describe('integration with addPathsToVariant', () => {
    it('should use paths calculated by addPathsToVariant', () => {
      const variant: VariantCode = {
        url: 'file:///src/components/checkbox/index.ts',
        fileName: 'index.ts',
        source: "console.log('index.ts')",
        extraFiles: {
          '../helper.ts': { source: "console.log('helper.ts')" },
        },
      };

      // Get the expected paths from addPathsToVariant
      const variantWithPaths = addPathsToVariant(variant);
      const result = flattenVariant(variant);

      // Verify that the result uses the calculated paths
      expect(result[variantWithPaths.path!]).toEqual({ source: "console.log('index.ts')" });

      if (variantWithPaths.extraFiles) {
        for (const fileWithPath of Object.values(variantWithPaths.extraFiles)) {
          if (typeof fileWithPath !== 'string' && fileWithPath.path) {
            expect(result[fileWithPath.path]).toEqual({
              source: "console.log('helper.ts')",
            });
          }
        }
      }
    });

    it('should handle metadata files with metadataPrefix', () => {
      const variant: VariantCode = {
        url: 'file:///src/components/checkbox/index.ts',
        fileName: 'index.ts',
        source: "console.log('index.ts')",
        extraFiles: {
          '../helper.ts': { source: "console.log('helper.ts')" },
          '../../package.json': { source: "console.log('package.json')", metadata: true },
        },
        metadataPrefix: 'src/',
      };

      const result = flattenVariant(variant);

      // Should have the paths calculated by addPathsToVariant with metadataPrefix
      expect(result['src/checkbox/index.ts']).toEqual({ source: "console.log('index.ts')" });
      expect(result['src/helper.ts']).toEqual({ source: "console.log('helper.ts')" });
      expect(result['package.json']).toEqual({
        source: "console.log('package.json')",
        metadata: true,
      });
    });
  });
});
