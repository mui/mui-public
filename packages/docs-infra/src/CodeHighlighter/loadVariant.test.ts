import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import { loadVariant } from './loadVariant';
import type {
  VariantCode,
  Transforms,
  ParseSource,
  LoadSource,
  LoadVariantCode,
  SourceTransformers,
  LoadFileOptions,
} from './types';

// Mock the transform functions
vi.mock('./transformSource', () => ({
  transformSource: vi.fn(),
}));

vi.mock('./transformParsedSource', () => ({
  transformParsedSource: vi.fn(),
}));

describe('loadVariant', () => {
  let mockLoadSource: MockedFunction<LoadSource>;
  let mockParseSource: MockedFunction<ParseSource>;
  let mockLoadVariantCode: MockedFunction<LoadVariantCode>;
  let mockSourceTransformers: SourceTransformers;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLoadSource = vi.fn();
    mockParseSource = vi.fn();
    mockLoadVariantCode = vi.fn();
    mockSourceTransformers = [
      {
        extensions: ['.ts', '.tsx'],
        transformer: vi.fn().mockResolvedValue(undefined),
      },
    ];
  });

  describe('basic functionality', () => {
    it('should load a variant with provided source', async () => {
      const variant: VariantCode = {
        fileName: 'test.ts',
        url: 'file:///test.ts',
        source: 'const x = 1;',
      };

      const result = await loadVariant(
        'file:///test.ts',
        'default',
        variant,
        mockParseSource,
        mockLoadSource,
        mockLoadVariantCode,
        mockSourceTransformers,
        { disableParsing: true }, // Disable parsing to keep source as string
      );

      expect(result.code.source).toBe('const x = 1;');
      expect(result.code.fileName).toBe('test.ts');
      expect(result.dependencies).toEqual(['file:///test.ts']);
      expect(mockLoadSource).not.toHaveBeenCalled();
    });

    it('should load source when not provided', async () => {
      const variant: VariantCode = {
        fileName: 'test.ts',
        url: 'file:///test.ts',
      };

      mockLoadSource.mockResolvedValue({
        source: 'const loaded = true;',
      });

      const result = await loadVariant(
        'file:///test.ts',
        'default',
        variant,
        mockParseSource,
        mockLoadSource,
        mockLoadVariantCode,
        mockSourceTransformers,
        { disableParsing: true }, // Disable parsing to keep source as string
      );

      expect(mockLoadSource).toHaveBeenCalledWith('file:///test.ts');
      expect(result.code.source).toBe('const loaded = true;');
      expect(result.dependencies).toEqual(['file:///test.ts']);
    });

    it('should handle string variants', async () => {
      const variantUrl = 'file:///variant.ts';
      const variantCode: VariantCode = {
        fileName: 'variant.ts',
        url: variantUrl,
        source: 'const variant = true;',
      };

      mockLoadVariantCode.mockResolvedValue(variantCode);

      const result = await loadVariant(
        'file:///test.ts',
        'default',
        variantUrl,
        mockParseSource,
        mockLoadSource,
        mockLoadVariantCode,
        mockSourceTransformers,
        { disableParsing: true }, // Disable parsing to keep source as string
      );

      expect(mockLoadVariantCode).toHaveBeenCalledWith('default', variantUrl);
      expect(result.code.source).toBe('const variant = true;');
      expect(result.dependencies).toEqual(['file:///test.ts']);
    });

    it('should parse source when parseSource is provided and parsing is enabled', async () => {
      const variant: VariantCode = {
        fileName: 'test.ts',
        url: 'file:///test.ts',
        source: 'const x = 1;',
      };

      const mockParsedSource = { type: 'root', children: [] };
      mockParseSource.mockResolvedValue(mockParsedSource as any);

      const result = await loadVariant(
        'file:///test.ts',
        'default',
        variant,
        mockParseSource,
        mockLoadSource,
        mockLoadVariantCode,
        mockSourceTransformers,
        // Don't disable parsing here
      );

      expect(mockParseSource).toHaveBeenCalledWith('const x = 1;', 'test.ts');
      expect(result.code.source).toEqual(mockParsedSource);
      expect(result.dependencies).toEqual(['file:///test.ts']);
    });
  });

  describe('extra files handling', () => {
    it('should load extra files from variant definition', async () => {
      const variant: VariantCode = {
        fileName: 'main.ts',
        url: 'file:///main.ts',
        source: 'const main = true;',
        extraFiles: {
          'helper.ts': 'file:///helper.ts',
          'utils.ts': {
            source: 'const utils = true;',
          },
        },
      };

      mockLoadSource.mockResolvedValue({
        source: 'const helper = true;',
      });

      const result = await loadVariant(
        'file:///main.ts',
        'default',
        variant,
        mockParseSource,
        mockLoadSource,
        mockLoadVariantCode,
        mockSourceTransformers,
        { disableParsing: true }, // Disable parsing to keep sources as strings
      );

      expect(result.code.extraFiles).toBeDefined();
      expect((result.code.extraFiles!['helper.ts'] as any).source).toBe('const helper = true;');
      expect((result.code.extraFiles!['utils.ts'] as any).source).toBe('const utils = true;');
      expect(result.dependencies).toEqual(['file:///main.ts', 'file:///helper.ts']);
    });

    it('should load extra files returned by loadSource', async () => {
      const variant: VariantCode = {
        fileName: 'main.ts',
        url: 'file:///main.ts',
      };

      mockLoadSource.mockImplementation((url: string) => {
        if (url === 'file:///main.ts') {
          return Promise.resolve({
            source: 'const main = true;',
            extraFiles: {
              'dependency.ts': 'file:///dependency.ts',
            },
          });
        }
        if (url === 'file:///dependency.ts') {
          return Promise.resolve({
            source: 'const dependency = true;',
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const result = await loadVariant(
        'file:///main.ts',
        'default',
        variant,
        mockParseSource,
        mockLoadSource,
        mockLoadVariantCode,
        mockSourceTransformers,
        { disableParsing: true }, // Disable parsing to keep sources as strings
      );

      expect(result.code.extraFiles).toBeDefined();
      expect((result.code.extraFiles!['dependency.ts'] as any).source).toBe(
        'const dependency = true;',
      );
      expect(result.dependencies).toEqual(['file:///main.ts', 'file:///dependency.ts']);
    });

    it('should handle recursive extra files', async () => {
      const variant: VariantCode = {
        fileName: 'main.ts',
        url: 'file:///main.ts',
        source: 'const main = true;',
        extraFiles: {
          'level1.ts': 'file:///level1.ts',
        },
      };

      mockLoadSource.mockImplementation((url: string) => {
        if (url === 'file:///level1.ts') {
          return Promise.resolve({
            source: 'const level1 = true;',
            extraFiles: {
              'level2.ts': 'file:///level2.ts',
            },
          });
        }
        if (url === 'file:///level2.ts') {
          return Promise.resolve({
            source: 'const level2 = true;',
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const result = await loadVariant(
        'file:///main.ts',
        'default',
        variant,
        mockParseSource,
        mockLoadSource,
        mockLoadVariantCode,
        mockSourceTransformers,
        { disableParsing: true }, // Disable parsing to keep sources as strings
      );

      expect(result.code.extraFiles).toBeDefined();
      expect((result.code.extraFiles!['level1.ts'] as any).source).toBe('const level1 = true;');
      expect((result.code.extraFiles!['level2.ts'] as any).source).toBe('const level2 = true;');
      expect(result.dependencies).toEqual([
        'file:///main.ts',
        'file:///level1.ts',
        'file:///level2.ts',
      ]);
    });

    it('should resolve relative paths for nested extra files correctly', async () => {
      const variant: VariantCode = {
        fileName: 'entry.js',
        url: 'file:///a/b/entry.js',
        source: 'const entry = true;',
        extraFiles: {
          '../a.js': 'file:///a/a.js',
        },
      };

      mockLoadSource.mockImplementation((url: string) => {
        if (url === 'file:///a/a.js') {
          return Promise.resolve({
            source: 'const a = true;',
            extraFiles: {
              '../index.js': 'file:///index.js',
            },
          });
        }
        if (url === 'file:///index.js') {
          return Promise.resolve({
            source: 'const index = true;',
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const result = await loadVariant(
        'file:///a/b/entry.js',
        'default',
        variant,
        mockParseSource,
        mockLoadSource,
        mockLoadVariantCode,
        mockSourceTransformers,
        { disableParsing: true },
      );

      expect(result.code.extraFiles).toBeDefined();

      // The original file from entry should keep its key
      expect((result.code.extraFiles!['../a.js'] as any).source).toBe('const a = true;');

      // The nested file from a.js should be converted to be relative from entry.js
      // index.js is at file:///index.js, entry.js is at file:///a/b/entry.js
      // So relative path from entry to index should be ../../index.js
      expect((result.code.extraFiles!['../../index.js'] as any).source).toBe('const index = true;');

      // Should NOT have the original relative path from a.js
      expect(result.code.extraFiles!['../index.js']).toBeUndefined();
      expect(result.dependencies).toEqual([
        'file:///a/b/entry.js',
        'file:///a/a.js',
        'file:///index.js',
      ]);
    });
  });

  describe('relative path resolution', () => {
    it('should resolve relative paths correctly', async () => {
      const variant: VariantCode = {
        fileName: 'demo.ts',
        url: 'file:///components/switch/demo/demo.ts',
        source: 'const demo = true;',
        extraFiles: {
          '../Switch.ts': '../Switch.ts',
          './helper.ts': './helper.ts',
        },
      };

      mockLoadSource.mockImplementation((url: string) => {
        if (url === 'file:///components/switch/Switch.ts') {
          return Promise.resolve({
            source: 'const Switch = true;',
          });
        }
        if (url === 'file:///components/switch/demo/helper.ts') {
          return Promise.resolve({
            source: 'const helper = true;',
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const result = await loadVariant(
        'file:///components/switch/demo/demo.ts',
        'default',
        variant,
        mockParseSource,
        mockLoadSource,
        mockLoadVariantCode,
        mockSourceTransformers,
        { disableParsing: true }, // Disable parsing to keep sources as strings
      );

      expect(mockLoadSource).toHaveBeenCalledWith('file:///components/switch/Switch.ts');
      expect(mockLoadSource).toHaveBeenCalledWith('file:///components/switch/demo/helper.ts');
      expect((result.code.extraFiles!['../Switch.ts'] as any).source).toBe('const Switch = true;');
      expect((result.code.extraFiles!['./helper.ts'] as any).source).toBe('const helper = true;');
      expect(result.dependencies).toEqual([
        'file:///components/switch/demo/demo.ts',
        'file:///components/switch/Switch.ts',
        'file:///components/switch/demo/helper.ts',
      ]);
    });

    it('should handle non-relative paths as-is', async () => {
      const variant: VariantCode = {
        fileName: 'main.ts',
        url: 'file:///main.ts',
        source: 'const main = true;',
        extraFiles: {
          'absolute.ts': 'file:///absolute/path/absolute.ts',
        },
      };

      mockLoadSource.mockResolvedValue({
        source: 'const absolute = true;',
      });

      const result = await loadVariant(
        'file:///main.ts',
        'default',
        variant,
        mockParseSource,
        mockLoadSource,
        mockLoadVariantCode,
        mockSourceTransformers,
        { disableParsing: true }, // Disable parsing to keep sources as strings
      );

      expect(mockLoadSource).toHaveBeenCalledWith('file:///absolute/path/absolute.ts');
      expect((result.code.extraFiles!['absolute.ts'] as any).source).toBe('const absolute = true;');
      expect(result.dependencies).toEqual(['file:///main.ts', 'file:///absolute/path/absolute.ts']);
    });
  });

  describe('circular dependency detection', () => {
    it('should detect and prevent circular dependencies', async () => {
      const variant: VariantCode = {
        fileName: 'main.ts',
        url: 'file:///main.ts',
        source: 'const main = true;',
        extraFiles: {
          'circular.ts': 'file:///circular.ts',
        },
      };

      mockLoadSource.mockImplementation((url: string) => {
        if (url === 'file:///circular.ts') {
          return Promise.resolve({
            source: 'const circular = true;',
            extraFiles: {
              'main.ts': 'file:///main.ts', // This creates a circular dependency
            },
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      await expect(
        loadVariant(
          'file:///main.ts',
          'default',
          variant,
          mockParseSource,
          mockLoadSource,
          mockLoadVariantCode,
          mockSourceTransformers,
        ),
      ).rejects.toThrow('Circular dependency detected: file:///main.ts');
    });
  });

  describe('options handling', () => {
    it('should respect disableTransforms option', async () => {
      const variant: VariantCode = {
        fileName: 'test.ts',
        url: 'file:///test.ts',
        source: 'const x = 1;',
      };

      const options: LoadFileOptions = {
        disableTransforms: true,
      };

      await loadVariant(
        'file:///test.ts',
        'default',
        variant,
        mockParseSource,
        mockLoadSource,
        mockLoadVariantCode,
        mockSourceTransformers,
        options,
      );

      // transformSource should not be called due to disableTransforms
      const { transformSource } = await import('./transformSource');
      expect(transformSource).not.toHaveBeenCalled();
    });

    it('should respect disableParsing option', async () => {
      const variant: VariantCode = {
        fileName: 'test.ts',
        url: 'file:///test.ts',
        source: 'const x = 1;',
      };

      const options: LoadFileOptions = {
        disableParsing: true,
      };

      const result = await loadVariant(
        'file:///test.ts',
        'default',
        variant,
        mockParseSource,
        mockLoadSource,
        mockLoadVariantCode,
        mockSourceTransformers,
        options,
      );

      expect(mockParseSource).not.toHaveBeenCalled();
      expect(result.code.source).toBe('const x = 1;'); // Should remain as string
      expect(result.dependencies).toEqual(['file:///test.ts']);
    });

    it('should respect maxDepth option', async () => {
      const variant: VariantCode = {
        fileName: 'main.ts',
        url: 'file:///main.ts',
        source: 'const main = true;',
        extraFiles: {
          'level1.ts': 'file:///level1.ts',
        },
      };

      mockLoadSource.mockImplementation((url: string) => {
        if (url === 'file:///level1.ts') {
          return Promise.resolve({
            source: 'const level = true;',
            extraFiles: {
              'levelNext.ts': 'file:///levelNext.ts',
            },
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const options: LoadFileOptions = {
        maxDepth: 1,
      };

      await expect(
        loadVariant(
          'file:///main.ts',
          'default',
          variant,
          mockParseSource,
          mockLoadSource,
          mockLoadVariantCode,
          mockSourceTransformers,
          options,
        ),
      ).rejects.toThrow('Maximum recursion depth reached while loading extra files');
    });
  });

  describe('error handling', () => {
    it('should throw error when variant is missing', async () => {
      await expect(
        loadVariant(
          'file:///test.ts',
          'default',
          undefined,
          mockParseSource,
          mockLoadSource,
          mockLoadVariantCode,
          mockSourceTransformers,
        ),
      ).rejects.toThrow('Variant is missing from code: default');
    });

    it('should throw error when loadSource is required but not provided', async () => {
      const variant: VariantCode = {
        fileName: 'test.ts',
        url: 'file:///test.ts',
        // source is missing, so loadSource is required
      };

      await expect(
        loadVariant(
          'file:///test.ts',
          'default',
          variant,
          mockParseSource,
          undefined, // loadSource not provided
          mockLoadVariantCode,
          mockSourceTransformers,
        ),
      ).rejects.toThrow('"loadSource" function is required when source is not provided');
    });

    it('should throw error when parseSource is required but not provided', async () => {
      const variant: VariantCode = {
        fileName: 'test.ts',
        url: 'file:///test.ts',
        source: 'const x = 1;', // string source requires parseSource
      };

      await expect(
        loadVariant(
          'file:///test.ts',
          'default',
          variant,
          undefined, // parseSource not provided
          mockLoadSource,
          mockLoadVariantCode,
          mockSourceTransformers,
        ),
      ).rejects.toThrow(
        '"parseSource" function is required when source is a string and highlightAt is "init"',
      );
    });

    it('should throw error when loadVariantCode is required but not provided', async () => {
      await expect(
        loadVariant(
          'file:///test.ts',
          'default',
          'file:///variant.ts', // string variant requires loadVariantCode
          mockParseSource,
          mockLoadSource,
          undefined, // loadVariantCode not provided
          mockSourceTransformers,
        ),
      ).rejects.toThrow('"loadVariantCode" function is required when loadCode returns strings');
    });

    it('should handle loadSource errors gracefully', async () => {
      const variant: VariantCode = {
        fileName: 'test.ts',
        url: 'file:///test.ts',
      };

      mockLoadSource.mockRejectedValue(new Error('Network error'));

      await expect(
        loadVariant(
          'file:///test.ts',
          'default',
          variant,
          mockParseSource,
          mockLoadSource,
          mockLoadVariantCode,
          mockSourceTransformers,
        ),
      ).rejects.toThrow('Failed to load source code');
    });

    it('should handle parseSource errors gracefully', async () => {
      const variant: VariantCode = {
        fileName: 'test.ts',
        url: 'file:///test.ts',
        source: 'invalid syntax',
      };

      mockParseSource.mockRejectedValue(new Error('Parse error'));

      await expect(
        loadVariant(
          'file:///test.ts',
          'default',
          variant,
          mockParseSource,
          mockLoadSource,
          mockLoadVariantCode,
          mockSourceTransformers,
        ),
      ).rejects.toThrow('Failed to parse source code');
    });
  });

  describe('transforms handling', () => {
    it('should preserve existing transforms', async () => {
      const existingTransforms: Transforms = {
        'test-transform': {
          delta: {},
          fileName: 'test.ts',
        },
      };

      const variant: VariantCode = {
        fileName: 'test.ts',
        url: 'file:///test.ts',
        source: 'const x = 1;',
        transforms: existingTransforms,
      };

      const result = await loadVariant(
        'file:///test.ts',
        'default',
        variant,
        mockParseSource,
        mockLoadSource,
        mockLoadVariantCode,
        mockSourceTransformers,
        { disableParsing: true }, // Disable parsing to keep source as string
      );

      expect(result.code.transforms).toEqual(existingTransforms);
      expect(result.dependencies).toEqual(['file:///test.ts']);
    });

    it('should apply source transformers when no existing transforms', async () => {
      const variant: VariantCode = {
        fileName: 'test.ts',
        url: 'file:///test.ts',
        source: 'const x = 1;',
      };

      const mockTransforms: Transforms = {
        'generated-transform': {
          delta: {},
          fileName: 'test.ts',
        },
      };

      const { transformSource } = await import('./transformSource');
      (transformSource as any).mockResolvedValue(mockTransforms);

      const result = await loadVariant(
        'file:///test.ts',
        'default',
        variant,
        mockParseSource,
        mockLoadSource,
        mockLoadVariantCode,
        mockSourceTransformers,
        { disableParsing: true }, // Disable parsing to keep source as string
      );

      expect(transformSource).toHaveBeenCalledWith(
        'const x = 1;',
        'test.ts',
        mockSourceTransformers,
      );
      expect(result.code.transforms).toEqual(mockTransforms);
      expect(result.dependencies).toEqual(['file:///test.ts']);
    });
  });

  describe('resolveRelativePath helper', () => {
    // Import the function for testing - we'll need to expose it or test it indirectly
    it('should resolve relative paths correctly via URL constructor', async () => {
      const variant: VariantCode = {
        fileName: 'demo.ts',
        url: 'file:///components/switch/demo/demo.ts',
        source: 'const demo = true;',
        extraFiles: {
          '../../../utils/helper.ts': '../../../utils/helper.ts',
          '../../shared.ts': '../../shared.ts',
          './local.ts': './local.ts',
        },
      };

      mockLoadSource.mockImplementation((url: string) => {
        if (url === 'file:///utils/helper.ts') {
          return Promise.resolve({
            source: 'const helper = true;',
          });
        }
        if (url === 'file:///components/shared.ts') {
          return Promise.resolve({
            source: 'const shared = true;',
          });
        }
        if (url === 'file:///components/switch/demo/local.ts') {
          return Promise.resolve({
            source: 'const local = true;',
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const result = await loadVariant(
        'file:///components/switch/demo/demo.ts',
        'default',
        variant,
        mockParseSource,
        mockLoadSource,
        mockLoadVariantCode,
        mockSourceTransformers,
        { disableParsing: true },
      );

      // Verify the resolved URLs were correct
      expect(mockLoadSource).toHaveBeenCalledWith('file:///utils/helper.ts');
      expect(mockLoadSource).toHaveBeenCalledWith('file:///components/shared.ts');
      expect(mockLoadSource).toHaveBeenCalledWith('file:///components/switch/demo/local.ts');

      expect(result.code.extraFiles).toBeDefined();
      expect((result.code.extraFiles!['../../../utils/helper.ts'] as any).source).toBe(
        'const helper = true;',
      );
      expect((result.code.extraFiles!['../../shared.ts'] as any).source).toBe(
        'const shared = true;',
      );
      expect((result.code.extraFiles!['./local.ts'] as any).source).toBe('const local = true;');
    });

    it('should handle URL schemes other than file://', async () => {
      const variant: VariantCode = {
        fileName: 'main.js',
        url: 'https://example.com/src/main.js',
        source: 'const main = true;',
        extraFiles: {
          '../utils.js': '../utils.js',
        },
      };

      mockLoadSource.mockResolvedValue({
        source: 'const utils = true;',
      });

      const result = await loadVariant(
        'https://example.com/src/main.js',
        'default',
        variant,
        mockParseSource,
        mockLoadSource,
        mockLoadVariantCode,
        mockSourceTransformers,
        { disableParsing: true },
      );

      expect(mockLoadSource).toHaveBeenCalledWith('https://example.com/utils.js');
      expect((result.code.extraFiles!['../utils.js'] as any).source).toBe('const utils = true;');
    });
  });

  it('should include extraDependencies from loadSource in dependencies', async () => {
    const variant: VariantCode = {
      fileName: 'main.ts',
      url: 'file:///main.ts',
    };

    // Mock loadSource to return extraDependencies
    mockLoadSource.mockResolvedValue({
      source: 'const main = true;',
      extraDependencies: ['file:///bundled-dep1.ts', 'file:///bundled-dep2.ts'],
    });

    const result = await loadVariant(
      'file:///main.ts',
      'default',
      variant,
      mockParseSource,
      mockLoadSource,
      mockLoadVariantCode,
      mockSourceTransformers,
      { disableParsing: true },
    );

    expect(result.code.source).toBe('const main = true;');
    expect(result.dependencies).toEqual([
      'file:///main.ts',
      'file:///bundled-dep1.ts',
      'file:///bundled-dep2.ts',
    ]);
  });
});
