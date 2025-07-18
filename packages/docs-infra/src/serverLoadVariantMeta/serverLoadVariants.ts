import { readFile } from 'node:fs/promises';
import { resolveModulePathsWithFs } from '../resolveImports/resolveModulePathWithFs';
import { parseCreateFactoryCall } from '../codeHighlighterPrecomputeLoader/parseCreateFactoryCall';

/**
 * Loads variant entrypoint URLs from a factory file that contains multiple variants.
 * This function parses the factory file and returns a map of variant names to their
 * resolved entrypoint URLs.
 *
 * @param factoryUrl - The URL/path to the factory file containing the variants
 * @returns Promise<Record<string, string>> mapping variant names to their entrypoint URLs
 */
export async function serverLoadVariants(factoryUrl: string): Promise<Record<string, string>> {
  const cleanFactoryUrl = factoryUrl.replace('file://', '');
  const code = await readFile(cleanFactoryUrl, 'utf8');
  const factoryCall = await parseCreateFactoryCall(code, cleanFactoryUrl);
  const imports = factoryCall?.variants || {};

  const variantUrls: Record<string, string> = {};

  // Resolve all variant import paths to their actual file URLs in parallel
  const variantEntries = Object.entries(imports);
  const variantImportPaths = variantEntries.map(([, variantImport]) => variantImport);
  const resolvedPathsMap = await resolveModulePathsWithFs(variantImportPaths);

  // Create the mapping of variant names to resolved URLs
  variantEntries.forEach(([variantName, variantImport]) => {
    const resolvedPath = resolvedPathsMap.get(variantImport);
    if (resolvedPath) {
      variantUrls[variantName] = resolvedPath;
    }
  });

  return variantUrls;
}
