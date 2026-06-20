import { describe, it, expect } from 'vitest';
import { compileCssModule, prefixCss } from './compileCssModule';

describe('compileCssModule', () => {
  describe('class scoping', () => {
    it('scopes a class selector and exports the mapping', async () => {
      const { css, exports } = await compileCssModule('.button { color: red; }');
      expect(exports.button.startsWith('button-')).toBe(true);
      expect(css).toBe(`.${exports.button} { color: red; }`);
    });

    it('reuses one scoped name per local class and shares the module suffix', async () => {
      const { css, exports } = await compileCssModule('.a { color: red; }\n.b .a { color: blue; }');
      const suffix = exports.a.slice('a-'.length);
      expect(exports.b).toBe(`b-${suffix}`);
      expect(css).toBe(`.a-${suffix} { color: red; }\n.b-${suffix} .a-${suffix} { color: blue; }`);
    });

    it('scopes compound, combinator, pseudo, and list selectors', async () => {
      const { css, exports } = await compileCssModule('.a.b:hover, .c > .d { color: red; }');
      expect(Object.keys(exports).sort()).toEqual(['a', 'b', 'c', 'd']);
      expect(css).toBe(
        `.${exports.a}.${exports.b}:hover, .${exports.c} > .${exports.d} { color: red; }`,
      );
    });

    it('scopes class selectors nested inside an at-rule group', async () => {
      const { css, exports } = await compileCssModule(
        '@media (min-width: 600px) { .a { color: blue; } }',
      );
      expect(Object.keys(exports)).toEqual(['a']);
      expect(css).toBe(`@media (min-width: 600px) { .${exports.a} { color: blue; } }`);
    });

    it('scopes id selectors but leaves element selectors alone', async () => {
      const { css, exports } = await compileCssModule('div#main .item { color: red; }');
      expect(Object.keys(exports).sort()).toEqual(['item', 'main']);
      expect(css).toBe(`div#${exports.main} .${exports.item} { color: red; }`);
    });

    it('scopes hyphenated class names (accessible via bracket notation)', async () => {
      const { exports } = await compileCssModule('.my-button { color: red; }');
      expect(exports['my-button'].startsWith('my-button-')).toBe(true);
    });

    it('does not scope dotted, hash, or url tokens inside declaration values', async () => {
      const source = '.box { margin: .5em; background: #fff url(./bg.png); }';
      const { css, exports } = await compileCssModule(source);
      expect(Object.keys(exports)).toEqual(['box']);
      expect(css).toBe(`.${exports.box} { margin: .5em; background: #fff url(./bg.png); }`);
    });

    it('ignores class-like text inside comments', async () => {
      const { css, exports } = await compileCssModule('/* .ignored */ .real { color: red; }');
      expect(Object.keys(exports)).toEqual(['real']);
      expect(css).toBe(`/* .ignored */ .${exports.real} { color: red; }`);
    });

    it('ignores class-like text inside strings', async () => {
      const { css, exports } = await compileCssModule('.a::before { content: ".not-a-class"; }');
      expect(Object.keys(exports)).toEqual(['a']);
      expect(css).toBe(`.${exports.a}::before { content: ".not-a-class"; }`);
    });

    it('handles a selector with no whitespace before the block', async () => {
      const { css, exports } = await compileCssModule('.x{color:red}');
      expect(css).toBe(`.${exports.x}{color:red}`);
    });
  });

  describe('hashing', () => {
    it('is deterministic for identical sources', async () => {
      const source = '.box { padding: 8px; }';
      const [first, second] = await Promise.all([
        compileCssModule(source),
        compileCssModule(source),
      ]);
      expect(first).toEqual(second);
    });

    it('derives a different scope hash for different sources', async () => {
      const [first, second] = await Promise.all([
        compileCssModule('.box { color: red; }'),
        compileCssModule('.box { color: blue; }'),
      ]);
      expect(first.exports.box).not.toBe(second.exports.box);
    });

    it('uses the hashSeed option for the suffix when provided', async () => {
      const [a, b, aAgain] = await Promise.all([
        compileCssModule('.box {}', { hashSeed: 'one' }),
        compileCssModule('.box {}', { hashSeed: 'two' }),
        compileCssModule('.box { color: red }', { hashSeed: 'one' }),
      ]);
      expect(a.exports.box).not.toBe(b.exports.box);
      // Same seed -> same suffix, even though the source differs.
      expect(a.exports.box).toBe(aAgain.exports.box);
    });
  });

  describe('CSS Modules semantics', () => {
    it('leaves a :global() class unscoped and out of the exports', async () => {
      const { css, exports } = await compileCssModule(':global(.keep) .btn { color: red; }');
      expect(Object.keys(exports)).toEqual(['btn']);
      expect(css).toBe(`.keep .${exports.btn} { color: red; }`);
    });

    it('scopes a :local() class explicitly', async () => {
      const { css, exports } = await compileCssModule(':local(.a) { color: red; }');
      expect(Object.keys(exports)).toEqual(['a']);
      expect(css).toBe(`.${exports.a} { color: red; }`);
    });

    it('merges a same-file `composes` target into the class export', async () => {
      const { css, exports } = await compileCssModule(
        '.base { color: red; }\n.btn { composes: base; padding: 4px; }',
      );
      const suffix = exports.base.slice('base-'.length);
      // `composes` is removed from the CSS; `btn` resolves to both scoped names.
      expect(exports.btn).toBe(`btn-${suffix} ${exports.base}`);
      expect(css).toBe(`.${exports.base} { color: red; }\n.btn-${suffix} { padding: 4px; }`);
    });

    it('scopes @keyframes names and their animation references', async () => {
      const { css, exports } = await compileCssModule(
        '@keyframes spin { from { opacity: 0; } to { opacity: 1; } }\n.a { animation: spin 1s; }',
      );
      expect(exports.spin.startsWith('spin-')).toBe(true);
      expect(css).toBe(
        `@keyframes ${exports.spin} { from { opacity: 0; } to { opacity: 1; } }\n.${exports.a} { animation: ${exports.spin} 1s; }`,
      );
    });

    it('substitutes a same-file @value', async () => {
      const { css, exports } = await compileCssModule(
        '@value primary: #333;\n.a { color: primary; }',
      );
      expect(exports.primary).toBe('#333');
      expect(css).toBe(`.${exports.a} { color: #333; }`);
    });

    it('captures a cross-file `composes ... from` as an unresolved import', async () => {
      // A single-file compile cannot resolve a sibling module; it surfaces the
      // import so the caller (buildScope) can resolve it against the sibling's
      // exports. The placeholder is carried verbatim in both maps.
      const { exports, imports } = await compileCssModule(
        '.btn { composes: foo from "./other.module.css"; color: red; }',
      );
      const placeholder = imports['./other.module.css'];
      expect(placeholder).toBeDefined();
      const [token, name] = Object.entries(placeholder)[0];
      expect(name).toBe('foo');
      // `btn` is exported as its own scoped name plus the still-opaque placeholder,
      // which the caller swaps for the sibling's resolved `foo`.
      const [own, composed] = exports.btn.split(' ');
      expect(own.startsWith('btn-')).toBe(true);
      expect(composed).toBe(token);
    });
  });

  describe('autoprefixing (Baseline Widely Available)', () => {
    // Autoprefixer runs after scoping. A property still needing a vendor prefix in
    // the Baseline range gets one; `user-select` is prefixed for the older Safari
    // versions Baseline still covers. If Baseline advances past them, this moves.
    it('autoprefixes declarations for the Baseline target', async () => {
      const { css, exports } = await compileCssModule('.sel { user-select: none; }');
      expect(css).toBe(`.${exports.sel} { -webkit-user-select: none; user-select: none; }`);
    });

    it('does not add prefixes to a property that needs none', async () => {
      const { css, exports } = await compileCssModule('.x { color: red; }');
      expect(css).toBe(`.${exports.x} { color: red; }`);
    });
  });

  describe('edge cases', () => {
    it('returns empty results for empty input', async () => {
      expect(await compileCssModule('')).toEqual({ css: '', exports: {}, imports: {} });
    });

    it('keeps css and exports consistent (every scoped name appears in the css)', async () => {
      const { css, exports } = await compileCssModule(
        '.header, .footer { color: red; }\n@media screen { .header .link:hover { color: blue; } }',
      );
      for (const scoped of Object.values(exports)) {
        expect(css.includes(scoped)).toBe(true);
      }
    });

    it('rejects on a CSS syntax error', async () => {
      await expect(compileCssModule('.a { color: ')).rejects.toThrow();
    });
  });
});

describe('prefixCss', () => {
  it('autoprefixes a global stylesheet without scoping its class selectors', async () => {
    expect(await prefixCss('.x { user-select: none; }')).toBe(
      '.x { -webkit-user-select: none; user-select: none; }',
    );
  });

  it('leaves a stylesheet needing no prefixes unchanged', async () => {
    expect(await prefixCss('a { color: red }')).toBe('a { color: red }');
  });

  it('returns empty output for empty input', async () => {
    expect(await prefixCss('')).toBe('');
  });
});
