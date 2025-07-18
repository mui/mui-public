import { readFile } from 'node:fs/promises';
import type { LoadSource } from '../CodeHighlighter/types';
import { resolveImports } from '../loaderUtils/resolveImports';
import { resolveImportResultWithFs } from '../loaderUtils/resolveModulePathWithFs';
import { processImportsWithStoreAt, type StoreAtMode } from '../loaderUtils/processImports';
import { isJavaScriptModule } from '../loaderUtils/resolveModulePath';

interface LoadSourceOptions {
  maxDepth?: number;
  maxFiles?: number;
  includeDependencies?: boolean;
  storeAt?: StoreAtMode;
}

/**
 * Default serverLoadSource function that reads a file and extracts its dependencies.
 * This function is used to load source files for demos, resolving their imports and dependencies.
 * It reads the source file, resolves its imports, and returns the processed source along with any
 * additional files and dependencies that were found.
 */
export const serverLoadSource = createServerLoadSource();

/**
 * Creates a loadSource function that reads a file and extracts its dependencies.
 *
 * @param options.storeAt - Controls how imports are stored in extraFiles:
 *   - 'canonical': Full resolved path (e.g., '../Component/index.js')
 *   - 'import': Import path with file extension (e.g., '../Component.js')
 *   - 'flat': Flattened to current directory with rewritten imports (e.g., './Component.js')
 */
export function createServerLoadSource(options: LoadSourceOptions = {}): LoadSource {
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
    const importResult = await resolveImports(source, filePath);

    if (Object.keys(importResult).length === 0) {
      return { source };
    }

    // Resolve import paths, handling JS/TS modules and static assets appropriately
    const resolvedPathsMap = await resolveImportResultWithFs(importResult);

    // Process imports using the consolidated helper function
    const { processedSource, extraFiles } = processImportsWithStoreAt(
      source,
      importResult,
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
    };
  };
}
