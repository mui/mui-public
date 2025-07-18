import { JAVASCRIPT_MODULE_EXTENSIONS, isJavaScriptModule } from './resolveModulePath';
import { getFileNameFromUrl } from './getFileNameFromUrl';

/**
 * Rewrites relative imports in source code to assume all files are in the same directory.
 * Converts imports like '../utils/helper' or './components/Button' to './helper' and './Button'
 *
 * @param source - The source code to process
 * @param filePaths - Set of file paths that are available as dependencies
 * @returns The source code with rewritten imports
 */
export function rewriteImportsToSameDirectory(source: string, filePaths: Set<string>): string {
  // Create a map of original file paths to just their basenames
  const fileBasenames = new Map<string, string>();
  Array.from(filePaths).forEach((path) => {
    fileBasenames.set(path, getFileNameFromUrl(path).fileName);
  });

  // Regex to match import statements with relative paths
  const importRegex = /import\s+((?:\w+|\*\s+as\s+\w+|{[^}]+})\s+from\s+)['"]([^'"]+)['"]/g;

  return source.replace(importRegex, (match, importPart, modulePath) => {
    // Only process relative imports
    if (modulePath.startsWith('.')) {
      // Extract the filename from the path
      const filename = getFileNameFromUrl(modulePath).fileName;

      // For static assets (CSS, JSON, etc.), use the filename as-is
      if (!isJavaScriptModule(modulePath)) {
        const matchingPath = Array.from(filePaths).find(
          (path) => getFileNameFromUrl(path).fileName === filename,
        );
        if (matchingPath) {
          return `import ${importPart}'./${filename}'`;
        }
      } else {
        // For JS/TS modules, check against all possible extensions
        const matchingPath = Array.from(filePaths).find((path) => {
          const pathBasename = getFileNameFromUrl(path).fileName;
          return (
            pathBasename === filename ||
            JAVASCRIPT_MODULE_EXTENSIONS.some((ext) => {
              const { fileName } = getFileNameFromUrl(path);
              return fileName.endsWith(ext) ? fileName.slice(0, -ext.length) === filename : false;
            })
          );
        });

        if (matchingPath) {
          // For JS/TS modules, rewrite to same directory without extension
          const pathBasename = getFileNameFromUrl(matchingPath).fileName;
          const nameWithoutExt = JAVASCRIPT_MODULE_EXTENSIONS.reduce(
            (name, ext) => name.replace(new RegExp(`\\${ext}$`), ''),
            pathBasename,
          );
          return `import ${importPart}'./${nameWithoutExt}'`;
        }
      }
    }

    return match;
  });
}
