import { readdir } from 'node:fs/promises';
import {
  resolveModulePath,
  resolveModulePaths,
  type DirectoryEntry,
  type DirectoryReader,
  type ResolveModulePathOptions,
} from './resolveModulePath';

/**
 * Node.js filesystem-based directory reader that converts Dirent objects
 * to the DirectoryEntry interface expected by the resolver functions.
 */
const nodeDirectoryReader: DirectoryReader = async (path: string): Promise<DirectoryEntry[]> => {
  const entries = await readdir(path, { withFileTypes: true });
  return entries.map((entry) => ({
    name: entry.name,
    isFile: entry.isFile(),
    isDirectory: entry.isDirectory(),
  }));
};

/**
 * Resolves a module path using Node.js filesystem APIs.
 * This is a convenience wrapper around the generic resolveModulePath function.
 *
 * @param modulePath - The module path to resolve (without file extension)
 * @param options - Configuration options
 * @returns Promise<string> - The resolved file path, or throws if not found
 */
export async function resolveModulePathWithFs(
  modulePath: string,
  options: ResolveModulePathOptions = {},
): Promise<string> {
  return resolveModulePath(modulePath, nodeDirectoryReader, options);
}

/**
 * Resolves multiple module paths using Node.js filesystem APIs.
 * This is a convenience wrapper around the generic resolveModulePaths function.
 *
 * @param modulePaths - Array of module paths to resolve (without file extensions)
 * @param options - Configuration options
 * @returns Promise<Map<string, string>> - Map from input path to resolved file path
 */
export async function resolveModulePathsWithFs(
  modulePaths: string[],
  options: ResolveModulePathOptions = {},
): Promise<Map<string, string>> {
  return resolveModulePaths(modulePaths, nodeDirectoryReader, options);
}

// Re-export types for convenience
export type { DirectoryEntry, DirectoryReader, ResolveModulePathOptions };
