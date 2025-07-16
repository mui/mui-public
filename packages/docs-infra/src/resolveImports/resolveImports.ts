export async function resolveImports(code: string, filePath: string): Promise<string[]> {
  const importMap = buildImportMap(code, filePath);
  return Array.from(importMap.values());
}

export async function resolveImportMap(
  code: string,
  filePath: string,
): Promise<Map<string, string>> {
  return buildImportMap(code, filePath);
}

function buildImportMap(code: string, filePath: string): Map<string, string> {
  const importMap = new Map<string, string>();
  const importRegex = /import\s+(?:(\w+)|\*\s+as\s+(\w+)|{[^}]+})\s+from\s+['"]([^'"]+)['"]/g;
  let importMatch = importRegex.exec(code);

  while (importMatch !== null) {
    const [fullMatch, defaultImport, namespaceImport, modulePath] = importMatch;

    if (modulePath.startsWith('.')) {
      const basePath = filePath.substring(0, filePath.lastIndexOf('/'));
      const resolvedPath = new URL(modulePath, `file://${basePath}/`).pathname;

      if (defaultImport) {
        importMap.set(defaultImport, resolvedPath);
      } else if (namespaceImport) {
        importMap.set(namespaceImport, resolvedPath);
      } else if (fullMatch.includes('{')) {
        // Handle named imports like { ComponentName }
        const namedImportsMatch = fullMatch.match(/{\s*([^}]+)\s*}/);
        if (namedImportsMatch) {
          const namedImports = namedImportsMatch[1].split(',').map((s) => s.trim());
          namedImports.forEach((namedImport) => {
            const cleanImport = namedImport.split(' as ')[0].trim();
            importMap.set(cleanImport, resolvedPath);
          });
        }
      }
    }
    importMatch = importRegex.exec(code);
  }

  return importMap;
}
