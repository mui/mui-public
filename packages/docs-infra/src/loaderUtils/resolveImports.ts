export async function resolveImports(
  code: string,
  filePath: string,
): Promise<Record<string, { path: string; names: string[] }>> {
  const result: Record<string, { path: string; names: string[] }> = {};
  const importRegex = /import\s+(?:(\w+)|\*\s+as\s+(\w+)|{([^}]+)})\s+from\s+['"]([^'"]+)['"]/g;
  let importMatch = importRegex.exec(code);

  while (importMatch !== null) {
    const [, defaultImport, namespaceImport, namedImportsStr, modulePath] = importMatch;

    // Only process relative imports
    if (modulePath.startsWith('.')) {
      const basePath = filePath.substring(0, filePath.lastIndexOf('/'));
      const resolvedPath = new URL(modulePath, `file://${basePath}/`).pathname;

      if (!result[modulePath]) {
        result[modulePath] = { path: resolvedPath, names: [] };
      }

      if (defaultImport) {
        result[modulePath].names.push(defaultImport);
      } else if (namespaceImport) {
        result[modulePath].names.push(namespaceImport);
      } else if (namedImportsStr) {
        // Handle named imports like { ComponentName, Component2 as Alias }
        const namedImports = namedImportsStr.split(',').map((s) => s.trim());
        namedImports.forEach((namedImport) => {
          // If there's an alias, use the alias name, otherwise use the original name
          const aliasMatch = namedImport.match(/(.+?)\s+as\s+(.+)/);
          const nameToUse = aliasMatch ? aliasMatch[2].trim() : namedImport.trim();
          result[modulePath].names.push(nameToUse);
        });
      }
    }
    importMatch = importRegex.exec(code);
  }

  return result;
}
