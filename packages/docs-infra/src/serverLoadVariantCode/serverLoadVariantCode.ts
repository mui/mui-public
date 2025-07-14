import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { LoadVariantCode, VariantCode, VariantExtraFiles } from '../CodeHighlighter';
import {
  resolveDemoImports,
  resolveImports,
  resolveModulePath,
  rewriteImportsToSameDirectory,
} from '../resolveImports';

interface LoadDependenciesOptions {
  maxDepth?: number;
  maxFiles?: number;
  includeDependencies?: boolean;
}

export interface VariantCodeWithFiles {
  /** The variant code data */
  variant: VariantCode;
  /** Array of all file paths that were visited during dependency resolution */
  visitedFiles: string[];
}

/**
 * Enhanced version of serverLoadVariantCode that supports loading relative dependencies.
 * This function recursively loads all relative imports of the variant code with configurable limits.
 *
 * @param variantName - The name of the variant to load
 * @param url - The URL/path to the file containing the variant
 * @param options - Configuration options for dependency loading
 * @returns Promise<VariantCodeWithFiles> with variant data and visitedFiles separately
 */
async function serverLoadVariantCodeWithOptions(
  variantName: string,
  url: string | undefined,
  options: LoadDependenciesOptions = {},
): Promise<VariantCodeWithFiles> {
  const { includeDependencies = true, maxDepth = 5, maxFiles = 50 } = options;

  if (!url) {
    throw new Error('URL is required to load variant code');
  }

  url = url.replace('file://', '');
  const code = await readFile(url, 'utf8');
  const imports = await resolveDemoImports(code, url);
  const variantImport = imports[variantName];

  if (!variantImport) {
    throw new Error(`Variant "${variantName}" not found in imports`);
  }

  // Use the resolveModulePath function to find the actual file
  const resolvedPath = await resolveModulePath(variantImport);
  let variantCode = await readFile(resolvedPath, 'utf8');

  let extraFiles: VariantExtraFiles | undefined;
  let filesOrder: string[] | undefined;
  let visitedFiles: string[] = [url, resolvedPath]; // Always include the main file

  // Load all relative dependencies if enabled
  if (includeDependencies) {
    const visited = new Set<string>();
    extraFiles = await loadRelativeDependencies(
      resolvedPath,
      variantCode,
      {
        maxDepth,
        maxFiles,
      },
      visited,
    );

    // Create a set of all file paths for import rewriting
    const allFilePaths = new Set([resolvedPath, ...Array.from(visited)]);

    // Rewrite imports in the main variant code
    const rewrittenVariantCode = rewriteImportsToSameDirectory(variantCode, allFilePaths);

    // Rewrite imports in all extra files and update keys to use basenames
    if (extraFiles) {
      const rewrittenExtraFiles: VariantExtraFiles = {};
      for (const [filePath, fileData] of Object.entries(extraFiles)) {
        const fileName = basename(filePath);
        if (fileData && fileData.source && typeof fileData.source === 'string') {
          const rewrittenSource = rewriteImportsToSameDirectory(
            fileData.source as string,
            allFilePaths,
          );
          rewrittenExtraFiles[fileName] = {
            ...fileData,
            source: rewrittenSource,
          };
        } else {
          rewrittenExtraFiles[fileName] = fileData;
        }
      }
      extraFiles = rewrittenExtraFiles;
    }

    // Update the main variant code with rewritten imports
    variantCode = rewrittenVariantCode;

    // Convert the visited set to an array, ensuring the main file is first
    visitedFiles = [
      url,
      resolvedPath,
      ...Array.from(visited).filter((path) => path !== resolvedPath),
    ];
    filesOrder = extraFiles ? [basename(resolvedPath), ...Object.keys(extraFiles)] : undefined;
  } else {
    // Even when not loading dependencies, rewrite imports in the main file
    // to handle any relative imports that might exist
    const allFilePaths = new Set([resolvedPath]);
    variantCode = rewriteImportsToSameDirectory(variantCode, allFilePaths);
  }

  return {
    variant: {
      fileName: basename(resolvedPath),
      source: variantCode,
      extraFiles,
      filesOrder,
    },
    visitedFiles,
  };
}

// Export the extended version for users who want to configure the options
export { serverLoadVariantCodeWithOptions };

// Default export that matches the LoadVariantCode interface
export const serverLoadVariantCode: LoadVariantCode = async (
  variantName,
  url,
): Promise<VariantCode> => {
  const result = await serverLoadVariantCodeWithOptions(variantName, url, {
    includeDependencies: true,
    maxDepth: 5,
    maxFiles: 50,
  });

  // Return only the VariantCode properties, excluding visitedFiles
  return result.variant;
};

/**
 * Recursively loads all relative dependencies of a file with configurable limits to prevent infinite loops.
 *
 * @param filePath - The absolute path to the file to analyze
 * @param fileContent - The content of the file
 * @param options - Configuration options (maxDepth, maxFiles)
 * @param visited - Set of already visited file paths to prevent cycles
 * @param currentDepth - Current recursion depth
 * @returns Promise<VariantExtraFiles | undefined> containing all relative dependencies
 */
async function loadRelativeDependencies(
  filePath: string,
  fileContent: string,
  options: LoadDependenciesOptions = {},
  visited: Set<string> = new Set(),
  currentDepth: number = 0,
): Promise<VariantExtraFiles | undefined> {
  const { maxDepth = 5, maxFiles = 50 } = options;

  // Prevent infinite loops and limit depth
  if (currentDepth >= maxDepth || visited.size >= maxFiles || visited.has(filePath)) {
    return undefined;
  }

  visited.add(filePath);
  const extraFiles: VariantExtraFiles = {};

  try {
    // Get all relative imports from the current file
    const relativePaths = await resolveImports(fileContent, filePath);

    // Process imports in parallel, but limit the number to avoid hitting the maxFiles limit
    const importsToProcess = relativePaths.slice(0, maxFiles - visited.size);

    const dependencyPromises = importsToProcess.map(async (importPath) => {
      try {
        // Resolve the import path to an actual file
        const resolvedImportPath = await resolveModulePath(importPath);

        if (!visited.has(resolvedImportPath)) {
          // Read the dependency file
          const dependencyContent = await readFile(resolvedImportPath, 'utf8');

          return {
            path: resolvedImportPath,
            content: dependencyContent,
          };
        }
      } catch (error) {
        // Skip files that can't be resolved or read
        console.warn(`Could not load dependency: ${importPath}`, error);
      }
      return null;
    });

    const dependencies = (await Promise.all(dependencyPromises)).filter(
      (dep): dep is { path: string; content: string } => dep !== null,
    );

    // Add all dependencies to extraFiles first
    for (const { path: resolvedImportPath, content: dependencyContent } of dependencies) {
      extraFiles[resolvedImportPath] = {
        source: dependencyContent,
      };
    }

    // Process nested dependencies recursively in parallel
    const nestedPromises = dependencies.map(
      ({ path: resolvedImportPath, content: dependencyContent }) =>
        loadRelativeDependencies(
          resolvedImportPath,
          dependencyContent,
          options,
          visited,
          currentDepth + 1,
        ),
    );

    const nestedResults = await Promise.all(nestedPromises);

    // Merge all nested dependencies
    for (const nestedDependencies of nestedResults) {
      if (nestedDependencies) {
        Object.assign(extraFiles, nestedDependencies);
      }
    }
  } catch (error) {
    // Skip if we can't parse imports from this file
    console.warn(`Could not parse imports from: ${filePath}`, error);
  }

  return Object.keys(extraFiles).length > 0 ? extraFiles : undefined;
}
