import * as React from 'react';

export const PLACEHOLDER = 'Filter files (e.g., src/, *.js, !node_modules, !*.test.js)';

interface FileWithPath {
  filePath: string;
}

interface Pattern {
  pattern: string | RegExp;
  negative: boolean;
}

export function useFileFilter(filterQuery: string) {
  const patterns = React.useMemo(() => {
    if (!filterQuery.trim()) {
      return [];
    }

    return filterQuery
      .split(',')
      .map((pattern) => pattern.trim())
      .filter((pattern) => pattern.length > 0)
      .map((pattern): Pattern => {
        const negative = pattern.startsWith('!');
        const cleanPattern = negative ? pattern.slice(1) : pattern;

        if (cleanPattern.includes('*')) {
          // Create regex for wildcard patterns
          const regexPattern = cleanPattern.replace(/[.+?^${}()|[\]\\*]/g, (char) =>
            char === '*' ? '.*' : `\\${char}`,
          );
          return {
            pattern: new RegExp(`^${regexPattern}$`, 'i'),
            negative,
          };
        }

        // String pattern for includes
        return {
          pattern: cleanPattern.toLowerCase(),
          negative,
        };
      });
  }, [filterQuery]);

  return React.useMemo(() => {
    if (patterns.length === 0) {
      return () => true;
    }

    return (file: FileWithPath) => {
      const filePath = file.filePath.toLowerCase();
      let matches = false;

      // Test patterns in order, allowing later patterns to override earlier ones
      for (const pattern of patterns) {
        let patternMatches = false;

        if (typeof pattern.pattern === 'string') {
          patternMatches = filePath.includes(pattern.pattern);
        } else {
          patternMatches = pattern.pattern.test(file.filePath);
        }

        if (patternMatches) {
          matches = !pattern.negative;
        }
      }

      return matches;
    };
  }, [patterns]);
}
