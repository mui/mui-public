import { createSyntheticDirectories, buildPath } from './pathUtils';

export function calculateMainFilePath(
  url: string,
  maxBackNav: number,
  maxSourceBackNav?: number,
  metadataPrefix?: string,
  fileName?: string,
): string {
  // Handle optional parameters with defaults
  const actualMaxSourceBackNav = maxSourceBackNav ?? maxBackNav;
  const actualMetadataPrefix = metadataPrefix ?? '';

  // Handle empty URL
  if (!url) {
    return '';
  }

  // Extract URL parts and filename
  let urlSegments: string[];
  let filename: string;
  let hasTrailingSlash = false;

  try {
    // Try to parse as URL first
    const urlObj = new URL(url);
    hasTrailingSlash = urlObj.pathname.endsWith('/');
    const pathSegments = urlObj.pathname.split('/').filter(Boolean);

    let baseFilename: string;
    if (hasTrailingSlash) {
      // If URL ends with /, there's no filename - all segments are path segments
      baseFilename = '';
      urlSegments = pathSegments;
    } else {
      // Normal case - last segment is the filename
      baseFilename = pathSegments.pop() || '';
      urlSegments = pathSegments;
    }

    // Use provided fileName or preserve query and hash from URL
    if (fileName !== undefined) {
      filename = fileName;
    } else {
      filename = baseFilename + urlObj.search + urlObj.hash;
      if (hasTrailingSlash && !baseFilename) {
        filename = `${filename}/`;
      }
    }
  } catch {
    // Fallback to simple string parsing for relative paths
    hasTrailingSlash = url.endsWith('/');
    const urlParts = url.split('/');

    let baseFilename: string;
    if (hasTrailingSlash) {
      // If URL ends with /, there's no filename - all segments are path segments
      baseFilename = urlParts.pop() || ''; // Remove the empty string after trailing slash
      urlSegments = urlParts.filter((part) => part !== ''); // Remove empty segments
    } else {
      // Normal case - last segment is the filename
      baseFilename = urlParts.pop() || '';
      urlSegments = urlParts.filter((part) => part !== ''); // Remove empty segments
    }

    // Use provided fileName or fallback to extracted baseFilename
    if (fileName !== undefined) {
      filename = fileName;
    } else {
      filename = baseFilename;
      if (hasTrailingSlash && !baseFilename) {
        filename = `${filename}/`;
      }
    }
  }

  // Work with a copy of URL segments to avoid mutations
  const remainingUrlSegments = [...urlSegments];

  // Take actualMaxSourceBackNav items from the end for sourcePath
  const sourcePath = remainingUrlSegments.splice(-actualMaxSourceBackNav, actualMaxSourceBackNav);

  // Calculate unhandledBackNav, accounting for missing sourcePath segments
  let unhandledBackNav = maxBackNav - actualMaxSourceBackNav;

  // Add any missing sourcePath segments to unhandledBackNav
  const missingSourcePathSegments = actualMaxSourceBackNav - sourcePath.length;
  unhandledBackNav += missingSourcePathSegments;

  // Split actualMetadataPrefix and subtract that count from unhandledBackNav
  const metadataPrefixSegments = actualMetadataPrefix.split('/').filter((part) => part !== '');
  unhandledBackNav -= metadataPrefixSegments.length;

  // Calculate metadataPath from remaining URL segments (what's left after sourcePath)
  const metadataSegmentsNeeded = Math.max(0, unhandledBackNav);
  const metadataSegmentsAvailable = Math.min(metadataSegmentsNeeded, remainingUrlSegments.length);

  const metadataPath = remainingUrlSegments.splice(
    -metadataSegmentsAvailable,
    metadataSegmentsAvailable,
  );

  // Update unhandledBackNav with segments we couldn't fulfill from URL
  unhandledBackNav = metadataSegmentsNeeded - metadataSegmentsAvailable;

  // Create synthetic directories for any remaining unhandledBackNav
  const syntheticDirs = createSyntheticDirectories(unhandledBackNav);

  // Combine all parts to create the final path using buildPath utility
  // Order: [synthetic directories] + [metadataPath] + [metadataPrefix] + [sourcePath] + [filename]
  const path = buildPath(syntheticDirs, metadataPath, metadataPrefixSegments, sourcePath, filename);

  // Return as file:// URL unless the result is empty
  return path ? `file:///${path}` : path;
}
