import { join, extname } from 'node:path';

/**
 * Default file extensions for JavaScript/TypeScript modules that can be resolved
 */
export const JAVASCRIPT_MODULE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'] as const;

/**
 * Checks if a file path or import path represents a JavaScript/TypeScript module
 * @param path - The file path or import path to check
 * @returns true if it's a JS/TS module, false otherwise
 */
export function isJavaScriptModule(path: string): boolean {
  // If the path has an extension, check if it's one of the JS/TS extensions
  if (/\.[^/]+$/.test(path)) {
    return JAVASCRIPT_MODULE_EXTENSIONS.some((ext) => path.endsWith(ext));
  }
  // If no extension, assume it's a JS/TS module (will be resolved to one)
  return true;
}

export interface DirectoryEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}

export type DirectoryReader = (path: string) => Promise<DirectoryEntry[]>;

export interface ResolveModulePathOptions {
  /**
   * Array of file extensions to try when resolving modules.
   * Default: ['.ts', '.tsx', '.js', '.jsx']
   */
  extensions?: string[];
}

/**
 * Resolves a module path by reading directory contents to find matching files.
 * This is more efficient than checking each file individually with stat calls.
 *
 * Given a path like `/Code/mui-public/packages/docs-infra/docs/app/components/code-highlighter/demos/code/BasicCode`,
 * this function will try to find the actual file by checking for:
 * - `BasicCode.ts`, `BasicCode.tsx`, `BasicCode.js`, `BasicCode.jsx`
 * - `BasicCode/index.ts`, `BasicCode/index.tsx`, `BasicCode/index.js`, `BasicCode/index.jsx`
 *
 * @param modulePath - The module path to resolve (without file extension)
 * @param readDirectory - Function to read directory contents
 * @param options - Configuration options
 * @returns Promise<string> - The resolved file path, or throws if not found
 */
export async function resolveModulePath(
  modulePath: string,
  readDirectory: DirectoryReader,
  options: ResolveModulePathOptions = {},
): Promise<string> {
  const { extensions = JAVASCRIPT_MODULE_EXTENSIONS } = options;

  // Extract the parent directory and the module name
  const lastSlashIndex = modulePath.lastIndexOf('/');
  const parentDir = modulePath.substring(0, lastSlashIndex);
  const moduleName = modulePath.substring(lastSlashIndex + 1);

  try {
    // Read the parent directory contents
    const dirContents = await readDirectory(parentDir);

    // Look for direct file matches in extension priority order
    // Create a map of baseName -> files with that basename for efficient lookup
    const filesByBaseName = new Map<string, DirectoryEntry[]>();
    for (const entry of dirContents) {
      if (entry.isFile) {
        const fileName = entry.name;
        const fileExt = extname(fileName);
        const fileBaseName = fileName.substring(0, fileName.length - fileExt.length);

        if (!filesByBaseName.has(fileBaseName)) {
          filesByBaseName.set(fileBaseName, []);
        }
        filesByBaseName.get(fileBaseName)!.push(entry);
      }
    }

    // Check for the module in extension priority order
    const matchingFiles = filesByBaseName.get(moduleName);
    if (matchingFiles) {
      for (const ext of extensions) {
        for (const entry of matchingFiles) {
          if (extname(entry.name) === ext) {
            return join(parentDir, entry.name);
          }
        }
      }
    }

    // Look for directory with index files
    const directoryMatches = dirContents.filter(
      (entry: DirectoryEntry) => entry.isDirectory && entry.name === moduleName,
    );

    if (directoryMatches.length > 0) {
      const moduleDir = join(parentDir, directoryMatches[0].name);

      try {
        const moduleDirContents = await readDirectory(moduleDir);

        // Look for index files in extension priority order
        // Create a map of baseName -> files for efficient lookup
        const indexFilesByBaseName = new Map<string, DirectoryEntry[]>();
        for (const moduleFile of moduleDirContents) {
          if (moduleFile.isFile) {
            const fileName = moduleFile.name;
            const fileExt = extname(fileName);
            const fileBaseName = fileName.substring(0, fileName.length - fileExt.length);

            if (!indexFilesByBaseName.has(fileBaseName)) {
              indexFilesByBaseName.set(fileBaseName, []);
            }
            indexFilesByBaseName.get(fileBaseName)!.push(moduleFile);
          }
        }

        // Check for index files in extension priority order
        const indexFiles = indexFilesByBaseName.get('index');
        if (indexFiles) {
          for (const ext of extensions) {
            for (const entry of indexFiles) {
              if (extname(entry.name) === ext) {
                return join(moduleDir, entry.name);
              }
            }
          }
        }
      } catch {
        // Could not read module directory, continue
      }
    }
  } catch {
    // Could not read parent directory
  }

  throw new Error(
    `Could not resolve module at path "${modulePath}". Tried extensions: ${extensions.join(', ')}`,
  );
}

/**
 * Resolves multiple module paths efficiently by grouping them by directory
 * and performing batch directory lookups.
 *
 * @param modulePaths - Array of module paths to resolve (without file extensions)
 * @param readDirectory - Function to read directory contents
 * @param options - Configuration options
 * @returns Promise<Map<string, string>> - Map from input path to resolved file path
 */
export async function resolveModulePaths(
  modulePaths: string[],
  readDirectory: DirectoryReader,
  options: ResolveModulePathOptions = {},
): Promise<Map<string, string>> {
  const { extensions = ['.ts', '.tsx', '.js', '.jsx'] } = options;
  const results = new Map<string, string>();

  // Group paths by their parent directory
  const pathsByDirectory = new Map<string, Array<{ fullPath: string; moduleName: string }>>();

  for (const modulePath of modulePaths) {
    const lastSlashIndex = modulePath.lastIndexOf('/');
    const parentDir = modulePath.substring(0, lastSlashIndex);
    const moduleName = modulePath.substring(lastSlashIndex + 1);

    if (!pathsByDirectory.has(parentDir)) {
      pathsByDirectory.set(parentDir, []);
    }
    pathsByDirectory.get(parentDir)!.push({ fullPath: modulePath, moduleName });
  }

  // Process each directory group
  const directoryEntries = Array.from(pathsByDirectory.entries());
  const directoryResults = await Promise.all(
    directoryEntries.map(async ([parentDir, pathGroup]) => {
      try {
        // Read the directory contents once for all paths in this directory
        const dirContents = await readDirectory(parentDir);
        const unresolved: Array<{ fullPath: string; moduleName: string }> = [];
        const resolved: Array<{ fullPath: string; resolvedPath: string }> = [];

        // Look for direct file matches in extension priority order
        // Create a map of baseName -> files for efficient lookup
        const filesByBaseName = new Map<string, DirectoryEntry[]>();
        for (const entry of dirContents) {
          if (entry.isFile) {
            const fileName = entry.name;
            const fileExt = extname(fileName);
            const fileBaseName = fileName.substring(0, fileName.length - fileExt.length);

            if (!filesByBaseName.has(fileBaseName)) {
              filesByBaseName.set(fileBaseName, []);
            }
            filesByBaseName.get(fileBaseName)!.push(entry);
          }
        }

        // Check each module path against the file map
        for (const { fullPath, moduleName } of pathGroup) {
          let foundMatch = false;
          const matchingFiles = filesByBaseName.get(moduleName);

          if (matchingFiles) {
            for (const ext of extensions) {
              for (const entry of matchingFiles) {
                if (extname(entry.name) === ext) {
                  resolved.push({ fullPath, resolvedPath: join(parentDir, entry.name) });
                  foundMatch = true;
                  break;
                }
              }
              if (foundMatch) {
                break;
              }
            }
          }

          if (!foundMatch) {
            unresolved.push({ fullPath, moduleName });
          }
        }

        // For unresolved paths, check if they are directories with index files
        if (unresolved.length > 0) {
          const directories = new Set(
            dirContents
              .filter((entry: DirectoryEntry) => entry.isDirectory)
              .map((entry: DirectoryEntry) => entry.name),
          );

          const indexResults = await Promise.all(
            unresolved.map(async ({ fullPath, moduleName }) => {
              if (directories.has(moduleName)) {
                const moduleDir = join(parentDir, moduleName);

                try {
                  const moduleDirContents = await readDirectory(moduleDir);

                  // Look for index files in extension priority order
                  // Create a map of baseName -> files for efficient lookup
                  const indexFilesByBaseName = new Map<string, DirectoryEntry[]>();
                  for (const moduleFile of moduleDirContents) {
                    if (moduleFile.isFile) {
                      const fileName = moduleFile.name;
                      const fileExt = extname(fileName);
                      const fileBaseName = fileName.substring(0, fileName.length - fileExt.length);

                      if (!indexFilesByBaseName.has(fileBaseName)) {
                        indexFilesByBaseName.set(fileBaseName, []);
                      }
                      indexFilesByBaseName.get(fileBaseName)!.push(moduleFile);
                    }
                  }

                  // Check for index files in extension priority order
                  const indexFiles = indexFilesByBaseName.get('index');
                  if (indexFiles) {
                    for (const ext of extensions) {
                      for (const entry of indexFiles) {
                        if (extname(entry.name) === ext) {
                          return { fullPath, resolvedPath: join(moduleDir, entry.name) };
                        }
                      }
                    }
                  }
                } catch {
                  // Could not read module directory, leave unresolved
                }
              }
              return { fullPath, resolvedPath: null };
            }),
          );

          for (const { fullPath, resolvedPath } of indexResults) {
            if (resolvedPath) {
              resolved.push({ fullPath, resolvedPath });
            }
          }
        }

        return resolved;
      } catch {
        // Could not read parent directory, return empty array
        return [];
      }
    }),
  );

  // Collect all resolved paths
  for (const directoryResult of directoryResults) {
    for (const { fullPath, resolvedPath } of directoryResult) {
      results.set(fullPath, resolvedPath);
    }
  }

  return results;
}

/**
 * Resolves import result by separating JavaScript modules from static assets,
 * only resolving JavaScript modules and returning a combined map.
 * This function uses the resolveModulePaths function internally but requires
 * a DirectoryReader to be provided.
 *
 * @param importResult - The result from resolveImports containing all imports
 * @param readDirectory - Function to read directory contents
 * @param options - Configuration options for module resolution
 * @returns Promise<Map<string, string>> - Map from import path to resolved file path
 */
export async function resolveImportResult(
  importResult: Record<string, { path: string; names: string[] }>,
  readDirectory: DirectoryReader,
  options: ResolveModulePathOptions = {},
): Promise<Map<string, string>> {
  const resolvedPathsMap = new Map<string, string>();

  // Separate JS/TS imports from static asset imports
  const jsImportPaths: string[] = [];
  const staticAssetPaths: string[] = [];

  Object.entries(importResult).forEach(([importPath, { path }]) => {
    if (isJavaScriptModule(importPath)) {
      // If the import path already has a JS/TS extension, use it as-is
      if (JAVASCRIPT_MODULE_EXTENSIONS.some((ext) => importPath.endsWith(ext))) {
        resolvedPathsMap.set(path, path);
      } else {
        // Otherwise, it needs to be resolved (extensionless import)
        jsImportPaths.push(path);
      }
    } else {
      staticAssetPaths.push(path);
    }
  });

  // Resolve JS/TS import paths using the provided directory reader
  if (jsImportPaths.length > 0) {
    const resolvedJsMap = await resolveModulePaths(jsImportPaths, readDirectory, options);
    resolvedJsMap.forEach((resolvedPath, importPath) => {
      resolvedPathsMap.set(importPath, resolvedPath);
    });
  }

  // For static assets, use the path as-is since they already have extensions
  staticAssetPaths.forEach((path) => {
    resolvedPathsMap.set(path, path);
  });

  return resolvedPathsMap;
}

/**
 * Resolves variant paths from a variants object mapping variant names to their file paths.
 * This function extracts the paths, resolves them using resolveModulePaths, and returns
 * a map from variant name to resolved file URL.
 *
 * @param variants - Object mapping variant names to their file paths
 * @param readDirectory - Function to read directory contents
 * @param options - Configuration options for module resolution
 * @returns Promise<Map<string, string>> - Map from variant name to resolved file URL
 */
export async function resolveVariantPaths(
  variants: Record<string, string>,
  readDirectory: DirectoryReader,
  options: ResolveModulePathOptions = {},
): Promise<Map<string, string>> {
  // Extract the variant paths and resolve them
  const variantPaths = Object.values(variants);
  const resolvedVariantPaths = await resolveModulePaths(variantPaths, readDirectory, options);

  // Build a map from variant name to resolved file URL
  const variantMap = new Map<string, string>();
  for (const [variantName, variantPath] of Object.entries(variants)) {
    const resolvedVariantPath = resolvedVariantPaths.get(variantPath);
    if (resolvedVariantPath) {
      // Store as a file URL
      variantMap.set(variantName, `file://${resolvedVariantPath}`);
    }
  }

  return variantMap;
}
