import postcss from 'postcss';
import autoprefixer from 'autoprefixer';
import modulesValues from 'postcss-modules-values';
import localByDefault from 'postcss-modules-local-by-default';
import extractImports from 'postcss-modules-extract-imports';
import scope from 'postcss-modules-scope';
import { extractICSS } from 'icss-utils';
import { hashString } from './hashString';
import type { CompiledCssModule, CssModuleOptions } from './compileCssModule';

/**
 * Browserslist target for autoprefixer. "Baseline Widely Available" is the set of
 * features supported across the major engines for ~2.5 years — a stable, modern
 * floor that still picks up the vendor prefixes those older-but-supported versions
 * need (e.g. `-webkit-user-select`).
 */
const BASELINE_WIDELY_AVAILABLE = ['baseline widely available'];

/** Shared autoprefixer plugin, created once when this lazy chunk first loads. */
const autoprefix = autoprefixer({ overrideBrowserslist: BASELINE_WIDELY_AVAILABLE });

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
 * extract-imports → scope) followed by autoprefixer, then `extractICSS` for the
 * exports. See the shell's docs for the full semantics.
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
    autoprefix,
  ]).process(source, { from: undefined });

  // `extractICSS` mutates the root (removing the `:export`/`:import` rules), so
  // re-stringify from the root afterwards rather than reading the stale `css`.
  const { icssImports, icssExports } = extractICSS(result.root, true);
  return { css: result.root.toString(), exports: icssExports, imports: icssImports };
}

/** The PostCSS implementation behind `prefixCss` — autoprefix only, no scoping. */
export async function prefixCssWithPostcss(source: string): Promise<string> {
  const result = await postcss([autoprefix]).process(source, { from: undefined });
  return result.css;
}
