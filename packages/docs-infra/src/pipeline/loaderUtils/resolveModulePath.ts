import { getFileNameFromUrl } from './getFileNameFromUrl';
import { fileUrlToPortablePath, portablePathToFileUrl } from './fileUrlToPortablePath';

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
  '.json',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.woff2',
] as const;

/**
 * Asset extensions that are intentionally unsupported.
 * Importing one of these throws so the issue surfaces at build time.
 */
const UNSUPPORTED_ASSET_EXTENSIONS = [
  '.sass', // use '.scss' instead
  '.less', // legacy
  '.ico', // legacy
  '.woff', // legacy, use '.woff2' (https://web.dev/articles/font-best-practices#use_woff2)
  '.eot', // legacy
  '.ttf', // desktop font format
  '.otf', // desktop font format
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
  // Determine whether the last path segment contains a `.` followed by at
  // least one character — equivalent to the original `/\.[^/]+$/` test but
  // using string indices to avoid the polynomial backtracking that the regex
  // can exhibit on input dominated by `.` characters.
  const lastSlashIndex = path.lastIndexOf('/');
  const lastSegment = lastSlashIndex >= 0 ? path.slice(lastSlashIndex + 1) : path;
  const dotIndex = lastSegment.indexOf('.');
  const hasExtension = dotIndex !== -1 && dotIndex < lastSegment.length - 1;
  if (hasExtension) {
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

type DirectoryIndex = {
  directories: Set<string>;
  files: Map<string, Map<string, DirectoryEntry>>;
};

const directoryIndexes = new WeakMap<DirectoryEntry[], DirectoryIndex>();

/** Indexes each directory snapshot by basename and extension once. */
function createDirectoryIndex(entries: DirectoryEntry[]): DirectoryIndex {
  const cachedIndex = directoryIndexes.get(entries);
  if (cachedIndex) {
    return cachedIndex;
  }

  const directories = new Set<string>();
  const files = new Map<string, Map<string, DirectoryEntry>>();

  for (const entry of entries) {
    if (entry.isDirectory) {
      directories.add(entry.name);
    }
    if (!entry.isFile) {
      continue;
    }

    const extension = entry.name.endsWith('.d.ts')
      ? '.d.ts'
      : getFileNameFromUrl(entry.name).extension;
    const baseName = extension ? entry.name.slice(0, -extension.length) : entry.name;
    const filesByExtension = files.get(baseName) ?? new Map<string, DirectoryEntry>();
    filesByExtension.set(extension, entry);
    files.set(baseName, filesByExtension);
  }

  const index = { directories, files };
  directoryIndexes.set(entries, index);
  return index;
}

/** Selects the first file matching the configured extension priority. */
function selectFile(
  index: DirectoryIndex,
  baseName: string,
  extensions: readonly string[],
): DirectoryEntry | undefined {
  const filesByExtension = index.files.get(baseName);
  if (!filesByExtension) {
    return undefined;
  }
  for (const extension of extensions) {
    const entry = filesByExtension.get(extension);
    if (entry) {
      return entry;
    }
  }
  return undefined;
}

/** Resolves value and type files from one directory index. */
function selectTypeAwareFiles(
  index: DirectoryIndex,
  directory: string,
  baseName: string,
): TypeAwareResolveResult | undefined {
  const importEntry = selectFile(index, baseName, VALUE_IMPORT_EXTENSIONS);
  const typeImportEntry = selectFile(index, baseName, TYPE_IMPORT_EXTENSIONS);
  const selectedEntry = importEntry ?? typeImportEntry;
  if (!selectedEntry) {
    return undefined;
  }

  const importPath = portablePathToFileUrl(joinPath(directory, selectedEntry.name));
  if (importEntry && typeImportEntry && typeImportEntry !== importEntry) {
    return {
      import: importPath,
      typeImport: portablePathToFileUrl(joinPath(directory, typeImportEntry.name)),
    };
  }
  return { import: importPath };
}

/** Reuses both pending and completed directory reads for one import graph. */
function cacheDirectoryReader(readDirectory: DirectoryReader): DirectoryReader {
  const cache = new Map<string, Promise<DirectoryEntry[]>>();
  return (path) => {
    const cachedEntries = cache.get(path);
    if (cachedEntries) {
      return cachedEntries;
    }
    const entries = readDirectory(path);
    cache.set(path, entries);
    return entries;
  };
}

/**
 * Resolves a module path by reading directory contents to find matching files.
 * This is more efficient than checking each file individually with stat calls.
 *
 * Given a path like `file:///Code/mui-public/packages/docs-infra/docs/app/components/code-highlighter/demos/code/BasicCode`,
 * this function will try to find the actual file by checking for:
 * - `BasicCode.ts`, `BasicCode.tsx`, `BasicCode.js`, `BasicCode.jsx`
 * - `BasicCode/index.ts`, `BasicCode/index.tsx`, `BasicCode/index.js`, `BasicCode/index.jsx`
 *
 * @param moduleUrl - The module URL to resolve (file:// URL or portable path, without file extension)
 * @param readDirectory - Function to read directory contents
 * @param options - Configuration options
 * @param includeTypeDefs - If true, returns both import and typeImport paths with different extension priorities
 * @returns Promise<string | TypeAwareResolveResult> - The resolved file:// URL(s)
 */
export async function resolveModulePath(
  moduleUrl: string,
  readDirectory: DirectoryReader,
  options: ResolveModulePathOptions = {},
  includeTypeDefs?: boolean,
): Promise<string | TypeAwareResolveResult> {
  const { extensions = JAVASCRIPT_MODULE_EXTENSIONS } = options;

  // Convert file URL to portable path for internal processing
  const modulePath = moduleUrl.startsWith('file://') ? fileUrlToPortablePath(moduleUrl) : moduleUrl;

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
  const dirContents = await readDirectory(portablePathToFileUrl(parentDir));

  const directoryIndex = createDirectoryIndex(dirContents);
  const directResult = selectTypeAwareFiles(directoryIndex, parentDir, moduleName);
  if (directResult) {
    return directResult;
  }

  if (directoryIndex.directories.has(moduleName)) {
    const moduleDir = joinPath(parentDir, moduleName);

    try {
      const moduleDirContents = await readDirectory(portablePathToFileUrl(moduleDir));

      const indexResult = selectTypeAwareFiles(
        createDirectoryIndex(moduleDirContents),
        moduleDir,
        'index',
      );
      if (indexResult) {
        return indexResult;
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
    const dirContents = await readDirectory(portablePathToFileUrl(parentDir));

    const directoryIndex = createDirectoryIndex(dirContents);
    const directEntry = selectFile(directoryIndex, moduleName, extensions);
    if (directEntry) {
      return portablePathToFileUrl(joinPath(parentDir, directEntry.name));
    }

    if (directoryIndex.directories.has(moduleName)) {
      const moduleDir = joinPath(parentDir, moduleName);

      try {
        const moduleDirContents = await readDirectory(portablePathToFileUrl(moduleDir));

        const indexEntry = selectFile(createDirectoryIndex(moduleDirContents), 'index', extensions);
        if (indexEntry) {
          return portablePathToFileUrl(joinPath(moduleDir, indexEntry.name));
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
        const dirContents = await readDirectory(portablePathToFileUrl(parentDir));
        const unresolved: Array<{ fullPath: string; moduleName: string }> = [];
        const resolved: Array<{ fullPath: string; resolvedPath: string }> = [];

        const directoryIndex = createDirectoryIndex(dirContents);
        for (const { fullPath, moduleName } of pathGroup) {
          const entry = selectFile(directoryIndex, moduleName, extensions);
          if (entry) {
            resolved.push({
              fullPath,
              resolvedPath: portablePathToFileUrl(joinPath(parentDir, entry.name)),
            });
          } else {
            unresolved.push({ fullPath, moduleName });
          }
        }

        const indexResults = await Promise.all(
          unresolved.map(async ({ fullPath, moduleName }) => {
            if (!directoryIndex.directories.has(moduleName)) {
              return { fullPath, resolvedPath: null };
            }

            const moduleDir = joinPath(parentDir, moduleName);
            try {
              const moduleDirContents = await readDirectory(portablePathToFileUrl(moduleDir));
              const entry = selectFile(
                createDirectoryIndex(moduleDirContents),
                'index',
                extensions,
              );
              return {
                fullPath,
                resolvedPath: entry ? portablePathToFileUrl(joinPath(moduleDir, entry.name)) : null,
              };
            } catch {
              return { fullPath, resolvedPath: null };
            }
          }),
        );

        for (const { fullPath, resolvedPath } of indexResults) {
          if (resolvedPath) {
            resolved.push({ fullPath, resolvedPath });
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
      url: string;
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
  const jsModulesToResolve: Array<{ url: string; includeTypeDefs?: true }> = [];
  const jsModulesWithExtensions: string[] = [];
  const staticAssets: string[] = [];

  for (const [importPath, { url, includeTypeDefs }] of Object.entries(importResult)) {
    if (UNSUPPORTED_ASSET_EXTENSIONS.some((ext) => importPath.endsWith(ext))) {
      throw new Error(`Unsupported import extension: "${importPath}".`);
    }

    if (isStaticAsset(importPath)) {
      // Static asset - use url as-is
      staticAssets.push(url);
    } else if (JAVASCRIPT_MODULE_EXTENSIONS.some((ext) => importPath.endsWith(ext))) {
      // If the import path already has a JS/TS extension, use it as-is
      jsModulesWithExtensions.push(url);
    } else {
      // Needs to be resolved
      jsModulesToResolve.push({ url, includeTypeDefs });
    }
  }

  // Add modules with extensions as-is
  jsModulesWithExtensions.forEach((url) => {
    resolvedPathsMap.set(url, url);
  });

  // Add static assets as-is
  staticAssets.forEach((url) => {
    resolvedPathsMap.set(url, url);
  });

  // Resolve JS modules without extensions
  if (jsModulesToResolve.length > 0) {
    const cachedReadDirectory = cacheDirectoryReader(readDirectory);
    const resolutionPromises = jsModulesToResolve.map(async ({ url, includeTypeDefs }) => {
      try {
        const resolved = await resolveModulePath(
          url,
          cachedReadDirectory,
          options,
          includeTypeDefs,
        );

        if (typeof resolved === 'string') {
          // Simple string result
          return { url, resolved };
        }

        // Type-aware result - for now, just use the import path
        // TODO: We might want to store both paths in the future
        return { url, resolved: resolved.import };
      } catch (error) {
        return null; // Mark as failed
      }
    });

    const resolutionResults = await Promise.all(resolutionPromises);

    // Add successful resolutions to the map
    resolutionResults.forEach((result) => {
      if (result) {
        resolvedPathsMap.set(result.url, result.resolved);
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
      // Store as a file URL (portablePathToFileUrl handles portable paths correctly)
      variantMap.set(variantName, portablePathToFileUrl(resolvedVariantPath));
    }
  }

  return variantMap;
}
