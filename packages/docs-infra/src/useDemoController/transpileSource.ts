import { absolutizeImports } from './absolutizeImports';
import { normalizeCode, transformCode } from './transformCode';

/** How to transform one source before sucrase transpiles it. */
export interface TranspileSourceOptions {
  /** The file's path within the demo (e.g. `dir/util.ts`) — resolves relative imports when `nested`. */
  fileName?: string;
  /** Rewrite relative imports to absolute scope keys (subdirectory demos). */
  nested?: boolean;
  /** Promote a bare leading expression to a default export — used for the entry source. */
  normalize?: boolean;
}

/**
 * The full source → runnable-JS transform, run for one file: rewrite relative
 * imports to absolute scope keys (when `nested`), promote a bare leading
 * expression to a default export (the `normalize` entry case), then transpile
 * TS/JSX to CommonJS via sucrase.
 *
 * Pure `string → string` with no DOM, React, or `new Function`, so it runs
 * identically on the main thread or inside a Web Worker — it is the unit the
 * transpile worker offloads off the UI thread. The `new Function`/eval that turns
 * the result into a module stays on the main thread (see `instantiateModule`).
 */
export function transpileSource(source: string, options: TranspileSourceOptions = {}): string {
  const { fileName = '', nested = false, normalize = false } = options;
  let result = nested ? absolutizeImports(source, fileName) : source;
  if (normalize) {
    result = normalizeCode(result);
  }
  return transformCode(result);
}

/**
 * Transpiles one source to runnable JS asynchronously — on the main thread, or
 * (preferably) in a Web Worker off the UI thread. An optional `AbortSignal` drops
 * a stale request when a newer edit supersedes it. Mirrors {@link transpileSource}
 * but async, so a worker-backed and a main-thread implementation are
 * interchangeable.
 */
export type Transpile = (
  source: string,
  options?: TranspileSourceOptions,
  signal?: AbortSignal,
) => Promise<string>;
