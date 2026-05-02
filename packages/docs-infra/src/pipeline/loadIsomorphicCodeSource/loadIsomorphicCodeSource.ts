import type { LoadSource, Externals } from '../../CodeHighlighter/types';
import { parseImportsAndComments } from '../loaderUtils';
import { processRelativeImports, type StoreAtMode } from '../loaderUtils/processRelativeImports';
import { isJavaScriptModule } from '../loaderUtils/resolveModulePath';

/**
 * Imports record passed to {@link LoadIsomorphicCodeSourceOptions.resolveImports}.
 *
 * Mirrors the shape produced by `parseImportsAndComments` once names have been
 * flattened, so resolvers can look up each import by its source path.
 */
export type IsomorphicImports = Record<
  string,
  {
    url: string;
    names: string[];
    includeTypeDefs?: true;
    positions: Array<{ start: number; end: number }>;
  }
>;

export interface LoadIsomorphicCodeSourceOptions {
  /**
   * Async fetcher that returns the raw source text for a URL.
   *
   * In server contexts this typically wraps `fs/promises#readFile`, in client
   * contexts it can wrap `fetch`. Required.
   */
  fetchSource: (url: string) => Promise<string>;
  /**
   * Resolve relative JavaScript/TypeScript imports to absolute URLs that can
   * be passed back into a `loadSource` recursion. Returning a `Map` keyed by
   * the import URL lets the caller rewrite identifiers (e.g. `./foo` →
   * `https://.../foo.tsx`).
   *
   * When omitted, JavaScript modules are processed without a resolver: import
   * URLs are used as-is for `extraDependencies` and no rewriting happens.
   */
  resolveImports?: (imports: IsomorphicImports) => Promise<Map<string, string>>;
  /**
   * Cap on the number of recursive load passes. Forwarded to consumers; this
   * function itself only processes a single file.
   */
  maxDepth?: number;
  /** Cap on the total number of files surfaced via `extraFiles`. */
  maxFiles?: number;
  /** When false, skip dependency parsing and return only the raw source. */
  includeDependencies?: boolean;
  /**
   * Controls how imports are stored in `extraFiles`:
   * - 'canonical': Full resolved path (e.g., '../Component/index.js')
   * - 'import': Import path with file extension (e.g., '../Component.js')
   * - 'flat': Flattened to current directory with rewritten imports
   */
  storeAt?: StoreAtMode;
  /**
   * Prefixes for comments that should be stripped from the source output.
   * Comments starting with these prefixes will be removed from the returned
   * source. They can still be collected via `notableCommentsPrefix`.
   */
  removeCommentsWithPrefix?: string[];
  /**
   * Prefixes for notable comments that should be collected and included in
   * the result. Comments starting with these prefixes will be returned in the
   * `comments` field.
   */
  notableCommentsPrefix?: string[];
}

/**
 * Creates a `LoadSource` function that performs all the platform-independent
 * work shared between server-side and client-side source loaders: fetching
 * the file via the supplied `fetchSource`, parsing its imports and comments,
 * reshaping externals, and assembling `extraFiles` / `extraDependencies` for
 * recursive loading.
 *
 * Platform-specific concerns (`fs.readFile`, `fetch`, module resolution
 * against a real filesystem vs. a remote tree) are injected via the
 * `fetchSource` and `resolveImports` options.
 */
export function createLoadIsomorphicCodeSource(
  options: LoadIsomorphicCodeSourceOptions,
): LoadSource {
  const {
    fetchSource,
    resolveImports,
    includeDependencies = true,
    storeAt = 'flat',
    removeCommentsWithPrefix,
    notableCommentsPrefix,
  } = options;

  return async function loadSource(url: string) {
    const source = await fetchSource(url);

    if (!includeDependencies) {
      return { source };
    }

    // Static assets (JSON, images, etc.) have no imports to resolve.
    const isJavascriptModuleFile = isJavaScriptModule(url);
    const isCssFile = url.toLowerCase().endsWith('.css');
    if (!isJavascriptModuleFile && !isCssFile) {
      return { source };
    }

    const {
      relative: importResult,
      externals,
      comments,
      code: processedCode,
    } = await parseImportsAndComments(source, url, {
      removeCommentsWithPrefix,
      notableCommentsPrefix,
    });

    // Use the comment-stripped source when `removeCommentsWithPrefix` rewrote
    // the file; fall back to the raw source otherwise.
    const finalSource = processedCode ?? source;

    // Reshape externals from the parser's per-import structure into the
    // framework's flat `Externals` record (drops position info that was only
    // needed for source rewriting).
    const transformedExternals: Externals = {};
    for (const [modulePath, externalImport] of Object.entries(externals)) {
      transformedExternals[modulePath] = externalImport.names.map((importName) => ({
        name: importName.name,
        type: importName.type,
        isType: importName.isType,
      }));
    }
    const externalsResult =
      Object.keys(transformedExternals).length > 0 ? transformedExternals : undefined;

    if (Object.keys(importResult).length === 0) {
      return {
        source: finalSource,
        externals: externalsResult,
        comments,
      };
    }

    // `processRelativeImports` expects names as plain strings (alias-aware).
    const importsCompatible: Record<
      string,
      { url: string; names: string[]; positions: Array<{ start: number; end: number }> }
    > = {};
    for (const [importPath, { url: importUrl, names, positions }] of Object.entries(importResult)) {
      importsCompatible[importPath] = {
        url: importUrl,
        names: names.map(({ name, alias }) => alias || name),
        positions,
      };
    }

    let processedSource: string;
    let extraFiles: Record<string, string>;
    let extraDependencies: string[];

    if (isCssFile) {
      // CSS imports are already absolute paths after `parseImportsAndComments`.
      const result = processRelativeImports(finalSource, importsCompatible, storeAt);
      processedSource = result.processedSource;
      extraFiles = result.extraFiles;
      extraDependencies = Object.values(importResult).map(({ url: importUrl }) => importUrl);
    } else {
      // JS/TS: optionally resolve each import to an absolute URL via the
      // platform-specific resolver. When no resolver is supplied, fall back to
      // the raw import URLs (suitable for callers that pre-resolve themselves
      // or don't need rewritten output).
      let resolvedPathsMap: Map<string, string> | undefined;
      if (resolveImports) {
        const relativeImportsCompatible: IsomorphicImports = {};
        for (const [
          importPath,
          { url: importUrl, names, includeTypeDefs, positions },
        ] of Object.entries(importResult)) {
          relativeImportsCompatible[importPath] = {
            url: importUrl,
            names: names.map(({ name, alias }) => alias || name),
            positions,
            ...(includeTypeDefs && { includeTypeDefs }),
          };
        }
        resolvedPathsMap = await resolveImports(relativeImportsCompatible);
      }

      const result = processRelativeImports(
        finalSource,
        importsCompatible,
        storeAt,
        true,
        resolvedPathsMap,
      );
      processedSource = result.processedSource;
      extraFiles = result.extraFiles;

      extraDependencies = resolvedPathsMap
        ? Object.values(importResult)
            .map(({ url: importUrl }) => resolvedPathsMap!.get(importUrl))
            .filter((resolved): resolved is string => resolved !== undefined)
        : Object.values(importResult).map(({ url: importUrl }) => importUrl);
    }

    return {
      source: processedSource,
      extraFiles: Object.keys(extraFiles).length > 0 ? extraFiles : undefined,
      extraDependencies: extraDependencies.length > 0 ? extraDependencies : undefined,
      externals: externalsResult,
      comments,
    };
  };
}
