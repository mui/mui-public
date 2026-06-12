import { describe, it, expect } from 'vitest';
import type { Root as HastRoot } from 'hast';
import { buildCodeHighlighterChunkProps } from './buildCodeHighlighterChunkProps';
import type { Code } from './types';

const hast: HastRoot = { type: 'root', children: [{ type: 'text', value: 'x' }] };

/** A fully-highlighted variant (has a parsed `hast` source). */
function loaded(source: HastRoot = hast) {
  return { source: { hast: source } };
}

/** A source-only variant (plain text, not yet highlighted/loaded). */
function sourceOnly(source = 'const a = 1;') {
  return { source };
}

const loaderFns = { loadCodeMeta: async () => ({}) as Code };

describe('buildCodeHighlighterChunkProps', () => {
  it('passes the code through as the preloaded value', () => {
    const code = { Default: loaded() } as unknown as Code;
    expect(buildCodeHighlighterChunkProps({ code, variants: ['Default'] }).preloaded).toBe(code);
  });

  describe('content (all variants loaded -> render the client directly)', () => {
    it('marks controlled (isLoaded) when every variant is already highlighted', () => {
      const code = { Default: loaded() } as unknown as Code;
      const out = buildCodeHighlighterChunkProps({ code, variants: ['Default'], ...loaderFns });
      expect(out.controlled).toBe(true);
    });

    it('marks controlled when CodeHighlighter is in controlled (editing) mode', () => {
      const code = { Default: sourceOnly() } as unknown as Code;
      const out = buildCodeHighlighterChunkProps({ code, variants: ['Default'], controlled: true });
      expect(out.controlled).toBe(true);
    });
  });

  describe('have-initial (partial code, an initial paint is available)', () => {
    it('sets isInitial and loads the full on the server when loader fns exist', () => {
      const code = { Default: sourceOnly(), Other: sourceOnly() } as unknown as Code;
      const out = buildCodeHighlighterChunkProps({
        code,
        variants: ['Default', 'Other'],
        initialVariant: 'Default',
        fileName: 'a.ts',
        ...loaderFns,
      });
      expect(out.controlled).toBe(false);
      expect(out.isInitial).toBe(true);
      expect(out.forceClient).toBe(false);
    });

    it('forces the client (content-initial) when there are no loader fns', () => {
      const code = { Default: sourceOnly(), Other: sourceOnly() } as unknown as Code;
      const out = buildCodeHighlighterChunkProps({
        code,
        variants: ['Default', 'Other'],
        initialVariant: 'Default',
        fileName: 'a.ts',
      });
      expect(out.isInitial).toBe(true);
      expect(out.forceClient).toBe(true);
    });

    it('forces the client when forceClient is set even though loader fns exist', () => {
      const code = { Default: sourceOnly(), Other: sourceOnly() } as unknown as Code;
      const out = buildCodeHighlighterChunkProps({
        code,
        variants: ['Default', 'Other'],
        initialVariant: 'Default',
        fileName: 'a.ts',
        forceClient: true,
        ...loaderFns,
      });
      expect(out.forceClient).toBe(true);
    });
  });

  describe('load-initial (no usable initial paint in hand)', () => {
    it('is not initial and not forced-client when loader fns can fetch the initial', () => {
      // No `code` at all: the server must load the initial via the InitialLoader.
      const out = buildCodeHighlighterChunkProps({
        variants: ['Default'],
        url: 'a.ts',
        ...loaderFns,
      });
      expect(out.controlled).toBe(false);
      expect(out.isInitial).toBe(false);
      expect(out.forceClient).toBe(false);
    });

    it('forces the client when no loader fns exist', () => {
      const out = buildCodeHighlighterChunkProps({ variants: ['Default'], url: 'a.ts' });
      expect(out.isInitial).toBe(false);
      expect(out.forceClient).toBe(true);
    });
  });
});
