/**
 * Shared path utilities for CodeHighlighter components
 */

/**
 * Resolves a relative path by handling .. and . segments properly
 * This mimics path.resolve() behavior for relative paths
 */
export function resolveRelativePath(relativePath: string): {
  resolvedPath: string;
  backSteps: number;
} {
  // Split the path into segments
  const segments = relativePath.split('/');
  const resolved: string[] = [];
  let backSteps = 0;

  for (const segment of segments) {
    if (segment === '' || segment === '.') {
      // Skip empty and current directory segments
      continue;
    } else if (segment === '..') {
      if (resolved.length > 0) {
        // Remove the last segment (go back one directory)
        resolved.pop();
      } else {
        // Count back steps that go beyond the current directory
        backSteps += 1;
      }
    } else {
      // Regular directory or file segment
      resolved.push(segment);
    }
  }

  return {
    resolvedPath: resolved.join('/'),
    backSteps,
  };
}

/**
 * Counts only consecutive '../' patterns at the beginning of a path
 */
export function countConsecutiveBackNavigation(path: string): number {
  const match = path.match(/^(\.\.\/)+/);
  return match ? match[0].split('../').length - 1 : 0;
}
