import { join, extname } from 'node:path';

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
  const { extensions = ['.ts', '.tsx', '.js', '.jsx'] } = options;

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
