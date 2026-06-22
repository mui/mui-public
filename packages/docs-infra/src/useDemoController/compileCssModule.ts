export interface CssModuleOptions {
  /**
   * Seed for the generated class-name hash. Defaults to the source itself, so
   * identical sources hash identically — keeping scoped names stable across
   * server render, client hydration, and live-edit recompiles.
   */
  hashSeed?: string;
  /**
   * The file's name, used only to label a `CssSyntaxError` (`name.module.css:L:C`)
   * so a multi-file demo points at the offending stylesheet.
   */
  fileName?: string;
}

export interface CompiledCssModule {
  /** The transformed CSS: class/id/keyframe names scoped, declarations autoprefixed. */
  css: string;
  /**
   * Map of original local name to its scoped name — the module's exports. A
   * `composes` target is merged in (space-separated). Register it in a runner
   * scope's `import` map so demo code can resolve
   * `import styles from './styles.module.css'` to `styles.button` etc.
   *
   * A cross-file `composes ... from` leaves an opaque placeholder token in the
   * value (see {@link imports}); the caller resolves it against the sibling.
   */
  exports: Record<string, string>;
  /**
   * Cross-file `composes ... from "./other"` requests this single-file compile
   * cannot resolve: `{ './other': { '<placeholder>': 'originalName' } }`. The
   * placeholder also appears in {@link exports}; resolving it (swapping the token
   * for the sibling's scoped name) is left to the caller, which has the sibling
   * modules. Empty for the common, self-contained case.
   */
  imports: Record<string, Record<string, string>>;
}

/**
 * Compiles a CSS Modules source string into scoped CSS plus its name exports,
 * using PostCSS with the same ICSS plugin chain css-loader runs (values →
 * local-by-default → extract-imports → scope) followed by autoprefixer.
 *
 * Each local `.button`/`#id`/`@keyframes`/`@value`/animation name becomes
 * `name-<hash>` in the CSS and `{ button: 'button-<hash>' }` in
 * {@link CompiledCssModule.exports}. Full CSS Modules semantics are supported:
 * `:global()`/`:local()`, same-file `composes`, `@keyframes` + `animation` name
 * scoping, and `@value`. Cross-file `composes ... from` is surfaced as an
 * {@link CompiledCssModule.imports} entry for the caller to resolve. Declaration
 * values, comments, and string contents are preserved; autoprefixer then adds the
 * vendor prefixes the Baseline Widely Available range still needs.
 *
 * The whole PostCSS toolchain is loaded behind a SINGLE dynamic import, so it
 * ships as one lazy `compileCss` chunk (never in the main bundle) — paid for only
 * when a demo first compiles CSS. Rejects with a PostCSS `CssSyntaxError` on
 * malformed input — callers that recompile on every keystroke should catch it and
 * keep the last good output.
 */
export async function compileCssModule(
  source: string,
  options: CssModuleOptions = {},
): Promise<CompiledCssModule> {
  const { compileCssModuleWithPostcss } = await import(
    /* webpackChunkName: "compileCss" */ './compileCssWithPostcss'
  );
  return compileCssModuleWithPostcss(source, options);
}

/**
 * Autoprefixes a plain (non-module) stylesheet for the visitor's browser, without
 * scoping any selectors — the global-CSS counterpart to {@link compileCssModule}.
 * Class names pass through verbatim; only the vendor prefixes that browser needs are
 * added. Shares the same lazy `compileCss` chunk. Rejects on malformed CSS, labelling
 * the error with `fileName` when given.
 */
export async function prefixCss(source: string, fileName?: string): Promise<string> {
  const { prefixCssWithPostcss } = await import(
    /* webpackChunkName: "compileCss" */ './compileCssWithPostcss'
  );
  return prefixCssWithPostcss(source, fileName);
}
