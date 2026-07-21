import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Root } from 'hast';
import type { ControlledCode, ParseSource } from './types';
import { parseControlledCode, preParsedCacheKey } from './parseControlledCode';

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

const mockParseSource = vi.fn((_source: string, _fileName: string): Root =>
  createMockHastRoot(_source),
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

  describe('preParsedCache', () => {
    it('does not cache plain HAST while a known grammar is still cold', () => {
      const registry = { scopes: vi.fn(() => ['source.tsx']) };
      const globalRegistry = globalThis as Record<string, unknown>;
      const previousRegistry = globalRegistry.__docs_infra_starry_night_instance__;
      globalRegistry.__docs_infra_starry_night_instance__ = registry;
      const controlledCode: ControlledCode = {
        Default: { fileName: 'message.ts', source: 'export const message = "ready";' },
      };
      const cache = new Map();

      try {
        parseControlledCode(controlledCode, mockParseSource, cache);
        expect(cache.size).toBe(0);

        registry.scopes.mockReturnValue(['source.tsx', 'source.ts']);
        parseControlledCode(controlledCode, mockParseSource, cache);
        parseControlledCode(controlledCode, mockParseSource, cache);

        expect(mockParseSource).toHaveBeenCalledTimes(2);
        expect(cache.has(preParsedCacheKey('Default', 'message.ts'))).toBe(true);
      } finally {
        if (previousRegistry === undefined) {
          delete globalRegistry.__docs_infra_starry_night_instance__;
        } else {
          globalRegistry.__docs_infra_starry_night_instance__ = previousRegistry;
        }
      }
    });

    it('reuses the cached HAST when fileName + source match exactly', () => {
      const cachedHast = createMockHastRoot('cached');
      const controlledCode: ControlledCode = {
        Default: {
          fileName: 'App.js',
          url: '/demo',
          source: 'console.log("hi");',
        },
      };
      const cache = new Map([
        [
          preParsedCacheKey('Default', 'App.js'),
          { source: 'console.log("hi");', hast: cachedHast },
        ],
      ]);

      const result = parseControlledCode(controlledCode, mockParseSource, cache);

      expect(mockParseSource).not.toHaveBeenCalled();
      expect((result.Default as any).source).toBe(cachedHast);
      // Hit leaves the entry in place.
      expect(cache.get(preParsedCacheKey('Default', 'App.js'))?.hast).toBe(cachedHast);
    });

    it('falls through to parseSource and refreshes the entry on a source mismatch', () => {
      const staleHast = createMockHastRoot('stale');
      const controlledCode: ControlledCode = {
        Default: {
          fileName: 'App.js',
          url: '/demo',
          source: 'new source',
        },
      };
      const cache = new Map([
        [preParsedCacheKey('Default', 'App.js'), { source: 'old source', hast: staleHast }],
      ]);

      const result = parseControlledCode(controlledCode, mockParseSource, cache);

      expect(mockParseSource).toHaveBeenCalledWith('new source', 'App.js');
      expect((result.Default as any).source).not.toBe(staleHast);
      // The stale entry is replaced by the fresh parse (write-through), so the next
      // render with the same source reuses it instead of re-parsing.
      expect(cache.get(preParsedCacheKey('Default', 'App.js'))?.source).toBe('new source');
    });

    it('writes a fresh parse through to the cache when there was no entry', () => {
      const controlledCode: ControlledCode = {
        Default: {
          fileName: 'App.js',
          url: '/demo',
          source: 'console.log("hi");',
        },
      };
      const cache = new Map<string, { source: string; hast: Root }>();

      const result = parseControlledCode(controlledCode, mockParseSource, cache);

      expect(mockParseSource).toHaveBeenCalledTimes(1);
      // Write-through: the parse is stored so an unchanged file is not re-parsed next render.
      expect(cache.get(preParsedCacheKey('Default', 'App.js'))).toEqual({
        source: 'console.log("hi");',
        hast: (result.Default as any).source,
      });
    });

    it('reuses cached HAST for entries in extraFiles', () => {
      const mainHast = createMockHastRoot('main');
      const extraHast = createMockHastRoot('extra');
      const controlledCode: ControlledCode = {
        Default: {
          fileName: 'App.js',
          url: '/demo',
          source: 'main source',
          extraFiles: {
            'helper.js': { source: 'extra source' },
          },
        },
      };
      const cache = new Map([
        [preParsedCacheKey('Default', 'App.js'), { source: 'main source', hast: mainHast }],
        [preParsedCacheKey('Default', 'helper.js'), { source: 'extra source', hast: extraHast }],
      ]);

      const result = parseControlledCode(controlledCode, mockParseSource, cache);

      expect(mockParseSource).not.toHaveBeenCalled();
      expect((result.Default as any).source).toBe(mainHast);
      expect((result.Default as any).extraFiles['helper.js'].source).toBe(extraHast);
    });

    it('write-through: an unchanged file is parsed once across two renders', () => {
      const controlledCode: ControlledCode = {
        Default: { fileName: 'App.js', url: '/demo', source: 'const x = 1;' },
      };
      const cache = new Map<string, { source: string; hast: Root }>();

      parseControlledCode(controlledCode, mockParseSource, cache); // miss -> parse + store
      const second = parseControlledCode(controlledCode, mockParseSource, cache); // hit -> reuse

      expect(mockParseSource).toHaveBeenCalledTimes(1);
      expect((second.Default as any).source).toBe(
        cache.get(preParsedCacheKey('Default', 'App.js'))?.hast,
      );
    });

    it('re-parses only the changed file, reusing an unchanged sibling across an edit', () => {
      const cache = new Map<string, { source: string; hast: Root }>();
      const before: ControlledCode = {
        Default: {
          fileName: 'App.js',
          url: '/demo',
          source: 'v1',
          extraFiles: { 'helper.js': { source: 'helper' } },
        },
      };
      parseControlledCode(before, mockParseSource, cache); // parses App.js + helper.js

      const after: ControlledCode = {
        Default: {
          fileName: 'App.js',
          url: '/demo',
          source: 'v2', // main edited
          extraFiles: { 'helper.js': { source: 'helper' } }, // sibling unchanged
        },
      };
      parseControlledCode(after, mockParseSource, cache); // only App.js re-parses

      // 2 (first render) + 1 (only the edited main) = 3, not 4.
      expect(mockParseSource).toHaveBeenCalledTimes(3);
      expect(mockParseSource).toHaveBeenLastCalledWith('v2', 'App.js');
    });

    it('keys by variant so two variants sharing a file name do not evict each other', () => {
      const cache = new Map<string, { source: string; hast: Root }>();
      const controlledCode: ControlledCode = {
        Default: { fileName: 'Demo.tsx', url: '/demo', source: 'default source' },
        Alt: { fileName: 'Demo.tsx', url: '/demo', source: 'alt source' },
      };

      parseControlledCode(controlledCode, mockParseSource, cache); // both miss -> parse both
      parseControlledCode(controlledCode, mockParseSource, cache); // both hit -> no re-parse

      // Without variant-qualified keys the two `Demo.tsx` entries would collide and
      // evict each other, forcing a re-parse every render.
      expect(mockParseSource).toHaveBeenCalledTimes(2);
      expect(cache.get(preParsedCacheKey('Default', 'Demo.tsx'))?.source).toBe('default source');
      expect(cache.get(preParsedCacheKey('Alt', 'Demo.tsx'))?.source).toBe('alt source');
    });

    it('behaves identically to the no-cache call when cache is omitted', () => {
      const controlledCode: ControlledCode = {
        Default: {
          fileName: 'App.js',
          url: '/demo',
          source: 'console.log("hi");',
        },
      };

      const withoutCache = parseControlledCode(controlledCode, mockParseSource);
      vi.clearAllMocks();
      const withEmptyCache = parseControlledCode(controlledCode, mockParseSource, new Map());

      expect(withoutCache).toEqual(withEmptyCache);
      expect(mockParseSource).toHaveBeenCalledTimes(1);
    });
  });
});
