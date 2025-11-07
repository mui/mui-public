import { describe, it, expect } from 'vitest';
import { maybeCodeInitialData } from './maybeCodeInitialData';
import type { Code } from '../../CodeHighlighter/types';

describe('maybeCodeInitialData', () => {
  describe('fileName handling', () => {
    it('should use variant.source when fileName matches variantCode.fileName', () => {
      const code: Code = {
        javascript: {
          fileName: 'App.js',
          url: 'http://example.com/App.js',
          source: 'const App = () => <div>Hello</div>;',
          allFilesListed: true,
        },
      };

      const result = maybeCodeInitialData(
        ['javascript'],
        'javascript',
        code,
        'App.js', // fileName matches variantCode.fileName
        false, // needsHighlight
        false, // needsAllFiles
        false, // needsAllVariants
      );

      expect(result.initialData).not.toBe(false);
      if (result.initialData !== false) {
        expect(result.initialData.initialSource).toBe('const App = () => <div>Hello</div>;');
        expect(result.initialData.initialFilename).toBe('App.js');
      }
    });

    it('should use extraFiles when fileName does not match variantCode.fileName', () => {
      const code: Code = {
        javascript: {
          fileName: 'App.js',
          url: 'http://example.com/App.js',
          source: 'const App = () => <div>Hello</div>;',
          extraFiles: {
            'utils.js': {
              source: 'export const utils = {};',
            },
          },
          allFilesListed: true,
        },
      };

      const result = maybeCodeInitialData(
        ['javascript'],
        'javascript',
        code,
        'utils.js', // fileName is an extra file
        false, // needsHighlight
        false, // needsAllFiles
        false, // needsAllVariants
      );

      expect(result.initialData).not.toBe(false);
      if (result.initialData !== false) {
        expect(result.initialData.initialSource).toBe('export const utils = {};');
        expect(result.initialData.initialFilename).toBe('utils.js');
      }
    });

    it('should return false when requesting non-existent extra file', () => {
      const code: Code = {
        javascript: {
          fileName: 'App.js',
          url: 'http://example.com/App.js',
          source: 'const App = () => <div>Hello</div>;',
          extraFiles: {
            'utils.js': {
              source: 'export const utils = {};',
            },
          },
          allFilesListed: true,
        },
      };

      const result = maybeCodeInitialData(
        ['javascript'],
        'javascript',
        code,
        'nonexistent.js', // File doesn't exist in extraFiles
        false, // needsHighlight
        false, // needsAllFiles
        false, // needsAllVariants
      );

      expect(result.initialData).toBe(false);
      expect(result.reason).toBe('File not found in code');
    });

    it('should default to variant.source when no fileName is provided', () => {
      const code: Code = {
        javascript: {
          fileName: 'App.js',
          url: 'http://example.com/App.js',
          source: 'const App = () => <div>Hello</div>;',
          extraFiles: {
            'utils.js': {
              source: 'export const utils = {};',
            },
          },
          allFilesListed: true,
        },
      };

      const result = maybeCodeInitialData(
        ['javascript'],
        'javascript',
        code,
        undefined, // No fileName provided
        false, // needsHighlight
        false, // needsAllFiles
        false, // needsAllVariants
      );

      expect(result.initialData).not.toBe(false);
      if (result.initialData !== false) {
        expect(result.initialData.initialSource).toBe('const App = () => <div>Hello</div>;');
        expect(result.initialData.initialFilename).toBe('App.js');
      }
    });

    it('should handle variant with undefined fileName and url', () => {
      const code: Code = {
        javascript: {
          fileName: undefined, // No fileName
          url: undefined, // No URL
          source: 'const App = () => <div>Hello No Metadata</div>;',
          allFilesListed: true,
        },
      };

      const result = maybeCodeInitialData(
        ['javascript'],
        'javascript',
        code,
        undefined, // No specific fileName requested
        false, // needsHighlight
        false, // needsAllFiles
        false, // needsAllVariants
      );

      expect(result.initialData).not.toBe(false);
      if (result.initialData !== false) {
        expect(result.initialData.initialSource).toBe(
          'const App = () => <div>Hello No Metadata</div>;',
        );
        expect(result.initialData.initialFilename).toBeUndefined(); // Should be undefined when variant has no fileName
      }
    });

    it('should return false when requesting specific fileName but variant has undefined fileName and url', () => {
      const code: Code = {
        javascript: {
          fileName: undefined, // No fileName
          url: undefined, // No URL
          source: 'const App = () => <div>Hello No Metadata</div>;',
          allFilesListed: true,
        },
      };

      const result = maybeCodeInitialData(
        ['javascript'],
        'javascript',
        code,
        'App.js', // Requesting a specific fileName that doesn't exist
        false, // needsHighlight
        false, // needsAllFiles
        false, // needsAllVariants
      );

      expect(result.initialData).toBe(false);
      expect(result.reason).toBe('File not found in code');
    });
  });

  describe('needsAllVariants handling', () => {
    it('should return false when needsAllVariants=true but not all variants are loaded', () => {
      const code: Code = {
        javascript: {
          fileName: 'App.js',
          url: 'http://example.com/App.js',
          source: 'const App = () => <div>Hello</div>;',
          allFilesListed: true,
        },
        // typescript variant is missing
      };

      const result = maybeCodeInitialData(
        ['javascript', 'typescript'], // typescript is required but missing
        'javascript',
        code,
        undefined,
        false, // needsHighlight
        false, // needsAllFiles
        true, // needsAllVariants
      );

      expect(result.initialData).toBe(false);
      expect(result.reason).toBe('Not all variants are available');
    });

    it('should return true when needsAllVariants=true and all variants are loaded', () => {
      const code: Code = {
        javascript: {
          fileName: 'App.js',
          url: 'http://example.com/App.js',
          source: 'const App = () => <div>Hello</div>;',
          allFilesListed: true,
        },
        typescript: {
          fileName: 'App.ts',
          url: 'http://example.com/App.ts',
          source: 'const App = () => <div>Hello TypeScript</div>;',
          allFilesListed: true,
        },
      };

      const result = maybeCodeInitialData(
        ['javascript', 'typescript'],
        'javascript',
        code,
        undefined,
        false, // needsHighlight
        false, // needsAllFiles
        true, // needsAllVariants
      );

      expect(result.initialData).not.toBe(false);
      if (result.initialData !== false) {
        expect(result.initialData.initialSource).toBe('const App = () => <div>Hello</div>;');
        expect(result.initialData.initialFilename).toBe('App.js');
      }
    });

    it('should handle undefined fileName by using main file', () => {
      const code: Code = {
        javascript: {
          fileName: 'App.js',
          url: 'http://example.com/App.js',
          source: 'const App = () => <div>Hello</div>;',
          allFilesListed: true,
        },
      };

      const result = maybeCodeInitialData(
        ['javascript'],
        'javascript',
        code,
        undefined, // undefined fileName should use main file
        false, // needsHighlight
        false, // needsAllFiles
        false, // needsAllVariants
      );

      expect(result.initialData).not.toBe(false);
      if (result.initialData !== false) {
        expect(result.initialData.initialSource).toBe('const App = () => <div>Hello</div>;');
        expect(result.initialData.initialFilename).toBe('App.js');
      }
    });
  });
});
