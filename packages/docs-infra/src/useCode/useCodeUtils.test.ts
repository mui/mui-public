import { describe, it, expect, vi } from 'vitest';
import {
  getAvailableTransforms,
  getApplicableTransforms,
  createTransformedFiles,
  applyTransformToSource,
  shouldHighlightForRender,
  transformHasCollapsePlaceholder,
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

    it('should return transforms from main variant manifest', () => {
      // After the embed split, variant-level `transforms` is a manifest.
      // The producer (`splitTransformsForEmbed`) marks entries with a real
      // embedded delta as `hasDelta: true`; `getAvailableTransforms` uses
      // that flag to decide which transforms surface in the UI toggle.
      const effectiveCode: Code = {
        Default: {
          source: 'const x = 1;',
          fileName: 'test.js',
          transforms: {
            'js-to-ts': { fileName: 'test.ts', hasDelta: true },
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

    it('skips rename-only manifest entries (hasDelta: false)', () => {
      // The transform toggle is bound to `getAvailableTransforms`, so
      // rename-only entries (no real source delta) must stay invisible
      // — there's nothing for the user to toggle between.
      const effectiveCode: Code = {
        Default: {
          source: 'const x = 1;',
          fileName: 'test.ts',
          transforms: {
            javascript: { fileName: 'test.js', hasDelta: false },
          },
        },
      };

      const result = getAvailableTransforms(effectiveCode, 'Default');
      expect(result).toEqual([]);
    });
  });

  describe('getApplicableTransforms', () => {
    it('includes both delta-bearing and rename-only entries', () => {
      // `getApplicableTransforms` is the resolution set used to decide
      // whether a stored preference (or `initialTransform`) should apply.
      // It must surface rename-only entries too so a preference like
      // 'javascript' can still apply the rename even when the toggle
      // is hidden.
      const effectiveCode: Code = {
        Default: {
          source: 'const x = 1;',
          fileName: 'test.ts',
          transforms: {
            javascript: { fileName: 'test.js', hasDelta: false },
            typed: { delta: { 0: ['const x: number = 1;'] }, fileName: 'test.ts' },
          },
        },
      };

      const result = getApplicableTransforms(effectiveCode, 'Default');
      expect(result).toEqual(['javascript', 'typed']);
    });

    it('returns an empty array when no transforms are defined', () => {
      const effectiveCode: Code = {
        Default: {
          source: 'const x = 1;',
          fileName: 'test.js',
        },
      };

      expect(getApplicableTransforms(effectiveCode, 'Default')).toEqual([]);
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

    it('should return original source when transform key not present in manifest', () => {
      // Under the embed-split contract, absence of the key means "no
      // meaningful transform" — equivalent to the legacy "empty delta" case.
      const transforms = {
        'other-transform': { fileName: 'other.js' },
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

    it('should return empty files when no fileName and no extraFiles with transforms', () => {
      const variant: VariantCode = {
        source: 'const x = 1;',
        // No fileName and no extraFiles with meaningful transforms
      };

      const result = createTransformedFiles(variant, 'some-transform');
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

      const result = createTransformedFiles(variant, 'js-to-ts');

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

      const result = createTransformedFiles(variant, 'js-to-ts');

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

      const result = createTransformedFiles(variant, 'js-to-ts');

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

      const result = createTransformedFiles(variant, 'js-to-ts');

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

      const result = createTransformedFiles(variant, 'js-to-ts');

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
      const result1 = createTransformedFiles(variant, 'js-to-ts');
      expect(result1).toBeDefined();
      expect(result1!.files).toHaveLength(3); // All files included
      expect(result1!.files.map((f) => f.name)).toEqual(['test.js', 'utils.ts', 'types.js']);
      expect(result1!.filenameMap).toEqual({
        'test.js': 'test.js', // Untransformed (empty delta)
        'utils.js': 'utils.ts', // Transformed
        'types.js': 'types.js', // Untransformed (no transform for this key)
      });

      // Test with 'add-strict' transform - only main file should be transformed
      const result2 = createTransformedFiles(variant, 'add-strict');
      expect(result2).toBeDefined();
      expect(result2!.files).toHaveLength(3); // All files included
      expect(result2!.files.map((f) => f.name)).toEqual(['test.js', 'utils.js', 'types.js']);
      expect(result2!.filenameMap).toEqual({
        'test.js': 'test.js', // Transformed (but same name)
        'utils.js': 'utils.js', // Untransformed (no transform for this key)
        'types.js': 'types.js', // Untransformed (no transform for this key)
      });

      // Test with 'different-transform' - only types.js should be transformed
      const result3 = createTransformedFiles(variant, 'different-transform');
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

      const result = createTransformedFiles(variant, 'js-to-ts');

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

  describe('transformHasCollapsePlaceholder', () => {
    const collapseNode = {
      type: 'element',
      tagName: 'span',
      properties: { className: 'collapse', dataLines: 3 },
      children: [],
    };

    it('returns false when variant is null', () => {
      expect(transformHasCollapsePlaceholder(null, 'ts')).toBe(false);
    });

    it('returns false when transformKey is null', () => {
      const variant: VariantCode = {
        source: 'x',
        fileName: 'a.ts',
        transforms: { ts: { delta: [collapseNode] } },
      };
      expect(transformHasCollapsePlaceholder(variant, null)).toBe(false);
    });

    it('returns false when the transform has no entry', () => {
      const variant: VariantCode = {
        source: 'x',
        fileName: 'a.ts',
        transforms: { ts: { fileName: 'a.js' } },
      };
      expect(transformHasCollapsePlaceholder(variant, 'js')).toBe(false);
    });

    it('returns false for rename-only entries (no delta, hasDelta falsy)', () => {
      const variant: VariantCode = {
        source: 'x',
        fileName: 'a.ts',
        transforms: { ts: { fileName: 'a.js', hasDelta: false } },
      };
      expect(transformHasCollapsePlaceholder(variant, 'ts')).toBe(false);
    });

    it('returns false for inline deltas that contain no collapse element', () => {
      // The runtime classifier is flag-based and does not walk inline
      // deltas. Without `hasCollapse: true`, the entry is treated as
      // non-collapse — the pipeline's `diffHast` is responsible for
      // setting the flag when it inserts a placeholder.
      const variant: VariantCode = {
        source: 'x',
        fileName: 'a.ts',
        transforms: {
          ts: {
            delta: {
              _t: 'a',
              0: [
                {
                  type: 'element',
                  tagName: 'span',
                  properties: { className: 'line' },
                  children: [],
                },
              ],
            },
          },
        },
      };
      expect(transformHasCollapsePlaceholder(variant, 'ts')).toBe(false);
    });

    it('returns true conservatively for legacy manifest entries (hasDelta: true, no inline delta, hasCollapse absent)', () => {
      // Legacy embedded mode (no `hasCollapse` flag): delta lives inside
      // the compressed hast payload and we cannot cheaply inspect it,
      // so the safe classification is phase 1 (coordinated swap).
      const variant: VariantCode = {
        source: 'x',
        fileName: 'a.ts',
        transforms: { ts: { hasDelta: true } },
      };
      expect(transformHasCollapsePlaceholder(variant, 'ts')).toBe(true);
    });

    it('honors hasCollapse: true on manifest entries (no inline delta)', () => {
      // Embedded mode with precomputed flag — runtime trusts the
      // pipeline's classification without decompressing the hast.
      const variant: VariantCode = {
        source: 'x',
        fileName: 'a.ts',
        transforms: { ts: { hasDelta: true, hasCollapse: true } },
      };
      expect(transformHasCollapsePlaceholder(variant, 'ts')).toBe(true);
    });

    it('honors hasCollapse: false on manifest entries (no inline delta)', () => {
      // Embedded mode with precomputed flag — runtime trusts the
      // pipeline's "no collapse in this delta" verdict and classifies
      // the swap as phase 2 (non-layout).
      const variant: VariantCode = {
        source: 'x',
        fileName: 'a.ts',
        transforms: { ts: { hasDelta: true, hasCollapse: false } },
      };
      expect(transformHasCollapsePlaceholder(variant, 'ts')).toBe(false);
    });

    it('returns true when an extraFile transform carries hasCollapse: true', () => {
      // `'all'` mode iterates every file's transform map. Callers
      // that render multiple files simultaneously use this to gate
      // the coordinated swap whenever *any* file would shift.
      const variant: VariantCode = {
        source: 'x',
        fileName: 'a.ts',
        transforms: { ts: { hasDelta: true, hasCollapse: false } },
        extraFiles: {
          'b.ts': {
            source: 'y',
            transforms: { ts: { hasDelta: true, hasCollapse: true } },
          },
        },
      };
      expect(transformHasCollapsePlaceholder(variant, 'ts', { mode: 'all' })).toBe(true);
    });

    it('does not crash on string extraFiles entries', () => {
      const variant: VariantCode = {
        source: 'x',
        fileName: 'a.ts',
        transforms: { ts: { hasDelta: true, hasCollapse: true } },
        extraFiles: { 'b.ts': 'y' },
      };
      expect(transformHasCollapsePlaceholder(variant, 'ts', { mode: 'all' })).toBe(true);
    });

    describe("mode: 'selected'", () => {
      it('checks only the main file when selectedFileName matches variant.fileName', () => {
        const variant: VariantCode = {
          source: 'x',
          fileName: 'a.ts',
          transforms: { ts: { hasDelta: true, hasCollapse: false } },
          extraFiles: {
            'b.ts': {
              source: 'y',
              transforms: { ts: { hasDelta: true, hasCollapse: true } },
            },
          },
        };
        // An extra file has hasCollapse:true but we only consult the
        // main file in 'selected' mode → no layout shift coordinated.
        expect(
          transformHasCollapsePlaceholder(variant, 'ts', {
            mode: 'selected',
            selectedFileName: 'a.ts',
          }),
        ).toBe(false);
      });

      it('checks only the named extraFile when selectedFileName points to one', () => {
        const variant: VariantCode = {
          source: 'x',
          fileName: 'a.ts',
          transforms: { ts: { hasDelta: true, hasCollapse: true } },
          extraFiles: {
            'b.ts': {
              source: 'y',
              transforms: { ts: { hasDelta: true, hasCollapse: false } },
            },
          },
        };
        // Main file has hasCollapse:true but the user is looking at
        // b.ts → no coordinated swap for this selection.
        expect(
          transformHasCollapsePlaceholder(variant, 'ts', {
            mode: 'selected',
            selectedFileName: 'b.ts',
          }),
        ).toBe(false);
      });

      it('returns true when the selected extraFile transform has hasCollapse: true', () => {
        const variant: VariantCode = {
          source: 'x',
          fileName: 'a.ts',
          transforms: { ts: { hasDelta: true, hasCollapse: false } },
          extraFiles: {
            'b.ts': {
              source: 'y',
              transforms: { ts: { hasDelta: true, hasCollapse: true } },
            },
          },
        };
        expect(
          transformHasCollapsePlaceholder(variant, 'ts', {
            mode: 'selected',
            selectedFileName: 'b.ts',
          }),
        ).toBe(true);
      });

      it('falls back to the variant main file when selectedFileName is omitted', () => {
        // The selected-mode default treats `variant.fileName` as the
        // implicit selection, so extraFile collapses don't trigger the
        // gate.
        const variant: VariantCode = {
          source: 'x',
          fileName: 'a.ts',
          transforms: { ts: { hasDelta: true, hasCollapse: false } },
          extraFiles: {
            'b.ts': {
              source: 'y',
              transforms: { ts: { hasDelta: true, hasCollapse: true } },
            },
          },
        };
        expect(transformHasCollapsePlaceholder(variant, 'ts', { mode: 'selected' })).toBe(false);
      });
    });

    describe("mode: 'focus'", () => {
      it('uses hasCollapseInFocus when expanded is false', () => {
        const variant: VariantCode = {
          source: 'x',
          fileName: 'a.ts',
          transforms: {
            ts: { hasDelta: true, hasCollapse: true, hasCollapseInFocus: false },
          },
        };
        // hasCollapse is true (insertion exists somewhere) but the
        // insertion is outside the initially-visible region, so a
        // collapsed block won't shift visibly → phase 2.
        expect(
          transformHasCollapsePlaceholder(variant, 'ts', {
            mode: 'focus',
            selectedFileName: 'a.ts',
            expanded: false,
          }),
        ).toBe(false);
      });

      it('uses hasCollapse when expanded is true', () => {
        const variant: VariantCode = {
          source: 'x',
          fileName: 'a.ts',
          transforms: {
            ts: { hasDelta: true, hasCollapse: true, hasCollapseInFocus: false },
          },
        };
        // Once expanded, the whole region is visible — the focus flag
        // is irrelevant and we fall back to plain hasCollapse.
        expect(
          transformHasCollapsePlaceholder(variant, 'ts', {
            mode: 'focus',
            selectedFileName: 'a.ts',
            expanded: true,
          }),
        ).toBe(true);
      });

      it('returns true when collapsed and the insertion is inside the visible region', () => {
        const variant: VariantCode = {
          source: 'x',
          fileName: 'a.ts',
          transforms: {
            ts: { hasDelta: true, hasCollapse: true, hasCollapseInFocus: true },
          },
        };
        expect(
          transformHasCollapsePlaceholder(variant, 'ts', {
            mode: 'focus',
            selectedFileName: 'a.ts',
            expanded: false,
          }),
        ).toBe(true);
      });

      it('falls back to hasCollapse when hasCollapseInFocus is absent (legacy payload)', () => {
        // Legacy manifest entries (pre-`hasCollapseInFocus`) get the
        // conservative phase 1 classification via hasCollapse.
        const variant: VariantCode = {
          source: 'x',
          fileName: 'a.ts',
          transforms: { ts: { hasDelta: true, hasCollapse: true } },
        };
        expect(
          transformHasCollapsePlaceholder(variant, 'ts', {
            mode: 'focus',
            selectedFileName: 'a.ts',
            expanded: false,
          }),
        ).toBe(true);
      });

      it('still scopes to the selected file', () => {
        const variant: VariantCode = {
          source: 'x',
          fileName: 'a.ts',
          transforms: {
            ts: { hasDelta: true, hasCollapse: true, hasCollapseInFocus: true },
          },
          extraFiles: {
            'b.ts': {
              source: 'y',
              transforms: {
                ts: { hasDelta: true, hasCollapse: true, hasCollapseInFocus: true },
              },
            },
          },
        };
        // Main file would shift, but the user is looking at b.ts —
        // however b.ts ALSO has a focus-region insertion, so still true.
        expect(
          transformHasCollapsePlaceholder(variant, 'ts', {
            mode: 'focus',
            selectedFileName: 'b.ts',
            expanded: false,
          }),
        ).toBe(true);
        // Now flip b.ts to outside-focus only — should become false.
        const variant2: VariantCode = {
          source: 'x',
          fileName: 'a.ts',
          transforms: {
            ts: { hasDelta: true, hasCollapse: true, hasCollapseInFocus: true },
          },
          extraFiles: {
            'b.ts': {
              source: 'y',
              transforms: {
                ts: { hasDelta: true, hasCollapse: true, hasCollapseInFocus: false },
              },
            },
          },
        };
        expect(
          transformHasCollapsePlaceholder(variant2, 'ts', {
            mode: 'focus',
            selectedFileName: 'b.ts',
            expanded: false,
          }),
        ).toBe(false);
      });
    });
  });

  describe('shouldHighlightForRender', () => {
    it('returns true when no gate is set', () => {
      expect(
        shouldHighlightForRender({
          deferHighlight: false,
          pendingBootstrap: false,
          highlightAfter: 'hydration',
        }),
      ).toBe(true);
    });

    it('returns false while the pipeline asks to defer highlighting', () => {
      // `deferHighlight` always wins: the incoming tree's parse /
      // transform is still in flight, so there are no spans to paint.
      expect(
        shouldHighlightForRender({
          deferHighlight: true,
          pendingBootstrap: false,
          highlightAfter: 'init',
        }),
      ).toBe(false);
    });

    it('returns false while a stored-preference bootstrap swap is pending', () => {
      // The outgoing tree is about to be swapped away — don't burn
      // cycles painting spans that the user won't see.
      expect(
        shouldHighlightForRender({
          deferHighlight: false,
          pendingBootstrap: true,
          highlightAfter: 'hydration',
        }),
      ).toBe(false);
    });

    it("skips the pendingBootstrap gate when highlightAfter is 'init'", () => {
      // Regression: keeping the bootstrap gate engaged in `'init'` mode
      // caused the incoming variant to render as plain text for one
      // render between `pendingBootstrap` flipping and the bootstrap
      // commit landing, producing a visible flash of unhighlighted
      // code on first-paint variant swaps. The precomputed HAST already
      // carries the spans, so there's no "wasted work" to protect
      // against here.
      expect(
        shouldHighlightForRender({
          deferHighlight: false,
          pendingBootstrap: true,
          highlightAfter: 'init',
        }),
      ).toBe(true);
    });

    it("still defers in 'init' mode when the pipeline-level gate is set", () => {
      // `deferHighlight` represents "the tree isn't ready" — the
      // `'init'` bypass only relieves the bootstrap-flash gate, not
      // this one.
      expect(
        shouldHighlightForRender({
          deferHighlight: true,
          pendingBootstrap: true,
          highlightAfter: 'init',
        }),
      ).toBe(false);
    });

    it('treats an undefined highlightAfter the same as the non-init modes', () => {
      expect(
        shouldHighlightForRender({
          deferHighlight: false,
          pendingBootstrap: true,
          highlightAfter: undefined,
        }),
      ).toBe(false);
      expect(
        shouldHighlightForRender({
          deferHighlight: false,
          pendingBootstrap: false,
          highlightAfter: undefined,
        }),
      ).toBe(true);
    });

    it('returns false while highlightReady is false even when no parse is in flight', () => {
      // Regression: when `highlightAfter` is `'hydration' | 'idle' | 'visible'`
      // and the trigger hasn't fired yet, the published `code` still
      // contains precomputed HAST (left over from SSR). Without
      // consulting `highlightReady`, `<Pre>` would render that HAST
      // as highlighted spans on the first paint — defeating the whole
      // point of the deferred-highlighting trigger.
      expect(
        shouldHighlightForRender({
          deferHighlight: false,
          highlightReady: false,
          pendingBootstrap: false,
          highlightAfter: 'idle',
        }),
      ).toBe(false);
      expect(
        shouldHighlightForRender({
          deferHighlight: false,
          highlightReady: false,
          pendingBootstrap: false,
          highlightAfter: 'hydration',
        }),
      ).toBe(false);
    });

    it('returns true once highlightReady flips to true and the bootstrap/defer gates are clear', () => {
      expect(
        shouldHighlightForRender({
          deferHighlight: false,
          highlightReady: true,
          pendingBootstrap: false,
          highlightAfter: 'idle',
        }),
      ).toBe(true);
    });
  });
});
