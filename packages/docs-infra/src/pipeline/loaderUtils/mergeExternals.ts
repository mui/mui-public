import type { Externals } from '../../CodeHighlighter/types';

/**
 * Merges multiple externals objects into a single object, combining imports from the same module.
 * Deduplicates imports by name and type within each module.
 *
 * @param externalsArray Array of externals objects to merge
 * @returns Merged externals object
 *
 * @example
 * ```typescript
 * const externals1 = {
 *   'react': [{ name: 'React', type: 'default' }],
 *   'lodash': [{ name: 'map', type: 'named' }]
 * };
 *
 * const externals2 = {
 *   'react': [{ name: 'useState', type: 'named' }],
 *   'lodash': [{ name: 'map', type: 'named' }] // duplicate - will be removed
 * };
 *
 * const merged = mergeExternals([externals1, externals2]);
 * // Result:
 * // {
 * //   'react': [
 * //     { name: 'React', type: 'default' },
 * //     { name: 'useState', type: 'named' }
 * //   ],
 * //   'lodash': [{ name: 'map', type: 'named' }]
 * // }
 * ```
 */
export function mergeExternals(externalsArray: Array<Externals>): Externals {
  const merged: Externals = {};

  for (const externals of externalsArray) {
    for (const [modulePath, imports] of Object.entries(externals)) {
      if (!merged[modulePath]) {
        // First time seeing this module, copy all imports
        merged[modulePath] = [...imports];
      } else {
        // Module already exists, merge imports and deduplicate
        const existingImports = merged[modulePath];
        const newImports = imports.filter((newImport) => {
          // Check if this import already exists (same name, type, and isType)
          return !existingImports.some(
            (existingImport) =>
              existingImport.name === newImport.name &&
              existingImport.type === newImport.type &&
              existingImport.isType === newImport.isType,
          );
        });

        // Add only the new imports that don't already exist
        merged[modulePath] = [...existingImports, ...newImports];
      }
    }
  }

  return merged;
}
