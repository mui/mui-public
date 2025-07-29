import { describe, it, expect } from 'vitest';
import {
  getAvailableTransforms,
  createTransformedFiles,
  applyTransformToSource,
} from './useCodeUtils';
import { extractNameAndSlugFromUrl } from '../loaderUtils';
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
