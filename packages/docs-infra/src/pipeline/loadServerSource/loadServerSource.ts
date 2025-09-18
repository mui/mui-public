// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import { readFile } from 'fs/promises';

import type { LoadSource, Externals } from '../../CodeHighlighter/types';
import { parseImports } from '../loaderUtils';
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

    if (!isJavascriptModuleFile) {
      // Static assets (CSS, JSON, etc.) don't have imports to resolve
      return { source };
    }

    // Get all relative imports from this file
    const { relative: importResult, externals } = await parseImports(source, filePath);

    // Transform externals from parseImports format to simplified format
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

    // Convert to format expected by resolveImportResultWithFs and processImports
    const relativeImportsCompatible: Record<
      string,
      { path: string; names: string[]; includeTypeDefs?: true }
    > = {};
    for (const [importPath, { path, names, includeTypeDefs }] of Object.entries(importResult)) {
      relativeImportsCompatible[importPath] = {
        path,
        names: names.map(({ name, alias }) => alias || name), // Use alias if available
        ...(includeTypeDefs && { includeTypeDefs }),
      };
    }

    // Resolve import paths, handling JS/TS modules and static assets appropriately
    const resolvedPathsMap = await resolveImportResultWithFs(relativeImportsCompatible);

    // Process imports using the consolidated helper function
    const { processedSource, extraFiles } = processRelativeImports(
      source,
      relativeImportsCompatible,
      resolvedPathsMap,
      storeAt,
    );

    // Build dependencies list for recursive loading
    const extraDependencies = Object.values(importResult)
      .map(({ path }) => resolvedPathsMap.get(path))
      .filter((path): path is string => path !== undefined);

    return {
      source: processedSource,
      extraFiles: Object.keys(extraFiles).length > 0 ? extraFiles : undefined,
      extraDependencies: extraDependencies.length > 0 ? extraDependencies : undefined,
      externals: Object.keys(transformedExternals).length > 0 ? transformedExternals : undefined,
    };
  };
}
