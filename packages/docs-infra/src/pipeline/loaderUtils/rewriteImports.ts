/**
 * Rewrites relative imports in source code based on a provided mapping.
 * Converts imports like '../utils/helper' or './components/Button' to their mapped equivalents
 *
 * @param source - The source code to process
 * @param importPathMapping - Map from original import paths to new import paths (without extensions)
 * @returns The source code with rewritten imports
 */
export function rewriteImportsToSameDirectory(
  source: string,
  importPathMapping: Map<string, string>,
): string {
  // Handle both types of imports:
  // 1. import [something] from 'path' (including import type)
  // 2. import 'path' (side-effect imports like CSS)

  return source
    .replace(
      /import\s+((?:type\s+)?(?:\w+|\*\s+as\s+\w+|{[^}]+})\s+from\s+)['"]([^'"]+)['"]/g,
      (match, importPart, modulePath) => {
        // Only process relative imports
        if (modulePath.startsWith('.')) {
          // Check if we have a mapping for this import path
          if (importPathMapping.has(modulePath)) {
            const newPath = importPathMapping.get(modulePath)!;
            return `import ${importPart}'${newPath}'`;
          }
        }
        return match;
      },
    )
    .replace(/import\s+['"]([^'"]+)['"]/g, (match, modulePath) => {
      // Only process relative imports
      if (modulePath.startsWith('.')) {
        // Check if we have a mapping for this import path
        if (importPathMapping.has(modulePath)) {
          const newPath = importPathMapping.get(modulePath)!;
          return `import '${newPath}'`;
        }
      }
      return match;
    });
}
