import { describe, it, expect } from 'vitest';
import type { Element as HastElement } from 'hast';
import type { Code, HastRoot, VariantCode } from './types';
import type { FallbackNode } from './fallbackFormat';
import { buildRootFallback, buildCriticalFallback, fallbackToText } from './fallbackFormat';
import { getInitialVisibleFrames } from '../pipeline/parseSource/frameVisibility';
import { compressHast } from '../pipeline/hastUtils';
import { decodeHastSource } from '../pipeline/loadIsomorphicCodeVariant/decodeHastSource';
import { resolveFallbackCritical } from './resolveFallbackCritical';

// The plain fallback, and the SPARSE highlighted-visible diff (only frame 0) whose
// spliced text is byte-identical to the plain frame — the DEFLATE-dictionary invariant
// the boundary relies on when promoting.
const PLAIN: FallbackNode[] = [['span', 'frame', 'const x = 1;\n']];
const CRITICAL: { [frameIndex: number]: FallbackNode } = {
  0: ['span', 'frame', [['span', 'pl-k', 'const'], ' x = 1;\n']],
};

const codeWith = (variant: Partial<VariantCode>): Code =>
  ({ Main: { fileName: 'a.tsx', source: { hastCompressed: 'x' }, ...variant } }) as Code;

describe('resolveFallbackCritical', () => {
  it('promotes fallbackCritical over fallback for highlightAt: init', () => {
    const result = resolveFallbackCritical(
      codeWith({ fallback: PLAIN, fallbackCritical: CRITICAL }),
      'init',
      false,
    );
    const variant = result?.Main as VariantCode;
    // Spliced (not the same ref): frame 0 is now highlighted.
    expect(JSON.stringify(variant.fallback)).toContain('pl-k');
    expect(variant.fallbackCritical).toBeUndefined();
  });

  it('keeps the promoted fallback a valid dictionary (text byte-identical)', () => {
    const result = resolveFallbackCritical(
      codeWith({ fallback: PLAIN, fallbackCritical: CRITICAL }),
      'init',
      false,
    );
    const variant = result?.Main as VariantCode;
    expect(fallbackToText(variant.fallback!)).toBe(fallbackToText(PLAIN));
  });

  it('strips fallbackCritical without promoting when not init', () => {
    const result = resolveFallbackCritical(
      codeWith({ fallback: PLAIN, fallbackCritical: CRITICAL }),
      'idle',
      false,
    );
    const variant = result?.Main as VariantCode;
    expect(variant.fallback).toBe(PLAIN);
    expect(variant.fallbackCritical).toBeUndefined();
  });

  it('strips without promoting under collapseToEmpty (all-plain is correct there)', () => {
    const result = resolveFallbackCritical(
      codeWith({ fallback: PLAIN, fallbackCritical: CRITICAL }),
      'init',
      true,
    );
    const variant = result?.Main as VariantCode;
    expect(variant.fallback).toBe(PLAIN);
    expect(variant.fallbackCritical).toBeUndefined();
  });

  it('strips fallbackCritical even when there is no plain fallback to promote over', () => {
    const result = resolveFallbackCritical(codeWith({ fallbackCritical: CRITICAL }), 'init', false);
    const variant = result?.Main as VariantCode;
    expect(variant.fallback).toBeUndefined();
    expect(variant.fallbackCritical).toBeUndefined();
  });

  it('does not mutate the input code or its variants', () => {
    const code = codeWith({ fallback: PLAIN, fallbackCritical: CRITICAL });
    const before = code.Main as VariantCode;
    resolveFallbackCritical(code, 'init', false);
    expect(before.fallback).toBe(PLAIN);
    expect(before.fallbackCritical).toBe(CRITICAL);
  });

  it('returns the same reference when no variant carries fallbackCritical', () => {
    const code = codeWith({ fallback: PLAIN });
    expect(resolveFallbackCritical(code, 'init', false)).toBe(code);
  });

  it('leaves string variants and other variants untouched', () => {
    const code: Code = {
      Main: { fileName: 'a.tsx', fallback: PLAIN, fallbackCritical: CRITICAL } as VariantCode,
      Other: { fileName: 'b.tsx', fallback: PLAIN } as VariantCode,
      Raw: 'https://example.test/x.tsx',
    };
    const result = resolveFallbackCritical(code, 'init', false);
    expect(JSON.stringify((result?.Main as VariantCode).fallback)).toContain('pl-k');
    expect(result?.Other).toBe(code.Other);
    expect(result?.Raw).toBe('https://example.test/x.tsx');
  });

  it('returns undefined code unchanged', () => {
    expect(resolveFallbackCritical(undefined, 'init', false)).toBeUndefined();
  });
});

/**
 * A live two-frame highlighted root, as the loader holds it right before compression:
 * frame 0 is the visible (`focus`) frame, frame 1 is off-screen. Each frame carries
 * highlighted `.line` children AND a per-frame `data.fallback` — the post-transform
 * state too, since a transform regenerates `data.fallback` from the rewritten children
 * (`applyCodeTransformWithComments`). Pass `staleVisibleFallback` to simulate the bug the
 * checksum guards against: a transform that rewrote the visible frame's children but left
 * its `data.fallback` stale, so the highlighted-visible text would diverge from the
 * compression dictionary.
 */
function highlightedRoot(staleVisibleFallback = false): HastRoot {
  const line = (ln: number, keyword: string, rest: string): HastElement => ({
    type: 'element',
    tagName: 'span',
    properties: { className: ['line'], dataLn: ln },
    children: [
      {
        type: 'element',
        tagName: 'span',
        properties: { className: ['pl-k'] },
        children: [{ type: 'text', value: keyword }],
      },
      { type: 'text', value: rest },
    ],
  });
  const frame = (frameType: string | undefined, child: HastElement, text: string): HastElement => ({
    type: 'element',
    tagName: 'span',
    properties: { className: ['frame'], ...(frameType ? { dataFrameType: frameType } : {}) },
    data: { fallback: [{ type: 'text', value: text }] } as HastElement['data'],
    children: [child],
  });
  return {
    type: 'root',
    data: { totalLines: 2, focusedLines: 1 },
    children: [
      frame('focus', line(1, 'const', ' x = 1;'), staleVisibleFallback ? 'STALE' : 'const x = 1;'),
      frame(undefined, line(2, 'const', ' y = 2;'), 'const y = 2;'),
    ],
  };
}

/** Compress a root the loader's way: strip per-frame `data.fallback`, dictionary = fallback text. */
function compressLikeLoader(root: HastRoot, fallback: FallbackNode[]) {
  const stripped = JSON.parse(JSON.stringify(root)) as HastRoot;
  for (const child of stripped.children) {
    delete (child as HastElement).data?.fallback;
  }
  return {
    stripped,
    source: { hastCompressed: compressHast(JSON.stringify(stripped), fallbackToText(fallback)) },
  };
}

describe('resolveFallbackCritical promotion round-trip', () => {
  it('keeps the compressed source decodable after promoting fallbackCritical (init)', () => {
    const root = highlightedRoot();
    const fallback = buildRootFallback(root);
    const fallbackCritical = buildCriticalFallback(root, getInitialVisibleFrames(root, false));
    const { source } = compressLikeLoader(root, fallback);

    const code: Code = {
      Main: {
        fileName: 'a.tsx',
        source,
        fallback,
        fallbackCritical,
        // A transformed variant carries a transform manifest; the source the dictionary
        // is built from is still the base, so promotion stays dictionary-consistent.
        transforms: { Plain: {} },
      } as unknown as VariantCode,
    };

    const promoted = (resolveFallbackCritical(code, 'init', false)?.Main as VariantCode).fallback!;
    // The visible frame is highlighted, the off-screen frame stays plain.
    expect(JSON.stringify(promoted[0])).toContain('pl-k');
    expect(promoted[1]).toEqual(['span', 'frame', 'const y = 2;']);
    // Promoting swapped the array but not its text, so the DEFLATE dictionary is intact:
    // the compressed source decodes against the promoted fallback (no checksum throw) and
    // round-trips the highlighted source.
    const decoded = decodeHastSource(source, promoted);
    expect(decoded).not.toBeNull();
    const decodedJson = JSON.stringify(decoded);
    expect(decodedJson).toContain('pl-k'); // highlighting survived the round-trip
    expect(decodedJson).toContain('const');
    expect(decodedJson).toContain('y = 2;');
  });

  it('throws loudly (checksum) if a stale data.fallback desyncs the visible frame', () => {
    // The compression dictionary is built from the (stale) plain fallback, but the
    // highlighted-visible text comes from the rewritten children — so they diverge and
    // the decode must fail rather than silently corrupt.
    const root = highlightedRoot(true);
    const fallback = buildRootFallback(root);
    const fallbackCritical = buildCriticalFallback(root, getInitialVisibleFrames(root, false));
    const { source } = compressLikeLoader(root, fallback);

    const code: Code = {
      Main: { fileName: 'a.tsx', source, fallback, fallbackCritical } as unknown as VariantCode,
    };
    const promoted = (resolveFallbackCritical(code, 'init', false)?.Main as VariantCode).fallback!;
    // Promotion pulled the visible frame's real (rewritten) text in, which diverges from
    // the stale dictionary the source was compressed against.
    expect(fallbackToText(promoted)).not.toBe(fallbackToText(fallback));
    expect(() => decodeHastSource(source, promoted)).toThrow();
  });
});
