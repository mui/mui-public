import type { ControlledVariantExtraFiles } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { compileCssModule } from './compileCssModule';
import { instantiateModule } from './instantiateModule';
import { ENTRY_EXPORTS_KEY } from './instantiateElement';
import { collectSources, type CollectedModule, type CollectedStyle } from './collectSources';
import type { Transpile } from './transpileSource';
import type { ModuleRun, Scope } from './types';

export interface BuildScopeOptions {
  /** Sibling files the sources can import, keyed by file name. */
  extraFiles?: ControlledVariantExtraFiles;
  /** Identifiers (e.g. `react`) seeded into the registry before the demo's files. */
  externals: Record<string, unknown>;
  /** The variant's main source — registered so an extra can import the entry, and returned (transpiled) as `runnerCode`. */
  mainCode?: string;
  /** Transpiles one source off the main thread (worker) or on it (fallback). */
  transpile: Transpile;
  /** Aborts in-flight transpiles when a newer edit supersedes this build. */
  signal?: AbortSignal;
  /** Overrides the name the main source is registered + resolved under. */
  mainName?: string;
}

export interface BuiltScope {
  /** The runner's module registry — the `import` map handed to the runner. */
  imports: Record<string, unknown>;
  /** The concatenated stylesheet text collected from CSS extra files. */
  css: string;
  /** Whether any extra file lives in a subdirectory (see {@link collectSources}). */
  nested: boolean;
  /** The transpiled main source for the runner to render. `undefined` when none was provided. */
  runnerCode?: string;
}

/**
 * A compiled extra file, cached by the file's object identity (see `compiledFiles`).
 * A JS module keeps a reusable `run`; a module whose transpile FAILED keeps the
 * error, thrown only if the module is actually required (so a broken but unused
 * file stays harmless); CSS results are fully materialized.
 */
type CompiledExtraFile =
  | { kind: 'module'; nested: boolean; run: ModuleRun }
  | { kind: 'moduleError'; nested: boolean; error: string }
  | { kind: 'cssModule'; exports: Record<string, string>; css: string }
  | { kind: 'css'; css: string };

/**
 * Compiled-form cache keyed by the extra-file OBJECT. An edit replaces only the
 * changed file's object (the controlled code is updated immutably), so unchanged
 * files keep their reference and stay cache hits — skipping the costly re-transpile
 * (and its worker round-trip) on every keystroke. Module-level so it survives
 * re-renders; `WeakMap` so entries are reclaimed once a demo drops its files.
 */
const compiledFiles = new WeakMap<object, CompiledExtraFile>();

/**
 * Transpiles one JS/TS module (off the main thread) and caches the result, unless
 * an up-to-date entry already exists. The cache is gated on `nested`: absolutization
 * differs by mode, so the transpiled output does too. A transpile FAILURE is cached
 * as `moduleError` and re-thrown only when the module is required — so a broken but
 * unused extra file never breaks the demo. An abort propagates (and is not cached).
 */
async function transpileModule(
  module: CollectedModule,
  nested: boolean,
  transpile: Transpile,
  signal?: AbortSignal,
): Promise<void> {
  const cached = compiledFiles.get(module.file);
  if (
    cached &&
    (cached.kind === 'module' || cached.kind === 'moduleError') &&
    cached.nested === nested
  ) {
    return;
  }
  try {
    const transpiled = await transpile(
      module.source,
      { fileName: module.fileName, nested },
      signal,
    );
    compiledFiles.set(module.file, { kind: 'module', nested, run: instantiateModule(transpiled) });
  } catch (error) {
    if (signal?.aborted) {
      throw error; // a superseded build — let it reject so the caller drops it (don't cache)
    }
    compiledFiles.set(module.file, {
      kind: 'moduleError',
      nested,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Returns the cached compiled CSS for an extra file, compiling on a miss. CSS
 * output is mode-independent (no imports), so it is reused as-is — and synchronous
 * (no worker), since CSS-module scoping is cheap.
 */
function compileCssExtra(style: CollectedStyle): { exports?: Record<string, string>; css: string } {
  const cached = compiledFiles.get(style.file);
  if (cached && cached.kind !== 'module' && cached.kind !== 'moduleError') {
    return cached;
  }
  const compiled: CompiledExtraFile = style.isModule
    ? { kind: 'cssModule', ...compileCssModule(style.source) }
    : { kind: 'css', css: style.source };
  compiledFiles.set(style.file, compiled);
  return compiled;
}

/**
 * Registers a module as a LAZILY-evaluated entry. It runs on first `require`, not
 * eagerly, so registration order doesn't matter: a file can import a sibling (or
 * the main source) registered later, and circular imports resolve via the
 * in-progress `exports` (set before the body runs). `makeRun` is invoked once, on
 * first access.
 *
 * `alwaysKeys` are claimed unconditionally; `ifFreeKeys` only when not already
 * taken — so a concrete file wins over a weaker claimant on the same key (Node
 * semantics: `foo.ts` beats `foo/index.ts`'s directory key, and an explicit extra
 * beats the main entry).
 */
function defineLazyModule(
  imports: Record<string, unknown>,
  alwaysKeys: string[],
  ifFreeKeys: string[],
  makeRun: () => ModuleRun,
): void {
  let exports: Scope | null = null;
  const get = () => {
    if (exports === null) {
      // Set before running so a circular re-entry sees the in-progress exports.
      exports = {};
      makeRun()(imports, exports);
    }
    return exports;
  };
  const define = (key: string) =>
    Object.defineProperty(imports, key, { get, enumerable: true, configurable: true });
  alwaysKeys.forEach(define);
  for (const key of ifFreeKeys) {
    if (!Object.prototype.hasOwnProperty.call(imports, key)) {
      define(key);
    }
  }
}

/** The run a module's registry getter uses: its cached `run`, or a deferred throw. */
function moduleRunFor(module: CollectedModule): ModuleRun {
  const cached = compiledFiles.get(module.file);
  if (cached?.kind === 'module') {
    return cached.run;
  }
  // Transpile failed (or, defensively, was never run): surface it only here, when
  // the module is actually required, so an unused broken file stays harmless.
  const message =
    cached?.kind === 'moduleError' ? cached.error : `Module was not transpiled: ${module.fileName}`;
  return () => {
    throw new Error(message);
  };
}

/**
 * Assembles the runner registry SYNCHRONOUSLY from already-transpiled files (the
 * cache populated by {@link transpileModule} + {@link compileCssExtra}). Kept
 * synchronous so circular imports stay safe: every getter sets its in-progress
 * `exports` before the body runs, and nothing here awaits.
 */
function assembleScope(
  collected: ReturnType<typeof collectSources>,
  runnerCode: string | undefined,
  externals: Record<string, unknown>,
): BuiltScope {
  const imports: Record<string, unknown> = { ...externals };
  const styleSheets: string[] = [];

  for (const style of collected.styles) {
    const compiled = compileCssExtra(style);
    imports[style.key] = compiled.exports ?? {};
    styleSheets.push(compiled.css);
  }

  for (const module of collected.modules) {
    defineLazyModule(
      imports,
      module.primaryKeys,
      module.directoryKey ? [module.directoryKey] : [],
      () => moduleRunFor(module),
    );
  }

  if (collected.entry) {
    // The entry's keys and the hidden ENTRY_EXPORTS_KEY point at ONE exports object
    // (claimed only where no extra took the key), so the rendered entry and any
    // extra that imports it share a single evaluation.
    const mainExports: Scope = {};
    imports[ENTRY_EXPORTS_KEY] = mainExports;
    for (const key of collected.entry.primaryKeys) {
      if (!Object.prototype.hasOwnProperty.call(imports, key)) {
        imports[key] = mainExports;
      }
    }
  }

  return { imports, css: styleSheets.join('\n'), nested: collected.nested, runnerCode };
}

/**
 * Builds the runner scope from a variant's extra files (and optionally the main
 * source). {@link collectSources} plans the registry keys (pure); each JS/TS file
 * is then transpiled — relative imports rewritten + sucrase — by `transpile`, which
 * runs off the main thread in a Web Worker (with a main-thread async fallback); CSS
 * is compiled synchronously. The transpiled files are assembled into a lazy,
 * circular-safe `import` registry.
 *
 * Per-file transpilation is cached by object identity, so editing one file only
 * re-transpiles that file; a broken but UNUSED file is harmless (its error is thrown
 * only if required). The main source (when provided) is returned transpiled as
 * `runnerCode` for the runner to evaluate.
 */
export async function buildScope({
  extraFiles,
  externals,
  mainCode,
  transpile,
  signal,
  mainName,
}: BuildScopeOptions): Promise<BuiltScope> {
  const collected = collectSources(extraFiles, mainCode, mainName);

  // Transpile the entry and every module concurrently, off the main thread. The
  // entry's transpile error rejects this build (there's nothing to render); module
  // errors are deferred inside `transpileModule` (thrown only if required).
  const [runnerCode] = await Promise.all([
    collected.entry
      ? transpile(
          collected.entry.source,
          { fileName: collected.entry.fileName, nested: collected.nested, normalize: true },
          signal,
        )
      : Promise.resolve(undefined),
    Promise.all(
      collected.modules.map((module) =>
        transpileModule(module, collected.nested, transpile, signal),
      ),
    ),
  ]);

  return assembleScope(collected, runnerCode, externals);
}
