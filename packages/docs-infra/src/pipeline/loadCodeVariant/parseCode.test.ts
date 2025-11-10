import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Root } from 'hast';
import type { Code, ParseSource } from '../../CodeHighlighter/types';
import { parseCode } from './parseCode';

// Mock parse function that returns proper HAST Root nodes
const mockParseSource: ParseSource = vi.fn(
  (_source: string, _fileName: string): Root => ({
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'pre',
        properties: {},
        children: [
          {
            type: 'text',
            value: _source,
          },
        ],
      },
    ],
  }),
);

const createMockHastRoot = (content: string): Root => ({
  type: 'root',
  children: [
    {
      type: 'element',
      tagName: 'pre',
      properties: {},
      children: [
        {
          type: 'text',
          value: content,
        },
      ],
    },
  ],
});

describe('parseCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle already parsed/highlighted string variants', () => {
    const code: Code = {
      Default: 'already-highlighted-html',
      TypeScript: 'another-highlighted-html',
    };

    const result = parseCode(code, mockParseSource);

    expect(result).toEqual({
      Default: 'already-highlighted-html',
      TypeScript: 'another-highlighted-html',
    });
    expect(mockParseSource).not.toHaveBeenCalled();
  });

  it('should parse string sources to HAST nodes', () => {
    const code: Code = {
      Default: {
        fileName: 'index.js',
        url: '/demo',
        source: 'console.log("hello");',
      },
    };

    const result = parseCode(code, mockParseSource);

    expect(mockParseSource).toHaveBeenCalledWith('console.log("hello");', 'index.js');
    expect(result.Default).toEqual({
      fileName: 'index.js',
      url: '/demo',
      source: expect.objectContaining({
        type: 'root',
        children: expect.any(Array),
      }),
      extraFiles: undefined,
    });
  });

  it('should handle parsing errors gracefully', () => {
    const mockParseSourceWithError = vi.fn((source: string, _fileName: string): Root => {
      if (source === 'invalid code') {
        throw new Error('Parse error');
      }
      return createMockHastRoot(source);
    }) as ParseSource;
    const code: Code = {
      Default: {
        fileName: 'index.js',
        url: '/demo',
        source: 'invalid code', // This will trigger the error
      },
    };

    const result = parseCode(code, mockParseSourceWithError);

    expect(result.Default).toEqual(code.Default);
  });

  it('should parse hastJson to HAST nodes', () => {
    const hastJson = JSON.stringify({
      type: 'root',
      children: [{ type: 'text', value: 'test' }],
    });

    const code: Code = {
      Default: {
        fileName: 'index.js',
        url: '/demo',
        source: { hastJson },
      },
    };

    const result = parseCode(code, mockParseSource);

    expect(result.Default).toEqual({
      fileName: 'index.js',
      url: '/demo',
      source: { type: 'root', children: [{ type: 'text', value: 'test' }] },
      extraFiles: undefined,
    });
    expect(mockParseSource).not.toHaveBeenCalled();
  });

  it('should handle invalid hastJson gracefully', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const code: Code = {
      Default: {
        fileName: 'index.js',
        url: '/demo',
        source: { hastJson: 'invalid json' },
      },
    };

    const result = parseCode(code, mockParseSource);

    expect(result.Default).toEqual(code.Default);
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to parse hastJson for variant Default:',
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });

  it('should parse extraFiles with string sources', () => {
    const code: Code = {
      Default: {
        fileName: 'index.js',
        url: '/demo',
        source: 'console.log("main");',
        extraFiles: {
          'utils.js': {
            source: 'export const util = () => {};',
            transforms: {},
          },
          'config.json': 'plain string file',
        },
      },
    };

    const result = parseCode(code, mockParseSource);

    expect(mockParseSource).toHaveBeenCalledWith('console.log("main");', 'index.js');
    expect(mockParseSource).toHaveBeenCalledWith('export const util = () => {};', 'utils.js');

    const defaultResult = result.Default as any;
    expect(defaultResult.extraFiles['utils.js']).toEqual({
      source: expect.objectContaining({
        type: 'root',
        children: expect.any(Array),
      }),
      transforms: {},
    });
    expect(defaultResult.extraFiles['config.json']).toBe('plain string file');
  });

  it('should handle extraFiles parsing errors gracefully', () => {
    const mockParseSourceWithError = vi.fn((source: string, fileName: string): Root => {
      if (fileName === 'error.js') {
        throw new Error('Parse error');
      }
      return createMockHastRoot(source);
    }) as ParseSource;

    const code: Code = {
      Default: {
        fileName: 'index.js',
        url: '/demo',
        source: 'console.log("main");',
        extraFiles: {
          'error.js': {
            source: 'invalid syntax',
            transforms: {},
          },
          'valid.js': {
            source: 'console.log("valid");',
          },
        },
      },
    };

    const result = parseCode(code, mockParseSourceWithError);

    const defaultResult = result.Default as any;
    expect(defaultResult.extraFiles['error.js']).toEqual({
      source: 'invalid syntax',
      transforms: {},
    });
    expect(defaultResult.extraFiles['valid.js']).toEqual({
      source: expect.objectContaining({
        type: 'root',
        children: expect.any(Array),
      }),
    });
  });

  it('should handle already parsed sources and extraFiles', () => {
    const hastNodes = createMockHastRoot('already parsed');

    const code: Code = {
      Default: {
        fileName: 'index.js',
        url: '/demo',
        source: hastNodes,
        extraFiles: {
          'parsed.js': {
            source: hastNodes,
            transforms: {},
          },
          'string.js': {
            source: 'to be parsed',
          },
        },
      },
    };

    const result = parseCode(code, mockParseSource);

    expect(mockParseSource).toHaveBeenCalledWith('to be parsed', 'string.js');
    expect(mockParseSource).not.toHaveBeenCalledWith('already parsed', expect.any(String));

    const defaultResult = result.Default as any;
    expect(defaultResult.source).toBe(hastNodes);
    expect(defaultResult.extraFiles['parsed.js'].source).toBe(hastNodes);
  });

  it('should handle mixed variant types', () => {
    const code: Code = {
      StringVariant: 'highlighted-html',
      ObjectVariant: {
        fileName: 'index.js',
        url: '/demo',
        source: 'console.log("test");',
      },
      UndefinedVariant: undefined,
    };

    const result = parseCode(code, mockParseSource);

    expect(result.StringVariant).toBe('highlighted-html');
    expect(result.ObjectVariant).toEqual({
      fileName: 'index.js',
      url: '/demo',
      source: expect.objectContaining({
        type: 'root',
        children: expect.any(Array),
      }),
      extraFiles: undefined,
    });
    expect(result.UndefinedVariant).toBeUndefined();
  });

  it('should handle empty extraFiles', () => {
    const code: Code = {
      Default: {
        fileName: 'index.js',
        url: '/demo',
        source: 'console.log("test");',
        extraFiles: {},
      },
    };

    const result = parseCode(code, mockParseSource);

    const defaultResult = result.Default as any;
    expect(defaultResult.extraFiles).toEqual({});
  });

  it('should preserve other properties during parsing', () => {
    const code: Code = {
      Default: {
        fileName: 'index.js',
        url: '/demo/test',
        source: 'console.log("test");',
        transforms: {
          someTransform: {
            delta: {
              0: ['old line', 'new line'],
            } as any,
            fileName: 'test.js',
          },
        },
        filesOrder: ['index.js', 'utils.js'],
        allFilesListed: true,
      },
    };

    const result = parseCode(code, mockParseSource);

    const defaultResult = result.Default as any;
    expect(defaultResult.fileName).toBe('index.js');
    expect(defaultResult.url).toBe('/demo/test');
    expect(defaultResult.transforms).toEqual({
      someTransform: {
        delta: {
          0: ['old line', 'new line'],
        },
        fileName: 'test.js',
      },
    });
    expect(defaultResult.filesOrder).toEqual(['index.js', 'utils.js']);
    expect(defaultResult.allFilesListed).toBe(true);
  });

  describe('Undefined filename handling', () => {
    it('should create basic HAST node for variant without filename', () => {
      const code: Code = {
        Default: {
          fileName: undefined, // undefined fileName
          url: '/demo/app',
          source: 'const App = () => <div>Hello</div>;',
        },
      };

      const result = parseCode(code, mockParseSource);

      // Should create a basic HAST root node with the source text
      expect(result.Default).toEqual({
        fileName: undefined,
        url: '/demo/app',
        source: {
          type: 'root',
          children: [
            {
              type: 'text',
              value: 'const App = () => <div>Hello</div>;',
            },
          ],
        },
      });

      // parseSource should not be called since there's no filename
      expect(mockParseSource).not.toHaveBeenCalled();
    });

    it('should parse variants that have filename and create basic HAST for those without', () => {
      const code: Code = {
        WithFilename: {
          fileName: 'App.js',
          url: '/demo/app-js',
          source: 'const App = () => <div>Hello JS</div>;',
        },
        WithoutFilename: {
          fileName: undefined, // undefined fileName
          url: '/demo/app-no-filename',
          source: 'const App = () => <div>Hello No Filename</div>;',
        },
      };

      const result = parseCode(code, mockParseSource);

      expect(result.WithFilename).toBeDefined();
      expect(result.WithoutFilename).toEqual({
        fileName: undefined,
        url: '/demo/app-no-filename',
        source: {
          type: 'root',
          children: [
            {
              type: 'text',
              value: 'const App = () => <div>Hello No Filename</div>;',
            },
          ],
        },
      });

      // Should only parse the variant with a filename
      expect(mockParseSource).toHaveBeenCalledTimes(1);
      expect(mockParseSource).toHaveBeenCalledWith(
        'const App = () => <div>Hello JS</div>;',
        'App.js',
      );
    });

    it('should handle missing fileName property (completely absent)', () => {
      const code: Code = {
        Default: {
          // No fileName property at all
          url: '/demo/app',
          source: 'const App = () => <div>No filename property</div>;',
        },
      };

      const result = parseCode(code, mockParseSource);

      // Should create a basic HAST root node when fileName is missing
      expect(result.Default).toEqual({
        url: '/demo/app',
        source: {
          type: 'root',
          children: [
            {
              type: 'text',
              value: 'const App = () => <div>No filename property</div>;',
            },
          ],
        },
      });

      // parseSource should not be called since there's no filename
      expect(mockParseSource).not.toHaveBeenCalled();
    });
  });
});
