import { rewriteImportsToSameDirectory } from './rewriteImports';
import { isJavaScriptModule } from './resolveModulePath';
import { getFileNameFromUrl } from './getFileNameFromUrl';

export type StoreAtMode = 'canonical' | 'import' | 'flat';

export interface ProcessImportsResult {
  processedSource: string;
  extraFiles: Record<string, string>;
}

/**
 * Processes imports based on the specified storage mode, automatically handling
 * source rewriting when needed (e.g., for 'flat' mode).
 *
 * @param source - The original source code
 * @param importResult - The result from resolveImports
 * @param resolvedPathsMap - Map from import paths to resolved file paths
 * @param storeAt - How to process the imports
 * @returns Object with processed source and extraFiles mapping
 */
export function processImportsWithStoreAt(
  source: string,
  importResult: Record<string, { path: string; names: string[] }>,
  resolvedPathsMap: Map<string, string>,
  storeAt: StoreAtMode,
): ProcessImportsResult {
  let processedSource = source;
  const extraFiles: Record<string, string> = {};

  // For flat mode, automatically rewrite imports to same directory
  if (storeAt === 'flat') {
    const allResolvedPaths = new Set(resolvedPathsMap.values());
    processedSource = rewriteImportsToSameDirectory(source, allResolvedPaths);
  }

  // Process each import and generate extraFiles
  Object.entries(importResult).forEach(([relativePath, importInfo]) => {
    const resolvedPath = resolvedPathsMap.get(importInfo.path);
    if (resolvedPath) {
      const fileExtension = getFileNameFromUrl(resolvedPath).extension;
      const isJavascriptModule = isJavaScriptModule(relativePath);
      let keyPath: string;

      if (!isJavascriptModule) {
        // For static assets (CSS, JSON, etc.), use the original import path as-is since it already has the extension
        switch (storeAt) {
          case 'canonical':
          case 'import':
            keyPath = relativePath;
            break;
          case 'flat':
            // For flat mode, use just the filename from the original import
            keyPath = `./${getFileNameFromUrl(relativePath).fileName}`;
            break;
          default:
            keyPath = relativePath;
        }
      } else {
        // For JS/TS modules, apply the existing logic
        switch (storeAt) {
          case 'canonical':
            // Show the full resolved path including index files when they exist
            // e.g., import '../Component' resolved to '/src/Component/index.js'
            // becomes extraFiles: { '../Component/index.js': 'file:///src/Component/index.js' }
            keyPath = `${relativePath}${resolvedPath.endsWith(`/index${fileExtension}`) ? `/index${fileExtension}` : fileExtension}`;
            break;

          case 'import':
            // Use the original import path with the actual file extension
            // e.g., import '../Component' with '/src/Component/index.js'
            // becomes extraFiles: { '../Component.js': 'file:///src/Component/index.js' }
            keyPath = `${relativePath}${fileExtension}`;
            break;

          case 'flat':
            // Flatten all files to current directory using just the filename
            // e.g., import '../Component' with '/src/Component/index.js'
            // becomes extraFiles: { './index.js': 'file:///src/Component/index.js' }
            // Note: This mode also requires rewriting imports in the source code (handled above)
            keyPath = `./${getFileNameFromUrl(resolvedPath).fileName}`;
            break;

          default:
            keyPath = `${relativePath}${fileExtension}`;
        }
      }

      extraFiles[keyPath] = `file://${resolvedPath}`;
    }
  });

  return {
    processedSource,
    extraFiles,
  };
}
