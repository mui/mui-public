export async function resolveImports(code: string, filePath: string): Promise<string[]> {
  const importMap = buildImportMap(code, filePath);
  return Array.from(importMap.values());
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

export async function resolveDemoImports(
  code: string,
  filePath: string,
): Promise<Record<string, string>> {
  const demoImports: Record<string, string> = {};

  // Use the shared buildImportMap function to get import mappings
  const importMap = buildImportMap(code, filePath);

  // Find createDemo calls and extract the demo object
  const createDemoRegex = /createDemo\s*\(\s*[^,]+,\s*({[^}]*})/g;
  let demoMatch = createDemoRegex.exec(code);

  while (demoMatch !== null) {
    const demoObjectStr = demoMatch[1];

    // Parse the demo object to extract key-value pairs
    // Handle both { Default: BasicCode } and { Default } syntax
    const objectContentRegex = /(\w+)(?:\s*:\s*(\w+))?/g;
    let objectMatch = objectContentRegex.exec(demoObjectStr);

    while (objectMatch !== null) {
      const [, key, value] = objectMatch;
      const importName = value || key; // Use value if provided, otherwise use key (shorthand syntax)

      if (importMap.has(importName)) {
        demoImports[key] = importMap.get(importName)!;
      }

      objectMatch = objectContentRegex.exec(demoObjectStr);
    }

    demoMatch = createDemoRegex.exec(code);
  }

  return demoImports;
}
