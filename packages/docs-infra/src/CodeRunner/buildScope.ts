import type { ControlledVariantExtraFiles } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { compileModule } from './compileModule';
import { compileCssModule } from './compileCssModule';
import { ENTRY_EXPORTS_KEY } from './generateElement';
import { absolutizeImports, SCOPE_IMPORT_PREFIX } from './absolutizeImports';
import type { Scope } from './types';

export interface BuiltScope {
  /** The runner's module registry — the `import` map handed to `useRunner`. */
  imports: Record<string, unknown>;
  /** The concatenated stylesheet text collected from CSS extra files. */
  css: string;
  /**
   * Whether any extra file lives in a subdirectory (its key contains `/`). When
   * `true`, every JS/TS source — including the main one — has its relative imports
   * rewritten with {@link absolutizeImports} so they resolve by key.
   */
  nested: boolean;
  /**
   * The main source to hand to the runner — absolutized when `nested`, otherwise
   * the input verbatim. `undefined` when no main source was provided.
   */
  runnerCode?: string;
}

/** Name the main source is registered + resolved under (it lives at the demo root). */
const MAIN_SOURCE_NAME = 'index.tsx';

/** Evaluates a compiled module against the registry, writing into `exports`. */
type ModuleRun = (imports: Record<string, unknown>, exports: Scope) => void;

/**
 * A compiled extra file, cached by the file's object identity (see `compiledFiles`).
 * A JS module keeps a reusable `run` (the transpile + compile are baked in); CSS
 * results are fully materialized since they have no dependencies.
 */
type CompiledExtraFile =
  | {
      kind: 'module';
      /** The `nested` mode it was compiled for — absolutization differs by mode. */
      nested: boolean;
      run: ModuleRun;
    }
  | { kind: 'cssModule'; exports: Record<string, string>; css: string }
  | { kind: 'css'; css: string };

/**
 * Compiled-form cache keyed by the extra-file OBJECT. An edit replaces only the
 * changed file's object (the controlled code is updated immutably), so unchanged
 * files keep their reference and stay cache hits — skipping the costly
 * re-absolutize + re-transpile on every keystroke. Module-level so it survives
 * re-renders; `WeakMap` so entries are reclaimed once a demo drops its files.
 */
const compiledFiles = new WeakMap<object, CompiledExtraFile>();

/**
 * Returns the cached `run` for a JS/TS extra file, compiling on a miss. The cache
 * hit is gated on `nested`: absolutization — and therefore the transpiled output —
 * differs between flat and nested mode.
 */
function compileJsModule(
  file: object,
  fileName: string,
  source: string,
  nested: boolean,
): ModuleRun {
  const cached = compiledFiles.get(file);
  if (cached && cached.kind === 'module' && cached.nested === nested) {
    return cached.run;
  }
  const resolved = nested ? absolutizeImports(source, fileName) : source;
  const run = compileModule(resolved);
  compiledFiles.set(file, { kind: 'module', nested, run });
  return run;
}

/**
 * Returns the cached compiled CSS for an extra file, compiling on a miss. CSS
 * output is mode-independent (no imports), so it is reused as-is.
 */
function compileCssExtra(
  file: object,
  fileName: string,
  source: string,
): { exports?: Record<string, string>; css: string } {
  const cached = compiledFiles.get(file);
  if (cached && cached.kind !== 'module') {
    return cached;
  }
  const compiled: CompiledExtraFile = fileName.endsWith('.module.css')
    ? { kind: 'cssModule', ...compileCssModule(source) }
    : { kind: 'css', css: source };
  compiledFiles.set(file, compiled);
  return compiled;
}

/**
 * The specifiers a JS/TS module answers to: its extension-less path (`dir/util`),
 * its full name (`dir/util.ts`), and — for an `index` file — its containing
 * directory (`dir/index.ts` also answers `import './dir'`), each under `prefix`.
 */
function moduleKeys(fileName: string, prefix: string): { primary: string[]; directory?: string } {
  const pathWithoutExtension = fileName.replace(/\.[^.]+$/, '');
  const primary = [...new Set([`${prefix}${pathWithoutExtension}`, `${prefix}${fileName}`])];
  if (pathWithoutExtension.endsWith('/index')) {
    return { primary, directory: `${prefix}${pathWithoutExtension.slice(0, -'/index'.length)}` };
  }
  return { primary };
}

/**
 * Registers a module as a LAZILY-evaluated entry. It runs on first `require`, not
 * eagerly, so registration order doesn't matter: a file can import a sibling (or
 * the main source) registered later, and circular imports resolve via the
 * in-progress `exports` (set before the body runs). `makeRun` is invoked once, on
 * first access, so a transpile only happens for modules actually imported.
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

/**
 * Builds the runner scope from a variant's extra files (and optionally the main
 * source), starting from the package `externals`. Each file is registered under
 * the specifier the source imports it by. Files are routed by extension:
 *
 * - `*.module.css` → compiled to scoped CSS (collected for output); the class-name
 *   map is exported under the `*.module.css` specifier.
 * - other `*.css` → emitted as-is (global); the side-effect import resolves to an
 *   empty module.
 * - everything else → evaluated as JS/TS, registered LAZILY under its
 *   extension-less specifier, its full name, and — for an `index` file — its
 *   directory, so a source can import it any of those ways.
 *
 * The main source (when provided) is registered the same way under
 * `MAIN_SOURCE_NAME`, so an extra file can import the entry — but it never clobbers
 * a key an extra file already claimed. It is also returned as `runnerCode`
 * (absolutized when nested) for the runner to render.
 *
 * When files span subdirectories (`nested`), keys become absolute
 * `<SCOPE_IMPORT_PREFIX><path>` specifiers and each JS/TS source is rewritten with
 * {@link absolutizeImports} so a relative import resolves regardless of where the
 * importing file sits. Flat demos keep their simpler `./name` specifiers.
 *
 * Per-file compilation (absolutize + transpile + compile) is cached by object
 * identity, so editing one file only recompiles that file; modules evaluate lazily
 * against the live registry, picking up sibling changes without re-transpiling.
 */
export function buildScope(
  extraFiles: ControlledVariantExtraFiles | undefined,
  externals: Record<string, unknown>,
  mainCode?: string,
  mainName: string = MAIN_SOURCE_NAME,
): BuiltScope {
  const imports: Record<string, unknown> = { ...externals };
  const styleSheets: string[] = [];

  // Normalize a leading `./` off the keys. The `storeAt` mode that produced the
  // controlled code is configurable: some modes key files by their bare path
  // (`dir/file.ts`), others by the import specifier (`./dir/file.ts`). Stripping
  // `./` makes both forms equivalent — and stops a flat `./file.ts` from looking
  // nested — so keys line up with the absolutized import specifiers below.
  const entries = Object.entries(extraFiles ?? {}).map(
    ([fileName, file]) => [fileName.replace(/^\.\//, ''), file] as const,
  );
  const nested = entries.some(([fileName]) => fileName.includes('/'));
  const prefix = nested ? SCOPE_IMPORT_PREFIX : './';

  for (const [fileName, file] of entries) {
    if (!file || typeof file.source !== 'string') {
      continue;
    }

    if (fileName.endsWith('.css')) {
      const compiled = compileCssExtra(file, fileName, file.source);
      imports[`${prefix}${fileName}`] = compiled.exports ?? {};
      styleSheets.push(compiled.css);
      continue;
    }

    const { source } = file;
    const keys = moduleKeys(fileName, prefix);
    // Primary keys (the file's own path) always win; a directory `index` key only
    // fills in when no file already claims it.
    defineLazyModule(imports, keys.primary, keys.directory ? [keys.directory] : [], () =>
      compileJsModule(file, fileName, source, nested),
    );
  }

  let runnerCode: string | undefined;
  if (mainCode !== undefined) {
    runnerCode = nested ? absolutizeImports(mainCode, mainName) : mainCode;
    // Register the main so an extra can import the entry — under the keys no extra
    // already claimed (an explicit root `index.ts` wins). The entry's keys and the
    // hidden ENTRY_EXPORTS_KEY point at ONE exports object; the runner evaluates
    // the main into it (via generateElement), so the rendered entry and any extra
    // that imports it share a single evaluation. No transpile here — the runner
    // owns it.
    const mainExports: Scope = {};
    imports[ENTRY_EXPORTS_KEY] = mainExports;
    for (const key of moduleKeys(mainName, prefix).primary) {
      if (!Object.prototype.hasOwnProperty.call(imports, key)) {
        imports[key] = mainExports;
      }
    }
  }

  return { imports, css: styleSheets.join('\n'), nested, runnerCode };
}
