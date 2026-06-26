import type { ControlledVariantExtraFiles } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { SCOPE_IMPORT_PREFIX } from './constants';

/** Name the main source is registered + resolved under (it lives at the demo root). */
export const MAIN_SOURCE_NAME = 'index.tsx';

/** A JS/TS extra file to register, with the specifiers it answers to. */
export interface CollectedModule {
  /** The extra-file object — used as the per-file transpile-cache key (identity). */
  file: object;
  /** Path within the demo (e.g. `dir/util.ts`) — drives absolutize + cache gating. */
  fileName: string;
  /** The raw source — absolutized later (in the transpile worker) when `nested`. */
  source: string;
  /** Specifiers this module always answers to (its own path). */
  primaryKeys: string[];
  /** Directory specifier an `index` file also answers to — claimed only if free. */
  directoryKey?: string;
}

/** A CSS extra file to register + collect. */
export interface CollectedStyle {
  /** The extra-file object — used as the per-file compile-cache key (identity). */
  file: object;
  fileName: string;
  source: string;
  /** Registry key the class map (or empty module) is registered under. */
  key: string;
  /** `*.module.css` (scoped, exports a class map) vs a plain global `*.css`. */
  isModule: boolean;
}

/** The main source to render, with the specifiers it answers to. */
export interface CollectedEntry {
  /** The raw main source — absolutized + normalized later (in the transpile worker). */
  source: string;
  /** The entry's path (the demo root) — used to resolve its relative imports. */
  fileName: string;
  /** Specifiers the entry answers to — claimed only if no extra already took them. */
  primaryKeys: string[];
}

export interface CollectedSources {
  /**
   * Whether any extra file lives in a subdirectory (its key contains `/`). When
   * `true`, keys are absolute `<SCOPE_IMPORT_PREFIX><path>` specifiers and every
   * JS/TS source — including the main one — has its relative imports rewritten
   * (during transpilation) so they resolve by absolute key.
   */
  nested: boolean;
  modules: CollectedModule[];
  styles: CollectedStyle[];
  entry?: CollectedEntry;
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
 * Plans the runner scope from a variant's extra files (and optionally the main
 * source): the pure, transpile-free half of `buildScope`. It decides each file's
 * registry keys and detects whether the demo is `nested`, but compiles nothing and
 * — unlike before — does not rewrite imports: the raw source is carried through so
 * the absolutize + sucrase transpile can run together off the main thread (see
 * `transpileSource`). The result is a descriptor list the caller transpiles and
 * assembles into a registry.
 *
 * Keys carry the `storeAt`-mode's leading `./` stripped, so a bare path
 * (`dir/file.ts`) and an import specifier (`./dir/file.ts`) collapse to the same
 * key — and a flat `./file.ts` is not mistaken for nested.
 *
 * Files are routed by extension: `*.css` become {@link CollectedStyle}s
 * (`*.module.css` scoped, others global); everything else a {@link CollectedModule}
 * keyed by its extension-less specifier, its full name, and — for an `index` file —
 * its directory. Files with a non-string `source` (e.g. `null`) are skipped.
 */
export function collectSources(
  extraFiles: ControlledVariantExtraFiles | undefined,
  mainCode?: string,
  mainName: string = MAIN_SOURCE_NAME,
): CollectedSources {
  const entries = Object.entries(extraFiles ?? {}).map(
    ([fileName, file]) => [fileName.replace(/^\.\//, ''), file] as const,
  );
  const nested = entries.some(([fileName]) => fileName.includes('/'));
  const prefix = nested ? SCOPE_IMPORT_PREFIX : './';

  const modules: CollectedModule[] = [];
  const styles: CollectedStyle[] = [];

  for (const [fileName, file] of entries) {
    if (!file || typeof file.source !== 'string') {
      continue;
    }

    if (fileName.endsWith('.css')) {
      styles.push({
        file,
        fileName,
        source: file.source,
        key: `${prefix}${fileName}`,
        isModule: fileName.endsWith('.module.css'),
      });
      continue;
    }

    const keys = moduleKeys(fileName, prefix);
    modules.push({
      file,
      fileName,
      source: file.source,
      primaryKeys: keys.primary,
      directoryKey: keys.directory,
    });
  }

  let entry: CollectedEntry | undefined;
  if (mainCode !== undefined) {
    entry = {
      source: mainCode,
      fileName: mainName,
      primaryKeys: moduleKeys(mainName, prefix).primary,
    };
  }

  return { nested, modules, styles, entry };
}
