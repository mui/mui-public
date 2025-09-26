import * as React from 'react';

export const PLACEHOLDER = 'Filter files (e.g., package.json, *.ts)';

function createPattern(pattern: string): string | RegExp {
  if (pattern.includes('*/')) {
    const regexPattern = pattern.replace(/[.+?^${}()|[\]\\*]/g, (char) =>
      char === '*' ? '.*' : `\\${char}`,
    );
    return new RegExp(`^${regexPattern}$`);
  }
  return pattern;
}

/**
 * Hook to create a file filter function based on glob-like patterns.
 *
 * Supports:
 * - Exact matches: package.json
 * - Wildcards: *.ts, **\/test/**
 */
export function useFileFilter(includeFilter: string, excludeFilter: string) {
  return React.useMemo(() => {
    const includePatterns = includeFilter
      .split(',')
      .map((p) => createPattern(p.trim()))
      .filter(Boolean);

    const excludePatterns = excludeFilter
      .split(',')
      .map((p) => createPattern(p.trim()))
      .filter(Boolean);

    return (filePath: string) => {
      // Check exclusions first
      if (excludePatterns.length > 0) {
        for (const pattern of excludePatterns) {
          if (matchesPattern(filePath, pattern)) {
            return false;
          }
        }
      }

      // If no include patterns, include everything (except excluded)
      if (includePatterns.length === 0) {
        return true;
      }

      // Check includes
      for (const pattern of includePatterns) {
        if (matchesPattern(filePath, pattern)) {
          return true;
        }
      }

      return false;
    };
  }, [includeFilter, excludeFilter]);
}

function matchesPattern(filePath: string, pattern: string | RegExp): boolean {
  if (typeof pattern === 'string') {
    return filePath.includes(pattern);
  }
  return pattern.test(filePath);
}
