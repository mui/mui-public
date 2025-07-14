import { basename } from 'node:path';

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
    fileBasenames.set(path, basename(path));
  });

  // Regex to match import statements with relative paths
  const importRegex = /import\s+((?:\w+|\*\s+as\s+\w+|{[^}]+})\s+from\s+)['"]([^'"]+)['"]/g;

  return source.replace(importRegex, (match, importPart, modulePath) => {
    // Only process relative imports
    if (modulePath.startsWith('.')) {
      // Extract the filename from the path
      const filename = basename(modulePath);

      // Check if this file is in our dependency list
      const matchingPath = Array.from(filePaths).find(
        (path) =>
          basename(path) === filename ||
          basename(path, '.ts') === filename ||
          basename(path, '.tsx') === filename ||
          basename(path, '.js') === filename ||
          basename(path, '.jsx') === filename,
      );

      if (matchingPath) {
        // Rewrite to same directory
        const newPath = `./${basename(matchingPath, '.ts').replace(/\.(tsx|js|jsx)$/, '')}`;
        return `import ${importPart}'${newPath}'`;
      }
    }

    return match;
  });
}
