import { describe, it, expect, vi } from 'vitest';
import {
  getAvailableTransforms,
  createTransformedFiles,
  applyTransformToSource,
} from './useCodeUtils';
import { extractNameAndSlugFromUrl } from '../pipeline/loaderUtils';
import type { Code, VariantCode, ContentProps } from '../CodeHighlighter/types';

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
      const result = createTransformedFiles(null, 'some-transform', true);
      expect(result).toBeUndefined();
    });

    it('should return undefined when no transform selected', () => {
      const variant: VariantCode = {
        source: 'const x = 1;',
        fileName: 'test.js',
      };

      const result = createTransformedFiles(variant, null, true);
      expect(result).toBeUndefined();
    });

    it('should return empty files when no fileName and no extraFiles with transforms', () => {
      const variant: VariantCode = {
        source: 'const x = 1;',
        // No fileName and no extraFiles with meaningful transforms
      };

      const result = createTransformedFiles(variant, 'some-transform', true);
      expect(result).toEqual({ files: [], filenameMap: {} });
    });

    it('should handle shouldHighlight=true for component creation', () => {
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

      const result = createTransformedFiles(variant, 'js-to-ts', true);

      expect(result).toBeDefined();
      expect(result!.files).toHaveLength(1);
      expect(result!.files[0].name).toBe('test.ts');
      expect(result!.files[0].component).toBeDefined();
      // Component should be created with syntax highlighting enabled
    });

    it('should handle shouldHighlight=false for component creation', () => {
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

      const result = createTransformedFiles(variant, 'js-to-ts', false);

      expect(result).toBeDefined();
      expect(result!.files).toHaveLength(1);
      expect(result!.files[0].name).toBe('test.ts');
      expect(result!.files[0].component).toBeDefined();
      // Component should be created without syntax highlighting
    });

    it('should return files from extraFiles when main file has no transform delta', () => {
      const variant: VariantCode = {
        source: 'const x = 1;',
        fileName: 'test.js',
        transforms: {
          'js-to-ts': {
            delta: {}, // Empty delta - main file has no meaningful transform
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
        },
      } as any;

      const result = createTransformedFiles(variant, 'js-to-ts', true);

      expect(result).toBeDefined();
      expect(result!.files).toHaveLength(2);
      // Both files should be included - main file untransformed, utils.js transformed
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

      const result = createTransformedFiles(variant, 'js-to-ts', true);

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
            transforms: {
              'js-to-ts': {
                delta: {}, // Empty delta - should still be included but untransformed
                fileName: 'config.ts',
              },
            },
          },
          'readme.md': 'Simple string file', // No transforms - should still be included
        },
      } as any;

      const result = createTransformedFiles(variant, 'js-to-ts', true);

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

    it('should return empty when no files have meaningful transform deltas', () => {
      const variant: VariantCode = {
        source: 'const x = 1;',
        fileName: 'test.js',
        transforms: {
          'js-to-ts': {
            delta: {}, // Empty delta
            fileName: 'test.ts',
          },
        },
        extraFiles: {
          'config.js': {
            source: 'module.exports = {};',
            transforms: {
              'js-to-ts': {
                delta: {}, // Empty delta
                fileName: 'config.ts',
              },
            },
          },
          'readme.md': 'Simple string file', // No transforms
        },
      } as any;

      const result = createTransformedFiles(variant, 'js-to-ts', true);

      expect(result).toEqual({ files: [], filenameMap: {} });
    });

    it('should handle mixed scenarios with main file and extraFiles transforms', () => {
      const variant: VariantCode = {
        source: 'const x = 1;',
        fileName: 'test.js',
        transforms: {
          'js-to-ts': {
            delta: {}, // Main file has no meaningful delta
            fileName: 'test.ts',
          },
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
      const result1 = createTransformedFiles(variant, 'js-to-ts', true);
      expect(result1).toBeDefined();
      expect(result1!.files).toHaveLength(3); // All files included
      expect(result1!.files.map((f) => f.name)).toEqual(['test.js', 'utils.ts', 'types.js']);
      expect(result1!.filenameMap).toEqual({
        'test.js': 'test.js', // Untransformed (empty delta)
        'utils.js': 'utils.ts', // Transformed
        'types.js': 'types.js', // Untransformed (no transform for this key)
      });

      // Test with 'add-strict' transform - only main file should be transformed
      const result2 = createTransformedFiles(variant, 'add-strict', true);
      expect(result2).toBeDefined();
      expect(result2!.files).toHaveLength(3); // All files included
      expect(result2!.files.map((f) => f.name)).toEqual(['test.js', 'utils.js', 'types.js']);
      expect(result2!.filenameMap).toEqual({
        'test.js': 'test.js', // Transformed (but same name)
        'utils.js': 'utils.js', // Untransformed (no transform for this key)
        'types.js': 'types.js', // Untransformed (no transform for this key)
      });

      // Test with 'different-transform' - only types.js should be transformed
      const result3 = createTransformedFiles(variant, 'different-transform', true);
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

      const result = createTransformedFiles(variant, 'js-to-ts', true);

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

  describe('userProps generation logic', () => {
    // Helper type for user props (name, slug, and custom properties)
    type UserProps<T extends {} = {}> = T & {
      name?: string;
      slug?: string;
    };

    // Helper function to simulate the userProps generation logic from useCode
    function generateUserProps<T extends {} = {}>(
      contentProps: ContentProps<T>,
      contextUrl?: string,
    ): UserProps<T> {
      let finalName = contentProps.name;
      let finalSlug = contentProps.slug;

      // Get URL from context first, then fall back to contentProps (simulating useCode logic)
      const effectiveUrl = contextUrl || contentProps.url;

      // Generate name and slug from URL if they're missing and we have a URL
      if ((!finalName || !finalSlug) && effectiveUrl) {
        try {
          const generated = extractNameAndSlugFromUrl(effectiveUrl);
          finalName = finalName || generated.name;
          finalSlug = finalSlug || generated.slug;
        } catch {
          // If URL parsing fails, keep the original values (which might be undefined)
        }
      }

      // Extract only the user-defined properties (T) from contentProps
      const { name, slug, code, components, url: contentUrl, ...userDefinedProps } = contentProps;

      return {
        ...userDefinedProps,
        name: finalName,
        slug: finalSlug,
      } as UserProps<T>;
    }

    it('should preserve existing name and slug when provided', () => {
      const contentProps: ContentProps<{}> = {
        name: 'Custom Name',
        slug: 'custom-slug',
        code: { Default: { source: 'test' } },
        components: { Test: null },
      };

      const result = generateUserProps(contentProps);

      expect(result).toEqual({
        name: 'Custom Name',
        slug: 'custom-slug',
      });
      expect(result).not.toHaveProperty('code');
      expect(result).not.toHaveProperty('components');
    });

    it('should generate name and slug from URL when missing', () => {
      const contentProps: ContentProps<{}> = {
        code: { Default: { source: 'test' } },
        components: { Test: null },
        url: 'file:///app/components/demos/advanced-keyboard/index.ts',
      };

      const result = generateUserProps(contentProps);

      expect(result).toEqual({
        name: 'Advanced Keyboard',
        slug: 'advanced-keyboard',
      });
      expect(result).not.toHaveProperty('code');
      expect(result).not.toHaveProperty('components');
    });

    it('should only generate missing name or slug from URL', () => {
      const contentProps: ContentProps<{}> = {
        name: 'Custom Name', // provided
        // slug is missing
        code: { Default: { source: 'test' } },
        components: { Test: null },
        url: 'file:///app/components/demos/simple-button/index.ts',
      };

      const result = generateUserProps(contentProps);

      expect(result).toEqual({
        name: 'Custom Name', // preserved
        slug: 'simple-button', // generated
      });
    });

    it('should preserve custom properties in userProps', () => {
      const contentProps: ContentProps<{ customProp: string; anotherProp: number }> = {
        customProp: 'test value',
        anotherProp: 42,
        code: { Default: { source: 'test' } },
        components: { Test: null },
        url: 'file:///app/components/demos/data-table/index.ts',
      };

      const result = generateUserProps(contentProps);

      expect(result).toEqual({
        customProp: 'test value',
        anotherProp: 42,
        name: 'Data Table',
        slug: 'data-table',
      });
    });

    it('should handle invalid URLs gracefully', () => {
      const contentProps: ContentProps<{}> = {
        code: { Default: { source: 'test' } },
        components: { Test: null },
        url: '', // empty URL
      };

      // Test with a URL that would actually fail parsing
      const result = generateUserProps(contentProps);

      expect(result).toEqual({
        name: undefined,
        slug: undefined,
      });
    });

    it('should handle simple strings as URLs', () => {
      const contentProps: ContentProps<{}> = {
        code: { Default: { source: 'test' } },
        components: { Test: null },
        url: 'custom-component',
      };

      // The extractNameAndSlugFromUrl function can handle simple strings
      const result = generateUserProps(contentProps);

      expect(result).toEqual({
        name: 'Custom Component',
        slug: 'custom-component',
      });
    });

    it('should handle context URL correctly (simulating CodeHighlighterContext behavior)', () => {
      // This test simulates how the useCode hook would work with context URL
      // In real usage, context.url would be provided by CodeHighlighterContext
      const contentProps: ContentProps<{}> = {
        code: { Default: { source: 'test' } },
        components: { Test: null },
        url: 'file:///app/components/content-demo/index.ts', // contentProps URL
      };

      // Simulate context URL taking priority over contentProps URL
      const contextUrl = 'file:///app/components/context-demo/index.ts';

      // Test with context URL (this should take priority)
      const contextResult = generateUserProps(contentProps, contextUrl);
      expect(contextResult).toEqual({
        name: 'Context Demo',
        slug: 'context-demo',
      });

      // Test without context URL (should fall back to contentProps URL)
      const contentResult = generateUserProps(contentProps);
      expect(contentResult).toEqual({
        name: 'Content Demo',
        slug: 'content-demo',
      });
    });
  });
});
