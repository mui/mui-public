import { readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

interface ResolveModulePathOptions {
  /**
   * Array of file extensions to try when resolving modules.
   * Default: ['.ts', '.tsx', '.js', '.jsx']
   */
  extensions?: string[];
}

/**
 * Resolves a module path by checking the filesystem for possible file matches.
 *
 * Given a path like `/Code/mui-public/packages/docs-infra/docs/app/components/code-highlighter/demos/code/BasicCode`,
 * this function will try to find the actual file by checking for:
 * - `BasicCode.ts`, `BasicCode.tsx`, `BasicCode.js`, `BasicCode.jsx`
 * - `BasicCode/index.ts`, `BasicCode/index.tsx`, `BasicCode/index.js`, `BasicCode/index.jsx`
 *
 * @param modulePath - The module path to resolve (without file extension)
 * @param options - Configuration options
 * @returns Promise<string> - The resolved file path, or throws if not found
 */
export async function resolveModulePath(
  modulePath: string,
  options: ResolveModulePathOptions = {},
): Promise<string> {
  const { extensions = ['.ts', '.tsx', '.js', '.jsx'] } = options;

  // First, try direct file matches with extensions
  const fileChecks = extensions.map(async (ext) => {
    const filePath = modulePath + ext;
    try {
      const stats = await stat(filePath);
      if (stats.isFile()) {
        return filePath;
      }
    } catch {
      // File doesn't exist
    }
    return null;
  });

  const fileResults = await Promise.all(fileChecks);
  const foundFile = fileResults.find((result) => result !== null);
  if (foundFile) {
    return foundFile;
  }

  // Then, try directory with index files
  try {
    const stats = await stat(modulePath);
    if (stats.isDirectory()) {
      const indexChecks = extensions.map(async (ext) => {
        const indexPath = join(modulePath, `index${ext}`);
        try {
          const indexStats = await stat(indexPath);
          if (indexStats.isFile()) {
            return indexPath;
          }
        } catch {
          // Index file doesn't exist
        }
        return null;
      });

      const indexResults = await Promise.all(indexChecks);
      const foundIndex = indexResults.find((result) => result !== null);
      if (foundIndex) {
        return foundIndex;
      }
    }
  } catch {
    // Directory doesn't exist, continue
  }

  throw new Error(
    `Could not resolve module at path "${modulePath}". Tried extensions: ${extensions.join(', ')}`,
  );
}

/**
 * Alternative implementation that reads directory contents to find matching files.
 * This can be more efficient when there are many possible extensions to check.
 *
 * @param modulePath - The module path to resolve (without file extension)
 * @param options - Configuration options
 * @returns Promise<string> - The resolved file path, or throws if not found
 */
export async function resolveModulePathByListing(
  modulePath: string,
  options: ResolveModulePathOptions = {},
): Promise<string> {
  const { extensions = ['.ts', '.tsx', '.js', '.jsx'] } = options;

  // Extract the parent directory and the module name
  const lastSlashIndex = modulePath.lastIndexOf('/');
  const parentDir = modulePath.substring(0, lastSlashIndex);
  const moduleName = modulePath.substring(lastSlashIndex + 1);

  try {
    // Read the parent directory contents
    const dirContents = await readdir(parentDir, { withFileTypes: true });

    // Look for direct file matches
    for (const entry of dirContents) {
      if (entry.isFile()) {
        const fileName = entry.name;
        const fileExt = extname(fileName);
        const fileBaseName = fileName.substring(0, fileName.length - fileExt.length);

        if (fileBaseName === moduleName && extensions.includes(fileExt)) {
          return join(parentDir, fileName);
        }
      }
    }

    // Look for directory with index files
    const directoryMatches = dirContents.filter(
      (entry) => entry.isDirectory() && entry.name === moduleName,
    );

    if (directoryMatches.length > 0) {
      const moduleDir = join(parentDir, directoryMatches[0].name);

      try {
        const moduleDirContents = await readdir(moduleDir, { withFileTypes: true });

        for (const moduleFile of moduleDirContents) {
          if (moduleFile.isFile()) {
            const fileName = moduleFile.name;
            const fileExt = extname(fileName);
            const fileBaseName = fileName.substring(0, fileName.length - fileExt.length);

            if (fileBaseName === 'index' && extensions.includes(fileExt)) {
              return join(moduleDir, fileName);
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
