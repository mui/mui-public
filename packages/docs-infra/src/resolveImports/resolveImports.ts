export async function resolveImports(code: string, filePath: string): Promise<string[]> {
  const imports: string[] = [];
  const regex = /import\s+(?:(\w+)|\*\s+as\s+(\w+))\s+from\s+['"]([^'"]+)['"]/g;
  let match = regex.exec(code);
  while (match !== null) {
    const [, namedImport, namespaceImport, modulePath] = match;

    if (modulePath.startsWith('.')) {
      const basePath = filePath.substring(0, filePath.lastIndexOf('/'));
      const resolvedPath = new URL(modulePath, `file://${basePath}/`).pathname;
      imports.push(resolvedPath);
    }
    match = regex.exec(code);
  }

  return imports;
}
