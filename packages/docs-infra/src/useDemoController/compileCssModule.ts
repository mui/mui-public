import type { Plugin, Processor, Root } from 'postcss';
import { hashString } from './hashString';

export interface CssModuleOptions {
  /**
   * Seed for the generated class-name hash. Defaults to the source itself, so
   * identical sources hash identically — keeping scoped names stable across
   * server render, client hydration, and live-edit recompiles.
   */
  hashSeed?: string;
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
 * Browserslist target for autoprefixer. "Baseline Widely Available" is the set of
 * features supported across the major engines for ~2.5 years — a stable, modern
 * floor that still picks up the vendor prefixes those older-but-supported versions
 * need (e.g. `-webkit-user-select`).
 */
const BASELINE_WIDELY_AVAILABLE = ['baseline widely available'];

/** The dynamically-imported PostCSS tooling, loaded once and shared. */
interface CssTooling {
  postcss: (plugins: Plugin[]) => Processor;
  /** A shared, pre-configured autoprefixer plugin (Baseline target). */
  autoprefix: Plugin;
  modulesValues: Plugin;
  localByDefault: (options: { mode: 'local' }) => Plugin;
  extractImports: () => Plugin;
  scope: (options: {
    generateScopedName: (name: string) => string;
    exportGlobals: boolean;
  }) => Plugin;
  extractICSS: (
    root: Root,
    removeRules: boolean,
  ) => { icssImports: Record<string, Record<string, string>>; icssExports: Record<string, string> };
}

let toolingPromise: Promise<CssTooling> | null = null;

/**
 * Loads PostCSS, autoprefixer, and the ICSS Modules plugins on first use and
 * memoizes them. Heavy and browser-/Node-isomorphic, so it lives behind a dynamic
 * `import()` — kept out of the main bundle and only paid for when a demo actually
 * compiles CSS. The shared autoprefixer instance is reused across every compile.
 */
function loadCssTooling(): Promise<CssTooling> {
  if (!toolingPromise) {
    toolingPromise = (async () => {
      const [postcss, autoprefixer, modulesValues, localByDefault, extractImports, scope, icss] =
        await Promise.all([
          import('postcss'),
          import('autoprefixer'),
          import('postcss-modules-values'),
          import('postcss-modules-local-by-default'),
          import('postcss-modules-extract-imports'),
          import('postcss-modules-scope'),
          import('icss-utils'),
        ]);
      return {
        postcss: (plugins: Plugin[]) => postcss.default(plugins),
        autoprefix: autoprefixer.default({ overrideBrowserslist: BASELINE_WIDELY_AVAILABLE }),
        modulesValues: modulesValues.default,
        localByDefault: localByDefault.default,
        extractImports: extractImports.default,
        scope: scope.default,
        extractICSS: icss.extractICSS,
      };
    })();
  }
  return toolingPromise;
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
 * Rejects with a PostCSS `CssSyntaxError` on malformed input — callers that
 * recompile on every keystroke should catch it and keep the last good output.
 */
export async function compileCssModule(
  source: string,
  options: CssModuleOptions = {},
): Promise<CompiledCssModule> {
  const tooling = await loadCssTooling();
  const suffix = hashString(options.hashSeed ?? source).padStart(5, '0');

  const result = await tooling
    .postcss([
      tooling.modulesValues,
      tooling.localByDefault({ mode: 'local' }),
      tooling.extractImports(),
      tooling.scope({ generateScopedName: (name) => `${name}-${suffix}`, exportGlobals: false }),
      tooling.autoprefix,
    ])
    .process(source, { from: undefined });

  // `extractICSS` mutates the root (removing the `:export`/`:import` rules), so
  // re-stringify from the root afterwards rather than reading the stale `css`.
  const { icssImports, icssExports } = tooling.extractICSS(result.root, true);
  return { css: result.root.toString(), exports: icssExports, imports: icssImports };
}

/**
 * Autoprefixes a plain (non-module) stylesheet for the Baseline Widely Available
 * range, without scoping any selectors — the global-CSS counterpart to
 * {@link compileCssModule}. Class names pass through verbatim; only the vendor
 * prefixes that range needs are added. Rejects on malformed CSS.
 */
export async function prefixCss(source: string): Promise<string> {
  const tooling = await loadCssTooling();
  const result = await tooling.postcss([tooling.autoprefix]).process(source, { from: undefined });
  return result.css;
}
