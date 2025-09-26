import type { Externals } from '../../CodeHighlighter/types';

/**
 * Filters out type-only imports from externals since they don't exist at runtime.
 * This is essential for client-side code where type imports are stripped during compilation.
 */
export function filterRuntimeExternals(externals: Externals): Externals {
  const runtimeExternals: Externals = {};

  for (const [modulePath, imports] of Object.entries(externals)) {
    // Filter out imports where isType is true
    const runtimeImports = imports.filter((importItem) => !importItem.isType);

    // Only include the module if it has runtime imports
    if (runtimeImports.length > 0) {
      runtimeExternals[modulePath] = runtimeImports;
    }
  }

  return runtimeExternals;
}
