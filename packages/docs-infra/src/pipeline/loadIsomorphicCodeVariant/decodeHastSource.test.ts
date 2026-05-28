import { describe, it, expect } from 'vitest';
import type { Element as HastElement } from 'hast';
import { compressHast } from '../hastUtils';
import { buildRootFallback, fallbackToText } from '../../CodeHighlighter/fallbackFormat';
import type { HastRoot } from '../../CodeHighlighter/types';
import { decodeHastSource } from './decodeHastSource';

const sampleRoot: HastRoot = {
  type: 'root',
  children: [
    {
      type: 'element',
      tagName: 'pre',
      properties: {},
      children: [{ type: 'text', value: 'hello' }],
    },
  ],
};

describe('decodeHastSource', () => {
  it('returns null for null or undefined', () => {
    expect(decodeHastSource(null)).toBeNull();
    expect(decodeHastSource(undefined)).toBeNull();
  });

  it('returns null for string sources', () => {
    expect(decodeHastSource('<pre>hello</pre>')).toBeNull();
  });

  it('parses a hastJson payload', () => {
    const source = { hastJson: JSON.stringify(sampleRoot) };
    const decoded = decodeHastSource(source);
    expect(decoded).toEqual(sampleRoot);
  });

  it('decompresses and parses a hastCompressed payload', () => {
    const source = { hastCompressed: compressHast(JSON.stringify(sampleRoot)) };
    const decoded = decodeHastSource(source);
    expect(decoded).toEqual(sampleRoot);
  });

  it('returns a live HastRoot unchanged', () => {
    const decoded = decodeHastSource(sampleRoot);
    expect(decoded).toBe(sampleRoot);
  });

  it('returns null for unrecognized object shapes', () => {
    const source = { somethingElse: 'value' } as unknown as { hastJson: string };
    expect(decodeHastSource(source)).toBeNull();
  });

  it('returns null when hastJson is malformed', () => {
    const source = { hastJson: '{not-valid-json' };
    expect(decodeHastSource(source)).toBeNull();
  });

  it('caches the decoded result by source identity (WeakMap)', () => {
    const source = { hastJson: JSON.stringify(sampleRoot) };
    const first = decodeHastSource(source);
    const second = decodeHastSource(source);
    expect(first).not.toBeNull();
    // Same identity on second call: WeakMap cache hit.
    expect(second).toBe(first);
  });

  it('does not share cache between distinct source objects with equal contents', () => {
    const sourceA = { hastJson: JSON.stringify(sampleRoot) };
    const sourceB = { hastJson: JSON.stringify(sampleRoot) };
    const decodedA = decodeHastSource(sourceA);
    const decodedB = decodeHastSource(sourceB);
    expect(decodedA).toEqual(decodedB);
    expect(decodedA).not.toBe(decodedB);
  });

  describe('with a root-fallback DEFLATE dictionary', () => {
    // Mirrors the production payload: per-frame fallbacks consolidated into a
    // root fallback (the `VariantCode.fallback` field), stripped from the
    // serialized tree, and the fallback text used as the compression
    // dictionary. The same fallback must be passed back to decode — this is the
    // exact data `deriveFallbacksFromCode` reads off `VariantCode` when there's
    // no `ContentLoading` to hoist it.
    const frameText = 'const a = 1;\nconst b = 2;';
    const framedRoot: HastRoot = {
      type: 'root',
      data: { totalLines: 2 },
      children: [
        {
          type: 'element',
          tagName: 'span',
          properties: { className: 'frame' },
          data: { fallback: [{ type: 'text', value: frameText }] } as HastElement['data'],
          children: [
            {
              type: 'element',
              tagName: 'span',
              properties: { className: 'line', dataLn: 1 },
              children: [{ type: 'text', value: 'const a = 1;' }],
            },
            { type: 'text', value: '\n' },
            {
              type: 'element',
              tagName: 'span',
              properties: { className: 'line', dataLn: 2 },
              children: [{ type: 'text', value: 'const b = 2;' }],
            },
          ],
        },
      ],
    };

    function buildCompressedSource() {
      const rootFallback = buildRootFallback(framedRoot);
      // Strip the per-frame fallback, as the loader does before serialization.
      const stripped = JSON.parse(JSON.stringify(framedRoot)) as HastRoot;
      delete (stripped.children[0] as HastElement).data!.fallback;
      const dictionary = fallbackToText(rootFallback);
      return {
        rootFallback,
        // Fresh object per call so the WeakMap decode cache never bridges cases.
        source: { hastCompressed: compressHast(JSON.stringify(stripped), dictionary) },
      };
    }

    it('decodes and redistributes per-frame fallbacks when given the fallback', () => {
      const { rootFallback, source } = buildCompressedSource();
      const decoded = decodeHastSource(source, rootFallback);
      // Decompressed via the dictionary, and the stripped per-frame fallback is
      // restored from the root fallback.
      expect(decoded).toEqual(framedRoot);
    });

    it('returns null without the fallback (the blank-render case)', () => {
      const { source } = buildCompressedSource();
      // No dictionary → decompression fails its checksum → null → blank render.
      // This is what happens with no `ContentLoading` until `activeFallbacks`
      // is derived from `VariantCode.fallback`.
      expect(decodeHastSource(source)).toBeNull();
    });
  });
});
