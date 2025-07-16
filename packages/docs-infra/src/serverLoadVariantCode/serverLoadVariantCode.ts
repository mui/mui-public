import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { LoadVariantCode, VariantCode, VariantExtraFiles } from '../CodeHighlighter';
import { resolveImports, rewriteImportsToSameDirectory } from '../resolveImports';
import { resolveModulePathsWithFs } from '../resolveImports/resolveModulePathWithFs';

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
 * @param variantName - The name of the variant to load (used for the fileName)
 * @param variantUrl - The URL/path to the variant entrypoint file
 * @param options - Configuration options for dependency loading
 * @returns Promise<VariantCodeWithFiles> with variant data and visitedFiles separately
 */
async function serverLoadVariantCodeWithOptions(
  variantName: string,
  variantUrl: string | undefined,
  options: LoadDependenciesOptions = {},
): Promise<VariantCodeWithFiles> {
  const { includeDependencies = true, maxDepth = 5, maxFiles = 50 } = options;

  if (!variantUrl) {
    throw new Error('Variant URL is required to load variant code');
  }

  const cleanVariantUrl = variantUrl.replace('file://', '');
  let variantCode = await readFile(cleanVariantUrl, 'utf8');

  let extraFiles: VariantExtraFiles | undefined;
  let filesOrder: string[] | undefined;
  let visitedFiles: string[] = [cleanVariantUrl]; // Always include the main file

  // Load all relative dependencies if enabled
  if (includeDependencies) {
    const visited = new Set<string>();
    extraFiles = await loadRelativeDependencies(
      cleanVariantUrl,
      variantCode,
      {
        maxDepth,
        maxFiles,
      },
      visited,
    );

    // Create a set of all file paths for import rewriting
    const allFilePaths = new Set([cleanVariantUrl, ...Array.from(visited)]);

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
      cleanVariantUrl,
      ...Array.from(visited).filter((path) => path !== cleanVariantUrl),
    ];
    filesOrder = extraFiles ? [basename(cleanVariantUrl), ...Object.keys(extraFiles)] : undefined;
  } else {
    // Even when not loading dependencies, rewrite imports in the main file
    // to handle any relative imports that might exist
    const allFilePaths = new Set([cleanVariantUrl]);
    variantCode = rewriteImportsToSameDirectory(variantCode, allFilePaths);
  }

  return {
    variant: {
      fileName: basename(cleanVariantUrl),
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
  variantUrl,
): Promise<VariantCode> => {
  const result = await serverLoadVariantCodeWithOptions(variantName, variantUrl, {
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

    // Resolve all import paths in batch using resolveModulePathsWithFs
    const resolvedPathsMap = await resolveModulePathsWithFs(importsToProcess);

    // Read all resolved files in parallel
    const dependencyPromises = Array.from(resolvedPathsMap.entries()).map(
      async ([importPath, resolvedImportPath]) => {
        try {
          if (!visited.has(resolvedImportPath)) {
            // Read the dependency file
            const dependencyContent = await readFile(resolvedImportPath, 'utf8');

            return {
              path: resolvedImportPath,
              content: dependencyContent,
            };
          }
        } catch (error) {
          // Skip files that can't be read
          console.warn(`Could not load dependency: ${importPath} -> ${resolvedImportPath}`, error);
        }
        return null;
      },
    );

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
