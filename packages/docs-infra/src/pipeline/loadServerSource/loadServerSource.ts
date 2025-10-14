// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import { readFile } from 'fs/promises';

import type { LoadSource, Externals } from '../../CodeHighlighter/types';
import { parseImportsAndComments } from '../loaderUtils';
import { resolveImportResultWithFs } from '../loaderUtils/resolveModulePathWithFs';
import { processRelativeImports, type StoreAtMode } from '../loaderUtils/processRelativeImports';
import { isJavaScriptModule } from '../loaderUtils/resolveModulePath';

interface LoadSourceOptions {
  maxDepth?: number;
  maxFiles?: number;
  includeDependencies?: boolean;
  storeAt?: StoreAtMode;
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
 */
export function createLoadServerSource(options: LoadSourceOptions = {}): LoadSource {
  const { includeDependencies = true, storeAt = 'flat' } = options;

  return async function loadSource(url: string) {
    // Remove file:// prefix if present
    const filePath = url.replace('file://', '');

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
    const { relative: importResult, externals } = await parseImportsAndComments(source, filePath);

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
        source,
        externals: Object.keys(transformedExternals).length > 0 ? transformedExternals : undefined,
      };
    }

    let processedSource: string;
    let extraFiles: Record<string, string>;
    let extraDependencies: string[];

    // Convert import result to the format expected by processImports, preserving position data
    const importsCompatible: Record<
      string,
      { path: string; names: string[]; positions: Array<{ start: number; end: number }> }
    > = {};
    for (const [importPath, { path, names, positions }] of Object.entries(importResult)) {
      importsCompatible[importPath] = {
        path,
        names: names.map(({ name, alias }) => alias || name),
        positions,
      };
    }

    if (isCssFile) {
      // For CSS files, we don't need complex path resolution
      // The parseImportsAndComments function already resolved paths for CSS
      const result = processRelativeImports(source, importsCompatible, storeAt);
      processedSource = result.processedSource;
      extraFiles = result.extraFiles;

      // Build dependencies list for recursive loading (CSS files use direct paths)
      extraDependencies = Object.values(importResult).map(({ path }) => path);
    } else {
      // For JavaScript/TypeScript files, resolve paths first
      const relativeImportsCompatible: Record<
        string,
        {
          path: string;
          names: string[];
          includeTypeDefs?: true;
          positions: Array<{ start: number; end: number }>;
        }
      > = {};
      for (const [importPath, { path, names, includeTypeDefs, positions }] of Object.entries(
        importResult,
      )) {
        relativeImportsCompatible[importPath] = {
          path,
          names: names.map(({ name, alias }) => alias || name), // Use alias if available
          positions,
          ...(includeTypeDefs && { includeTypeDefs }),
        };
      }

      // Resolve import paths, handling JS/TS modules and static assets appropriately
      const resolvedPathsMap = await resolveImportResultWithFs(relativeImportsCompatible);

      // Process imports using the unified helper function
      const result = processRelativeImports(
        source,
        importsCompatible,
        storeAt,
        true,
        resolvedPathsMap,
      );
      processedSource = result.processedSource;
      extraFiles = result.extraFiles;

      // Build dependencies list for recursive loading
      extraDependencies = Object.values(importResult)
        .map(({ path }) => resolvedPathsMap.get(path))
        .filter((path): path is string => path !== undefined);
    }

    return {
      source: processedSource,
      extraFiles: Object.keys(extraFiles).length > 0 ? extraFiles : undefined,
      extraDependencies: extraDependencies.length > 0 ? extraDependencies : undefined,
      externals: Object.keys(transformedExternals).length > 0 ? transformedExternals : undefined,
    };
  };
}
