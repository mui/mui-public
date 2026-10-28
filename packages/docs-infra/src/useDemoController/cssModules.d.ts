// Ambient declarations for the ICSS plugin trio + helpers that power CSS Modules
// scoping. These are the exact packages css-loader composes internally; none ship
// their own types, and all are pure PostCSS AST transforms (no fs/path), so they
// run identically in the browser and Node. Typed minimally to what the compiler
// here uses — see `compileCssModule.ts`.

declare module 'postcss-modules-values' {
  import type { Plugin } from 'postcss';

  // Resolves `@value` definitions/usages. Used directly as a plugin (no options).
  const plugin: Plugin;
  export default plugin;
}

declare module 'postcss-modules-local-by-default' {
  import type { Plugin } from 'postcss';

  const plugin: (options?: { mode?: 'local' | 'global' | 'pure' }) => Plugin;
  export default plugin;
}

declare module 'postcss-modules-extract-imports' {
  import type { Plugin } from 'postcss';

  const plugin: (options?: { failOnWrongOrder?: boolean }) => Plugin;
  export default plugin;
}

declare module 'postcss-modules-scope' {
  import type { Plugin } from 'postcss';

  const plugin: (options?: {
    generateScopedName?: (name: string, path: string, css: string) => string;
    generateExportEntry?: unknown;
    exportGlobals?: boolean;
  }) => Plugin;
  export default plugin;
}

declare module 'icss-utils' {
  import type { Root } from 'postcss';

  /** Pulls the `:import`/`:export` ICSS rules out of a processed root. */
  export function extractICSS(
    css: Root,
    removeRules?: boolean,
  ): {
    icssImports: Record<string, Record<string, string>>;
    icssExports: Record<string, string>;
  };
  export function replaceValueSymbols(css: Root, replacements: Record<string, string>): void;
  export function replaceSymbols(css: Root, replacements: Record<string, string>): void;
}
