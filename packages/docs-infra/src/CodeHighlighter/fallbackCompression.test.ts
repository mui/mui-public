import { describe, it, expect } from 'vitest';
import type { Code } from './types';
import type { FallbackNode } from './fallbackFormat';
import { stripFallbackHastsFromCode } from './codeToFallbackProps';
import {
  FALLBACK_COMPRESSION_MIN_BYTES,
  collapseRenderedFallbacks,
  compressResidualFallbacks,
  decompressResidualFallbacks,
  extractResidualFallbacks,
  mergeResidualFallbacks,
  residualDictionaryText,
  scatterResidualFallbacks,
  type ResidualFallbacks,
} from './fallbackCompression';

/** A fallback frame whose text is `seed` repeated enough to exceed the threshold. */
function frame(seed: string): FallbackNode[] {
  return [['span', 'frame', `${seed} = computeSomethingReasonablyLong();\n`.repeat(6)]];
}

const residual: ResidualFallbacks = {
  javascript: { 'utils.js': frame('const helper'), 'data.js': frame('const data') },
  typescript: { 'App.ts': frame('const app') },
};

describe('residualDictionaryText', () => {
  it('concatenates rendered fallback text deterministically (sorted keys)', () => {
    const rendered: ResidualFallbacks = {
      typescript: { 'App.ts': ['b'] },
      javascript: { 'utils.js': ['c'], 'App.js': ['a'] },
    };
    // javascript before typescript; App.js before utils.js.
    expect(residualDictionaryText(rendered)).toBe('acb');
  });

  it('is stable regardless of insertion order', () => {
    const one: ResidualFallbacks = { a: { y: ['2'], x: ['1'] } };
    const two: ResidualFallbacks = { a: { x: ['1'], y: ['2'] } };
    expect(residualDictionaryText(one)).toBe(residualDictionaryText(two));
  });
});

describe('compressResidualFallbacks / decompressResidualFallbacks', () => {
  it('round-trips a residual map through one blob', () => {
    const blob = compressResidualFallbacks(residual);
    expect(blob).toMatchObject({ fallbackCompressed: expect.any(String) });
    expect(decompressResidualFallbacks(blob!)).toEqual(residual);
  });

  it('round-trips when primed with a rendered-text dictionary', () => {
    const dictionaryText = residualDictionaryText({ javascript: { 'App.js': frame('const app') } });
    const blob = compressResidualFallbacks(residual, dictionaryText);
    expect(decompressResidualFallbacks(blob!, dictionaryText)).toEqual(residual);
  });

  it('deduplicates shared text across files into a payload smaller than the JSON', () => {
    const blob = compressResidualFallbacks(residual);
    expect(blob!.fallbackCompressed.length).toBeLessThan(JSON.stringify(residual).length);
  });

  it('returns undefined for an empty residual', () => {
    expect(compressResidualFallbacks({})).toBeUndefined();
  });

  it('returns undefined for a residual below the byte threshold', () => {
    const tiny: ResidualFallbacks = { javascript: { 'a.js': ['x'] } };
    expect(JSON.stringify(tiny).length).toBeLessThan(FALLBACK_COMPRESSION_MIN_BYTES);
    expect(compressResidualFallbacks(tiny)).toBeUndefined();
  });

  it('throws when decompressed with the wrong dictionary (checksum mismatch)', () => {
    const blob = compressResidualFallbacks(residual, 'the-right-dictionary-text-padding-padding');
    expect(() => decompressResidualFallbacks(blob!, 'a-different-dictionary')).toThrow();
  });
});

describe('extractResidualFallbacks / scatterResidualFallbacks', () => {
  const code: Code = {
    javascript: {
      fileName: 'App.js',
      source: { hastCompressed: 'main-bytes' },
      fallback: frame('const app'),
      extraFiles: {
        'utils.js': { source: { hastCompressed: 'utils-bytes' }, fallback: frame('const helper') },
        'readme.md': 'plain string entry',
      },
    },
    typescript: 'variant-url',
  };

  it('pulls every fallback off the code into a residual map', () => {
    const { wireCode, residual: extracted } = extractResidualFallbacks(code);

    expect(extracted).toEqual({
      javascript: { 'App.js': frame('const app'), 'utils.js': frame('const helper') },
    });

    // The wire code carries no fallbacks, but keeps everything else.
    const variant = wireCode.javascript as any;
    expect('fallback' in variant).toBe(false);
    expect('fallback' in variant.extraFiles['utils.js']).toBe(false);
    expect(variant.extraFiles['utils.js'].source).toEqual({ hastCompressed: 'utils-bytes' });
    expect(variant.extraFiles['readme.md']).toBe('plain string entry');
    expect(wireCode.typescript).toBe('variant-url');
  });

  it('does not mutate the input code', () => {
    const snapshot = JSON.parse(JSON.stringify(code));
    extractResidualFallbacks(code);
    expect(code).toEqual(snapshot);
  });

  it('scatter is the inverse of extract', () => {
    const { wireCode, residual: extracted } = extractResidualFallbacks(code);
    expect(scatterResidualFallbacks(wireCode, extracted)).toEqual(code);
  });

  it('survives a full round-trip through compression', () => {
    const { wireCode, residual: extracted } = extractResidualFallbacks(code);
    const blob = compressResidualFallbacks(extracted);
    const restored = scatterResidualFallbacks(wireCode, decompressResidualFallbacks(blob!));
    expect(restored).toEqual(code);
  });
});

describe('server production → client reconstruction', () => {
  // Two variants of the same file: the loading UI renders only `javascript`,
  // so `typescript` (a near-duplicate) plus the JS extra file are residual.
  const code: Code = {
    javascript: {
      fileName: 'App.js',
      source: { hastCompressed: 'js-main' },
      fallback: frame('const app'),
      extraFiles: {
        'utils.js': { source: { hastCompressed: 'js-utils' }, fallback: frame('const helper') },
      },
    },
    typescript: {
      fileName: 'App.ts',
      source: { hastCompressed: 'ts-main' },
      fallback: frame('const app'),
      extraFiles: {
        'utils.ts': { source: { hastCompressed: 'ts-utils' }, fallback: frame('const helper') },
      },
    },
  };

  it('reconstructs exactly the in-memory strippedCode the client uses today', () => {
    // ── Server ──
    // Hoist the rendered subset (initial variant), then consolidate the rest.
    const { strippedCode, allFallbackHasts } = stripFallbackHastsFromCode(code, 'javascript');
    const { wireCode, residual: extracted } = extractResidualFallbacks(strippedCode);
    const dictionaryText = residualDictionaryText(allFallbackHasts);
    const blob = compressResidualFallbacks(extracted, dictionaryText);

    // A blob is produced and the wire code carries no inline fallbacks.
    expect(blob).toMatchObject({ fallbackCompressed: expect.any(String) });
    expect(JSON.stringify(wireCode)).not.toContain('frame');

    // ── Client ──
    // The rendered text arrives via the hoist; rebuild the same dictionary.
    const clientDictionaryText = residualDictionaryText(allFallbackHasts);
    const restored = scatterResidualFallbacks(
      wireCode,
      decompressResidualFallbacks(blob!, clientDictionaryText),
    );

    // The client's in-memory code is byte-identical to today's strippedCode:
    // residual fallbacks plain and co-located, rendered subset hoisted off.
    expect(restored).toEqual(strippedCode);
  });

  it('the primed blob is smaller than the inline residual it replaces', () => {
    const { strippedCode, allFallbackHasts } = stripFallbackHastsFromCode(code, 'javascript');
    const { residual: extracted } = extractResidualFallbacks(strippedCode);
    const blob = compressResidualFallbacks(extracted, residualDictionaryText(allFallbackHasts));
    expect(blob!.fallbackCompressed.length).toBeLessThan(JSON.stringify(extracted).length);
  });

  it('decodes regardless of the order the client accumulated the hoisted dictionary', () => {
    // The client builds the priming dictionary from `hoistedFallbackHasts`,
    // which accumulates across multiple `setFallbackHasts` calls in
    // `useCodeFallback`'s effect loop. A single byte of drift from the server's
    // dictionary would fail the embedded checksum, so this pins that the
    // sorted-key dictionary is byte-identical no matter what order the rendered
    // subset landed in.
    const rendered: ResidualFallbacks = {
      javascript: { 'App.js': frame('const app'), 'utils.js': frame('const helper') },
    };
    const hidden: ResidualFallbacks = {
      typescript: { 'App.ts': frame('const app'), 'utils.ts': frame('const helper') },
    };

    // Server compresses against the rendered subset's text.
    const serverDictionary = residualDictionaryText(rendered);
    const blob = compressResidualFallbacks(hidden, serverDictionary);

    // Client reconstructs the same rendered subset, but accumulated in a
    // different insertion order across hoists.
    const accumulatedOutOfOrder: ResidualFallbacks = {
      javascript: { 'utils.js': frame('const helper'), 'App.js': frame('const app') },
    };
    const clientDictionary = residualDictionaryText(accumulatedOutOfOrder);

    expect(clientDictionary).toBe(serverDictionary);
    expect(decompressResidualFallbacks(blob!, clientDictionary)).toEqual(hidden);
  });
});

describe('fallbackCollapsed (visibility split)', () => {
  function frameNode(type: string | undefined, text: string): FallbackNode {
    return type ? ['span', 'frame', { dataFrameType: type }, text] : ['span', 'frame', text];
  }

  // A collapsible file: a focused window (highlighted) wrapped in normal frames
  // that collapse away. Long enough that the full residual clears the threshold.
  const fullMain: FallbackNode[] = [
    frameNode(undefined, 'import { thing } from "./module";\n'.repeat(3)),
    frameNode('highlighted', 'const result = compute(thing);\n'.repeat(3)),
    frameNode(undefined, 'export default result;\n'.repeat(3)),
  ];
  const visibleMain: FallbackNode[] = [
    frameNode('highlighted', 'const result = compute(thing);\n'.repeat(3)),
  ];

  const code: Code = {
    javascript: {
      fileName: 'App.js',
      source: { hastCompressed: 'js-main' },
      fallback: fullMain,
    },
  };

  it('paints the collapsed window but reconstructs the full dictionary', () => {
    // ── Server (mirrors renderWithInitialSource with fallbackCollapsed) ──
    const { strippedCode, allFallbackHasts } = stripFallbackHastsFromCode(code, 'javascript');
    // eslint-disable-next-line testing-library/render-result-naming-convention -- not a testing-library render
    const loadingHasts = collapseRenderedFallbacks(allFallbackHasts);

    // The loading UI only paints the focused window.
    expect(loadingHasts).toEqual({ javascript: { 'App.js': visibleMain } });

    const { wireCode, residual: extracted } = extractResidualFallbacks(strippedCode);
    const fullResidual = mergeResidualFallbacks(extracted, allFallbackHasts);
    const blob = compressResidualFallbacks(fullResidual, residualDictionaryText(loadingHasts));
    expect(blob).toMatchObject({ fallbackCompressed: expect.any(String) });

    // ── Client ──
    // The hoisted text is the collapsed window; rebuild the same priming dict.
    const dictionaryText = residualDictionaryText(loadingHasts);
    const restored = scatterResidualFallbacks(
      wireCode,
      decompressResidualFallbacks(blob!, dictionaryText),
    );

    // The reconstructed code carries the FULL fallback — the dictionary the
    // file's `hastCompressed` needs — not the visible window the UI painted.
    const variant = restored.javascript as { fallback?: FallbackNode[] };
    expect(variant.fallback).toEqual(fullMain);
    expect(variant.fallback).not.toEqual(visibleMain);
  });
});
