// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import fs from 'fs/promises';
import { resolve } from 'import-meta-resolve';
import type ts from 'typescript';
import { resolveVariantPathsWithFs } from '../loaderUtils/resolveModulePathWithFs';

export interface ResolveLibrarySourceFilesOptions {
  variants: Record<string, string>;
  resourcePath: string;
  rootContext: string;
  tsconfigPaths?: ts.MapLike<string[]>;
  pathsBasePath?: string;
  watchSourceDirectly: boolean;
}

export interface ResolveLibrarySourceFilesResult {
  resolvedVariantMap: Map<string, string>;
  globalTypes: string[];
}

/**
 * Transforms tsconfig.json paths configuration into regex patterns for matching.
 * Converts glob patterns like "**" and "*" into regex capture groups.
 *
 * @param tsconfigPaths - The paths object from tsconfig.json
 * @returns A map of regex patterns to replacement templates
 */
function transformTsconfigPaths(tsconfigPaths: ts.MapLike<string[]>): Record<string, string[]> {
  const paths: Record<string, string[]> = {};

  Object.keys(tsconfigPaths).forEach((key) => {
    const regex = `^${key.replace('**', '(.+)').replace('*', '([^/]+)')}$`;
    paths[regex] = tsconfigPaths[key].map((p) => {
      let index = 0;
      return p.replace(/\*\*|\*/g, () => {
        index = index + 1;
        return `$${index}`;
      });
    });
  });

  return paths;
}

/**
 * Resolves library source file paths to their actual file system locations.
 *
 * Handles three types of library imports:
 * 1. Relative paths - files within the project root
 * 2. Path-mapped imports - imports resolved through tsconfig paths
 * 3. External library imports - imports resolved through node module resolution
 *
 * For external libraries with watchSourceDirectly enabled, follows source maps
 * to find the original TypeScript source files instead of declaration files.
 */
export async function resolveLibrarySourceFiles(
  options: ResolveLibrarySourceFilesOptions,
): Promise<ResolveLibrarySourceFilesResult> {
  const { variants, resourcePath, rootContext, tsconfigPaths, pathsBasePath, watchSourceDirectly } =
    options;

  let globalTypes = options.watchSourceDirectly ? [] : [];

  const relativeVariants: Record<string, string> = {};
  const externalVariants: Record<string, string> = {};

  // Transform tsconfig paths into regex patterns
  const paths = tsconfigPaths && transformTsconfigPaths(tsconfigPaths);

  // Categorize variants as relative, path-mapped, or external
  Object.entries(variants).forEach(([variantName, variantPath]) => {
    if (variantPath.startsWith(rootContext)) {
      relativeVariants[variantName] = variantPath;
    } else if (paths) {
      const found = Object.keys(paths).find((key) => {
        const regex = new RegExp(key);
        const pathMatch = variantPath.match(regex);
        if (pathMatch && pathMatch.length > 0) {
          const replacements = paths[key];
          for (const replacement of replacements) {
            let replacedPath = replacement;
            for (let i = 1; i < pathMatch.length; i += 1) {
              replacedPath = replacedPath.replace(`$${i}`, pathMatch[i]);
            }
            if (replacedPath.startsWith('.')) {
              let basePath = String(pathsBasePath || rootContext);
              basePath = basePath.endsWith('/') ? basePath : `${basePath}/`;
              relativeVariants[variantName] = new URL(replacedPath, `file://${basePath}`).pathname;
            } else {
              externalVariants[variantName] = replacedPath;
            }

            return true;
          }
        }

        return false;
      });

      if (!found) {
        externalVariants[variantName] = variantPath;
      }
    } else {
      externalVariants[variantName] = variantPath;
    }
  });

  // Resolve relative variants using file system
  const resolvedVariantMap = await resolveVariantPathsWithFs(relativeVariants);

  // Resolve external variants using import resolution
  const externalVariantPromises = Object.entries(externalVariants).map(
    async ([variantName, variantPath]) => {
      // We can use this ponyfill because it behaves strangely when using native import.meta.resolve(path, parentUrl)
      const resolvedPath = resolve(variantPath, `file://${resourcePath}`);

      if (!watchSourceDirectly) {
        globalTypes = []; // if we are reading d.ts files directly, we shouldn't need to add any global types
        return [variantName, resolvedPath] as const;
      }

      // Lookup the source map to find the original .ts/.tsx source file
      const resolvedSourceMap = resolvedPath.replace('file://', '').replace('.js', '.d.ts.map');
      const sourceMap = await fs.readFile(resolvedSourceMap, 'utf-8').catch(() => null);
      if (!sourceMap) {
        throw new Error(`Missing source map for variant "${variantName}" at ${resolvedSourceMap}.`);
      }

      const parsedSourceMap = JSON.parse(sourceMap);

      if (
        !('sources' in parsedSourceMap) ||
        !Array.isArray(parsedSourceMap.sources) ||
        parsedSourceMap.sources.length === 0
      ) {
        throw new Error(
          `Invalid source map for variant "${variantName}" at ${resolvedSourceMap}. Missing "sources" field.`,
        );
      }

      const basePath = parsedSourceMap.sourceRoot
        ? new URL(parsedSourceMap.sourceRoot, resolvedPath)
        : resolvedPath;
      const sourceUrl = new URL(parsedSourceMap.sources[0], basePath).toString();

      return [variantName, sourceUrl] as const;
    },
  );

  const externalVariantResults = await Promise.all(externalVariantPromises);
  externalVariantResults.forEach((result) => {
    if (result) {
      resolvedVariantMap.set(result[0], result[1]);
    }
  });

  return { resolvedVariantMap, globalTypes };
}
