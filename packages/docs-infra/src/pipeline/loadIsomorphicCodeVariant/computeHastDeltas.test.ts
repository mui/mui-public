import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Root } from 'hast';
import type { Code, HastRoot, ParseSource, VariantCode } from '../../CodeHighlighter/types';
import {
  getVariantsToTransform,
  getAvailableTransforms,
  computeVariantDeltas,
  computeHastDeltas,
} from './computeHastDeltas';

const createMockHastRoot = (content: string): Root => ({
  type: 'root',
  children: [
    {
      type: 'element',
      tagName: 'pre',
      properties: {},
      children: [
        {
          type: 'text',
          value: content,
        },
      ],
    },
  ],
});

const mockParseSource = vi.fn(
  (_source: string, _fileName: string): Root => createMockHastRoot(_source),
) as ParseSource;

const createVariantCode = (overrides: Partial<VariantCode> = {}): VariantCode => ({
  fileName: 'test.js',
  url: '/demo',
  ...overrides,
});

describe('getVariantsToTransform', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should identify variants that need main source transformation', () => {
    const parsedCode: Code = {
      Default: createVariantCode({
        source: createMockHastRoot('code'),
        transforms: { someTransform: { delta: { 0: ['old', 'new'] }, fileName: 'test.js' } },
      }),
      NoTransforms: createVariantCode({
        source: createMockHastRoot('code'),
        // No transforms
      }),
      StringSource: createVariantCode({
        source: 'string source',
        transforms: { someTransform: { delta: { 0: ['old', 'new'] }, fileName: 'test.js' } },
      }),
    };

    const variants = getVariantsToTransform(parsedCode);

    expect(variants).toHaveLength(1);
    expect(variants[0][0]).toBe('Default');
  });

  it('should identify variants that need extraFiles transformation', () => {
    const parsedCode: Code = {
      Default: createVariantCode({
        source: 'string source',
        extraFiles: {
          'file1.js': {
            source: createMockHastRoot('extra code'),
            transforms: { someTransform: { delta: { 0: ['old', 'new'] }, fileName: 'file1.js' } },
          },
          'file2.js': {
            source: 'string source', // Won't be transformed
            transforms: { someTransform: { delta: { 0: ['old', 'new'] }, fileName: 'file2.js' } },
          },
        },
      }),
    };

    const variants = getVariantsToTransform(parsedCode);

    expect(variants).toHaveLength(1);
    expect(variants[0][0]).toBe('Default');
  });

  it('should handle variants with both main source and extraFiles needing transformation', () => {
    const parsedCode: Code = {
      Default: createVariantCode({
        source: createMockHastRoot('main code'),
        transforms: { mainTransform: { delta: { 0: ['old', 'new'] }, fileName: 'main.js' } },
        extraFiles: {
          'extra.js': {
            source: createMockHastRoot('extra code'),
            transforms: { extraTransform: { delta: { 0: ['old', 'new'] }, fileName: 'extra.js' } },
          },
        },
      }),
    };

    const variants = getVariantsToTransform(parsedCode);

    expect(variants).toHaveLength(1);
    expect(variants[0][0]).toBe('Default');
  });

  it('should ignore variants with hastJson sources', () => {
    const parsedCode: Code = {
      Default: createVariantCode({
        source: { hastJson: JSON.stringify({ type: 'root', children: [] }) },
        transforms: { someTransform: { delta: { 0: ['old', 'new'] }, fileName: 'test.js' } },
      }),
    };

    const variants = getVariantsToTransform(parsedCode);

    expect(variants).toHaveLength(0);
  });

  it('should ignore variants with hastCompressed sources', () => {
    const parsedCode: Code = {
      Default: createVariantCode({
        source: { hastCompressed: 'AAAA' },
        transforms: { someTransform: { delta: { 0: ['old', 'new'] }, fileName: 'test.js' } },
      }),
    };

    const variants = getVariantsToTransform(parsedCode);

    expect(variants).toHaveLength(0);
  });

  it('should ignore extraFiles with hastCompressed sources', () => {
    const parsedCode: Code = {
      Default: createVariantCode({
        source: 'string source',
        extraFiles: {
          'file1.js': {
            source: { hastCompressed: 'AAAA' },
            transforms: { someTransform: { delta: { 0: ['old', 'new'] }, fileName: 'file1.js' } },
          },
        },
      }),
    };

    const variants = getVariantsToTransform(parsedCode);

    expect(variants).toHaveLength(0);
  });

  it('should handle empty or invalid variants', () => {
    const parsedCode: Code = {
      EmptyVariant: undefined,
      StringVariant: 'just a string',
    };

    const variants = getVariantsToTransform(parsedCode);

    expect(variants).toHaveLength(0);
  });
});

describe('getAvailableTransforms', () => {
  it('should return transform keys from a variant', () => {
    const parsedCode: Code = {
      Default: createVariantCode({
        source: 'code',
        transforms: {
          transform1: { delta: { 0: ['old', 'new'] }, fileName: 'test.js' },
          transform2: { delta: { 1: ['old2', 'new2'] }, fileName: 'test2.js' },
        },
      }),
    };

    const transforms = getAvailableTransforms(parsedCode, 'Default');

    expect(transforms).toEqual(['transform1', 'transform2']);
  });

  it('should return empty array for variant without transforms', () => {
    const parsedCode: Code = {
      Default: createVariantCode({
        source: 'code',
        // No transforms
      }),
    };

    const transforms = getAvailableTransforms(parsedCode, 'Default');

    expect(transforms).toEqual([]);
  });

  it('should return empty array for non-existent variant', () => {
    const parsedCode: Code = {
      Default: createVariantCode({
        source: 'code',
        transforms: { transform1: { delta: { 0: ['old', 'new'] }, fileName: 'test.js' } },
      }),
    };

    const transforms = getAvailableTransforms(parsedCode, 'NonExistent');

    expect(transforms).toEqual([]);
  });

  it('should return empty array for undefined parsedCode', () => {
    const transforms = getAvailableTransforms(undefined, 'Default');

    expect(transforms).toEqual([]);
  });

  it('returns every key present in the variant transforms manifest', () => {
    // Under the embed-split contract, `getAvailableTransforms` trusts that
    // every key in the manifest corresponds to a non-empty delta inside
    // `source.data.transforms`. Filtering by delta-presence happens at
    // producer time (`splitTransformsForEmbed`).
    const parsedCode: Code = {
      Default: createVariantCode({
        source: 'code',
        transforms: {
          transformWithDelta: { delta: { 0: ['old', 'new'] }, fileName: 'test.js' },
          manifestOnly: { fileName: 'test.js' },
        },
      }),
    };

    const transforms = getAvailableTransforms(parsedCode, 'Default');

    expect(transforms).toEqual(['transformWithDelta', 'manifestOnly']);
  });

  it('returns every key present in extraFiles transforms manifests', () => {
    const parsedCode: Code = {
      Default: createVariantCode({
        source: 'code',
        extraFiles: {
          'utils.js': {
            source: 'utils code',
            transforms: {
              validTransform: { delta: { 0: ['old', 'new'] }, fileName: 'utils.js' },
              manifestOnly: { fileName: 'utils.js' },
            },
          },
        },
      }),
    };

    const transforms = getAvailableTransforms(parsedCode, 'Default');

    expect(transforms).toEqual(['validTransform', 'manifestOnly']);
  });
});

describe('computeVariantDeltas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should transform main source when applicable', async () => {
    const variantCode = {
      source: createMockHastRoot('original code'),
      transforms: { someTransform: { delta: { 0: ['old', 'new'] }, fileName: 'test.js' } },
    };

    const result = await computeVariantDeltas('Default', variantCode, mockParseSource);

    expect(result.transforms).toBeDefined();
    expect(result.source).toBe(variantCode.source);
  });

  it('should transform extraFiles when applicable', async () => {
    const variantCode = {
      source: 'string source', // Won't be transformed
      extraFiles: {
        'file1.js': {
          source: createMockHastRoot('extra code'),
          transforms: { extraTransform: { delta: { 0: ['old', 'new'] }, fileName: 'file1.js' } },
        },
        'file2.js': {
          source: 'string source', // Won't be transformed
        },
      },
    };

    const result = await computeVariantDeltas('Default', variantCode, mockParseSource);

    expect(result.extraFiles!['file1.js'].transforms).toBeDefined();
    expect(result.extraFiles!['file2.js'].transforms).toBeUndefined();
  });

  it('should return original variant for invalid input', async () => {
    const invalidVariant = 'just a string';

    const result = await computeVariantDeltas('Default', invalidVariant, mockParseSource);

    expect(result).toBe(invalidVariant);
  });

  it('should skip transformation for hastJson sources', async () => {
    const variantCode = {
      source: { hastJson: JSON.stringify({ type: 'root', children: [] }) },
      transforms: { someTransform: { delta: { 0: ['old', 'new'] }, fileName: 'test.js' } },
    };

    const result = await computeVariantDeltas('Default', variantCode, mockParseSource);

    expect(result.transforms).toBe(variantCode.transforms); // Should remain unchanged
  });

  it('moves transform deltas into source.data.transforms and leaves only a manifest at the variant level', async () => {
    // Embedding deltas inside `root.data.transforms` keeps them inside the
    // (later compressed) hast payload and out of any plain-text serialization
    // of variant-level metadata (e.g. the `data-precompute` HTML attribute on
    // <pre> emitted by transformHtmlCodeBlock, or the JSON injected into the
    // bundle by replacePrecomputeValue). `hast-util-to-jsx-runtime` doesn't
    // render `Root.data` to the DOM, so embedded deltas never leak to HTML.
    const variantCode: VariantCode = {
      source: createMockHastRoot('original code'),
      transforms: {
        embeddedTransform: { delta: { 0: ['old', 'new'] }, fileName: 'test.ts' },
      },
    };

    const result = await computeVariantDeltas('Default', variantCode, mockParseSource);

    // The variant-level entry survives but is now a manifest entry: it
    // identifies the transform (and any renamed fileName) without exposing
    // the diff payload.
    expect(result.transforms).toBeDefined();
    expect(result.transforms!.embeddedTransform).toBeDefined();
    expect(result.transforms!.embeddedTransform).not.toHaveProperty('delta');
    expect(result.transforms!.embeddedTransform.fileName).toBe('test.ts');

    // The delta itself now lives inside the hast root's `data.transforms`.
    // The exact shape is whatever `diffHast` produced from the patched tree;
    // we just verify it's present and non-empty.
    const sourceRoot = result.source as HastRoot;
    expect(sourceRoot.data?.transforms).toBeDefined();
    expect(sourceRoot.data!.transforms!.embeddedTransform.delta).toBeDefined();
    expect(
      Object.keys(sourceRoot.data!.transforms!.embeddedTransform.delta!).length,
    ).toBeGreaterThan(0);

    // Guard: serializing the variant-level transforms (the surface that ends
    // up in HTML / module source) must not leak the embedded delta payload.
    const variantSerialized = JSON.stringify({ transforms: result.transforms });
    expect(variantSerialized).not.toContain('"delta"');
  });

  it('moves extraFile transform deltas into the extraFile source.data.transforms', async () => {
    const variantCode: VariantCode = {
      source: 'string source',
      extraFiles: {
        'file1.js': {
          source: createMockHastRoot('extra code'),
          transforms: {
            embeddedTransform: { delta: { 0: ['old', 'new'] }, fileName: 'file1.ts' },
          },
        },
      },
    };

    const result = await computeVariantDeltas('Default', variantCode, mockParseSource);

    const extra = result.extraFiles!['file1.js'] as {
      transforms: NonNullable<VariantCode['transforms']>;
      source: HastRoot;
    };
    expect(extra.transforms.embeddedTransform).not.toHaveProperty('delta');
    expect(extra.source.data?.transforms?.embeddedTransform.delta).toBeDefined();
    expect(
      Object.keys(extra.source.data!.transforms!.embeddedTransform.delta!).length,
    ).toBeGreaterThan(0);
  });
});

describe('computeHastDeltas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should apply transforms to variants that need them', async () => {
    const parsedCode: Code = {
      Default: createVariantCode({
        source: createMockHastRoot('code'),
        transforms: { someTransform: { delta: { 0: ['old', 'new'] }, fileName: 'test.js' } },
      }),
      NoTransforms: createVariantCode({
        source: 'string code',
      }),
    };

    const result = await computeHastDeltas(parsedCode, mockParseSource);

    // Check that transforms were processed (result will have the actual transformed values)
    expect(typeof result.Default).toBe('object');
    expect(result.NoTransforms).toBe(parsedCode.NoTransforms); // Should remain unchanged
  });

  it('should return original code when no variants need transformation', async () => {
    const parsedCode: Code = {
      Default: createVariantCode({
        source: 'string code',
        // No transforms
      }),
      Another: createVariantCode({
        source: 'more string code',
        // No transforms
      }),
    };

    const result = await computeHastDeltas(parsedCode, mockParseSource);

    expect(result).toEqual(parsedCode);
  });
});
