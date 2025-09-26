/**
 * Rewrites relative imports in source code based on a provided mapping.
 * Converts imports like '../utils/helper' or './components/Button' to their mapped equivalents
 *
 * @param source - The source code to process
 * @param importPathMapping - Map from original import paths to new import paths (without extensions)
 * @returns The source code with rewritten imports
 */
export function rewriteJsImports(source: string, importPathMapping: Map<string, string>): string {
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

/**
 * Rewrites CSS @import statements in source code based on a provided mapping.
 * Converts imports like @import './styles.css' or @import url('./styles.css') to their mapped equivalents
 * while preserving all CSS import metadata (layers, supports, media queries).
 *
 * @param source - The CSS source code to process
 * @param importPathMapping - Map from original import paths to new import paths
 * @returns The CSS source code with rewritten @import statements
 */
export function rewriteCssImports(source: string, importPathMapping: Map<string, string>): string {
  return (
    source
      // Handle @import 'path' with optional metadata
      .replace(/@import\s+(['"])([^'"]+)\1([^;]*);?/g, (match, quote, modulePath, metadata) => {
        // Only process relative imports
        if (modulePath.startsWith('.')) {
          // Check if we have a mapping for this import path
          if (importPathMapping.has(modulePath)) {
            const newPath = importPathMapping.get(modulePath)!;
            return `@import ${quote}${newPath}${quote}${metadata}${match.endsWith(';') ? ';' : ''}`;
          }
        }
        return match;
      })
      // Handle @import url('path') with optional metadata
      .replace(
        /@import\s+url\(\s*(['"])([^'"]+)\1\s*\)([^;]*);?/g,
        (match, quote, modulePath, metadata) => {
          // Only process relative imports
          if (modulePath.startsWith('.')) {
            // Check if we have a mapping for this import path
            if (importPathMapping.has(modulePath)) {
              const newPath = importPathMapping.get(modulePath)!;
              return `@import url(${quote}${newPath}${quote})${metadata}${match.endsWith(';') ? ';' : ''}`;
            }
          }
          return match;
        },
      )
      // Handle @import url(unquoted-path) with optional metadata
      .replace(/@import\s+url\(\s*([^'")[^)]*)\s*\)([^;]*);?/g, (match, modulePath, metadata) => {
        // Handle unquoted url() - only process relative imports
        if (modulePath.startsWith('.')) {
          // Check if we have a mapping for this import path
          if (importPathMapping.has(modulePath)) {
            const newPath = importPathMapping.get(modulePath)!;
            return `@import url(${newPath})${metadata}${match.endsWith(';') ? ';' : ''}`;
          }
        }
        return match;
      })
  );
}
