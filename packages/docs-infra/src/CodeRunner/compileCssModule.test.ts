import { describe, it, expect } from 'vitest';
import { compileCssModule } from './compileCssModule';

describe('compileCssModule', () => {
  it('scopes a class selector and exports the mapping', () => {
    const { css, exports } = compileCssModule('.button { color: red; }');
    expect(exports.button.startsWith('button-')).toBe(true);
    expect(css).toBe(`.${exports.button} { color: red; }`);
  });

  it('is deterministic for identical sources', () => {
    const source = '.box { padding: 8px; }';
    expect(compileCssModule(source)).toEqual(compileCssModule(source));
  });

  it('derives a different scope hash for different sources', () => {
    const first = compileCssModule('.box { color: red; }').exports.box;
    const second = compileCssModule('.box { color: blue; }').exports.box;
    expect(first).not.toBe(second);
  });

  it('uses the hashSeed option for the suffix when provided', () => {
    const a = compileCssModule('.box {}', { hashSeed: 'one' }).exports.box;
    const b = compileCssModule('.box {}', { hashSeed: 'two' }).exports.box;
    const aAgain = compileCssModule('.box { color: red }', { hashSeed: 'one' }).exports.box;
    expect(a).not.toBe(b);
    // Same seed -> same suffix, even though the source differs.
    expect(a).toBe(aAgain);
  });

  it('reuses one scoped name per local class and shares the module suffix', () => {
    const { css, exports } = compileCssModule('.a { color: red; }\n.b .a { color: blue; }');
    const suffix = exports.a.slice('a-'.length);
    expect(exports.b).toBe(`b-${suffix}`);
    expect(css).toBe(`.a-${suffix} { color: red; }\n.b-${suffix} .a-${suffix} { color: blue; }`);
  });

  it('scopes compound, combinator, pseudo, and list selectors but not pseudos', () => {
    const { css, exports } = compileCssModule('.a.b:hover, .c > .d { color: red; }');
    expect(Object.keys(exports).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(css).toBe(
      `.${exports.a}.${exports.b}:hover, .${exports.c} > .${exports.d} { color: red; }`,
    );
  });

  it('does not scope dotted, hash, or url tokens inside declaration values', () => {
    const source = '.box { margin: .5em; background: #fff url(./bg.png); }';
    const { css, exports } = compileCssModule(source);
    expect(Object.keys(exports)).toEqual(['box']);
    expect(css).toBe(`.${exports.box} { margin: .5em; background: #fff url(./bg.png); }`);
  });

  it('does not scope element or id selectors', () => {
    const { css, exports } = compileCssModule('div#main .item { color: red; }');
    expect(Object.keys(exports)).toEqual(['item']);
    expect(css).toBe(`div#main .${exports.item} { color: red; }`);
  });

  it('scopes class selectors nested inside an at-rule group', () => {
    const { css, exports } = compileCssModule('@media (min-width: 600px) { .a { color: blue; } }');
    expect(Object.keys(exports)).toEqual(['a']);
    expect(css).toBe(`@media (min-width: 600px) { .${exports.a} { color: blue; } }`);
  });

  it('leaves @keyframes bodies untouched', () => {
    const source = '@keyframes spin { from { opacity: 0; } to { opacity: 1; } }';
    expect(compileCssModule(source).css).toBe(source);
    expect(compileCssModule(source).exports).toEqual({});
  });

  it('ignores class-like text inside comments', () => {
    const { css, exports } = compileCssModule('/* .ignored */ .real { color: red; }');
    expect(Object.keys(exports)).toEqual(['real']);
    expect(css).toBe(`/* .ignored */ .${exports.real} { color: red; }`);
  });

  it('ignores class-like text inside strings', () => {
    const { css, exports } = compileCssModule('.a::before { content: ".not-a-class"; }');
    expect(Object.keys(exports)).toEqual(['a']);
    expect(css).toBe(`.${exports.a}::before { content: ".not-a-class"; }`);
  });

  it('scopes hyphenated class names (accessible via bracket notation)', () => {
    const { exports } = compileCssModule('.my-button { color: red; }');
    expect(exports['my-button'].startsWith('my-button-')).toBe(true);
  });

  it('handles a selector with no whitespace before the block', () => {
    const { css, exports } = compileCssModule('.x{color:red}');
    expect(css).toBe(`.${exports.x}{color:red}`);
  });

  it('returns empty results for empty input', () => {
    expect(compileCssModule('')).toEqual({ css: '', exports: {} });
  });

  it('keeps css and exports consistent (every scoped name appears in the css)', () => {
    const { css, exports } = compileCssModule(
      '.header, .footer { color: red; }\n@media screen { .header .link:hover { color: blue; } }',
    );
    for (const scoped of Object.values(exports)) {
      expect(css.includes(scoped)).toBe(true);
    }
  });
});
