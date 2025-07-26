import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import { loadVariant } from './loadVariant';
import type {
  VariantCode,
  ParseSource,
  LoadSource,
  LoadVariantMeta,
  SourceTransformers,
  LoadFileOptions,
} from './types';

describe('loadVariant', () => {
  let mockLoadSource: MockedFunction<LoadSource>;
  let mockParseSource: MockedFunction<ParseSource>;
  let mockLoadVariantMeta: MockedFunction<LoadVariantMeta>;
  let mockSourceTransformers: SourceTransformers;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLoadSource = vi.fn();
    mockParseSource = vi.fn();
    mockLoadVariantMeta = vi.fn();
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
        Promise.resolve(mockParseSource),
        mockLoadSource,
        mockLoadVariantMeta,
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
        Promise.resolve(mockParseSource),
        mockLoadSource,
        mockLoadVariantMeta,
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

      mockLoadVariantMeta.mockResolvedValue(variantCode);

      const result = await loadVariant(
        'file:///test.ts',
        'default',
        variantUrl,
        Promise.resolve(mockParseSource),
        mockLoadSource,
        mockLoadVariantMeta,
        mockSourceTransformers,
        { disableParsing: true }, // Disable parsing to keep source as string
      );

      expect(mockLoadVariantMeta).toHaveBeenCalledWith('default', variantUrl);
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
      mockParseSource.mockReturnValue(mockParsedSource as any);

      const result = await loadVariant(
        'file:///test.ts',
        'default',
        variant,
        Promise.resolve(mockParseSource),
        mockLoadSource,
        mockLoadVariantMeta,
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
        Promise.resolve(mockParseSource),
        mockLoadSource,
        mockLoadVariantMeta,
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
        Promise.resolve(mockParseSource),
        mockLoadSource,
        mockLoadVariantMeta,
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
        Promise.resolve(mockParseSource),
        mockLoadSource,
        mockLoadVariantMeta,
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
        Promise.resolve(mockParseSource),
        mockLoadSource,
        mockLoadVariantMeta,
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

    it('should preserve relative paths from entrypoint across nested extraFiles loading', async () => {
      // Test case based on user requirements:
      // Entrypoint at file:///a/b/index.ts returns extraFiles with relative keys
      // Those files may load other files, but all keys should remain relative to the entrypoint
      const variant: VariantCode = {
        fileName: 'index.ts',
        url: 'file:///a/b/index.ts',
        source: 'const main = true;',
        extraFiles: {
          './createDemo.ts': 'file:///createDemo.ts',
          './BasicCheckbox.tsx': 'file:///a/b/BasicCheckbox.tsx',
        },
      };

      mockLoadSource.mockImplementation((url: string) => {
        if (url === 'file:///createDemo.ts') {
          return Promise.resolve({
            source: 'const createDemo = true;',
            extraFiles: {
              './DemoContent.tsx': 'file:///DemoContent.tsx',
            },
          });
        }
        if (url === 'file:///a/b/BasicCheckbox.tsx') {
          return Promise.resolve({
            source: 'const BasicCheckbox = true;',
          });
        }
        if (url === 'file:///DemoContent.tsx') {
          return Promise.resolve({
            source: 'const DemoContent = true;',
            extraFiles: {
              './DemoContent.module.css': 'file:///DemoContent.module.css',
            },
          });
        }
        if (url === 'file:///DemoContent.module.css') {
          return Promise.resolve({
            source: '.demo { color: blue; }',
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const result = await loadVariant(
        'file:///a/b/index.ts',
        'default',
        variant,
        Promise.resolve(mockParseSource),
        mockLoadSource,
        mockLoadVariantMeta,
        mockSourceTransformers,
        { disableParsing: true },
      );

      // Verify that all extraFiles keys remain relative to the entrypoint
      expect(result.code.extraFiles).toBeDefined();
      expect(result.code.extraFiles!['createDemo.ts']).toBeDefined();
      expect(result.code.extraFiles!['BasicCheckbox.tsx']).toBeDefined();
      expect(result.code.extraFiles!['DemoContent.tsx']).toBeDefined();
      expect(result.code.extraFiles!['DemoContent.module.css']).toBeDefined();

      // Verify the content is correct
      expect((result.code.extraFiles!['createDemo.ts'] as any).source).toBe(
        'const createDemo = true;',
      );
      expect((result.code.extraFiles!['BasicCheckbox.tsx'] as any).source).toBe(
        'const BasicCheckbox = true;',
      );
      expect((result.code.extraFiles!['DemoContent.tsx'] as any).source).toBe(
        'const DemoContent = true;',
      );
      expect((result.code.extraFiles!['DemoContent.module.css'] as any).source).toBe(
        '.demo { color: blue; }',
      );

      // Verify all URLs were loaded
      expect(mockLoadSource).toHaveBeenCalledWith('file:///createDemo.ts');
      expect(mockLoadSource).toHaveBeenCalledWith('file:///a/b/BasicCheckbox.tsx');
      expect(mockLoadSource).toHaveBeenCalledWith('file:///DemoContent.tsx');
      expect(mockLoadSource).toHaveBeenCalledWith('file:///DemoContent.module.css');

      // Verify dependencies include all loaded URLs
      expect(result.dependencies).toEqual([
        'file:///a/b/index.ts',
        'file:///createDemo.ts',
        'file:///a/b/BasicCheckbox.tsx',
        'file:///DemoContent.tsx',
        'file:///DemoContent.module.css',
      ]);
    });

    it('should handle different relative path formats in extraFiles keys', async () => {
      const variant: VariantCode = {
        fileName: 'main.ts',
        url: 'file:///src/main.ts',
        source: 'const main = true;',
        extraFiles: {
          'components/Button.tsx': 'file:///src/components/Button.tsx',
        },
      };

      mockLoadSource.mockImplementation((url: string) => {
        if (url === 'file:///src/components/Button.tsx') {
          return Promise.resolve({
            source: 'const Button = () => <button>Click</button>;',
            extraFiles: {
              'helper.ts': 'file:///src/helper.ts', // bare format (no ./ prefix)
              './../utils.ts': 'file:///utils.ts', // ./../ format
            },
          });
        }
        if (url === 'file:///src/helper.ts') {
          return Promise.resolve({
            source: 'const helper = true;',
          });
        }
        if (url === 'file:///utils.ts') {
          return Promise.resolve({
            source: 'const utils = true;',
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const result = await loadVariant(
        'file:///src/main.ts',
        'default',
        variant,
        Promise.resolve(mockParseSource),
        mockLoadSource,
        mockLoadVariantMeta,
        mockSourceTransformers,
        { disableParsing: true },
      );

      expect(result.code.extraFiles).toBeDefined();

      const utilsKey = 'utils.ts';
      const helperKey = 'components/helper.ts';
      const buttonKey = 'components/Button.tsx';

      expect(result.code.extraFiles![utilsKey]).toBeDefined();
      expect((result.code.extraFiles![utilsKey] as any).source).toBe('const utils = true;');

      expect(result.code.extraFiles![helperKey]).toBeDefined();
      expect((result.code.extraFiles![helperKey] as any).source).toBe('const helper = true;');

      expect(result.code.extraFiles![buttonKey]).toBeDefined();
      expect((result.code.extraFiles![buttonKey] as any).source).toBe(
        'const Button = () => <button>Click</button>;',
      );

      expect(result.dependencies).toEqual([
        'file:///src/main.ts',
        'file:///src/components/Button.tsx',
        'file:///src/helper.ts',
        'file:///utils.ts',
      ]);
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
          Promise.resolve(mockParseSource),
          mockLoadSource,
          mockLoadVariantMeta,
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
        Promise.resolve(mockParseSource),
        mockLoadSource,
        mockLoadVariantMeta,
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
        Promise.resolve(mockParseSource),
        mockLoadSource,
        mockLoadVariantMeta,
        mockSourceTransformers,
        options,
      );

      expect(mockParseSource).not.toHaveBeenCalled();
      expect(result.code.source).toBe('const x = 1;'); // Should remain as string
      expect(result.dependencies).toEqual(['file:///test.ts']);
    });

    it('should apply basic transforms when enabled', async () => {
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
        Promise.resolve(mockParseSource),
        mockLoadSource,
        mockLoadVariantMeta,
        sourceTransformersWithSpy,
        { disableParsing: true }, // Disable parsing to keep source as string
      );

      expect(transformerSpy).toHaveBeenCalledWith('const x = 1;', 'test.ts');
      expect(result.code.transforms).toBeDefined();
      expect(result.code.transforms!['syntax-highlight']).toBeDefined();
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
          Promise.resolve(mockParseSource),
          mockLoadSource,
          mockLoadVariantMeta,
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
        parseSource: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        expectedError: 'Variant is missing from code: default',
      },
      {
        name: 'loadSource is required but not provided',
        variant: { fileName: 'test.ts', url: 'file:///test.ts' } as VariantCode,
        parseSource: Promise.resolve(mockParseSource),
        loadSource: undefined,
        loadVariantMeta: mockLoadVariantMeta,
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
        loadVariantMeta: mockLoadVariantMeta,
        expectedError:
          '"sourceParser" function is required when source is a string and parsing is not disabled',
      },
    ])(
      'should throw error when $name',
      async ({ variant, parseSource, loadSource, loadVariantMeta, expectedError }) => {
        await expect(
          loadVariant(
            'file:///test.ts',
            'default',
            variant,
            parseSource ? Promise.resolve(parseSource) : undefined,
            loadSource,
            loadVariantMeta,
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
        setupMock: () =>
          mockParseSource.mockImplementation(() => {
            throw new Error('Parse error');
          }),
        expectedError: 'Failed to parse source code',
      },
    ])('should handle $name gracefully', async ({ variant, setupMock, expectedError }) => {
      setupMock();

      await expect(
        loadVariant(
          'file:///test.ts',
          'default',
          variant,
          Promise.resolve(mockParseSource),
          mockLoadSource,
          mockLoadVariantMeta,
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
          Promise.resolve(mockParseSource),
          mockLoadSource,
          mockLoadVariantMeta,
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
          Promise.resolve(mockParseSource),
          mockLoadSource,
          mockLoadVariantMeta,
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
        Promise.resolve(mockParseSource),
        mockLoadSource,
        mockLoadVariantMeta,
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
        Promise.resolve(mockParseSource),
        mockLoadSource,
        mockLoadVariantMeta,
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
        Promise.resolve(mockParseSource),
        mockLoadSource,
        mockLoadVariantMeta,
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
        Promise.resolve(mockParseSource),
        mockLoadSource,
        mockLoadVariantMeta,
        mockSourceTransformers,
        { disableParsing: true },
      );

      expect(result.code.extraFiles).toBeDefined();
      expect((result.code.extraFiles!['../helper.ts'] as any).source).toBe('const helper = true;');
      expect((result.code.extraFiles!['utils.ts'] as any).source).toBe('const utils = true;');
      expect(result.dependencies).toEqual([
        'file:///main.ts',
        'file:///helper.ts',
        'file:///utils.ts',
      ]);
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
        Promise.resolve(mockParseSource),
        mockLoadSource,
        mockLoadVariantMeta,
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
        Promise.resolve(mockParseSource),
        mockLoadSource,
        mockLoadVariantMeta,
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
        Promise.resolve(mockParseSource),
        mockLoadSource,
        mockLoadVariantMeta,
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

  describe('loadVariantMeta fallback behavior', () => {
    it('should create basic variant from URL string when loadVariantMeta is undefined', async () => {
      const variantUrl = 'file:///src/components/Button.tsx';
      mockLoadSource.mockResolvedValue({
        source: 'const Button = () => <button>Click me</button>;',
      });

      const result = await loadVariant(
        variantUrl,
        'default',
        variantUrl, // String variant
        undefined, // parseSource
        mockLoadSource,
        undefined, // loadVariantMeta - this is the key test case
        mockSourceTransformers,
        { disableParsing: true },
      );

      expect(result.code.url).toBe(variantUrl);
      expect(result.code.fileName).toBe('Button.tsx'); // Uses getFileNameFromUrl utility
      expect(result.code.source).toBe('const Button = () => <button>Click me</button>;');
      expect(mockLoadSource).toHaveBeenCalledWith(variantUrl);
    });

    it('should still use loadVariantMeta when provided', async () => {
      const variantUrl = 'file:///src/Button.tsx';
      const customVariant: VariantCode = {
        url: variantUrl,
        fileName: 'CustomButton.tsx',
        source: 'const CustomButton = () => <button>Custom</button>;',
        allFilesListed: true,
      };

      mockLoadVariantMeta.mockResolvedValue(customVariant);

      const result = await loadVariant(
        variantUrl,
        'default',
        variantUrl,
        undefined,
        mockLoadSource,
        mockLoadVariantMeta, // Provided loadVariantMeta
        mockSourceTransformers,
        { disableParsing: true },
      );

      expect(result.code).toEqual(customVariant);
      expect(mockLoadVariantMeta).toHaveBeenCalledWith('default', variantUrl);
      expect(mockLoadSource).not.toHaveBeenCalled(); // Should use provided source
    });
  });
});

describe('loadVariant - helper functions', () => {
  // Tests for helper function behavior through integration

  describe('allFilesListed validation', () => {
    it('should throw error in non-production when allFilesListed=true and loadSource returns unknown extra files', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      try {
        const mockLoadSource = vi.fn();
        const mockLoadVariantMeta = vi.fn();

        // Mock loadSource for the main file to return extra files not declared in variant
        mockLoadSource.mockImplementation((url: string) => {
          if (url === 'file:///Button.tsx') {
            return Promise.resolve({
              source: 'const Button = () => <button>Click</button>;',
              extraFiles: {
                'helper.js': 'file:///path/to/helper.js', // This key is NOT in variant.extraFiles
              },
            });
          }
          // For any other URL, just return a basic source
          return Promise.resolve({
            source: '// helper code',
          });
        });

        // Mock loadVariantMeta to return variant with allFilesListed=true but no extraFiles
        mockLoadVariantMeta.mockResolvedValue({
          url: 'file:///Button.tsx',
          fileName: 'Button.tsx',
          allFilesListed: true, // This should prevent discovery of new files
          // No extraFiles declared, so 'helper.js' is unknown
        });

        await expect(
          loadVariant(
            'file:///Button.tsx',
            'default',
            'file:///Button.tsx',
            undefined,
            mockLoadSource,
            mockLoadVariantMeta,
            undefined,
            { disableParsing: true },
          ),
        ).rejects.toThrow(
          'Unexpected files discovered via loadSource when allFilesListed=true (variant: default, file: Button.tsx). ' +
            'New files: helper.js. ' +
            'Please update the loadVariantMeta function to provide the complete list of files upfront.',
        );
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('should console.warn in production when allFilesListed=true and loadSource returns unknown extra files', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        const mockLoadSource = vi.fn();
        const mockLoadVariantMeta = vi.fn();

        // Mock loadSource for different files
        mockLoadSource.mockImplementation((url: string) => {
          if (url === 'file:///Button.tsx') {
            return Promise.resolve({
              source: 'const Button = () => <button>Click</button>;',
              extraFiles: {
                'helper.js': 'file:///path/to/helper.js',
              },
            });
          }
          return Promise.resolve({
            source: '// helper code',
          });
        });

        // Mock loadVariantMeta to return variant with allFilesListed=true but no extraFiles
        mockLoadVariantMeta.mockResolvedValue({
          url: 'file:///Button.tsx',
          fileName: 'Button.tsx',
          allFilesListed: true,
        });

        const result = await loadVariant(
          'file:///Button.tsx',
          'default',
          'file:///Button.tsx',
          undefined,
          mockLoadSource,
          mockLoadVariantMeta,
          undefined,
          { disableParsing: true },
        );

        // Should not throw, but should warn
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          'Unexpected files discovered via loadSource when allFilesListed=true (variant: default, file: Button.tsx). ' +
            'New files: helper.js. ' +
            'Please update the loadVariantMeta function to provide the complete list of files upfront.',
        );

        // Should still return the result with the discovered files
        expect(result.code.extraFiles).toBeDefined();
        expect(result.code.extraFiles!['helper.js']).toBeDefined();
      } finally {
        process.env.NODE_ENV = originalEnv;
        consoleWarnSpy.mockRestore();
      }
    });

    it('should work normally when allFilesListed=true and loadSource returns known extra files', async () => {
      const mockLoadSource = vi.fn();
      const mockLoadVariantMeta = vi.fn();

      // Mock loadSource for different files
      mockLoadSource.mockImplementation((url: string) => {
        if (url === 'file:///Button.tsx') {
          return Promise.resolve({
            source: 'const Button = () => <button>Click</button>;',
            extraFiles: {
              'helper.js': 'file:///path/to/helper.js', // This key IS in variant.extraFiles
            },
          });
        }
        return Promise.resolve({
          source: '// helper code',
        });
      });

      // Mock loadVariantMeta to return variant with allFilesListed=true and the extra file declared
      mockLoadVariantMeta.mockResolvedValue({
        url: 'file:///Button.tsx',
        fileName: 'Button.tsx',
        allFilesListed: true,
        extraFiles: {
          'helper.js': 'file:///path/to/helper.js', // File is known upfront
        },
      });

      const result = await loadVariant(
        'file:///Button.tsx',
        'default',
        'file:///Button.tsx',
        undefined,
        mockLoadSource,
        mockLoadVariantMeta,
        undefined,
        { disableParsing: true },
      );

      // Should work normally and include the known files
      expect(result.code.extraFiles).toBeDefined();
      expect(result.code.extraFiles!['helper.js']).toBeDefined();
    });

    it('should work normally when allFilesListed=false and loadSource returns extra files', async () => {
      const mockLoadSource = vi.fn();
      const mockLoadVariantMeta = vi.fn();

      // Mock loadSource for different files
      mockLoadSource.mockImplementation((url: string) => {
        if (url === 'file:///Button.tsx') {
          return Promise.resolve({
            source: 'const Button = () => <button>Click</button>;',
            extraFiles: {
              'helper.js': 'file:///path/to/helper.js',
            },
          });
        }
        return Promise.resolve({
          source: '// helper code',
        });
      });

      // Mock loadVariantMeta to return variant with allFilesListed=false
      mockLoadVariantMeta.mockResolvedValue({
        url: 'file:///Button.tsx',
        fileName: 'Button.tsx',
        allFilesListed: false, // This allows discovery of new files
      });

      const result = await loadVariant(
        'file:///Button.tsx',
        'default',
        'file:///Button.tsx',
        undefined,
        mockLoadSource,
        mockLoadVariantMeta,
        undefined,
        { disableParsing: true },
      );

      // Should work normally and include the discovered files
      expect(result.code.extraFiles).toBeDefined();
      expect(result.code.extraFiles!['helper.js']).toBeDefined();
    });

    it('should allow extraDependencies from loadSource when allFilesListed=true', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      try {
        const mockLoadSource = vi.fn();
        const mockLoadVariantMeta = vi.fn();

        // Mock loadSource to return extraDependencies
        mockLoadSource.mockResolvedValue({
          source: 'const Button = () => <button>Click</button>;',
          extraDependencies: ['file:///path/to/dependency.js'],
        });

        // Mock loadVariantMeta to return variant with allFilesListed=true
        mockLoadVariantMeta.mockResolvedValue({
          url: 'file:///Button.tsx',
          fileName: 'Button.tsx',
          allFilesListed: true,
        });

        const result = await loadVariant(
          'file:///Button.tsx',
          'default',
          'file:///Button.tsx',
          undefined,
          mockLoadSource,
          mockLoadVariantMeta,
          undefined,
          { disableParsing: true },
        );

        // extraDependencies should not cause errors since they're internal/webpack dependencies
        expect(result.code.source).toBe('const Button = () => <button>Click</button>;');
        expect(result.dependencies).toEqual([
          'file:///Button.tsx',
          'file:///path/to/dependency.js',
        ]);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });
});
