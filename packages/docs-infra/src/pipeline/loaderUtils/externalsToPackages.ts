export function externalsToPackages(externals: string[]): Record<string, true> {
  const packages: Record<string, true> = {};

  externals.forEach((external) => {
    // Filter out path aliases that start with @/
    if (external.startsWith('@/')) {
      return;
    }

    // Extract package name from import path
    const packageName = extractPackageName(external);
    if (packageName) {
      packages[packageName] = true;
    }
  });

  return packages;
}

/**
 * Extracts the package name from an import path.
 * Examples:
 * - 'react' -> 'react'
 * - 'react-dom' -> 'react-dom'
 * - '@mui/internal-docs-infra/CodeHighlighter' -> '@mui/internal-docs-infra'
 * - '@mui/internal-docs-infra/parseSource' -> '@mui/internal-docs-infra'
 * - 'lodash/get' -> 'lodash'
 * - 'some-package/submodule/deep' -> 'some-package'
 */
function extractPackageName(importPath: string): string | null {
  if (!importPath) {
    return null;
  }

  // Handle scoped packages (starting with @)
  if (importPath.startsWith('@')) {
    const parts = importPath.split('/');
    if (parts.length >= 2) {
      // Return @scope/package-name
      return `${parts[0]}/${parts[1]}`;
    }
    return null;
  }

  // Handle regular packages
  const parts = importPath.split('/');
  return parts[0] || null;
}
