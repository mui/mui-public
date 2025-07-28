export async function parseImports(
  code: string,
  filePath: string,
): Promise<Record<string, { path: string; names: string[]; includeTypeDefs?: true }>> {
  const result: Record<string, { path: string; names: string[]; includeTypeDefs?: true }> = {};

  // Enhanced regex patterns to handle all import types:
  // 1. Standard imports with 'from' clause (including type imports)
  // 2. Side-effect imports without 'from' clause

  // Pattern 1: Handle imports with 'from' clause - covers most cases including type imports
  const importWithFromRegex =
    /import\s+(type\s+)?(?:(\w+)|\*\s+as\s+(\w+)|{([^}]+)})\s+from\s+['"]([^'"]+)['"]/g;

  // Pattern 2: Handle side-effect imports (no 'from' clause)
  const sideEffectImportRegex = /import\s+['"]([^'"]+)['"]/g;

  // Process imports with 'from' clause
  let importMatch = importWithFromRegex.exec(code);
  while (importMatch !== null) {
    const [, typeKeyword, defaultImport, namespaceImport, namedImportsStr, modulePath] =
      importMatch;
    const includeTypeDefs = !!typeKeyword;

    // Only process relative imports
    if (modulePath.startsWith('.')) {
      const basePath = filePath.substring(0, filePath.lastIndexOf('/'));
      const resolvedPath = new URL(modulePath, `file://${basePath}/`).pathname;

      if (!result[modulePath]) {
        result[modulePath] = {
          path: resolvedPath,
          names: [],
          ...(includeTypeDefs && { includeTypeDefs: true }),
        };
      } else if (!includeTypeDefs) {
        // If we already have this import path and this import is not type-only,
        // remove the includeTypeDefs flag (mixed imports become value imports)
        delete result[modulePath].includeTypeDefs;
      }

      if (defaultImport) {
        result[modulePath].names.push(defaultImport);
      } else if (namespaceImport) {
        result[modulePath].names.push(namespaceImport);
      } else if (namedImportsStr) {
        // Handle named imports like { ComponentName, Component2 as Alias, type TypeName }
        const namedImports = namedImportsStr.split(',').map((s) => s.trim());
        namedImports.forEach((namedImport) => {
          // Clean up the import name (remove 'type' keyword and handle aliases)
          const cleanImport = namedImport.replace(/^type\s+/, ''); // Remove leading 'type'

          // If there's an alias, use the alias name, otherwise use the original name
          const aliasMatch = cleanImport.match(/(.+?)\s+as\s+(.+)/);
          const nameToUse = aliasMatch ? aliasMatch[2].trim() : cleanImport.trim();
          result[modulePath].names.push(nameToUse);
        });
      }
    }
    importMatch = importWithFromRegex.exec(code);
  }

  // Process side-effect imports (imports without 'from' clause)
  let sideEffectMatch = sideEffectImportRegex.exec(code);
  while (sideEffectMatch !== null) {
    const [, modulePath] = sideEffectMatch;

    // Only process relative imports
    if (modulePath.startsWith('.')) {
      const basePath = filePath.substring(0, filePath.lastIndexOf('/'));
      const resolvedPath = new URL(modulePath, `file://${basePath}/`).pathname;

      // Check if this import wasn't already processed by the 'from' regex
      if (!result[modulePath]) {
        result[modulePath] = { path: resolvedPath, names: [] }; // Side-effect imports don't include type defs
      }
    }
    sideEffectMatch = sideEffectImportRegex.exec(code);
  }

  return result;
}
