/**
 * Injects import statements into source code after 'use client' directive.
 * Handles proper placement of imports in client components.
 */
export function injectImportsIntoSource(source: string, importLines: string[]): string {
  if (importLines.length === 0) {
    return source;
  }

  const importString = `${importLines.join('\n')}\n\n`;

  // Check if file starts with 'use client'
  const useClientMatch = source.match(/^['"]use client['"]\s*;\s*\n/);

  if (useClientMatch) {
    // Insert after 'use client' directive
    const afterUseClient = useClientMatch[0];
    return `${afterUseClient}${importString}${source.slice(afterUseClient.length)}`;
  }

  // Insert at the beginning
  return `${importString}${source}`;
}
