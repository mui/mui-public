import { describe, it, expect } from 'vitest';
import { codeToFallbackProps } from './codeToFallbackProps';
import type { Code } from './types';

describe('codeToFallbackProps', () => {
  describe('basic functionality', () => {
    it('should return empty object for missing or string variant', () => {
      expect(codeToFallbackProps('missing', {})).toEqual({});
      expect(codeToFallbackProps('string', { string: 'highlighted html' })).toEqual({});
    });

    it('should return basic props with source and fileNames', () => {
      const code: Code = {
        javascript: {
          fileName: 'App.js',
          source: 'const App = () => <div>Hello</div>;',
        },
      };

      const result = codeToFallbackProps('javascript', code);

      expect(result).toEqual({
        fileNames: ['App.js'],
        source: 'const App = () => <div>Hello</div>;',
        language: 'javascript',
      });
    });

    it('should handle variant without fileName', () => {
      const code: Code = {
        javascript: {
          fileName: undefined,
          source: 'const App = () => <div>Hello</div>;',
        },
      };

      const result = codeToFallbackProps('javascript', code);

      expect(result).toEqual({
        fileNames: [],
        source: 'const App = () => <div>Hello</div>;',
      });
    });
  });

  describe('extraSource behavior', () => {
    it('should not include main file in extraSource', () => {
      const code: Code = {
        javascript: {
          fileName: 'App.js',
          source: 'const App = () => <div>Hello</div>;',
          extraFiles: {
            'utils.js': {
              source: 'export const utils = {};',
            },
          },
        },
      };

      const result = codeToFallbackProps('javascript', code, undefined, true); // needsAllFiles=true

      expect(result.extraSource).toEqual({
        'utils.js': { source: 'export const utils = {};', language: 'javascript' },
      });
      expect(result.extraSource).not.toHaveProperty('App.js');
    });

    it('should exclude requested fileName from extraSource', () => {
      const code: Code = {
        javascript: {
          fileName: 'App.js',
          source: 'const App = () => <div>Hello</div>;',
          extraFiles: {
            'utils.js': {
              source: 'export const utils = {};',
            },
            'config.js': {
              source: 'export const config = {};',
            },
          },
        },
      };

      const result = codeToFallbackProps('javascript', code, 'utils.js', true); // needsAllFiles=true

      expect(result.extraSource).toEqual({
        'config.js': { source: 'export const config = {};', language: 'javascript' },
      });
      expect(result.extraSource).not.toHaveProperty('utils.js');
      expect(result.extraSource).not.toHaveProperty('App.js');
    });
  });

  describe('fileName parameter handling', () => {
    it('should return specific file source when fileName is provided', () => {
      const code: Code = {
        javascript: {
          fileName: 'App.js',
          source: 'const App = () => <div>Hello</div>;',
          extraFiles: {
            'utils.js': {
              source: 'export const utils = {};',
            },
          },
        },
      };

      const result = codeToFallbackProps('javascript', code, 'utils.js');

      expect(result).toEqual({
        fileNames: ['App.js', 'utils.js'],
        source: 'export const utils = {};',
        language: 'javascript',
      });
    });

    it('should return main source when fileName is not provided', () => {
      const code: Code = {
        javascript: {
          fileName: 'App.js',
          source: 'const App = () => <div>Hello</div>;',
          extraFiles: {
            'utils.js': {
              source: 'export const utils = {};',
            },
          },
        },
      };

      const result = codeToFallbackProps('javascript', code);

      expect(result).toEqual({
        fileNames: ['App.js', 'utils.js'],
        source: 'const App = () => <div>Hello</div>;',
        language: 'javascript',
      });
    });
  });

  describe('needsAllFiles handling', () => {
    it('should include extraSource when needsAllFiles=true', () => {
      const code: Code = {
        javascript: {
          fileName: 'App.js',
          source: 'const App = () => <div>Hello</div>;',
          extraFiles: {
            'utils.js': {
              source: 'export const utils = {};',
            },
          },
        },
      };

      const result = codeToFallbackProps('javascript', code, undefined, true);

      expect(result).toEqual({
        fileNames: ['App.js', 'utils.js'],
        source: 'const App = () => <div>Hello</div>;',
        language: 'javascript',
        extraSource: {
          'utils.js': { source: 'export const utils = {};', language: 'javascript' },
        },
      });
    });
  });

  describe('needsAllVariants handling', () => {
    it('should include extraVariants when needsAllVariants=true', () => {
      const code: Code = {
        javascript: {
          fileName: 'App.js',
          source: 'const App = () => <div>Hello JS</div>;',
          extraFiles: {
            'utils.js': {
              source: 'export const utils = {};',
            },
          },
        },
        typescript: {
          fileName: 'App.ts',
          source: 'const App = () => <div>Hello TS</div>;',
          extraFiles: {
            'utils.ts': {
              source: 'export const utils: any = {};',
            },
          },
        },
      };

      const result = codeToFallbackProps('javascript', code, undefined, false, true);

      expect(result).toEqual({
        fileNames: ['App.js', 'utils.js'],
        source: 'const App = () => <div>Hello JS</div>;',
        language: 'javascript',
        extraSource: {
          'utils.js': { source: 'export const utils = {};', language: 'javascript' },
        },
        extraVariants: {
          typescript: {
            fileNames: ['App.ts', 'utils.ts'],
            source: 'const App = () => <div>Hello TS</div>;',
            language: 'typescript',
            extraSource: {
              'utils.ts': { source: 'export const utils: any = {};', language: 'typescript' },
            },
          },
        },
      });
    });

    it('should not include main variant in extraVariants', () => {
      const code: Code = {
        javascript: {
          fileName: 'App.js',
          source: 'const App = () => <div>Hello JS</div>;',
        },
        typescript: {
          fileName: 'App.ts',
          source: 'const App = () => <div>Hello TS</div>;',
        },
      };

      const result = codeToFallbackProps('javascript', code, undefined, false, true);

      expect(result.extraVariants).toEqual({
        typescript: {
          fileNames: ['App.ts'],
          source: 'const App = () => <div>Hello TS</div>;',
          language: 'typescript',
          extraSource: {},
        },
      });
      expect(result.extraVariants).not.toHaveProperty('javascript');
    });
  });
});
