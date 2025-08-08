import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Root } from 'hast';
import type { ControlledCode, ParseSource } from './types';
import { parseControlledCode } from './parseControlledCode';

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

const mockParseSource = vi.fn(
  (_source: string, _fileName: string): Root => createMockHastRoot(_source),
) as ParseSource;

describe('parseControlledCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should convert controlled code to regular code format', () => {
    const controlledCode: ControlledCode = {
      Default: {
        fileName: 'test.js',
        url: '/demo',
        source: 'console.log("test");',
      },
    };

    const result = parseControlledCode(controlledCode, mockParseSource);

    expect(result.Default).toBeDefined();
    expect(typeof result.Default).toBe('object');
    expect(mockParseSource).toHaveBeenCalledWith('console.log("test");', 'test.js');
  });

  it('should convert null source to empty string and parse it', () => {
    const mockControlledCode: ControlledCode = {
      Default: {
        fileName: 'App.js',
        url: 'test-url',
        source: null,
      },
    };

    const result = parseControlledCode(mockControlledCode, mockParseSource);

    expect(result).toEqual({
      Default: {
        fileName: 'App.js',
        url: 'test-url',
        source: createMockHastRoot(''), // parseSource('', 'App.js') returns this
      },
    });

    expect(mockParseSource).toHaveBeenCalledWith('', 'App.js');
  });

  it('should handle null variants (deletion pattern)', () => {
    const controlledCode: ControlledCode = {
      DeletedVariant: null,
      ExistingVariant: {
        fileName: 'test.js',
        url: '/demo',
        source: 'console.log("existing");',
      },
    };

    const result = parseControlledCode(controlledCode, mockParseSource);

    expect(result.DeletedVariant).toBeUndefined();
    expect(result.ExistingVariant).toBeDefined();
  });

  it('should handle undefined variants', () => {
    const controlledCode: ControlledCode = {
      UndefinedVariant: undefined,
      ExistingVariant: {
        fileName: 'test.js',
        url: '/demo',
        source: 'console.log("existing");',
      },
    };

    const result = parseControlledCode(controlledCode, mockParseSource);

    expect(result.UndefinedVariant).toBeUndefined();
    expect(result.ExistingVariant).toBeDefined();
  });

  it('should parse extraFiles when present', () => {
    const controlledCode: ControlledCode = {
      Default: {
        fileName: 'main.js',
        url: '/demo',
        source: 'console.log("main");',
        extraFiles: {
          'utils.js': { source: 'export function helper() {}' },
          'config.json': { source: '{"setting": true}' },
        },
      },
    };

    const result = parseControlledCode(controlledCode, mockParseSource);

    expect(result.Default).toBeDefined();
    const defaultResult = result.Default as any;
    expect(defaultResult.extraFiles).toBeDefined();
    expect(defaultResult.extraFiles['utils.js'].source).toEqual(
      createMockHastRoot('export function helper() {}'),
    );
    expect(defaultResult.extraFiles['config.json'].source).toEqual(
      createMockHastRoot('{"setting": true}'),
    );

    // Both main source and extraFiles get parsed
    expect(mockParseSource).toHaveBeenCalledWith('console.log("main");', 'main.js');
    expect(mockParseSource).toHaveBeenCalledWith('export function helper() {}', 'utils.js');
    expect(mockParseSource).toHaveBeenCalledWith('{"setting": true}', 'config.json');
    expect(mockParseSource).toHaveBeenCalledTimes(3);
  });

  it('should handle extraFiles with null sources', () => {
    const controlledCode: ControlledCode = {
      Default: {
        fileName: 'main.js',
        url: '/demo',
        source: 'console.log("main");',
        extraFiles: {
          'valid.js': { source: 'console.log("valid");' },
          'deleted.js': { source: null },
        },
      },
    };

    const result = parseControlledCode(controlledCode, mockParseSource);

    expect(result.Default).toBeDefined();
    const defaultResult = result.Default as any;
    expect(defaultResult.extraFiles).toBeDefined();
    expect(defaultResult.extraFiles['valid.js'].source).toEqual(
      createMockHastRoot('console.log("valid");'),
    );
    expect(defaultResult.extraFiles['deleted.js'].source).toEqual(createMockHastRoot('')); // null converted to empty string and parsed

    expect(mockParseSource).toHaveBeenCalledWith('console.log("main");', 'main.js');
    expect(mockParseSource).toHaveBeenCalledWith('console.log("valid");', 'valid.js');
    expect(mockParseSource).toHaveBeenCalledWith('', 'deleted.js'); // null converted to empty string
    expect(mockParseSource).toHaveBeenCalledTimes(3); // All sources parsed
  });

  it('should preserve other variant properties', () => {
    const controlledCode: ControlledCode = {
      Default: {
        fileName: 'test.js',
        url: '/demo/custom',
        source: 'console.log("test");',
        filesOrder: ['test.js', 'utils.js'],
      },
    };

    const result = parseControlledCode(controlledCode, mockParseSource);

    expect(result.Default).toBeDefined();
    const defaultResult = result.Default as any;
    expect(defaultResult.fileName).toBe('test.js');
    expect(defaultResult.url).toBe('/demo/custom');
    expect(defaultResult.filesOrder).toEqual(['test.js', 'utils.js']);
  });

  it('should handle complex nested structures', () => {
    const complexControlledCode: ControlledCode = {
      TypeScript: {
        fileName: 'complex.ts',
        url: '/demo/typescript',
        source: 'interface User { name: string; }',
        extraFiles: {
          'types.ts': { source: 'export type ID = string;' },
          'deleted.ts': { source: null },
          'config.ts': { source: 'export const CONFIG = {};' },
        },
        filesOrder: ['complex.ts', 'types.ts', 'config.ts'],
      },
      JavaScript: null, // Deleted variant
      Python: undefined, // Undefined variant
    };

    const result = parseControlledCode(complexControlledCode, mockParseSource);

    expect(result.TypeScript).toBeDefined();
    expect(result.JavaScript).toBeUndefined();
    expect(result.Python).toBeUndefined();

    const tsResult = result.TypeScript as any;
    expect(tsResult.fileName).toBe('complex.ts');
    expect(tsResult.extraFiles).toBeDefined();
    expect(tsResult.extraFiles['types.ts'].source).toBeDefined();
    expect(tsResult.extraFiles['deleted.ts'].source).toEqual(createMockHastRoot('')); // null converted to empty string and parsed
    expect(tsResult.extraFiles['config.ts'].source).toBeDefined();
    expect(tsResult.filesOrder).toEqual(['complex.ts', 'types.ts', 'config.ts']);
  });

  it('should handle empty controlledCode', () => {
    const controlledCode: ControlledCode = {};

    const result = parseControlledCode(controlledCode, mockParseSource);

    expect(result).toEqual({});
    expect(mockParseSource).not.toHaveBeenCalled();
  });

  it('should handle variant with no source property', () => {
    const controlledCode: ControlledCode = {
      NoSource: {
        fileName: 'test.js',
        url: '/demo',
        // No source property
      },
    };

    const result = parseControlledCode(controlledCode, mockParseSource);

    expect(result.NoSource).toBeDefined();
    const noSourceResult = result.NoSource as any;
    expect(noSourceResult.source).toBeUndefined();
    expect(mockParseSource).not.toHaveBeenCalled();
  });

  it('should handle variant with empty extraFiles', () => {
    const controlledCode: ControlledCode = {
      Default: {
        fileName: 'test.js',
        url: '/demo',
        source: 'console.log("test");',
        extraFiles: {},
      },
    };

    const result = parseControlledCode(controlledCode, mockParseSource);

    expect(result.Default).toBeDefined();
    const defaultResult = result.Default as any;
    expect(defaultResult.extraFiles).toEqual({});
    expect(mockParseSource).toHaveBeenCalledWith('console.log("test");', 'test.js');
    expect(mockParseSource).toHaveBeenCalledTimes(1);
  });

  describe('Undefined filename handling', () => {
    it('should gracefully handle controlled code variant without filename', () => {
      const controlledCode: ControlledCode = {
        Default: {
          fileName: undefined, // undefined fileName
          url: '/demo',
          source: 'console.log("test");',
        },
      };

      const result = parseControlledCode(controlledCode, mockParseSource);

      expect(result.Default).toBeDefined();
      const defaultResult = result.Default as any;
      expect(defaultResult.fileName).toBeUndefined();

      // parseSource should not be called without a filename
      expect(mockParseSource).not.toHaveBeenCalled();
    });

    it('should parse variants that have filename and skip those without', () => {
      const controlledCode: ControlledCode = {
        WithFilename: {
          fileName: 'App.js',
          url: '/demo/app-js',
          source: 'console.log("with filename");',
        },
        WithoutFilename: {
          fileName: undefined, // undefined fileName
          url: '/demo/app-no-filename',
          source: 'console.log("without filename");',
        },
      };

      const result = parseControlledCode(controlledCode, mockParseSource);

      expect(result.WithFilename).toBeDefined();
      expect(result.WithoutFilename).toBeDefined();

      const withFilenameResult = result.WithFilename as any;
      const withoutFilenameResult = result.WithoutFilename as any;

      expect(withFilenameResult.fileName).toBe('App.js');
      expect(withoutFilenameResult.fileName).toBeUndefined();

      // Should only parse the variant with a filename
      expect(mockParseSource).toHaveBeenCalledTimes(1);
      expect(mockParseSource).toHaveBeenCalledWith('console.log("with filename");', 'App.js');
    });
  });
});
