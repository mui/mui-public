import { rewriteJsImports, rewriteCssImports } from './rewriteImports';
import { isJavaScriptModule } from './resolveModulePath';
import { getFileNameFromUrl } from './getFileNameFromUrl';

export type StoreAtMode = 'canonical' | 'import' | 'flat';

export interface ProcessImportsResult {
  processedSource: string;
  extraFiles: Record<string, string>;
}

/**
 * Processes flat mode with intelligent conflict resolution
 */
function processFlatMode(
  importResult: Record<string, { path: string; names: string[] }>,
  resolvedPathsMap: Map<string, string>,
): ProcessImportsResult {
  const extraFiles: Record<string, string> = {};
  const fileMapping: Array<{
    resolvedPath: string;
    extension: string;
    segments: string[];
    originalImportPath: string;
  }> = [];

  // First pass: collect all files and their path segments
  Object.entries(importResult).forEach(([relativePath, importInfo]) => {
    const resolvedPath = resolvedPathsMap.get(importInfo.path);
    if (resolvedPath) {
      const fileExtension = getFileNameFromUrl(resolvedPath).extension;
      const pathSegments = resolvedPath.split('/').filter(Boolean);

      fileMapping.push({
        resolvedPath,
        extension: fileExtension,
        segments: pathSegments,
        originalImportPath: relativePath,
      });
    }
  });

  // Second pass: determine candidate names and group by conflicts
  const candidateNames = new Map<string, string>();
  const nameGroups = new Map<string, string[]>();

  for (const file of fileMapping) {
    const fileName = file.segments[file.segments.length - 1];
    const isIndexFile = fileName.startsWith('index.');

    let candidateName: string;

    if (isIndexFile) {
      // Check if the original import was a direct index file (e.g., "./index.ext")
      const originalImportParts = file.originalImportPath.split('/');
      const isDirectIndexImport =
        originalImportParts.length === 2 &&
        originalImportParts[0] === '.' &&
        originalImportParts[1].startsWith('index.');

      if (isDirectIndexImport) {
        // For direct index imports like "./index.ext", keep the original name
        candidateName = `index${file.extension}`;
      } else {
        // For nested index files like "./test/index.ext", use parent directory + extension
        const parentDir = file.segments[file.segments.length - 2];
        candidateName = `${parentDir}${file.extension}`;
      }
    } else {
      candidateName = fileName;
    }

    candidateNames.set(file.resolvedPath, candidateName);

    if (!nameGroups.has(candidateName)) {
      nameGroups.set(candidateName, []);
    }
    nameGroups.get(candidateName)!.push(file.resolvedPath);
  }

  // Third pass: resolve conflicts for all files in conflicting groups
  const finalNames = new Map<string, string>();

  nameGroups.forEach((paths, candidateName) => {
    if (paths.length === 1) {
      // No conflict, use the candidate name
      finalNames.set(paths[0], candidateName);
    } else {
      // Conflict detected, find optimal minimal distinguishing paths for all files
      const conflictingFiles = paths.map(
        (resolvedPath) => fileMapping.find((f) => f.resolvedPath === resolvedPath)!,
      );

      // Check if we can resolve conflicts by treating some files differently
      // This specifically handles cases like:
      // - /path/to/a/Component.js and /path/to/Component.js (parent-child relationship)

      // Find files that are "shorter" (parent level) compared to others
      const minLength = Math.min(...conflictingFiles.map((f) => f.segments.length));
      const maxLengthForSmart = Math.max(...conflictingFiles.map((f) => f.segments.length));

      if (maxLengthForSmart > minLength) {
        // We have files at different depths, check if it's a parent-child scenario
        const shorterFiles = conflictingFiles.filter((file) => file.segments.length === minLength);
        const longerFiles = conflictingFiles.filter((file) => file.segments.length > minLength);

        if (shorterFiles.length === 1 && longerFiles.length >= 1) {
          // Check if the shorter file is truly a "parent" of the longer files
          const shorterFile = shorterFiles[0];
          const shorterPath = shorterFile.segments.slice(0, -1).join('/'); // Remove filename

          // Check if all longer files share the same prefix as the shorter file
          const allLongerFilesAreChildren = longerFiles.every((longerFile) => {
            const longerPath = longerFile.segments
              .slice(0, shorterFile.segments.length - 1)
              .join('/');
            return longerPath === shorterPath;
          });

          if (allLongerFilesAreChildren) {
            // This is a true parent-child scenario, apply smart resolution

            // For longer files, find distinguishing index
            let distinguishingIndex = -1;
            const maxLongerLength = Math.max(...longerFiles.map((f) => f.segments.length));

            for (let i = 0; i < maxLongerLength; i += 1) {
              const segmentsAtIndex = new Set(
                longerFiles.map((f) => f.segments[i]).filter(Boolean),
              );
              if (segmentsAtIndex.size === longerFiles.length) {
                distinguishingIndex = i;
                break;
              }
            }

            if (distinguishingIndex !== -1) {
              // Generate names for longer files using distinguishing segment
              for (const file of longerFiles) {
                const fileName = file.segments[file.segments.length - 1];
                const isIndexFile = fileName.startsWith('index.');
                const distinguishingSegment = file.segments[distinguishingIndex];

                let finalName: string;
                if (isIndexFile) {
                  // Check if this was a direct index import
                  const originalImportParts = file.originalImportPath.split('/');
                  const isDirectIndexImport =
                    originalImportParts.length === 2 &&
                    originalImportParts[0] === '.' &&
                    originalImportParts[1].startsWith('index.');

                  if (isDirectIndexImport) {
                    finalName = `${distinguishingSegment}/index${file.extension}`;
                  } else {
                    const parentDir = file.segments[file.segments.length - 2];
                    finalName = `${distinguishingSegment}/${parentDir}${file.extension}`;
                  }
                } else {
                  finalName = `${distinguishingSegment}/${fileName}`;
                }

                finalNames.set(file.resolvedPath, finalName);
              }

              // For shorter files, use the candidate name as-is (no conflicts after disambiguation)
              for (const shortFile of shorterFiles) {
                finalNames.set(shortFile.resolvedPath, candidateName);
              }

              return; // Successfully resolved
            }
          }
        }
      }

      // Fallback to original algorithm if smart resolution fails
      let distinguishingIndex = -1;
      const maxLength = Math.max(...conflictingFiles.map((f) => f.segments.length));

      for (let i = 0; i < maxLength; i += 1) {
        const segmentsAtIndex = new Set(conflictingFiles.map((f) => f.segments[i]).filter(Boolean));
        if (segmentsAtIndex.size === conflictingFiles.length) {
          distinguishingIndex = i;
          break;
        }
      }

      if (distinguishingIndex === -1) {
        throw new Error(`Cannot find distinguishing segment for files: ${paths.join(', ')}`);
      }

      // Generate names using the distinguishing segment
      for (const file of conflictingFiles) {
        const fileName = file.segments[file.segments.length - 1];
        const isIndexFile = fileName.startsWith('index.');
        const distinguishingSegment = file.segments[distinguishingIndex];

        let finalName: string;
        if (isIndexFile) {
          // Check if this was a direct index import
          const originalImportParts = file.originalImportPath.split('/');
          const isDirectIndexImport =
            originalImportParts.length === 2 &&
            originalImportParts[0] === '.' &&
            originalImportParts[1].startsWith('index.');

          if (isDirectIndexImport) {
            finalName = `${distinguishingSegment}/index${file.extension}`;
          } else {
            const parentDir = file.segments[file.segments.length - 2];
            finalName = `${distinguishingSegment}/${parentDir}${file.extension}`;
          }
        } else {
          finalName = `${distinguishingSegment}/${fileName}`;
        }

        finalNames.set(file.resolvedPath, finalName);
      }
    }
  });

  // Fourth pass: build the extraFiles mapping
  finalNames.forEach((finalName, resolvedPath) => {
    extraFiles[`./${finalName}`] = `file://${resolvedPath}`;
  });

  return {
    processedSource: '', // Will be set by caller after rewriting
    extraFiles,
  };
}

/**
 * Processes imports with basic conflict resolution based on filenames.
 * Used for CSS, JSON, and other simple file types that don't require complex module resolution.
 */
function processBasicImports(
  source: string,
  importResult: Record<string, { path: string; names: string[] }>,
  storeAt: StoreAtMode,
): ProcessImportsResult {
  const extraFiles: Record<string, string> = {};

  if (storeAt === 'flat') {
    const finalNames = new Map<string, string>();
    const usedNames = new Set<string>();

    // Process each import to determine final names with simple conflict resolution
    Object.entries(importResult).forEach(([_relativePath, importInfo]) => {
      const resolvedPath = importInfo.path; // For CSS, this is already resolved by parseImports
      const fileUrl = resolvedPath.startsWith('http') ? resolvedPath : `file://${resolvedPath}`;
      const { fileName, extension } = getFileNameFromUrl(fileUrl);

      let finalName = fileName;
      let counter = 1;

      // Handle naming conflicts by appending numbers
      while (usedNames.has(finalName)) {
        const baseName = fileName.replace(extension, '');
        finalName = `${baseName}-${counter}${extension}`;
        counter += 1;
      }

      usedNames.add(finalName);
      finalNames.set(resolvedPath, finalName);
    });

    // Create the import path mapping for rewriting
    const importPathMapping = new Map<string, string>();
    Object.entries(importResult).forEach(([relativePath, importInfo]) => {
      const resolvedPath = importInfo.path;
      const finalName = finalNames.get(resolvedPath);
      if (finalName) {
        importPathMapping.set(relativePath, finalName);
      }
    });

    // Create extraFiles entries
    finalNames.forEach((finalName, resolvedPath) => {
      const fileUrl = resolvedPath.startsWith('http') ? resolvedPath : `file://${resolvedPath}`;
      extraFiles[`./${finalName}`] = fileUrl;
    });

    return {
      processedSource: rewriteCssImports(source, importPathMapping),
      extraFiles,
    };
  }

  if (storeAt === 'import') {
    // Create a mapping for import mode: remove ./ prefix from relative paths
    const importModeMapping = new Map<string, string>();
    Object.keys(importResult).forEach((relativePath) => {
      if (relativePath.startsWith('./')) {
        importModeMapping.set(relativePath, relativePath.slice(2));
      }
      // Keep other paths (../, absolute URLs) unchanged
    });

    // Process each import for extraFiles
    Object.entries(importResult).forEach(([relativePath, importInfo]) => {
      const resolvedPath = importInfo.path;
      const fileUrl = resolvedPath.startsWith('http') ? resolvedPath : `file://${resolvedPath}`;
      extraFiles[relativePath] = fileUrl; // Always use original path for extraFiles
    });

    return {
      processedSource: rewriteCssImports(source, importModeMapping),
      extraFiles,
    };
  }

  // Canonical mode - no rewriting needed
  Object.entries(importResult).forEach(([relativePath, importInfo]) => {
    const resolvedPath = importInfo.path;
    const fileUrl = resolvedPath.startsWith('http') ? resolvedPath : `file://${resolvedPath}`;
    extraFiles[relativePath] = fileUrl; // Use original import path
  });

  return {
    processedSource: source, // No rewriting needed for canonical mode
    extraFiles,
  };
}

/**
 * Processes JavaScript imports with complex conflict resolution and module handling
 */
function processJsImports(
  source: string,
  importResult: Record<string, { path: string; names: string[] }>,
  storeAt: StoreAtMode,
  resolvedPathsMap: Map<string, string>,
): ProcessImportsResult {
  const extraFiles: Record<string, string> = {};

  if (storeAt === 'flat') {
    const result = processFlatMode(importResult, resolvedPathsMap);

    // Build a reverse mapping from resolved paths to extraFiles keys
    const resolvedToExtraFile = new Map<string, string>();
    Object.entries(result.extraFiles).forEach(([extraFileKey, fileUrl]) => {
      const resolvedPath = fileUrl.replace('file://', '');
      resolvedToExtraFile.set(resolvedPath, extraFileKey);
    });

    // For each import, find its resolved path and map to the corresponding extraFile key
    const importPathMapping = new Map<string, string>();
    Object.entries(importResult).forEach(([relativePath, importInfo]) => {
      const resolvedPath = resolvedPathsMap.get(importInfo.path);
      if (resolvedPath) {
        const extraFileKey = resolvedToExtraFile.get(resolvedPath);
        if (extraFileKey) {
          // For JavaScript modules, remove the extension; for other files (CSS, JSON, etc.), keep it
          const isJavascriptModule = isJavaScriptModule(relativePath);
          let newPath = extraFileKey;

          if (isJavascriptModule) {
            // Handle TypeScript declaration files (.d.ts) properly
            if (newPath.endsWith('.d.ts')) {
              newPath = newPath.replace(/\.d\.ts$/, '');
            } else {
              newPath = newPath.replace(/\.[^/.]+$/, '');
            }
          }
          // For non-JS modules (CSS, JSON, etc.), keep the full path with extension

          importPathMapping.set(relativePath, newPath);
        }
      }
    });

    return {
      processedSource: rewriteJsImports(source, importPathMapping),
      extraFiles: result.extraFiles,
    };
  }

  // Non-flat modes (canonical and import)
  Object.entries(importResult).forEach(([relativePath, importInfo]) => {
    const resolved = resolvedPathsMap.get(importInfo.path);
    if (!resolved) {
      return;
    }

    const resolvedPath = resolved;
    const fileExtension = getFileNameFromUrl(resolvedPath).extension;
    const isJavascriptModule = isJavaScriptModule(relativePath);

    let keyPath: string;
    if (!isJavascriptModule) {
      // For static assets (CSS, JSON, etc.), use the original import path as-is
      keyPath = relativePath;
    } else {
      // For JS/TS modules, apply the existing logic
      switch (storeAt) {
        case 'canonical':
          // Show the full resolved path including index files when they exist
          keyPath = `${relativePath}${resolvedPath.endsWith(`/index${fileExtension}`) ? `/index${fileExtension}` : fileExtension}`;
          break;
        case 'import':
          // Use the original import path with the actual file extension
          keyPath = `${relativePath}${fileExtension}`;
          break;
        default:
          keyPath = `${relativePath}${fileExtension}`;
      }
    }

    const fileUrl = resolvedPath.startsWith('http') ? resolvedPath : `file://${resolvedPath}`;
    extraFiles[keyPath] = fileUrl;
  });

  return {
    processedSource: source, // No rewriting needed for non-flat modes
    extraFiles,
  };
}

/**
 * Processes imports based on the specified storage mode, automatically handling
 * source rewriting when needed (e.g., for 'flat' mode). Works for both JavaScript and simple file types.
 *
 * @param source - The original source code
 * @param importResult - The result from parseImports
 * @param storeAt - How to process the imports
 * @param isJsFile - Whether this is a JavaScript file (false = basic processing for CSS/JSON/etc.)
 * @param resolvedPathsMap - Map from import paths to resolved file paths (only needed for JavaScript files)
 * @returns Object with processed source and extraFiles mapping
 */
export function processRelativeImports(
  source: string,
  importResult: Record<string, { path: string; names: string[] }>,
  storeAt: StoreAtMode,
  isJsFile: boolean = false,
  resolvedPathsMap?: Map<string, string>,
): ProcessImportsResult {
  if (!isJsFile) {
    // Use basic processing mode for CSS, JSON, and other simple file types
    return processBasicImports(source, importResult, storeAt);
  }

  // Use complex JavaScript processing mode
  if (!resolvedPathsMap) {
    throw new Error('resolvedPathsMap is required for JavaScript files');
  }

  return processJsImports(source, importResult, storeAt, resolvedPathsMap);
}
