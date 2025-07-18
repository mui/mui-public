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
        extensions: ['ts', 'tsx'],
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
    it.each([
      {
        name: 'parent directory navigation',
        baseUrl: 'file:///components/switch/demo/demo.ts',
        relativePath: '../Switch.ts',
        expectedUrl: 'file:///components/switch/Switch.ts',
        expectedSource: 'const Switch = true;',
      },
      {
        name: 'current directory files',
        baseUrl: 'file:///components/switch/demo/demo.ts',
        relativePath: './helper.ts',
        expectedUrl: 'file:///components/switch/demo/helper.ts',
        expectedSource: 'const helper = true;',
      },
      {
        name: 'multiple level navigation',
        baseUrl: 'file:///components/switch/demo/demo.ts',
        relativePath: '../../../utils/shared.ts',
        expectedUrl: 'file:///utils/shared.ts',
        expectedSource: 'const shared = true;',
      },
    ])(
      'should resolve $name ($relativePath)',
      async ({ baseUrl, relativePath, expectedUrl, expectedSource }) => {
        const variant: VariantCode = {
          fileName: baseUrl.split('/').pop()!,
          url: baseUrl,
          source: 'const demo = true;',
          extraFiles: {
            [relativePath]: relativePath,
          },
        };

        mockLoadSource.mockImplementation((url: string) => {
          if (url === expectedUrl) {
            return Promise.resolve({ source: expectedSource });
          }
          throw new Error(`Unexpected URL: ${url}`);
        });

        const result = await loadVariant(
          baseUrl,
          'default',
          variant,
          mockParseSource,
          mockLoadSource,
          mockLoadVariantCode,
          mockSourceTransformers,
          { disableParsing: true },
        );

        expect(mockLoadSource).toHaveBeenCalledWith(expectedUrl);
        expect((result.code.extraFiles![relativePath] as any).source).toBe(expectedSource);
      },
    );

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
        { disableParsing: true },
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

      const transformerSpy = vi.fn().mockResolvedValue({
        'test-transform': {
          delta: { 0: ['// transformed'] },
          fileName: 'test.ts',
        },
      });

      const sourceTransformersWithSpy: SourceTransformers = [
        {
          extensions: ['ts', 'tsx'],
          transformer: transformerSpy,
        },
      ];

      const options: LoadFileOptions = {
        disableTransforms: true,
      };

      const result = await loadVariant(
        'file:///test.ts',
        'default',
        variant,
        mockParseSource,
        mockLoadSource,
        mockLoadVariantCode,
        sourceTransformersWithSpy,
        options,
      );

      // Transformer should not be called due to disableTransforms
      expect(transformerSpy).not.toHaveBeenCalled();
      // Should not have any transforms applied
      expect(result.code.transforms).toBeUndefined();
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
    // Missing dependencies and function validation
    it.each([
      {
        name: 'variant is missing',
        variant: undefined,
        parseSource: mockParseSource,
        loadSource: mockLoadSource,
        loadVariantCode: mockLoadVariantCode,
        expectedError: 'Variant is missing from code: default',
      },
      {
        name: 'loadSource is required but not provided',
        variant: { fileName: 'test.ts', url: 'file:///test.ts' } as VariantCode,
        parseSource: mockParseSource,
        loadSource: undefined,
        loadVariantCode: mockLoadVariantCode,
        expectedError: '"loadSource" function is required when source is not provided',
      },
      {
        name: 'parseSource is required but not provided',
        variant: {
          fileName: 'test.ts',
          url: 'file:///test.ts',
          source: 'const x = 1;',
        } as VariantCode,
        parseSource: undefined,
        loadSource: mockLoadSource,
        loadVariantCode: mockLoadVariantCode,
        expectedError:
          '"parseSource" function is required when source is a string and highlightAt is "init"',
      },
      {
        name: 'loadVariantCode is required but not provided',
        variant: 'file:///variant.ts',
        parseSource: mockParseSource,
        loadSource: mockLoadSource,
        loadVariantCode: undefined,
        expectedError: '"loadVariantCode" function is required when loadCode returns strings',
      },
    ])(
      'should throw error when $name',
      async ({ variant, parseSource, loadSource, loadVariantCode, expectedError }) => {
        await expect(
          loadVariant(
            'file:///test.ts',
            'default',
            variant,
            parseSource,
            loadSource,
            loadVariantCode,
            mockSourceTransformers,
          ),
        ).rejects.toThrow(expectedError);
      },
    );

    // Runtime error handling
    it.each([
      {
        name: 'loadSource fails',
        variant: { fileName: 'test.ts', url: 'file:///test.ts' } as VariantCode,
        setupMock: () => mockLoadSource.mockRejectedValue(new Error('Network error')),
        expectedError: 'Failed to load source code',
      },
      {
        name: 'parseSource fails',
        variant: {
          fileName: 'test.ts',
          url: 'file:///test.ts',
          source: 'invalid syntax',
        } as VariantCode,
        setupMock: () => mockParseSource.mockRejectedValue(new Error('Parse error')),
        expectedError: 'Failed to parse source code',
      },
    ])('should handle $name gracefully', async ({ variant, setupMock, expectedError }) => {
      setupMock();

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
      ).rejects.toThrow(expectedError);
    });

    // Path validation errors
    it.each([
      {
        name: 'loadSource returns relative path in extraFiles value',
        setupMock: (mock: MockedFunction<LoadSource>) => {
          mock.mockResolvedValue({
            source: 'const main = true;',
            extraFiles: { 'helper.ts': '../helper.ts' },
          });
        },
        expectedError:
          'Invalid extraFiles from loadSource: "helper.ts" has relative path "../helper.ts". All extraFiles values must be absolute URLs.',
      },
      {
        name: 'loadSource returns absolute URL as extraFiles key',
        setupMock: (mock: MockedFunction<LoadSource>) => {
          mock.mockResolvedValue({
            source: 'const main = true;',
            extraFiles: { 'file:///helper.ts': 'file:///helper.ts' },
          });
        },
        expectedError:
          'Invalid extraFiles from loadSource: key "file:///helper.ts" appears to be an absolute path. extraFiles keys should be relative paths from the current file.',
      },
      {
        name: 'loadSource returns filesystem absolute path as extraFiles key',
        setupMock: (mock: MockedFunction<LoadSource>) => {
          mock.mockResolvedValue({
            source: 'const main = true;',
            extraFiles: { '/absolute/helper.ts': 'file:///helper.ts' },
          });
        },
        expectedError:
          'Invalid extraFiles from loadSource: key "/absolute/helper.ts" appears to be an absolute path. extraFiles keys should be relative paths from the current file.',
      },
      {
        name: 'loadSource returns relative path in extraDependencies',
        setupMock: (mock: MockedFunction<LoadSource>) => {
          mock.mockResolvedValue({
            source: 'const main = true;',
            extraDependencies: ['../dependency.ts'],
          });
        },
        expectedError:
          'Invalid extraDependencies from loadSource: "../dependency.ts" is a relative path. All extraDependencies must be absolute URLs.',
      },
      {
        name: 'loadSource returns input URL in extraDependencies',
        setupMock: (mock: MockedFunction<LoadSource>) => {
          mock.mockResolvedValue({
            source: 'const main = true;',
            extraDependencies: ['file:///main.ts'],
          });
        },
        expectedError:
          'Invalid extraDependencies from loadSource: "file:///main.ts" is the same as the input URL. extraDependencies should not include the file being loaded.',
      },
    ])('should throw error when $name', async ({ setupMock, expectedError }) => {
      const variant: VariantCode = {
        fileName: 'main.ts',
        url: 'file:///main.ts',
      };

      setupMock(mockLoadSource);

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
      ).rejects.toThrow(expectedError);
    });

    // Variant validation errors
    it.each([
      {
        name: 'variant extraFiles has absolute URL as key',
        variantData: {
          fileName: 'main.ts',
          url: 'file:///main.ts',
          source: 'const main = true;',
          extraFiles: { 'file:///helper.ts': 'file:///helper.ts' },
        } as VariantCode,
        expectedError:
          'Invalid extraFiles key in variant: "file:///helper.ts" appears to be an absolute path. extraFiles keys in variant definition should be relative paths from the main file.',
      },
      {
        name: 'variant extraFiles has filesystem absolute path as key',
        variantData: {
          fileName: 'main.ts',
          url: 'file:///main.ts',
          source: 'const main = true;',
          extraFiles: { '/absolute/path/helper.ts': 'file:///helper.ts' },
        } as VariantCode,
        expectedError:
          'Invalid extraFiles key in variant: "/absolute/path/helper.ts" appears to be an absolute path. extraFiles keys in variant definition should be relative paths from the main file.',
      },
    ])('should throw error when $name', async ({ variantData, expectedError }) => {
      await expect(
        loadVariant(
          'file:///main.ts',
          'default',
          variantData,
          mockParseSource,
          mockLoadSource,
          mockLoadVariantCode,
          mockSourceTransformers,
        ),
      ).rejects.toThrow(expectedError);
    });

    it('should allow relative paths as keys with absolute URLs as values in variant extraFiles', async () => {
      const variant: VariantCode = {
        fileName: 'main.ts',
        url: 'file:///main.ts',
        source: 'const main = true;',
        extraFiles: {
          '../helper.ts': 'file:///helper.ts', // Valid: relative key, absolute value
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
        { disableParsing: true },
      );

      expect(mockLoadSource).toHaveBeenCalledWith('file:///helper.ts');
      expect((result.code.extraFiles!['../helper.ts'] as any).source).toBe('const helper = true;');
    });

    it('should allow valid extraDependencies from loadSource', async () => {
      const variant: VariantCode = {
        fileName: 'main.ts',
        url: 'file:///main.ts',
      };

      mockLoadSource.mockResolvedValue({
        source: 'const main = true;',
        extraDependencies: ['file:///bundled-dep.ts', 'https://example.com/external.js'], // Valid: absolute URLs, different from input
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

      expect(result.dependencies).toEqual([
        'file:///main.ts',
        'file:///bundled-dep.ts',
        'https://example.com/external.js',
      ]);
    });

    it('should handle edge cases in extraDependencies validation', async () => {
      const variant: VariantCode = {
        fileName: 'main.ts',
        url: 'file:///main.ts',
      };

      // Test empty string
      mockLoadSource.mockResolvedValue({
        source: 'const main = true;',
        extraDependencies: [''], // Edge case: empty string
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

      // Empty string should be allowed (might represent base URL)
      expect(result.dependencies).toEqual(['file:///main.ts', '']);
    });

    it('should allow valid extraFiles from loadSource with relative keys and absolute values', async () => {
      const variant: VariantCode = {
        fileName: 'main.ts',
        url: 'file:///main.ts',
      };

      mockLoadSource.mockImplementation((url: string) => {
        if (url === 'file:///main.ts') {
          return Promise.resolve({
            source: 'const main = true;',
            extraFiles: {
              '../helper.ts': 'file:///helper.ts', // Valid: relative key, absolute value
              './utils.ts': 'file:///utils.ts', // Valid: relative key, absolute value
            },
          });
        }
        if (url === 'file:///helper.ts') {
          return Promise.resolve({ source: 'const helper = true;' });
        }
        if (url === 'file:///utils.ts') {
          return Promise.resolve({ source: 'const utils = true;' });
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
        { disableParsing: true },
      );

      expect(result.code.extraFiles).toBeDefined();
      expect((result.code.extraFiles!['../helper.ts'] as any).source).toBe('const helper = true;');
      expect((result.code.extraFiles!['./utils.ts'] as any).source).toBe('const utils = true;');
      expect(result.dependencies).toEqual([
        'file:///main.ts',
        'file:///helper.ts',
        'file:///utils.ts',
      ]);
    });
  });

  describe('sourceTransformers integration', () => {
    it('should apply sourceTransformers when no existing transforms', async () => {
      const variant: VariantCode = {
        fileName: 'test.ts',
        url: 'file:///test.ts',
        source: 'const x = 1;',
      };

      const mockTransforms = {
        'syntax-highlight': {
          source: 'const x = 1; // highlighted',
          fileName: 'test.ts',
        },
      };

      const transformerSpy = vi.fn().mockResolvedValue(mockTransforms);

      const sourceTransformersWithSpy: SourceTransformers = [
        {
          extensions: ['ts', 'tsx'],
          transformer: transformerSpy,
        },
      ];

      const result = await loadVariant(
        'file:///test.ts',
        'default',
        variant,
        mockParseSource,
        mockLoadSource,
        mockLoadVariantCode,
        sourceTransformersWithSpy,
        { disableParsing: true }, // Disable parsing to keep source as string
      );

      expect(transformerSpy).toHaveBeenCalledWith('const x = 1;', 'test.ts');
      expect(result.code.transforms).toEqual({
        'syntax-highlight': {
          delta: expect.any(Object), // Delta object from jsondiffpatch
          fileName: 'test.ts',
        },
      });
      expect(result.dependencies).toEqual(['file:///test.ts']);
    });

    it('should not apply sourceTransformers when transforms already exist', async () => {
      const existingTransforms: Transforms = {
        'existing-transform': {
          delta: { 0: ['// existing'] },
          fileName: 'test.ts',
        },
      };

      const variant: VariantCode = {
        fileName: 'test.ts',
        url: 'file:///test.ts',
        source: 'const x = 1;',
        transforms: existingTransforms,
      };

      const transformerSpy = vi.fn().mockResolvedValue({
        'should-not-be-called': {
          delta: { 0: ['// should not appear'] },
          fileName: 'test.ts',
        },
      });

      const sourceTransformersWithSpy: SourceTransformers = [
        {
          extensions: ['ts', 'tsx'],
          transformer: transformerSpy,
        },
      ];

      const result = await loadVariant(
        'file:///test.ts',
        'default',
        variant,
        mockParseSource,
        mockLoadSource,
        mockLoadVariantCode,
        sourceTransformersWithSpy,
        { disableParsing: true },
      );

      // Should not call transformer when transforms already exist
      expect(transformerSpy).not.toHaveBeenCalled();
      // Should preserve existing transforms
      expect(result.code.transforms).toEqual(existingTransforms);
    });

    it('should apply sourceTransformers that match file extension', async () => {
      const variant: VariantCode = {
        fileName: 'component.tsx',
        url: 'file:///component.tsx',
        source: 'const Component = () => <div />;',
      };

      const tsxTransformerSpy = vi.fn().mockResolvedValue({
        'jsx-highlight': {
          source: 'const Component = () => <div />; // jsx highlighted',
          fileName: 'component.tsx',
        },
      });

      const jsTransformerSpy = vi.fn().mockResolvedValue({
        'js-highlight': {
          source: 'const Component = () => <div />; // js highlighted',
          fileName: 'component.tsx',
        },
      });

      const sourceTransformersWithSpy: SourceTransformers = [
        {
          extensions: ['js'],
          transformer: jsTransformerSpy,
        },
        {
          extensions: ['ts', 'tsx'],
          transformer: tsxTransformerSpy,
        },
      ];

      const result = await loadVariant(
        'file:///component.tsx',
        'default',
        variant,
        mockParseSource,
        mockLoadSource,
        mockLoadVariantCode,
        sourceTransformersWithSpy,
        { disableParsing: true },
      );

      // Only the .tsx transformer should be called
      expect(tsxTransformerSpy).toHaveBeenCalledWith(
        'const Component = () => <div />;',
        'component.tsx',
      );
      expect(jsTransformerSpy).not.toHaveBeenCalled();

      expect(result.code.transforms).toEqual({
        'jsx-highlight': {
          delta: expect.any(Object), // Delta object from jsondiffpatch
          fileName: 'component.tsx',
        },
      });
    });

    it('should handle sourceTransformers that return undefined', async () => {
      const variant: VariantCode = {
        fileName: 'test.ts',
        url: 'file:///test.ts',
        source: 'const x = 1;',
      };

      const transformerSpy = vi.fn().mockResolvedValue(undefined);

      const sourceTransformersWithSpy: SourceTransformers = [
        {
          extensions: ['ts', 'tsx'],
          transformer: transformerSpy,
        },
      ];

      const result = await loadVariant(
        'file:///test.ts',
        'default',
        variant,
        mockParseSource,
        mockLoadSource,
        mockLoadVariantCode,
        sourceTransformersWithSpy,
        { disableParsing: true },
      );

      expect(transformerSpy).toHaveBeenCalledWith('const x = 1;', 'test.ts');
      // Should not have transforms when transformer returns undefined
      expect(result.code.transforms).toBeUndefined();
    });

    it('should handle sourceTransformers errors gracefully', async () => {
      const variant: VariantCode = {
        fileName: 'test.ts',
        url: 'file:///test.ts',
        source: 'const x = 1;',
      };

      const transformerSpy = vi.fn().mockRejectedValue(new Error('Transform failed'));

      const sourceTransformersWithSpy: SourceTransformers = [
        {
          extensions: ['ts', 'tsx'],
          transformer: transformerSpy,
        },
      ];

      await expect(
        loadVariant(
          'file:///test.ts',
          'default',
          variant,
          mockParseSource,
          mockLoadSource,
          mockLoadVariantCode,
          sourceTransformersWithSpy,
          { disableParsing: true },
        ),
      ).rejects.toThrow('Transform failed');
    });

    it('should apply multiple sourceTransformers for matching extensions', async () => {
      const variant: VariantCode = {
        fileName: 'test.ts',
        url: 'file:///test.ts',
        source: 'const x = 1;',
      };

      const highlightTransformerSpy = vi.fn().mockResolvedValue({
        'syntax-highlight': {
          source: 'const x = 1; // highlighted',
          fileName: 'test.ts',
        },
      });

      const lintTransformerSpy = vi.fn().mockResolvedValue({
        'lint-errors': {
          source: 'const x = 1; // lint error',
          fileName: 'test.ts',
        },
      });

      const sourceTransformersWithSpy: SourceTransformers = [
        {
          extensions: ['ts', 'tsx'],
          transformer: highlightTransformerSpy,
        },
        {
          extensions: ['ts'],
          transformer: lintTransformerSpy,
        },
      ];

      const result = await loadVariant(
        'file:///test.ts',
        'default',
        variant,
        mockParseSource,
        mockLoadSource,
        mockLoadVariantCode,
        sourceTransformersWithSpy,
        { disableParsing: true },
      );

      // Both transformers should be called
      expect(highlightTransformerSpy).toHaveBeenCalledWith('const x = 1;', 'test.ts');
      expect(lintTransformerSpy).toHaveBeenCalledWith('const x = 1;', 'test.ts');

      // Should merge transforms from both transformers
      expect(result.code.transforms).toEqual({
        'syntax-highlight': {
          delta: expect.any(Object), // Delta object from jsondiffpatch
          fileName: 'test.ts',
        },
        'lint-errors': {
          delta: expect.any(Object), // Delta object from jsondiffpatch
          fileName: 'test.ts',
        },
      });
    });

    it('should apply sourceTransformers and then transform parsed source', async () => {
      const variant: VariantCode = {
        fileName: 'test.ts',
        url: 'file:///test.ts',
        source: 'const x = 1;',
      };

      // Create a transform that adds a comment (will change the source)
      const initialTransforms = {
        'syntax-highlight': {
          source: 'const x = 1;\n// highlighted comment',
          fileName: 'test.ts',
        },
      };

      const transformerSpy = vi.fn().mockResolvedValue(initialTransforms);

      // Mock parseSource to return different AST for original vs transformed source
      mockParseSource.mockImplementation((source: string) => {
        if (source === 'const x = 1;') {
          return Promise.resolve({
            type: 'root',
            children: [
              { type: 'element', tagName: 'code', children: [{ type: 'text', value: source }] },
            ],
          } as any);
        }
        if (source === 'const x = 1;\n// highlighted comment') {
          return Promise.resolve({
            type: 'root',
            children: [
              { type: 'element', tagName: 'code', children: [{ type: 'text', value: source }] },
              {
                type: 'element',
                tagName: 'span',
                className: ['comment'],
                children: [{ type: 'text', value: '// highlighted comment' }],
              },
            ],
          } as any);
        }
        throw new Error(`Unexpected source: ${source}`);
      });

      const sourceTransformersWithSpy: SourceTransformers = [
        {
          extensions: ['ts', 'tsx'],
          transformer: transformerSpy,
        },
      ];

      const result = await loadVariant(
        'file:///test.ts',
        'default',
        variant,
        mockParseSource,
        mockLoadSource,
        mockLoadVariantCode,
        sourceTransformersWithSpy,
        // Enable both transforms and parsing
      );

      // Should call the source transformer first
      expect(transformerSpy).toHaveBeenCalledWith('const x = 1;', 'test.ts');
      // Should call parseSource to convert original string to AST
      expect(mockParseSource).toHaveBeenCalledWith('const x = 1;', 'test.ts');
      // Should call parseSource again to convert transformed string to AST for delta comparison
      expect(mockParseSource).toHaveBeenCalledWith(
        'const x = 1;\n// highlighted comment',
        'test.ts',
      );

      // Source should be the parsed version of the original
      expect(result.code.source).toEqual({
        type: 'root',
        children: [
          { type: 'element', tagName: 'code', children: [{ type: 'text', value: 'const x = 1;' }] },
        ],
      });

      // Should have transforms with delta representing the difference between original and transformed AST
      expect(result.code.transforms).toBeDefined();
      expect(result.code.transforms!['syntax-highlight']).toBeDefined();
      expect(result.code.transforms!['syntax-highlight'].fileName).toBe('test.ts');
      // The delta should exist since the ASTs are different
      expect(result.code.transforms!['syntax-highlight'].delta).toBeDefined();
    });

    it('should skip transformParsedSource when no initial transforms exist', async () => {
      const variant: VariantCode = {
        fileName: 'test.ts',
        url: 'file:///test.ts',
        source: 'const x = 1;',
      };

      const transformerSpy = vi.fn().mockResolvedValue(undefined); // No transforms
      const mockParsedSource = {
        type: 'root',
        children: [{ type: 'element', tagName: 'pre', children: [] }],
      };

      mockParseSource.mockResolvedValue(mockParsedSource as any);

      const sourceTransformersWithSpy: SourceTransformers = [
        {
          extensions: ['ts', 'tsx'],
          transformer: transformerSpy,
        },
      ];

      const result = await loadVariant(
        'file:///test.ts',
        'default',
        variant,
        mockParseSource,
        mockLoadSource,
        mockLoadVariantCode,
        sourceTransformersWithSpy,
        // Enable both transforms and parsing
      );

      expect(transformerSpy).toHaveBeenCalledWith('const x = 1;', 'test.ts');
      expect(mockParseSource).toHaveBeenCalledWith('const x = 1;', 'test.ts');

      // Source should be parsed but no transforms
      expect(result.code.source).toEqual(mockParsedSource);
      expect(result.code.transforms).toBeUndefined();
    });

    it('should handle parsing errors gracefully', async () => {
      const variant: VariantCode = {
        fileName: 'test.ts',
        url: 'file:///test.ts',
        source: 'const x = 1;',
      };

      const transformerSpy = vi.fn().mockResolvedValue({
        'syntax-highlight': {
          source: 'const x = 1; // highlighted',
          fileName: 'test.ts',
        },
      });

      mockParseSource.mockRejectedValue(new Error('Parse error'));

      const sourceTransformersWithSpy: SourceTransformers = [
        {
          extensions: ['ts', 'tsx'],
          transformer: transformerSpy,
        },
      ];

      await expect(
        loadVariant(
          'file:///test.ts',
          'default',
          variant,
          mockParseSource,
          mockLoadSource,
          mockLoadVariantCode,
          sourceTransformersWithSpy,
          // Enable both transforms and parsing
        ),
      ).rejects.toThrow('Failed to parse source code');
    });

    it('should preserve existing transforms when parsing is enabled', async () => {
      const existingTransforms: Transforms = {
        'existing-transform': {
          // Delta that replaces line 0 with a comment
          delta: { '0': ['const x = 1;', '// existing comment\nconst x = 1;'] },
          fileName: 'test.ts',
        },
      };

      const variant: VariantCode = {
        fileName: 'test.ts',
        url: 'file:///test.ts',
        source: 'const x = 1;',
        transforms: existingTransforms,
      };

      const transformerSpy = vi.fn().mockResolvedValue({
        'should-not-be-called': {
          source: 'should not appear',
          fileName: 'test.ts',
        },
      });

      // Mock parseSource to return different AST for original vs transformed source
      mockParseSource.mockImplementation((source: string) => {
        if (source === 'const x = 1;') {
          return Promise.resolve({
            type: 'root',
            children: [
              { type: 'element', tagName: 'code', children: [{ type: 'text', value: source }] },
            ],
          } as any);
        }
        if (source === '// existing comment\nconst x = 1;') {
          return Promise.resolve({
            type: 'root',
            children: [
              {
                type: 'element',
                tagName: 'span',
                className: ['comment'],
                children: [{ type: 'text', value: '// existing comment' }],
              },
              {
                type: 'element',
                tagName: 'code',
                children: [{ type: 'text', value: 'const x = 1;' }],
              },
            ],
          } as any);
        }
        throw new Error(`Unexpected source: ${source}`);
      });

      const sourceTransformersWithSpy: SourceTransformers = [
        {
          extensions: ['ts', 'tsx'],
          transformer: transformerSpy,
        },
      ];

      const result = await loadVariant(
        'file:///test.ts',
        'default',
        variant,
        mockParseSource,
        mockLoadSource,
        mockLoadVariantCode,
        sourceTransformersWithSpy,
        // Enable parsing but transforms already exist
      );

      // Should not call transformer when transforms already exist
      expect(transformerSpy).not.toHaveBeenCalled();
      // Should call parseSource to convert string to AST
      expect(mockParseSource).toHaveBeenCalledWith('const x = 1;', 'test.ts');

      // Source should be parsed
      expect(result.code.source).toEqual({
        type: 'root',
        children: [
          { type: 'element', tagName: 'code', children: [{ type: 'text', value: 'const x = 1;' }] },
        ],
      });

      // Should have transforms processed by transformParsedSource
      expect(result.code.transforms).toBeDefined();
      expect(result.code.transforms!['existing-transform']).toBeDefined();
      expect(result.code.transforms!['existing-transform'].fileName).toBe('test.ts');
      // The delta should be modified by transformParsedSource to represent AST differences
      expect(result.code.transforms!['existing-transform'].delta).toBeDefined();
    });
  });

  describe('URL scheme handling', () => {
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

  describe('extraDependencies integration', () => {
    it('should include extraDependencies from loadSource in dependencies', async () => {
      const variant: VariantCode = {
        fileName: 'main.ts',
        url: 'file:///main.ts',
      };

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

  describe('caching behavior', () => {
    it('should cache loadSource calls and not call loadSource twice for the same URL', async () => {
      // Setup: Create a scenario where multiple extra files depend on the same shared utility
      const variant: VariantCode = {
        fileName: 'main.ts',
        url: 'file:///main.ts',
        source: 'const main = true;',
        extraFiles: {
          'component1.ts': 'file:///component1.ts',
          'component2.ts': 'file:///component2.ts',
        },
      };

      // Mock loadSource to return extra files that both depend on the same shared utility
      mockLoadSource.mockImplementation(async (url: string) => {
        if (url === 'file:///main.ts') {
          return {
            source: 'const main = true;',
          };
        }
        if (url === 'file:///component1.ts') {
          return {
            source: 'import { shared } from "./shared.ts";',
            extraFiles: {
              'shared.ts': 'file:///shared.ts', // Both components depend on the same shared file
            },
          };
        }
        if (url === 'file:///component2.ts') {
          return {
            source: 'import { shared } from "./shared.ts";',
            extraFiles: {
              'shared.ts': 'file:///shared.ts', // Same shared file
            },
          };
        }
        if (url === 'file:///shared.ts') {
          return {
            source: 'export const shared = "shared utility";',
          };
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
        { disableParsing: true },
      );

      // Verify that loadSource was called for each unique URL exactly once (main.ts not called because source provided)
      expect(mockLoadSource).toHaveBeenCalledTimes(3); // component1.ts, component2.ts, shared.ts
      expect(mockLoadSource).toHaveBeenCalledWith('file:///component1.ts');
      expect(mockLoadSource).toHaveBeenCalledWith('file:///component2.ts');
      expect(mockLoadSource).toHaveBeenCalledWith('file:///shared.ts');

      // Verify that shared.ts was only called once despite being referenced twice
      const sharedCalls = mockLoadSource.mock.calls.filter(
        (call: any) => call[0] === 'file:///shared.ts',
      );
      expect(sharedCalls).toHaveLength(1);

      // Verify the result structure is correct
      expect(result.code.extraFiles).toBeDefined();
      expect(result.code.extraFiles!['component1.ts']).toBeDefined();
      expect(result.code.extraFiles!['component2.ts']).toBeDefined();
      expect(result.code.extraFiles!['shared.ts']).toBeDefined();
      expect((result.code.extraFiles!['shared.ts'] as any).source).toBe(
        'export const shared = "shared utility";',
      );

      // Verify dependencies include all unique URLs
      expect(result.dependencies).toEqual([
        'file:///main.ts',
        'file:///component1.ts',
        'file:///component2.ts',
        'file:///shared.ts',
      ]);
    });

    it('should handle concurrent requests for the same URL correctly', async () => {
      // Create a scenario with deeply nested dependencies that reference the same file
      const variant: VariantCode = {
        fileName: 'main.ts',
        url: 'file:///main.ts',
        source: 'const main = true;',
        extraFiles: {
          'module1/index.ts': 'file:///module1/index.ts',
          'module2/index.ts': 'file:///module2/index.ts',
        },
      };

      let sharedCallCount = 0;

      // Mock loadSource with a delay to simulate network requests
      mockLoadSource.mockImplementation(async (url: string) => {
        // Add a small delay to make concurrent calls more likely
        await new Promise<void>((resolve) => {
          setTimeout(() => resolve(), 10);
        });

        if (url === 'file:///main.ts') {
          return { source: 'const main = true;' };
        }
        if (url === 'file:///module1/index.ts') {
          return {
            source: 'import { utils } from "../shared/utils.ts";',
            extraFiles: {
              '../shared/utils.ts': 'file:///shared/utils.ts',
            },
          };
        }
        if (url === 'file:///module2/index.ts') {
          return {
            source: 'import { utils } from "../shared/utils.ts";',
            extraFiles: {
              '../shared/utils.ts': 'file:///shared/utils.ts',
            },
          };
        }
        if (url === 'file:///shared/utils.ts') {
          sharedCallCount += 1;
          return {
            source: 'export const utils = "shared utilities";',
          };
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
        { disableParsing: true },
      );

      // Verify that the shared utility was only loaded once despite concurrent requests
      expect(sharedCallCount).toBe(1);
      expect(mockLoadSource).toHaveBeenCalledTimes(3); // module1, module2, shared (main not called because source provided)

      // Verify the result is correct - the shared file should be present somewhere in extraFiles
      const extraFilesKeys = Object.keys(result.code.extraFiles!);
      const sharedKey = extraFilesKeys.find(
        (key) => key.includes('shared') || key.includes('utils'),
      );
      expect(sharedKey).toBeDefined();
      expect(result.code.extraFiles![sharedKey!]).toBeDefined();
      expect((result.code.extraFiles![sharedKey!] as any).source).toBe(
        'export const utils = "shared utilities";',
      );
    });
  });
});

describe('loadVariant - helper functions', () => {
  // Tests for helper function behavior through integration
  describe('resolveRelativePath behavior', () => {
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
          extensions: ['ts', 'tsx'],
          transformer: vi.fn().mockResolvedValue(undefined),
        },
      ];
    });

    it('should resolve complex relative paths correctly via URL constructor', async () => {
      const variant: VariantCode = {
        fileName: 'demo.ts',
        url: 'file:///components/switch/demo/demo.ts',
        source: 'const demo = true;',
        extraFiles: {
          '../../../utils/helper.ts': 'file:///utils/helper.ts',
          '../../shared.ts': 'file:///components/shared.ts',
          './local.ts': 'file:///components/switch/demo/local.ts',
        },
      };

      mockLoadSource.mockImplementation((url: string) => {
        if (url === 'file:///utils/helper.ts') {
          return Promise.resolve({ source: 'const helper = true;' });
        }
        if (url === 'file:///components/shared.ts') {
          return Promise.resolve({ source: 'const shared = true;' });
        }
        if (url === 'file:///components/switch/demo/local.ts') {
          return Promise.resolve({ source: 'const local = true;' });
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
  });
});
