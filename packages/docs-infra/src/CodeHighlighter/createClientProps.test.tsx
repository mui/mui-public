import { describe, it, expect } from 'vitest';
import type { Code, VariantCode } from './types';
import type { CodeHighlighterClientProps } from './clientProps';
import type { FallbackNode } from './fallbackFormat';
import { fallbackToText } from './fallbackFormat';
import { createClientProps, type CreateClientPropsOptions } from './createClientProps';

// The plain fallback and the SPARSE highlighted-visible diff (frame 0), spliced text
// byte-identical to the plain frame.
const PLAIN: FallbackNode[] = [['span', 'frame', 'const x = 1;\n']];
const CRITICAL: { [frameIndex: number]: FallbackNode } = {
  0: ['span', 'frame', [['span', 'pl-k', 'const'], ' x = 1;\n']],
};

function Content(): null {
  return null;
}

const variantWith = (extra: Partial<VariantCode>): VariantCode => ({
  fileName: 'a.tsx',
  source: { hastCompressed: 'x' },
  ...extra,
});

function run(
  highlightAfter: CreateClientPropsOptions<{}>['highlightAfter'],
  options?: { collapseToEmpty?: boolean; carrier?: 'code' | 'precompute' },
): CodeHighlighterClientProps {
  const code: Code = { Main: variantWith({ fallback: PLAIN, fallbackCritical: CRITICAL }) };
  const carrier = options?.carrier ?? 'code';
  return createClientProps({
    Content,
    initialVariant: 'Main',
    highlightAfter,
    collapseToEmpty: options?.collapseToEmpty,
    code: carrier === 'code' ? code : undefined,
    precompute: carrier === 'precompute' ? code : undefined,
  } as CreateClientPropsOptions<{}>);
}

const mainOf = (result: CodeHighlighterClientProps, carrier: 'code' | 'precompute'): VariantCode =>
  (carrier === 'code' ? result.code : result.precompute)!.Main as VariantCode;

describe('createClientProps fallbackCritical', () => {
  it('promotes fallbackCritical over fallback on the precomputed code for init', () => {
    const variant = mainOf(run('init', { carrier: 'precompute' }), 'precompute');
    expect(JSON.stringify(variant.fallback)).toContain('pl-k');
    expect(variant.fallbackCritical).toBeUndefined();
    // The promoted fallback stays a valid DEFLATE dictionary.
    expect(fallbackToText(variant.fallback!)).toBe(fallbackToText(PLAIN));
  });

  it('promotes on the `code` carrier too (the bare / server-loaded path)', () => {
    const variant = mainOf(run('init', { carrier: 'code' }), 'code');
    expect(JSON.stringify(variant.fallback)).toContain('pl-k');
    expect(variant.fallbackCritical).toBeUndefined();
  });

  it('strips fallbackCritical without promoting when not init (no leak across the boundary)', () => {
    const variant = mainOf(run('idle', { carrier: 'precompute' }), 'precompute');
    expect(variant.fallback).toBe(PLAIN);
    expect(variant.fallbackCritical).toBeUndefined();
  });

  it('strips without promoting under collapseToEmpty', () => {
    const variant = mainOf(
      run('init', { carrier: 'precompute', collapseToEmpty: true }),
      'precompute',
    );
    expect(variant.fallback).toBe(PLAIN);
    expect(variant.fallbackCritical).toBeUndefined();
  });

  it('treats highlightAfter: stream like init (normalized before resolving)', () => {
    const variant = mainOf(run('stream', { carrier: 'precompute' }), 'precompute');
    expect(JSON.stringify(variant.fallback)).toContain('pl-k');
    expect(variant.fallbackCritical).toBeUndefined();
  });

  it('reads collapseToEmpty from contentProps (skips promotion via that branch too)', () => {
    const code: Code = { Main: variantWith({ fallback: PLAIN, fallbackCritical: CRITICAL }) };
    const result = createClientProps({
      Content,
      initialVariant: 'Main',
      highlightAfter: 'init',
      // collapseToEmpty arrives via contentProps, not the top-level prop.
      contentProps: { collapseToEmpty: true },
      precompute: code,
    } as CreateClientPropsOptions<{}>);
    const variant = result.precompute!.Main as VariantCode;
    expect(variant.fallback).toBe(PLAIN);
    expect(variant.fallbackCritical).toBeUndefined();
  });
});
