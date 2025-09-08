// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import { readdir } from 'fs/promises';
import {
  resolveModulePath,
  resolveModulePaths,
  resolveImportResult,
  resolveVariantPaths,
  type DirectoryEntry,
  type DirectoryReader,
  type ResolveModulePathOptions,
  type TypeAwareResolveResult,
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
 * @param includeTypeDefs - If true, returns both import and typeImport paths with different extension priorities
 * @returns Promise<string | TypeAwareResolveResult> - The resolved file path(s), or throws if not found
 */
export async function resolveModulePathWithFs(
  modulePath: string,
  options?: ResolveModulePathOptions,
): Promise<string>;
export async function resolveModulePathWithFs(
  modulePath: string,
  options: ResolveModulePathOptions,
  includeTypeDefs: true,
): Promise<TypeAwareResolveResult>;
export async function resolveModulePathWithFs(
  modulePath: string,
  options: ResolveModulePathOptions = {},
  includeTypeDefs?: boolean,
): Promise<string | TypeAwareResolveResult> {
  return resolveModulePath(modulePath, nodeDirectoryReader, options, includeTypeDefs);
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

/**
 * Resolves import result by separating JavaScript modules from static assets,
 * only resolving JavaScript modules and returning a combined map.
 * This is a convenience wrapper around the generic resolveImportResult function
 * that uses Node.js filesystem APIs.
 *
 * @param importResult - The result from parseImports containing all imports
 * @param options - Configuration options for module resolution
 * @returns Promise<Map<string, string>> - Map from import path to resolved file path
 */
export async function resolveImportResultWithFs(
  importResult: Record<string, { path: string; names: string[]; includeTypeDefs?: true }>,
  options: ResolveModulePathOptions = {},
): Promise<Map<string, string>> {
  return resolveImportResult(importResult, nodeDirectoryReader, options);
}

/**
 * Resolves variant paths from a variants object mapping variant names to their file paths.
 * This is a convenience wrapper around the generic resolveVariantPaths function
 * that uses Node.js filesystem APIs.
 *
 * @param variants - Object mapping variant names to their file paths
 * @param options - Configuration options for module resolution
 * @returns Promise<Map<string, string>> - Map from variant name to resolved file URL
 */
export async function resolveVariantPathsWithFs(
  variants: Record<string, string>,
  options: ResolveModulePathOptions = {},
): Promise<Map<string, string>> {
  return resolveVariantPaths(variants, nodeDirectoryReader, options);
}

// Re-export types for convenience
export type { DirectoryEntry, DirectoryReader, ResolveModulePathOptions };
