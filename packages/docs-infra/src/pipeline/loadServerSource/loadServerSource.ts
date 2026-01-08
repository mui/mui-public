// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import { readFile } from 'fs/promises';
// eslint-disable-next-line n/prefer-node-protocol
import { fileURLToPath } from 'url';

import type { LoadSource, Externals } from '../../CodeHighlighter/types';
import { parseImportsAndComments } from '../loaderUtils';
import { resolveImportResultWithFs } from '../loadServerCodeMeta/resolveModulePathWithFs';
import { processRelativeImports, type StoreAtMode } from '../loaderUtils/processRelativeImports';
import { isJavaScriptModule } from '../loaderUtils/resolveModulePath';

interface LoadSourceOptions {
  maxDepth?: number;
  maxFiles?: number;
  includeDependencies?: boolean;
  storeAt?: StoreAtMode;
  /**
   * Prefixes for comments that should be stripped from the source output.
   * Comments starting with these prefixes will be removed from the returned source.
   * They can still be collected via `notableCommentsPrefix`.
   * @example ['@highlight', '@internal']
   */
  removeCommentsWithPrefix?: string[];
  /**
   * Prefixes for notable comments that should be collected and included in the result.
   * Comments starting with these prefixes will be returned in the `comments` field.
   * @example ['@highlight', '@focus']
   */
  notableCommentsPrefix?: string[];
}

/**
 * Default loadServerSource function that reads a file and extracts its dependencies.
 * This function is used to load source files for demos, resolving their imports and dependencies.
 * It reads the source file, resolves its imports, and returns the processed source along with any
 * additional files and dependencies that were found.
 */
export const loadServerSource = createLoadServerSource();

/**
 * Creates a loadSource function that reads a file and extracts its dependencies.
 *
 * @param options.storeAt - Controls how imports are stored in extraFiles:
 *   - 'canonical': Full resolved path (e.g., '../Component/index.js')
 *   - 'import': Import path with file extension (e.g., '../Component.js')
 *   - 'flat': Flattened to current directory with rewritten imports (e.g., './Component.js')
 * @param options.removeCommentsWithPrefix - Prefixes for comments to strip from source
 * @param options.notableCommentsPrefix - Prefixes for comments to collect
 */
export function createLoadServerSource(options: LoadSourceOptions = {}): LoadSource {
  const {
    includeDependencies = true,
    storeAt = 'flat',
    removeCommentsWithPrefix,
    notableCommentsPrefix,
  } = options;

  return async function loadSource(url: string) {
    // Convert file:// URL to proper file system path for reading the file
    // Using fileURLToPath handles Windows drive letters correctly (e.g., file:///C:/... → C:\...)
    const filePath = url.startsWith('file://') ? fileURLToPath(url) : url;

    // Read the file
    const source = await readFile(filePath, 'utf8');

    if (!includeDependencies) {
      return { source };
    }

    // Check if this is a static asset file (non-JS/TS modules)
    const isJavascriptModuleFile = isJavaScriptModule(filePath);
    const isCssFile = filePath.toLowerCase().endsWith('.css');

    if (!isJavascriptModuleFile && !isCssFile) {
      // Static assets (CSS, JSON, etc.) don't have imports to resolve
      return { source };
    }

    // Get all relative imports from this file
    // Pass the original URL to parseImportsAndComments for cross-platform path handling
    const parseResult = await parseImportsAndComments(source, url, {
      removeCommentsWithPrefix,
      notableCommentsPrefix,
    });
    const { relative: importResult, externals, comments, code: processedCode } = parseResult;

    // Use the processed code (with comments stripped) if available, otherwise use original source
    const finalSource = processedCode ?? source;

    // Transform externals from parseImportsAndComments format to simplified format
    const transformedExternals: Externals = {};
    for (const [modulePath, externalImport] of Object.entries(externals)) {
      transformedExternals[modulePath] = externalImport.names.map((importName) => ({
        name: importName.name,
        type: importName.type,
        isType: importName.isType,
      }));
    }

    if (Object.keys(importResult).length === 0) {
      return {
        source: finalSource,
        externals: Object.keys(transformedExternals).length > 0 ? transformedExternals : undefined,
        comments,
      };
    }

    let processedSource: string;
    let extraFiles: Record<string, string>;
    let extraDependencies: string[];

    // Convert import result to the format expected by processImports, preserving position data
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

    if (isCssFile) {
      // For CSS files, we don't need complex path resolution
      // The parseImportsAndComments function already resolved paths for CSS
      const result = processRelativeImports(finalSource, importsCompatible, storeAt);
      processedSource = result.processedSource;
      extraFiles = result.extraFiles;

      // Build dependencies list for recursive loading (CSS files use direct paths)
      extraDependencies = Object.values(importResult).map(({ url: importUrl }) => importUrl);
    } else {
      // For JavaScript/TypeScript files, resolve paths first
      const relativeImportsCompatible: Record<
        string,
        {
          url: string;
          names: string[];
          includeTypeDefs?: true;
          positions: Array<{ start: number; end: number }>;
        }
      > = {};
      for (const [
        importPath,
        { url: importUrl, names, includeTypeDefs, positions },
      ] of Object.entries(importResult)) {
        relativeImportsCompatible[importPath] = {
          url: importUrl,
          names: names.map(({ name, alias }) => alias || name), // Use alias if available
          positions,
          ...(includeTypeDefs && { includeTypeDefs }),
        };
      }

      // Resolve import paths, handling JS/TS modules and static assets appropriately
      const resolvedPathsMap = await resolveImportResultWithFs(relativeImportsCompatible);

      // Process imports using the unified helper function
      const result = processRelativeImports(
        finalSource,
        importsCompatible,
        storeAt,
        true,
        resolvedPathsMap,
      );
      processedSource = result.processedSource;
      extraFiles = result.extraFiles;

      // Build dependencies list for recursive loading
      extraDependencies = Object.values(importResult)
        .map(({ url: importUrl }) => resolvedPathsMap.get(importUrl))
        .filter((resolved): resolved is string => resolved !== undefined);
    }

    return {
      source: processedSource,
      extraFiles: Object.keys(extraFiles).length > 0 ? extraFiles : undefined,
      extraDependencies: extraDependencies.length > 0 ? extraDependencies : undefined,
      externals: Object.keys(transformedExternals).length > 0 ? transformedExternals : undefined,
      comments,
    };
  };
}
