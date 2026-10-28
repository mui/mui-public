/**
 * Specifier prefix under which an extra file's exports are registered in the
 * runner scope. Relative imports between extra files (and from the main source)
 * are rewritten to `<prefix><path-from-demo-root>`, so the runner's exact-key
 * `require` resolves them no matter where the importing file sits.
 *
 * Kept in this tiny module — not in `absolutizeImports` — so the static-graph
 * `collectSources`, which only needs this constant, doesn't pull the heavy
 * `absolutizeImports` (sucrase-adjacent: the import parser + rewriter) into the
 * main bundle. That function then folds into the lazy `transpileSource` chunk
 * instead of hoisting out as its own.
 */
export const SCOPE_IMPORT_PREFIX = '@mui/internal-docs-infra/useDemoController/imports/';
