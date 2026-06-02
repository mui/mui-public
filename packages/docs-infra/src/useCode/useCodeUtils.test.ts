import { describe, it, expect } from 'vitest';
import {
  getAvailableTransforms,
  getApplicableTransforms,
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
