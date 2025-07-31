/**
 * Flatten variant utility to convert a VariantCode into a flat files list
 * Handles relative path resolution and metadata file scoping
 */

import type { VariantCode, VariantSource } from '../CodeHighlighter/types';
import { stringOrHastToString } from '../hastUtils';
import { getFileNameFromUrl } from '../loaderUtils/getFileNameFromUrl';
import { createPathContext, type PathContext } from './examineVariant';

export interface FlatFile {
  source: string;
  metadata?: boolean;
}

export interface FlattenedFiles {
  [filePath: string]: FlatFile;
}

interface ProcessedMainFile {
  path: string;
  hasDirectory: boolean;
}

/**
 * Resolve a relative path from a base URL to get the target directory structure
 */
function resolveRelativePath(baseUrl: string, relativePath: string): string {
  const url = new URL(baseUrl);
  const pathSegments = url.pathname.split('/').filter(Boolean);
  pathSegments.pop(); // Remove filename to get directory

  const relativeSegments = relativePath.split('/');
  for (const segment of relativeSegments) {
    if (segment === '..') {
      pathSegments.pop();
    } else if (segment !== '.' && segment !== '') {
      pathSegments.push(segment);
    }
  }

  return pathSegments.join('/');
}

/**
 * Process the main file and determine its final path
 */
function processMainFile(variant: VariantCode, context: PathContext): ProcessedMainFile | null {
  let effectiveFileName = variant.fileName;

  // If fileName is missing but we have a URL, derive it from the URL
  if (!effectiveFileName && context.hasUrl) {
    const { fileName } = getFileNameFromUrl(context.actualUrl);
    effectiveFileName = fileName;
  }

  if (!effectiveFileName || variant.source === undefined) {
    return null;
  }

  let mainFilePath: string;

  if (context.hasUrl && context.maxBackNavigation > 0) {
    // URL with back navigation - calculate relative path from root level
    // TypeScript knows context.actualUrl is defined when context.hasUrl is true
    const urlObj = new URL(context.actualUrl);
    const fullPath = urlObj.pathname.substring(1); // Remove leading slash
    const relativePath = context.rootLevel
      ? fullPath.substring(context.rootLevel.length)
      : fullPath;
    mainFilePath = relativePath.replace(/\/[^/]+$/, `/${effectiveFileName}`);
  } else if (context.hasUrl && variant.extraFiles && Object.keys(variant.extraFiles).length > 0) {
    // URL with extra files but no back navigation
    if (context.hasMetadata) {
      // For metadata cases, preserve the full directory structure
      mainFilePath =
        context.urlDirectory.length > 0
          ? `${context.urlDirectory.join('/')}/${effectiveFileName}`
          : effectiveFileName;
    } else {
      // Check if all extra files are current directory references
      const allCurrentDir = Object.keys(variant.extraFiles).every(
        (path) => path.startsWith('./') || (!path.startsWith('../') && !path.startsWith('.')),
      );

      if (allCurrentDir) {
        // For current directory references without metadata, flatten to root
        mainFilePath = effectiveFileName;
      } else {
        // Use just the immediate parent directory
        const lastSegment = context.urlDirectory[context.urlDirectory.length - 1];
        mainFilePath = lastSegment ? `${lastSegment}/${effectiveFileName}` : effectiveFileName;
      }
    }
  } else {
    // Simple case - just use the filename
    mainFilePath = effectiveFileName;
  }

  // Add src/ prefix if we have metadata
  if (context.hasMetadata) {
    // When there are metadata files, simplify the main file path
    if (context.hasUrl && !context.maxBackNavigation) {
      // No back navigation - just use the filename
      mainFilePath = effectiveFileName;
    }
    mainFilePath = `src/${mainFilePath}`;
  }

  return {
    path: mainFilePath,
    hasDirectory: mainFilePath.includes('/'),
  };
}

/**
 * Process metadata files to determine their final paths
 */
function processMetadataFile(relativePath: string): string {
  // Extract everything after the back navigation, preserving directory structure
  return relativePath.replace(/^(\.\.\/)+/, '');
}

/**
 * Process extra file paths to determine their final paths
 */
function processExtraFilePath(
  relativePath: string,
  context: PathContext,
  mainFile: ProcessedMainFile | null,
): string {
  if (relativePath.startsWith('./')) {
    // Current directory reference - just remove the ./
    return relativePath.substring(2);
  }

  if (relativePath.startsWith('../')) {
    // Back navigation - resolve relative to URL or create synthetic paths
    if (context.hasUrl) {
      // TypeScript knows context.actualUrl is defined when context.hasUrl is true
      const resolved = resolveRelativePath(context.actualUrl, relativePath);

      if (context.rootLevel) {
        const rootLevelClean = context.rootLevel.replace(/\/$/, '');
        if (resolved.startsWith(`${rootLevelClean}/`)) {
          return resolved.substring(rootLevelClean.length + 1);
        }
        if (resolved === rootLevelClean) {
          return relativePath.split('/').pop() || relativePath;
        }
        return resolved;
      }
      return resolved;
    }

    // Fallback: if somehow we don't have a URL (shouldn't happen anymore with synthetic URLs)
    return relativePath.split('/').pop() || relativePath;
  }

  // Regular relative path (like 'dir/utils.ts')
  if (context.hasUrl && !context.hasMetadata && mainFile?.hasDirectory) {
    // Place relative to main file's directory if it has one
    const lastSegment = context.urlDirectory[context.urlDirectory.length - 1];
    return lastSegment ? `${lastSegment}/${relativePath}` : relativePath;
  }

  return relativePath;
}

/**
 * Process an extra file to determine its final path
 */
function processExtraFile(
  relativePath: string,
  file: { source?: VariantSource; metadata?: boolean },
  context: PathContext,
  mainFile: ProcessedMainFile | null,
): string {
  let finalPath: string;

  if (file.metadata) {
    finalPath = processMetadataFile(relativePath);
  } else {
    finalPath = processExtraFilePath(relativePath, context, mainFile);

    // Add src/ prefix if we have metadata (all paths are relative to main file)
    if (context.hasMetadata) {
      finalPath = `src/${finalPath}`;
    }
  }

  return finalPath;
}

/**
 * Flatten a VariantCode into a flat files structure
 * Resolves relative paths and handles metadata file scoping
 */
export function flattenVariant(variant: VariantCode): FlattenedFiles {
  const result: FlattenedFiles = {};
  const context = createPathContext(variant);

  // Process main file
  const mainFile = processMainFile(variant, context);
  if (mainFile && variant.source !== undefined) {
    result[mainFile.path] = {
      source: stringOrHastToString(variant.source),
    };
  }

  // Process extra files
  if (variant.extraFiles) {
    for (const [relativePath, fileContent] of Object.entries(variant.extraFiles)) {
      const file = typeof fileContent === 'string' ? { source: fileContent } : fileContent;

      // Skip files with no source content
      if (!file.source && file.source !== '') {
        continue;
      }

      const finalPath = processExtraFile(relativePath, file, context, mainFile);
      result[finalPath] = {
        source: stringOrHastToString(file.source || ''),
        ...(file.metadata && { metadata: file.metadata }),
      };
    }
  }

  return result;
}
