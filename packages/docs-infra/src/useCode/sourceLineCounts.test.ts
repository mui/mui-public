import { describe, it, expect } from 'vitest';
import type { Element as HastElement } from 'hast';
import { compressHast } from '../pipeline/hastUtils';
import { buildRootFallback, fallbackToText } from '../CodeHighlighter/fallbackFormat';
import type { FallbackNode } from '../CodeHighlighter/fallbackFormat';
import type { Code, HastRoot, VariantCode } from '../CodeHighlighter/types';
import { findVariantFocusedLinesMismatches, getVariantFileLineCounts } from './sourceLineCounts';

/**
 * Build a `{ hastCompressed }` source the way the loader does: consolidate the
 * per-frame fallbacks into a root fallback (the `fallback` field), strip the
 * per-frame `data.fallback` from the serialized tree, and use the fallback
 * text as the DEFLATE dictionary. The same fallback must be forwarded to the
 * decoder or decompression fails its checksum and throws.
 */
function buildCompressedSource(root: HastRoot): {
  fallback: FallbackNode[];
  source: { hastCompressed: string };
} {
  const rootFallback = buildRootFallback(root);
  // Strip the per-frame fallback, as the loader does before serialization.
  const stripped = JSON.parse(JSON.stringify(root)) as HastRoot;
  delete (stripped.children[0] as HastElement).data!.fallback;
  const dictionary = fallbackToText(rootFallback);
  return {
    fallback: rootFallback,
    // Fresh object per call so the decode WeakMap never bridges cases.
    source: { hastCompressed: compressHast(JSON.stringify(stripped), dictionary) },
  };
}

function framedRoot(lineText: string): HastRoot {
  return {
    type: 'root',
    data: { totalLines: 1, focusedLines: 1 },
    children: [
      {
        type: 'element',
        tagName: 'span',
        properties: { className: 'frame' },
        data: { fallback: [{ type: 'text', value: lineText }] } as HastElement['data'],
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { className: 'line', dataLn: 1 },
            children: [{ type: 'text', value: lineText }],
          },
        ],
      },
    ],
  };
}

describe('findVariantFocusedLinesMismatches', () => {
  it('uses loader-surfaced counts for deferred string sources', () => {
    const variant: VariantCode = {
      fileName: 'main.ts',
      source: 'const x = 1;',
      totalLines: 40,
      focusedLines: 12,
      collapsible: true,
      extraFiles: {
        'helper.ts': {
          source: 'export const y = 1;',
          totalLines: 20,
          focusedLines: 5,
          collapsible: true,
        },
      },
    };

    expect(getVariantFileLineCounts(variant, 'main.ts')).toEqual({
      totalLines: 40,
      focusedLines: 12,
      collapsible: true,
    });
    expect(getVariantFileLineCounts(variant, 'helper.ts')).toEqual({
      totalLines: 20,
      focusedLines: 5,
      collapsible: true,
    });
  });

  it('honors loader-surfaced collapsible false instead of inferring it from counts', () => {
    const variant: VariantCode = {
      fileName: 'main.ts',
      source: 'const x = 1;',
      totalLines: 40,
      focusedLines: 12,
      collapsible: false,
    };

    expect(getVariantFileLineCounts(variant, 'main.ts')).toEqual({
      totalLines: 40,
      focusedLines: 12,
      collapsible: false,
    });
  });

  it('does not throw for a compressed main source when the variant carries its fallback', () => {
    const { fallback, source } = buildCompressedSource(framedRoot('const Button = 1;'));
    const code: Code = {
      js: {
        fileName: 'a.js',
        source,
        fallback,
      },
    };
    let result: ReturnType<typeof findVariantFocusedLinesMismatches> | undefined;
    expect(() => {
      result = findVariantFocusedLinesMismatches(code);
    }).not.toThrow();
    // Single variant: nothing to compare against, so no mismatches.
    expect(result).toEqual([]);
  });

  it('does not throw for a compressed extra-file source when the file carries its fallback', () => {
    const { fallback, source } = buildCompressedSource(framedRoot('const Button = 2;'));
    const code: Code = {
      js: {
        fileName: 'a.js',
        source: 'const Button = 0;',
        extraFiles: {
          'b.js': {
            source,
            fallback,
          },
        },
      },
    };
    let result: ReturnType<typeof findVariantFocusedLinesMismatches> | undefined;
    expect(() => {
      result = findVariantFocusedLinesMismatches(code);
    }).not.toThrow();
    expect(result).toEqual([]);
  });
});
