import { describe, it, expect } from 'vitest';
import { rewriteImports } from './rewriteImports.js';

describe('rewriteImports', () => {
  describe('basic functionality', () => {
    it('should rewrite a single import path', () => {
      const source = `import { foo } from './bar';`;
      const importPathMapping = new Map([['./bar', './new-bar']]);
      const importResult = {
        './bar': {
          positions: [{ start: 20, end: 27 }], // Position of "'./bar'"
        },
      };

      const result = rewriteImports(source, importPathMapping, importResult);
      expect(result).toBe(`import { foo } from './new-bar';`);
    });

    it('should rewrite multiple import paths', () => {
      const source = `import { foo } from './bar';
import { baz } from './qux';`;
      const importPathMapping = new Map([
        ['./bar', './new-bar'],
        ['./qux', './new-qux'],
      ]);
      const importResult = {
        './bar': {
          positions: [{ start: 20, end: 27 }], // Position of "'./bar'"
        },
        './qux': {
          positions: [{ start: 49, end: 56 }], // Position of "'./qux'"
        },
      };

      const result = rewriteImports(source, importPathMapping, importResult);
      expect(result).toBe(`import { foo } from './new-bar';
import { baz } from './new-qux';`);
    });

    it('should handle imports not in the mapping', () => {
      const source = `import { foo } from './bar';
import { baz } from './unchanged';`;
      const importPathMapping = new Map([['./bar', './new-bar']]);
      const importResult = {
        './bar': {
          positions: [{ start: 20, end: 27 }],
        },
        './unchanged': {
          positions: [{ start: 49, end: 62 }],
        },
      };

      const result = rewriteImports(source, importPathMapping, importResult);
      expect(result).toBe(`import { foo } from './new-bar';
import { baz } from './unchanged';`);
    });
  });

  describe('different length replacements', () => {
    it('should handle shorter replacement strings', () => {
      const source = `import { foo } from './very-long-path';
import { bar } from './short';`;
      const importPathMapping = new Map([
        ['./very-long-path', './x'],
        ['./short', './new-short'],
      ]);
      const importResult = {
        './very-long-path': {
          positions: [{ start: 20, end: 38 }], // Position of "'./very-long-path'"
        },
        './short': {
          positions: [{ start: 60, end: 69 }], // Position of "'./short'"
        },
      };

      const result = rewriteImports(source, importPathMapping, importResult);
      expect(result).toBe(`import { foo } from './x';
import { bar } from './new-short';`);
    });

    it('should handle longer replacement strings', () => {
      const source = `import { foo } from './x';
import { bar } from './y';`;
      const importPathMapping = new Map([
        ['./x', './very-long-replacement-path'],
        ['./y', './another-long-path'],
      ]);
      const importResult = {
        './x': {
          positions: [{ start: 20, end: 25 }], // Position of "'./x'"
        },
        './y': {
          positions: [{ start: 47, end: 52 }], // Position of "'./y'"
        },
      };

      const result = rewriteImports(source, importPathMapping, importResult);
      expect(result).toBe(`import { foo } from './very-long-replacement-path';
import { bar } from './another-long-path';`);
    });

    it('should handle mixed length changes', () => {
      const source = `import { a } from './long-path-name';
import { b } from './x';
import { c } from './medium-path';`;
      const importPathMapping = new Map([
        ['./long-path-name', './short'], // Shorter
        ['./x', './extremely-long-replacement-path'], // Much longer
        ['./medium-path', './new-medium'], // Similar length
      ]);
      const importResult = {
        './long-path-name': {
          positions: [{ start: 18, end: 36 }],
        },
        './x': {
          positions: [{ start: 56, end: 61 }],
        },
        './medium-path': {
          positions: [{ start: 81, end: 96 }],
        },
      };

      const result = rewriteImports(source, importPathMapping, importResult);
      expect(result).toBe(`import { a } from './short';
import { b } from './extremely-long-replacement-path';
import { c } from './new-medium';`);
    });
  });

  describe('quote preservation', () => {
    it('should preserve single quotes', () => {
      const source = `import { foo } from './bar';`;
      const importPathMapping = new Map([['./bar', './new-bar']]);
      const importResult = {
        './bar': {
          positions: [{ start: 20, end: 27 }],
        },
      };

      const result = rewriteImports(source, importPathMapping, importResult);
      expect(result).toBe(`import { foo } from './new-bar';`);
    });

    it('should preserve double quotes', () => {
      const source = `import { foo } from "./bar";`;
      const importPathMapping = new Map([['./bar', './new-bar']]);
      const importResult = {
        './bar': {
          positions: [{ start: 20, end: 27 }],
        },
      };

      const result = rewriteImports(source, importPathMapping, importResult);
      expect(result).toBe(`import { foo } from "./new-bar";`);
    });

    it('should handle mixed quote styles', () => {
      const source = `import { foo } from './bar';
import { baz } from "./qux";`;
      const importPathMapping = new Map([
        ['./bar', './new-bar'],
        ['./qux', './new-qux'],
      ]);
      const importResult = {
        './bar': {
          positions: [{ start: 20, end: 27 }],
        },
        './qux': {
          positions: [{ start: 49, end: 56 }],
        },
      };

      const result = rewriteImports(source, importPathMapping, importResult);
      expect(result).toBe(`import { foo } from './new-bar';
import { baz } from "./new-qux";`);
    });
  });

  describe('multiple occurrences', () => {
    it('should handle same import path appearing multiple times', () => {
      const source = `import { foo } from './shared';
import { bar } from './shared';
const dynamicImport = import('./shared');`;
      const importPathMapping = new Map([['./shared', './new-shared']]);
      const importResult = {
        './shared': {
          positions: [
            { start: 20, end: 30 }, // First import
            { start: 52, end: 62 }, // Second import
            { start: 93, end: 103 }, // Dynamic import
          ],
        },
      };

      const result = rewriteImports(source, importPathMapping, importResult);
      expect(result).toBe(`import { foo } from './new-shared';
import { bar } from './new-shared';
const dynamicImport = import('./new-shared');`);
    });

    it('should handle multiple occurrences with different length replacements', () => {
      const source = `import './css-file';
import './css-file';
const url = './css-file';`;
      const importPathMapping = new Map([['./css-file', './styles/very-long-css-filename']]);
      const importResult = {
        './css-file': {
          positions: [
            { start: 7, end: 19 }, // First import
            { start: 28, end: 40 }, // Second import
            { start: 54, end: 66 }, // String literal
          ],
        },
      };

      const result = rewriteImports(source, importPathMapping, importResult);
      expect(result).toBe(`import './styles/very-long-css-filename';
import './styles/very-long-css-filename';
const url = './styles/very-long-css-filename';`);
    });
  });

  describe('CSS imports', () => {
    it('should handle CSS import syntax', () => {
      const source = `@import './styles.css';
@import url('./theme.css');`;
      const importPathMapping = new Map([
        ['./styles.css', './new-styles.css'],
        ['./theme.css', './new-theme.css'],
      ]);
      const importResult = {
        './styles.css': {
          positions: [{ start: 8, end: 22 }],
        },
        './theme.css': {
          positions: [{ start: 36, end: 49 }],
        },
      };

      const result = rewriteImports(source, importPathMapping, importResult);
      expect(result).toBe(`@import './new-styles.css';
@import url('./new-theme.css');`);
    });
  });

  describe('edge cases', () => {
    it('should handle empty source', () => {
      const source = '';
      const importPathMapping = new Map();
      const importResult = {};

      const result = rewriteImports(source, importPathMapping, importResult);
      expect(result).toBe('');
    });

    it('should handle empty mappings', () => {
      const source = `import { foo } from './bar';`;
      const importPathMapping = new Map();
      const importResult = {
        './bar': {
          positions: [{ start: 20, end: 27 }],
        },
      };

      const result = rewriteImports(source, importPathMapping, importResult);
      expect(result).toBe(`import { foo } from './bar';`);
    });

    it('should handle missing position data', () => {
      const source = `import { foo } from './bar';`;
      const importPathMapping = new Map([['./bar', './new-bar']]);
      const importResult = {}; // No position data

      const result = rewriteImports(source, importPathMapping, importResult);
      expect(result).toBe(`import { foo } from './bar';`); // Unchanged
    });

    it('should handle invalid position bounds', () => {
      const source = `import { foo } from './bar';`;
      const importPathMapping = new Map([['./bar', './new-bar']]);
      const importResult = {
        './bar': {
          positions: [
            { start: -1, end: 5 }, // Invalid start
            { start: 5, end: 1000 }, // Invalid end
            { start: 10, end: 5 }, // Start > end
          ],
        },
      };

      const result = rewriteImports(source, importPathMapping, importResult);
      expect(result).toBe(`import { foo } from './bar';`); // Unchanged due to invalid positions
    });

    it('should handle empty positions array', () => {
      const source = `import { foo } from './bar';`;
      const importPathMapping = new Map([['./bar', './new-bar']]);
      const importResult = {
        './bar': {
          positions: [], // Empty array
        },
      };

      const result = rewriteImports(source, importPathMapping, importResult);
      expect(result).toBe(`import { foo } from './bar';`); // Unchanged
    });

    it('should handle position with empty text', () => {
      const source = `import { foo } from './bar';`;
      const importPathMapping = new Map([['./bar', './new-bar']]);
      const importResult = {
        './bar': {
          positions: [{ start: 20, end: 20 }], // Zero-length position
        },
      };

      const result = rewriteImports(source, importPathMapping, importResult);
      expect(result).toBe(`import { foo } from './bar';`); // Unchanged due to zero-length position
    });
  });

  describe('complex scenarios', () => {
    it('should handle a realistic file with multiple import types', () => {
      const source = `import React from 'react';
import { Component } from './components/Component';
import './styles.css';
import type { Props } from './types/Props';
const LazyComponent = React.lazy(() => import('./components/LazyComponent'));
export { default as Utils } from './utils/index';`;

      const importPathMapping = new Map([
        ['./components/Component', '@/components/Component'],
        ['./styles.css', '@/styles/main.css'],
        ['./types/Props', '@/types/Props'],
        ['./components/LazyComponent', '@/components/LazyComponent'],
        ['./utils/index', '@/utils'],
      ]);

      const importResult = {
        './components/Component': {
          positions: [{ start: 53, end: 77 }],
        },
        './styles.css': {
          positions: [{ start: 86, end: 100 }],
        },
        './types/Props': {
          positions: [{ start: 129, end: 144 }],
        },
        './components/LazyComponent': {
          positions: [{ start: 192, end: 220 }],
        },
        './utils/index': {
          positions: [{ start: 257, end: 272 }],
        },
      };

      const result = rewriteImports(source, importPathMapping, importResult);
      expect(result).toBe(`import React from 'react';
import { Component } from '@/components/Component';
import '@/styles/main.css';
import type { Props } from '@/types/Props';
const LazyComponent = React.lazy(() => import('@/components/LazyComponent'));
export { default as Utils } from '@/utils';`);
    });

    it('should handle overlapping position scenarios gracefully', () => {
      // This tests the right-to-left replacement strategy
      const source = `import a from './path1'; import b from './path2'; import c from './path3';`;
      const importPathMapping = new Map([
        ['./path1', './very-long-new-path1'],
        ['./path2', './x'],
        ['./path3', './medium-path3'],
      ]);
      const importResult = {
        './path1': {
          positions: [{ start: 14, end: 23 }],
        },
        './path2': {
          positions: [{ start: 39, end: 48 }],
        },
        './path3': {
          positions: [{ start: 64, end: 73 }],
        },
      };

      const result = rewriteImports(source, importPathMapping, importResult);
      expect(result).toBe(
        `import a from './very-long-new-path1'; import b from './x'; import c from './medium-path3';`,
      );
    });

    it('should demonstrate right-to-left replacement prevents position corruption', () => {
      // This test specifically verifies that when the first import is replaced with
      // a much longer string, it doesn't affect the replacement of subsequent imports
      // because replacements are applied from right to left (highest position first)
      const source = `import './a'; import './b'; import './c';`;
      const importPathMapping = new Map([
        ['./a', './this-is-a-very-very-very-long-replacement-path'],
        ['./b', './short'],
        ['./c', './medium-length-path'],
      ]);
      const importResult = {
        './a': {
          positions: [{ start: 7, end: 12 }], // Position of "'./a'"
        },
        './b': {
          positions: [{ start: 21, end: 26 }], // Position of "'./b'"
        },
        './c': {
          positions: [{ start: 35, end: 40 }], // Position of "'./c'"
        },
      };

      const result = rewriteImports(source, importPathMapping, importResult);
      expect(result).toBe(
        `import './this-is-a-very-very-very-long-replacement-path'; import './short'; import './medium-length-path';`,
      );
    });
  });
});
