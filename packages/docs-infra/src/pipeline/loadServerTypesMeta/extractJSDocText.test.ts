import { describe, it, expect } from 'vitest';
import { extractJSDocText, isJSDocNodeArray } from './extractJSDocText';

/** A plain-text JSDoc node. */
function text(value: string) {
  return { pos: 0, end: 0, kind: 0, text: value };
}

/** A `{@link symbol}` JSDoc node. */
function link(symbol: string) {
  return { pos: 0, end: 0, kind: 325, name: { escapedText: symbol } };
}

describe('extractJSDocText', () => {
  it('concatenates plain-text nodes verbatim', () => {
    expect(extractJSDocText([text('routes via '), text('one component')])).toBe(
      'routes via one component',
    );
  });

  it('links a {@link} reference when the symbol is documented on the page', () => {
    const documented = new Set(['resolveChunkRender']);
    expect(extractJSDocText([text('routes via '), link('resolveChunkRender')], documented)).toBe(
      'routes via [`resolveChunkRender`](#resolvechunkrender)',
    );
  });

  it('renders a {@link} reference as a code span when the symbol is not documented', () => {
    // `buildChunkRenderInputs` is an internal helper with no heading on the page,
    // so linking it would produce a dangling `#anchor`.
    const documented = new Set(['resolveChunkRender']);
    expect(extractJSDocText([text('evaluates '), link('buildChunkRenderInputs')], documented)).toBe(
      'evaluates `buildChunkRenderInputs`',
    );
  });

  it('mixes linked and code-span references within one description', () => {
    const documented = new Set(['resolveChunkRender']);
    expect(
      extractJSDocText(
        [link('resolveChunkRender'), text(' wraps '), link('CodeHighlighterChunk')],
        documented,
      ),
    ).toBe('[`resolveChunkRender`](#resolvechunkrender) wraps `CodeHighlighterChunk`');
  });

  it('links every reference when no documented-name set is provided (legacy behavior)', () => {
    expect(extractJSDocText([link('AnySymbol')])).toBe('[`AnySymbol`](#anysymbol)');
  });
});

describe('isJSDocNodeArray', () => {
  it('detects arrays of typescript-api-extractor JSDoc nodes', () => {
    expect(isJSDocNodeArray([text('hello')])).toBe(true);
  });

  it('rejects empty arrays and plain values', () => {
    expect(isJSDocNodeArray([])).toBe(false);
    expect(isJSDocNodeArray(['plain string'])).toBe(false);
    expect(isJSDocNodeArray([{ foo: 'bar' }])).toBe(false);
  });
});
