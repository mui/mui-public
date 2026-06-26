import postcss from 'postcss';
import autoprefixer from 'autoprefixer';
import modulesValues from 'postcss-modules-values';
import localByDefault from 'postcss-modules-local-by-default';
import extractImports from 'postcss-modules-extract-imports';
import scope from 'postcss-modules-scope';
import relativeColorSyntax from '@csstools/postcss-relative-color-syntax';
import lightDarkFunction from '@csstools/postcss-light-dark-function';
import steppedValueFunctions from '@csstools/postcss-stepped-value-functions';
import { extractICSS } from 'icss-utils';
import { hashString } from './hashString';
import { currentBrowserTarget } from './currentBrowserTarget';
import type { CompiledCssModule, CssModuleOptions } from './compileCssModule';

/**
 * Shared autoprefixer plugin, created once when this lazy chunk first loads. It
 * targets the EXACT browser the preview is running in (see
 * {@link currentBrowserTarget}) rather than a broad range — a demo's CSS only has to
 * work in the visitor's own browser, so a current browser gets no prefixes at all.
 * `ignoreUnknownVersions` makes a browser newer than the bundled caniuse-lite resolve
 * to no prefixes (correct) instead of throwing.
 */
const autoprefix = autoprefixer({
  overrideBrowserslist: currentBrowserTarget(),
  ignoreUnknownVersions: true,
});

/**
 * Lowers the handful of modern CSS features that aren't yet Baseline Widely Available
 * — relative color syntax (`rgb(from …)`), `light-dark()`, and the stepped-value math
 * (`round()`/`mod()`/`rem()`) — so a demo using them still renders while live-editing
 * on a browser older than the feature, matching what Lightning CSS does at build time.
 * `preserve: true` keeps the modern syntax alongside the fallback, so a current browser
 * uses it natively and the fallback is harmless dead weight. Everything else on
 * Lightning CSS's lowering list (nesting, `color-mix()`, lab/lch, media-query ranges,
 * `:is()`/`:not()`, …) is already widely available and needs no transform.
 */
const lowerModernCss = [
  relativeColorSyntax({ preserve: true }),
  lightDarkFunction({ preserve: true }),
  steppedValueFunctions({ preserve: true }),
];

/**
 * The PostCSS implementation behind {@link import('./compileCssModule').compileCssModule}.
 *
 * This module statically imports the WHOLE CSS toolchain (postcss + autoprefixer +
 * the ICSS Modules plugins), so it is loaded behind ONE dynamic `import()` from the
 * light `compileCssModule` shell — the bundler then emits a single `compileCss`
 * chunk instead of a separate chunk per npm package. None of this enters the main
 * bundle; it is paid for only when a demo first compiles CSS.
 *
 * Runs the same ICSS plugin chain css-loader uses (values → local-by-default →
 * extract-imports → scope) followed by {@link lowerModernCss} and autoprefixer, then
 * `extractICSS` for the exports. See the shell's docs for the full semantics.
 */
export async function compileCssModuleWithPostcss(
  source: string,
  options: CssModuleOptions = {},
): Promise<CompiledCssModule> {
  const suffix = hashString(options.hashSeed ?? source).padStart(5, '0');

  const result = await postcss([
    modulesValues,
    localByDefault({ mode: 'local' }),
    extractImports(),
    scope({ generateScopedName: (name) => `${name}-${suffix}`, exportGlobals: false }),
    ...lowerModernCss,
    autoprefix,
    // `from` is the file name, so a `CssSyntaxError` reads `name.module.css:L:C: …`.
  ]).process(source, { from: options.fileName });

  // `extractICSS` mutates the root (removing the `:export`/`:import` rules), so
  // re-stringify from the root afterwards rather than reading the stale `css`.
  const { icssImports, icssExports } = extractICSS(result.root, true);
  return { css: result.root.toString(), exports: icssExports, imports: icssImports };
}

/** The PostCSS implementation behind `prefixCss` — {@link lowerModernCss} + autoprefix, no scoping. */
export async function prefixCssWithPostcss(source: string, fileName?: string): Promise<string> {
  const result = await postcss([...lowerModernCss, autoprefix]).process(source, { from: fileName });
  return result.css;
}
