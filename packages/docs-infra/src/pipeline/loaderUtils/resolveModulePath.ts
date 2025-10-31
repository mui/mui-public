import { getFileNameFromUrl } from './getFileNameFromUrl';

/**
 * Isomorphic path joining function that works in both Node.js and browser environments.
 * Uses string concatenation to handle path joining consistently across platforms.
 */
function joinPath(basePath: string, ...segments: string[]): string {
  // Start with the base path, ensuring it has a trailing slash for URL construction
  let result = basePath.endsWith('/') ? basePath : `${basePath}/`;

  // Handle each segment
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (segment) {
      // Remove leading slash from segment to avoid double slashes
      const cleanSegment = segment.startsWith('/') ? segment.slice(1) : segment;
      // Append segment
      result += cleanSegment;
      // Add trailing slash for intermediate segments
      if (i < segments.length - 1) {
        result += '/';
      }
    }
  }

  return result;
}

/**
 * Default file extensions for JavaScript/TypeScript modules that can be resolved
 */
export const JAVASCRIPT_MODULE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mdx',
  '.d.ts',
] as const;

/**
 * Extension priority for type-only imports - prioritize .d.ts first
 */
export const TYPE_IMPORT_EXTENSIONS = ['.d.ts', '.ts', '.tsx', '.js', '.jsx', '.mdx'] as const;

/**
 * Extension priority for value imports - standard priority with .d.ts last
 */
export const VALUE_IMPORT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mdx', '.d.ts'] as const;

/**
 * Static asset extensions that should NOT be resolved as JS modules
 */
const STATIC_ASSET_EXTENSIONS = [
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.json',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
] as const;

/**
 * Checks if a file path or import path represents a static asset
 * @param path - The file path or import path to check
 * @returns true if it's a static asset, false if it should be resolved as a JS module
 */
function isStaticAsset(path: string): boolean {
  return STATIC_ASSET_EXTENSIONS.some((ext) => path.endsWith(ext));
}

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

export interface TypeAwareResolveResult {
  import: string;
  typeImport?: string;
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
 * @param includeTypeDefs - If true, returns both import and typeImport paths with different extension priorities
 * @returns Promise<string | TypeAwareResolveResult> - The resolved file path(s)
 */
export async function resolveModulePath(
  modulePath: string,
  readDirectory: DirectoryReader,
  options: ResolveModulePathOptions = {},
  includeTypeDefs?: boolean,
): Promise<string | TypeAwareResolveResult> {
  const { extensions = JAVASCRIPT_MODULE_EXTENSIONS } = options;

  // If includeTypeDefs is true, we need to resolve with both type and value extension priorities
  if (includeTypeDefs) {
    return resolveWithTypeAwareness(modulePath, readDirectory, options);
  }

  // Extract the parent directory and the module name
  const lastSlashIndex = modulePath.lastIndexOf('/');
  const parentDir = modulePath.substring(0, lastSlashIndex);
  const moduleName = modulePath.substring(lastSlashIndex + 1);

  const resolvedPath = await resolveSinglePath(
    modulePath,
    parentDir,
    moduleName,
    readDirectory,
    extensions,
  );
  return resolvedPath;
}

/**
 * Resolves a module path with type-aware resolution, returning both import and typeImport paths
 * This function is optimized to do only a single directory read instead of two separate reads.
 */
async function resolveWithTypeAwareness(
  modulePath: string,
  readDirectory: DirectoryReader,
  _options: ResolveModulePathOptions = {},
): Promise<TypeAwareResolveResult> {
  const lastSlashIndex = modulePath.lastIndexOf('/');
  const parentDir = modulePath.substring(0, lastSlashIndex);
  const moduleName = modulePath.substring(lastSlashIndex + 1);

  // Single filesystem read to get directory contents
  const dirContents = await readDirectory(parentDir);

  // Build a map of available files by basename
  const filesByBaseName = new Map<string, DirectoryEntry[]>();
  for (const entry of dirContents) {
    if (entry.isFile) {
      const fileName = entry.name;
      let fileBaseName: string;
      let actualExtension: string;

      // Handle .d.ts files specially since getFileNameFromUrl returns .ts for types.d.ts
      if (fileName.endsWith('.d.ts')) {
        actualExtension = '.d.ts';
        fileBaseName = fileName.substring(0, fileName.length - 5); // Remove .d.ts
      } else {
        const { extension: fileExt } = getFileNameFromUrl(fileName);
        actualExtension = fileExt;
        fileBaseName = fileName.substring(0, fileName.length - fileExt.length);
      }

      if (!filesByBaseName.has(fileBaseName)) {
        filesByBaseName.set(fileBaseName, []);
      }
      // Store the entry with its actual extension for later matching
      filesByBaseName.get(fileBaseName)!.push({
        ...entry,
        actualExtension,
      } as DirectoryEntry & { actualExtension: string });
    }
  }

  // Check for the module in both priority orders
  const matchingFiles = filesByBaseName.get(moduleName);
  if (matchingFiles) {
    const entryMap = matchingFiles as Array<DirectoryEntry & { actualExtension: string }>;

    // Find best match for value imports (VALUE_IMPORT_EXTENSIONS priority)
    let importPath: string | null = null;
    for (const ext of VALUE_IMPORT_EXTENSIONS) {
      for (const entry of entryMap) {
        if (entry.actualExtension === ext) {
          importPath = joinPath(parentDir, entry.name);
          break;
        }
      }
      if (importPath) {
        break;
      }
    }

    // Find best match for type imports (TYPE_IMPORT_EXTENSIONS priority)
    let typeImportPath: string | null = null;
    for (const ext of TYPE_IMPORT_EXTENSIONS) {
      for (const entry of entryMap) {
        if (entry.actualExtension === ext) {
          typeImportPath = joinPath(parentDir, entry.name);
          break;
        }
      }
      if (typeImportPath) {
        break;
      }
    }

    if (importPath && typeImportPath && importPath !== typeImportPath) {
      return { import: importPath, typeImport: typeImportPath };
    }
    if (importPath) {
      return { import: importPath };
    }
    if (typeImportPath) {
      return { import: typeImportPath };
    }
  }

  // Try index files with the same single-pass approach
  const directoryMatches = dirContents.filter(
    (entry: DirectoryEntry) => entry.isDirectory && entry.name === moduleName,
  );

  if (directoryMatches.length > 0) {
    const moduleDir = joinPath(parentDir, directoryMatches[0].name);

    try {
      const moduleDirContents = await readDirectory(moduleDir);

      // Build a map of available index files by basename
      const indexFilesByBaseName = new Map<string, DirectoryEntry[]>();
      for (const moduleFile of moduleDirContents) {
        if (moduleFile.isFile) {
          const fileName = moduleFile.name;
          let fileBaseName: string;
          let actualExtension: string;

          // Handle .d.ts files specially since getFileNameFromUrl returns .ts for index.d.ts
          if (fileName.endsWith('.d.ts')) {
            actualExtension = '.d.ts';
            fileBaseName = fileName.substring(0, fileName.length - 5); // Remove .d.ts
          } else {
            const { extension: fileExt } = getFileNameFromUrl(fileName);
            actualExtension = fileExt;
            fileBaseName = fileName.substring(0, fileName.length - fileExt.length);
          }

          if (!indexFilesByBaseName.has(fileBaseName)) {
            indexFilesByBaseName.set(fileBaseName, []);
          }
          // Store the entry with its actual extension for later matching
          indexFilesByBaseName.get(fileBaseName)!.push({
            ...moduleFile,
            actualExtension,
          } as DirectoryEntry & { actualExtension: string });
        }
      }

      // Check for index files in both priority orders
      const indexFiles = indexFilesByBaseName.get('index');
      if (indexFiles) {
        const indexEntryMap = indexFiles as Array<DirectoryEntry & { actualExtension: string }>;

        // Find best match for value imports
        let importPath: string | null = null;
        for (const ext of VALUE_IMPORT_EXTENSIONS) {
          for (const entry of indexEntryMap) {
            if (entry.actualExtension === ext) {
              importPath = joinPath(moduleDir, entry.name);
              break;
            }
          }
          if (importPath) {
            break;
          }
        }

        // Find best match for type imports
        let typeImportPath: string | null = null;
        for (const ext of TYPE_IMPORT_EXTENSIONS) {
          for (const entry of indexEntryMap) {
            if (entry.actualExtension === ext) {
              typeImportPath = joinPath(moduleDir, entry.name);
              break;
            }
          }
          if (typeImportPath) {
            break;
          }
        }

        if (importPath && typeImportPath && importPath !== typeImportPath) {
          return { import: importPath, typeImport: typeImportPath };
        }
        if (importPath) {
          return { import: importPath };
        }
        if (typeImportPath) {
          return { import: typeImportPath };
        }
      }
    } catch {
      // Could not read module directory, continue
    }
  }

  throw new Error(
    `Could not resolve module at path "${modulePath}". Tried extensions: ${VALUE_IMPORT_EXTENSIONS.join(', ')}, ${TYPE_IMPORT_EXTENSIONS.join(', ')}`,
  );
}

/**
 * Internal function to resolve a single path with given extensions
 */
async function resolveSinglePath(
  modulePath: string,
  parentDir: string,
  moduleName: string,
  readDirectory: DirectoryReader,
  extensions: readonly string[],
): Promise<string> {
  try {
    // Read the parent directory contents
    const dirContents = await readDirectory(parentDir);

    // Look for direct file matches in extension priority order
    // Create a map of baseName -> files with that basename for efficient lookup
    const filesByBaseName = new Map<string, DirectoryEntry[]>();
    for (const entry of dirContents) {
      if (entry.isFile) {
        const fileName = entry.name;
        let fileBaseName: string;
        let actualExtension: string;

        // Handle .d.ts files specially since getFileNameFromUrl returns .ts for types.d.ts
        if (fileName.endsWith('.d.ts')) {
          actualExtension = '.d.ts';
          fileBaseName = fileName.substring(0, fileName.length - 5); // Remove .d.ts
        } else {
          const { extension: fileExt } = getFileNameFromUrl(fileName);
          actualExtension = fileExt;
          fileBaseName = fileName.substring(0, fileName.length - fileExt.length);
        }

        if (!filesByBaseName.has(fileBaseName)) {
          filesByBaseName.set(fileBaseName, []);
        }
        // Store the entry with its actual extension for later matching
        filesByBaseName.get(fileBaseName)!.push({
          ...entry,
          // Add a custom property to track the actual extension
          actualExtension,
        } as DirectoryEntry & { actualExtension: string });
      }
    }

    // Check for the module in extension priority order
    const matchingFiles = filesByBaseName.get(moduleName);
    if (matchingFiles) {
      for (const ext of extensions) {
        for (const entry of matchingFiles) {
          const entryWithExt = entry as DirectoryEntry & { actualExtension: string };
          if (entryWithExt.actualExtension === ext) {
            const resolvedPath = joinPath(parentDir, entry.name);
            return resolvedPath;
          }
        }
      }
    }

    // Look for directory with index files
    const directoryMatches = dirContents.filter(
      (entry: DirectoryEntry) => entry.isDirectory && entry.name === moduleName,
    );

    if (directoryMatches.length > 0) {
      const moduleDir = joinPath(parentDir, directoryMatches[0].name);

      try {
        const moduleDirContents = await readDirectory(moduleDir);

        // Look for index files in extension priority order
        // Create a map of baseName -> files for efficient lookup
        const indexFilesByBaseName = new Map<string, DirectoryEntry[]>();
        for (const moduleFile of moduleDirContents) {
          if (moduleFile.isFile) {
            const fileName = moduleFile.name;
            let fileBaseName: string;
            let actualExtension: string;

            // Handle .d.ts files specially since getFileNameFromUrl returns .ts for index.d.ts
            if (fileName.endsWith('.d.ts')) {
              actualExtension = '.d.ts';
              fileBaseName = fileName.substring(0, fileName.length - 5); // Remove .d.ts
            } else {
              const { extension: fileExt } = getFileNameFromUrl(fileName);
              actualExtension = fileExt;
              fileBaseName = fileName.substring(0, fileName.length - fileExt.length);
            }

            if (!indexFilesByBaseName.has(fileBaseName)) {
              indexFilesByBaseName.set(fileBaseName, []);
            }
            // Store the entry with its actual extension for later matching
            indexFilesByBaseName.get(fileBaseName)!.push({
              ...moduleFile,
              actualExtension,
            } as DirectoryEntry & { actualExtension: string });
          }
        }

        // Check for index files in extension priority order
        const indexFiles = indexFilesByBaseName.get('index');
        if (indexFiles) {
          for (const ext of extensions) {
            for (const entry of indexFiles) {
              const entryWithExt = entry as DirectoryEntry & { actualExtension: string };
              if (entryWithExt.actualExtension === ext) {
                return joinPath(moduleDir, entry.name);
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
  const { extensions = JAVASCRIPT_MODULE_EXTENSIONS } = options;
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
            const { extension: fileExt } = getFileNameFromUrl(fileName);
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
                const { extension: entryExt } = getFileNameFromUrl(entry.name);
                if (entryExt === ext) {
                  resolved.push({ fullPath, resolvedPath: joinPath(parentDir, entry.name) });
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
                const moduleDir = joinPath(parentDir, moduleName);

                try {
                  const moduleDirContents = await readDirectory(moduleDir);

                  // Look for index files in extension priority order
                  // Create a map of baseName -> files for efficient lookup
                  const indexFilesByBaseName = new Map<string, DirectoryEntry[]>();
                  for (const moduleFile of moduleDirContents) {
                    if (moduleFile.isFile) {
                      const fileName = moduleFile.name;
                      const { extension: fileExt } = getFileNameFromUrl(fileName);
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
                        const { extension: entryExt } = getFileNameFromUrl(entry.name);
                        if (entryExt === ext) {
                          return { fullPath, resolvedPath: joinPath(moduleDir, entry.name) };
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
 * This function uses the new type-aware resolveModulePath function internally.
 *
 * @param importResult - The result from parseImports containing all imports
 * @param readDirectory - Function to read directory contents
 * @param options - Configuration options for module resolution
 * @returns Promise<Map<string, string>> - Map from import path to resolved file path
 */
export async function resolveImportResult(
  importResult: Record<
    string,
    {
      path: string;
      names: string[];
      includeTypeDefs?: true;
      positions?: Array<{ start: number; end: number }>;
    }
  >,
  readDirectory: DirectoryReader,
  options: ResolveModulePathOptions = {},
): Promise<Map<string, string>> {
  const resolvedPathsMap = new Map<string, string>();

  // Separate imports into categories for processing
  const jsModulesToResolve: Array<{ path: string; includeTypeDefs?: true }> = [];
  const jsModulesWithExtensions: string[] = [];
  const staticAssets: string[] = [];

  for (const [importPath, { path, includeTypeDefs }] of Object.entries(importResult)) {
    if (isStaticAsset(importPath)) {
      // Static asset - use path as-is
      staticAssets.push(path);
    } else if (JAVASCRIPT_MODULE_EXTENSIONS.some((ext) => importPath.endsWith(ext))) {
      // If the import path already has a JS/TS extension, use it as-is
      jsModulesWithExtensions.push(path);
    } else {
      // Needs to be resolved
      jsModulesToResolve.push({ path, includeTypeDefs });
    }
  }

  // Add modules with extensions as-is
  jsModulesWithExtensions.forEach((path) => {
    resolvedPathsMap.set(path, path);
  });

  // Add static assets as-is
  staticAssets.forEach((path) => {
    resolvedPathsMap.set(path, path);
  });

  // Resolve JS modules without extensions
  if (jsModulesToResolve.length > 0) {
    const resolutionPromises = jsModulesToResolve.map(async ({ path, includeTypeDefs }) => {
      try {
        const resolved = await resolveModulePath(path, readDirectory, options, includeTypeDefs);

        if (typeof resolved === 'string') {
          // Simple string result
          return { path, resolved };
        }

        // Type-aware result - for now, just use the import path
        // TODO: We might want to store both paths in the future
        return { path, resolved: resolved.import };
      } catch (error) {
        return null; // Mark as failed
      }
    });

    const resolutionResults = await Promise.all(resolutionPromises);

    // Add successful resolutions to the map
    resolutionResults.forEach((result) => {
      if (result) {
        resolvedPathsMap.set(result.path, result.resolved);
      }
    });
  }

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
