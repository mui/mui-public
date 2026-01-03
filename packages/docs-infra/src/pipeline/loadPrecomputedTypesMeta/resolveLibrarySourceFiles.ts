// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import fs from 'fs/promises';
// eslint-disable-next-line n/prefer-node-protocol
import { fileURLToPath } from 'url';
import { resolve } from 'import-meta-resolve';
import type ts from 'typescript';
import { resolveVariantPathsWithFs } from '../loadServerCodeMeta';
import { fileUrlToPortablePath, portablePathToFileUrl } from '../loaderUtils/fileUrlToPortablePath';

export interface ResolveLibrarySourceFilesOptions {
  /** Map from variant name to file URL (file:// protocol) */
  variants: Record<string, string>;
  /** Filesystem path to the resource being loaded */
  resourcePath: string;
  /** Filesystem path to the webpack root context (must end with /) */
  rootContextDir: string;
  tsconfigPaths?: ts.MapLike<string[]>;
  /** Base path for resolving tsconfig paths (must end with /) */
  pathsBaseDir?: string;
  watchSourceDirectly?: boolean;
}

export interface ResolveLibrarySourceFilesResult {
  /** Map from variant name to resolved file URL (file:// protocol) */
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
 *
 * If watchSourceDirectly is not explicitly provided, it will be automatically
 * determined based on whether any variants use tsconfig path aliases.
 */
export async function resolveLibrarySourceFiles(
  options: ResolveLibrarySourceFilesOptions,
): Promise<ResolveLibrarySourceFilesResult> {
  const { variants, resourcePath, rootContextDir, tsconfigPaths, pathsBaseDir } = options;

  // Determine watchSourceDirectly if not explicitly provided
  // If any variant uses a tsconfig path alias, we should watch source files directly
  const watchSourceDirectly =
    options.watchSourceDirectly ??
    (tsconfigPaths
      ? Object.values(variants).some((variantUrl) => {
          const variantPath = fileUrlToPortablePath(variantUrl);
          // Skip relative paths - they don't need source watching
          if (variantPath.startsWith(rootContextDir)) {
            return false;
          }
          // Check if this variant path matches any tsconfig path pattern
          return Object.keys(tsconfigPaths).some((pattern) => {
            const regexPattern = pattern.replace(/\*\*/g, '.+').replace(/\*/g, '[^/]+');
            return new RegExp(`^${regexPattern}`).test(variantPath);
          });
        })
      : false);

  let globalTypes = watchSourceDirectly ? [] : [];

  const relativeVariants: Record<string, string> = {};
  const externalVariants: Record<string, string> = {};

  // Transform tsconfig paths into regex patterns
  const paths = tsconfigPaths && transformTsconfigPaths(tsconfigPaths);

  // Categorize variants as relative, path-mapped, or external
  Object.entries(variants).forEach(([variantName, variantUrl]) => {
    const variantPath = fileUrlToPortablePath(variantUrl);
    if (variantPath.startsWith(rootContextDir)) {
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
              const baseDir = pathsBaseDir || rootContextDir;
              relativeVariants[variantName] = new URL(
                replacedPath,
                portablePathToFileUrl(baseDir),
              ).pathname;
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
      const resolvedUrl = resolve(variantPath, portablePathToFileUrl(resourcePath));

      if (!watchSourceDirectly) {
        globalTypes = []; // if we are reading d.ts files directly, we shouldn't need to add any global types
        // When not watching source directly, we want to analyze the .d.ts file, not the .js file
        const dtsUrl = resolvedUrl.replace('.js', '.d.ts');
        return [variantName, dtsUrl] as const;
      }

      // Lookup the source map to find the original .ts/.tsx source file
      const sourceMapUrl = resolvedUrl.replace('.js', '.d.ts.map');
      const sourceMap = await fs.readFile(fileURLToPath(sourceMapUrl), 'utf-8').catch(() => null);
      if (!sourceMap) {
        throw new Error(`Missing source map for variant "${variantName}" at ${sourceMapUrl}.`);
      }

      const parsedSourceMap = JSON.parse(sourceMap);

      if (
        !('sources' in parsedSourceMap) ||
        !Array.isArray(parsedSourceMap.sources) ||
        parsedSourceMap.sources.length === 0
      ) {
        throw new Error(
          `Invalid source map for variant "${variantName}" at ${sourceMapUrl}. Missing "sources" field.`,
        );
      }

      const basePath = parsedSourceMap.sourceRoot
        ? new URL(parsedSourceMap.sourceRoot, resolvedUrl)
        : resolvedUrl;
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
