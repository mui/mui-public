import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import { loadCodeVariant } from './loadCodeVariant';
import type {
  VariantCode,
  ParseSource,
  LoadSource,
  LoadVariantMeta,
  SourceTransformers,
} from '../../CodeHighlighter/types';

describe('loadCodeVariant', () => {
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

      const result = await loadCodeVariant('file:///test.ts', 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true, // Disable parsing to keep source as string
      });

      expect(result.code.source).toBe('const x = 1;');
      expect(result.code.fileName).toBe('test.ts');
      expect(result.dependencies).toEqual(['file:///test.ts']);
      expect(mockLoadSource).not.toHaveBeenCalled();
      // Verify that externals is undefined when there are no externals
      expect(result.code.externals).toBeUndefined();
    });

    it('should load source when not provided', async () => {
      const variant: VariantCode = {
        fileName: 'test.ts',
        url: 'file:///test.ts',
      };

      mockLoadSource.mockResolvedValue({
        source: 'const loaded = true;',
      });

      const result = await loadCodeVariant('file:///test.ts', 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true, // Disable parsing to keep source as string
      });

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

      const result = await loadCodeVariant('file:///test.ts', 'default', variantUrl, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true, // Disable parsing to keep source as string
      });

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

      const result = await loadCodeVariant('file:///test.ts', 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        // Don't disable parsing here
      });

      expect(mockParseSource).toHaveBeenCalledWith('const x = 1;', 'test.ts', 'typescript');
      expect(result.code.source).toEqual(mockParsedSource);
      expect(result.dependencies).toEqual(['file:///test.ts']);
    });
  });

  describe('optional URL functionality', () => {
    it('should work without URL when only parsing/transforming', async () => {
      const variant: VariantCode = {
        fileName: 'test.ts',
        source: 'const x = 1;',
      };

      const mockParsedSource = { type: 'root', children: [] };
      mockParseSource.mockReturnValue(mockParsedSource as any);

      const result = await loadCodeVariant(
        undefined, // No URL provided
        'default',
        variant,
        {
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          sourceTransformers: mockSourceTransformers,
        },
      );

      expect(result.code.fileName).toBe('test.ts');
      expect(result.code.source).toBe(mockParsedSource);
      expect(result.dependencies).toEqual([]); // No URL, so no dependencies
      expect(mockParseSource).toHaveBeenCalledWith('const x = 1;', 'test.ts', 'typescript');
      expect(mockLoadSource).not.toHaveBeenCalled(); // No loading needed
    });

    it('should handle extra files with inline source and absolute URLs when no URL provided', async () => {
      const variant: VariantCode = {
        fileName: 'test.ts',
        source: 'const x = 1;',
        extraFiles: {
          'helper.ts': {
            source: 'export const helper = () => {};',
          },
          'external.ts': 'file:///external.ts', // This should be loaded since it's an absolute URL
        },
      };

      const mockParsedSource = { type: 'root', children: [] };
      mockParseSource.mockReturnValue(mockParsedSource as any);

      // Mock loadSource for the absolute URL
      mockLoadSource.mockResolvedValue({
        source: 'export const external = true;',
      });

      const result = await loadCodeVariant(
        undefined, // No URL provided
        'default',
        variant,
        {
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          sourceTransformers: mockSourceTransformers,
          disableParsing: true, // Disable parsing to keep sources as strings
        },
      );

      expect(result.code.fileName).toBe('test.ts');
      expect(result.code.source).toBe('const x = 1;'); // Should be string since parsing disabled
      expect(result.code.extraFiles).toEqual({
        'helper.ts': {
          source: 'export const helper = () => {};',
          language: 'typescript',
        },
        'external.ts': {
          source: 'export const external = true;',
          language: 'typescript',
        },
      });
      expect(result.dependencies).toEqual(['file:///external.ts']); // Should include the loaded external file
      expect(mockLoadSource).toHaveBeenCalledWith('file:///external.ts'); // Should have loaded the external file
    });

    it('should warn about relative path extra files when no URL provided', async () => {
      const variant: VariantCode = {
        fileName: 'test.ts',
        source: 'const x = 1;',
        extraFiles: {
          'helper.ts': {
            source: 'export const helper = () => {};',
          },
          '../relative.ts': '../relative.ts', // This should be skipped with warning (relative path)
        },
      };

      const mockParsedSource = { type: 'root', children: [] };
      mockParseSource.mockReturnValue(mockParsedSource as any);
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await loadCodeVariant(
        undefined, // No URL provided
        'default',
        variant,
        {
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          sourceTransformers: mockSourceTransformers,
        },
      );

      expect(result.code.fileName).toBe('test.ts');
      expect(result.code.source).toBe(mockParsedSource);
      expect(result.code.extraFiles).toEqual({
        'helper.ts': {
          source: 'export const helper = () => {};',
          language: 'typescript',
        },
      });
      expect(result.dependencies).toEqual([]); // No URL, so no dependencies
      expect(mockLoadSource).not.toHaveBeenCalled(); // No loading needed
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Skipping extra file "../relative.ts" - no URL provided and file requires loading from external source',
      );

      consoleWarnSpy.mockRestore();
    });

    it('should return code as-is when no fileName and no URL provided', async () => {
      const variant: VariantCode = {
        source: 'const x = 1;',
        // No fileName provided
      };

      const result = await loadCodeVariant(
        undefined, // No URL provided
        'default',
        variant,
        {
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          sourceTransformers: mockSourceTransformers,
        },
      );

      expect(result.code.source).toEqual({
        type: 'root',
        children: [
          {
            type: 'text',
            value: 'const x = 1;',
          },
        ],
      }); // Should have basic HAST node
      expect(result.code.fileName).toBeUndefined(); // No fileName available
      expect(result.dependencies).toEqual([]); // No URL, so no dependencies
      expect(mockParseSource).not.toHaveBeenCalled(); // No parsing without fileName or language
      expect(mockLoadSource).not.toHaveBeenCalled(); // No loading needed
    });

    it('should parse source when language is provided but no fileName or URL', async () => {
      const variant: VariantCode = {
        source: 'const x = 1;',
        language: 'typescript',
        // No fileName provided
      };

      const mockParsedSource = { type: 'root', children: [{ type: 'element', tagName: 'span' }] };
      mockParseSource.mockReturnValue(mockParsedSource as any);

      const result = await loadCodeVariant(
        undefined, // No URL provided
        'default',
        variant,
        {
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          sourceTransformers: mockSourceTransformers,
        },
      );

      expect(result.code.source).toEqual(mockParsedSource); // Should be parsed
      expect(result.code.language).toBe('typescript');
      expect(result.code.fileName).toBeUndefined(); // No fileName available
      expect(result.dependencies).toEqual([]); // No URL, so no dependencies
      expect(mockParseSource).toHaveBeenCalledWith('const x = 1;', '', 'typescript'); // Parse with empty fileName
      expect(mockLoadSource).not.toHaveBeenCalled(); // No loading needed
    });

    it('should support transforms without URL', async () => {
      const variant: VariantCode = {
        fileName: 'test.ts',
        source: 'const x = 1;',
      };

      const mockTransforms = {
        'test-transform': {
          source: 'const x = 1; // transformed',
          fileName: 'test.ts',
        },
      };

      const transformerSpy = vi.fn().mockResolvedValue(mockTransforms);
      const sourceTransformersWithSpy = [
        {
          extensions: ['ts', 'tsx'],
          transformer: transformerSpy,
        },
      ];

      const result = await loadCodeVariant(
        undefined, // No URL provided
        'default',
        variant,
        {
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          sourceTransformers: sourceTransformersWithSpy,
          disableParsing: true, // Keep as string to see transforms
        },
      );

      expect(result.code.fileName).toBe('test.ts');
      expect(result.code.source).toBe('const x = 1;');
      expect(result.code.transforms).toBeDefined();
      expect(result.code.transforms!['test-transform']).toBeDefined();
      expect(result.dependencies).toEqual([]); // No URL, so no dependencies
      expect(transformerSpy).toHaveBeenCalledWith('const x = 1;', 'test.ts');
      expect(mockLoadSource).not.toHaveBeenCalled(); // No loading needed
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

      const result = await loadCodeVariant('file:///main.ts', 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true, // Disable parsing to keep sources as strings
      });

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

      const result = await loadCodeVariant('file:///main.ts', 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true, // Disable parsing to keep sources as strings
      });

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

      const result = await loadCodeVariant('file:///main.ts', 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true, // Disable parsing to keep sources as strings
      });

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

      const result = await loadCodeVariant('file:///a/b/entry.js', 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true,
      });

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

      const result = await loadCodeVariant('file:///a/b/index.ts', 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true,
      });

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

      const result = await loadCodeVariant('file:///src/main.ts', 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true,
      });

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
        loadCodeVariant('file:///main.ts', 'default', variant, {
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          sourceTransformers: mockSourceTransformers,
        }),
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

      const result = await loadCodeVariant('file:///test.ts', 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: sourceTransformersWithSpy,
        disableTransforms: true,
      });

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

      const result = await loadCodeVariant('file:///test.ts', 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true,
      });

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

      const result = await loadCodeVariant('file:///test.ts', 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: sourceTransformersWithSpy,
        disableParsing: true, // Disable parsing to keep source as string
      });

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

      await expect(
        loadCodeVariant('file:///main.ts', 'default', variant, {
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          sourceTransformers: mockSourceTransformers,
          maxDepth: 1,
        }),
      ).rejects.toThrow('Maximum recursion depth reached while loading extra files');
    });
  });

  describe('error handling', () => {
    // Missing dependencies and function validation
    it.each([
      {
        name: 'variant is missing',
        variant: undefined,
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        expectedError: 'Variant is missing from code: default',
      },
      {
        name: 'loadSource is required but not provided',
        variant: { fileName: 'test.ts', url: 'file:///test.ts' } as VariantCode,
        sourceParser: Promise.resolve(mockParseSource),
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
        sourceParser: undefined,
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        expectedError:
          '"sourceParser" function is required when source is a string and parsing is not disabled',
      },
    ])(
      'should throw error when $name',
      async ({ variant, sourceParser, loadSource, loadVariantMeta, expectedError }) => {
        await expect(
          loadCodeVariant('file:///test.ts', 'default', variant, {
            sourceParser: sourceParser ? Promise.resolve(sourceParser) : undefined,
            loadSource,
            loadVariantMeta,
            sourceTransformers: mockSourceTransformers,
          }),
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
        loadCodeVariant('file:///test.ts', 'default', variant, {
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          sourceTransformers: mockSourceTransformers,
        }),
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
        loadCodeVariant('file:///main.ts', 'default', variant, {
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          sourceTransformers: mockSourceTransformers,
        }),
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
        loadCodeVariant('file:///main.ts', 'default', variantData, {
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          sourceTransformers: mockSourceTransformers,
        }),
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

      const result = await loadCodeVariant('file:///main.ts', 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true,
      });

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

      const result = await loadCodeVariant('file:///main.ts', 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true,
      });

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

      const result = await loadCodeVariant('file:///main.ts', 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true,
      });

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

      const result = await loadCodeVariant('file:///main.ts', 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true,
      });

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

      const result = await loadCodeVariant('file:///main.ts', 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true,
      });

      expect(result.code.source).toBe('const main = true;');
      expect(result.dependencies).toEqual([
        'file:///main.ts',
        'file:///bundled-dep1.ts',
        'file:///bundled-dep2.ts',
      ]);
    });
  });

  describe('externals integration', () => {
    it('should include externals from loadSource in externals array', async () => {
      const variant: VariantCode = {
        fileName: 'main.ts',
        url: 'file:///main.ts',
      };

      mockLoadSource.mockResolvedValue({
        source: 'const main = true;',
        externals: {
          react: [{ name: 'React', type: 'default' }],
          '@mui/material': [{ name: 'Button', type: 'named' }],
          lodash: [{ name: 'map', type: 'named' }],
        },
      });

      const result = await loadCodeVariant('file:///main.ts', 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true,
      });

      expect(result.code.source).toBe('const main = true;');
      expect(result.externals).toEqual({
        react: [{ name: 'React', type: 'default' }],
        '@mui/material': [{ name: 'Button', type: 'named' }],
        lodash: [{ name: 'map', type: 'named' }],
      });
      // Verify that externals array is set on the code object
      expect(result.code.externals).toEqual(['react', '@mui/material', 'lodash']);
    });

    it('should combine externals from main file and extra files', async () => {
      const variant: VariantCode = {
        fileName: 'main.ts',
        url: 'file:///main.ts',
        extraFiles: {
          'helper.ts': 'file:///helper.ts',
        },
      };

      // Mock main file loading
      mockLoadSource.mockImplementation((url: string) => {
        if (url === 'file:///main.ts') {
          return Promise.resolve({
            source: 'const main = true;',
            externals: {
              react: [{ name: 'React', type: 'default' }],
              '@mui/material': [{ name: 'Button', type: 'named' }],
            },
          });
        }
        if (url === 'file:///helper.ts') {
          return Promise.resolve({
            source: 'const helper = true;',
            externals: {
              lodash: [{ name: 'map', type: 'named' }],
              axios: [{ name: 'axios', type: 'default' }],
            },
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const result = await loadCodeVariant('file:///main.ts', 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true,
      });

      expect(result.code.source).toBe('const main = true;');
      expect(result.externals).toEqual({
        react: [{ name: 'React', type: 'default' }],
        '@mui/material': [{ name: 'Button', type: 'named' }],
        lodash: [{ name: 'map', type: 'named' }],
        axios: [{ name: 'axios', type: 'default' }],
      });
      // Verify that externals array is set on the code object
      expect(result.code.externals).toEqual(['react', '@mui/material', 'lodash', 'axios']);
    });

    it('should merge different imports from same external modules', async () => {
      const variant: VariantCode = {
        fileName: 'main.ts',
        url: 'file:///main.ts',
        extraFiles: {
          'helper.ts': 'file:///helper.ts',
        },
      };

      // Mock main file loading
      mockLoadSource.mockImplementation((url: string) => {
        if (url === 'file:///main.ts') {
          return Promise.resolve({
            source: 'const main = true;',
            externals: {
              react: [{ name: 'React', type: 'default' }],
              '@mui/material': [{ name: 'Button', type: 'named' }],
              lodash: [{ name: 'map', type: 'named' }],
            },
          });
        }
        if (url === 'file:///helper.ts') {
          return Promise.resolve({
            source: 'const helper = true;',
            externals: {
              react: [
                { name: 'useState', type: 'named' },
                { name: 'useEffect', type: 'named' },
              ], // Different imports from react
              '@mui/material': [
                { name: 'TextField', type: 'named' },
                { name: 'Box', type: 'named' },
              ], // Different imports from @mui/material
              axios: [{ name: 'axios', type: 'default' }], // New module
            },
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const result = await loadCodeVariant('file:///main.ts', 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true,
      });

      expect(result.code.source).toBe('const main = true;');
      // Should merge externals properly, combining all imports from each module:
      // - react: default import from main + named imports from helper
      // - @mui/material: Button from main + TextField, Box from helper
      // - lodash: only from main
      // - axios: only from helper
      expect(result.externals).toEqual({
        react: [
          { name: 'React', type: 'default' },
          { name: 'useState', type: 'named' },
          { name: 'useEffect', type: 'named' },
        ],
        '@mui/material': [
          { name: 'Button', type: 'named' },
          { name: 'TextField', type: 'named' },
          { name: 'Box', type: 'named' },
        ],
        lodash: [{ name: 'map', type: 'named' }],
        axios: [{ name: 'axios', type: 'default' }],
      });
      // Verify that externals array is set on the code object
      expect(result.code.externals).toEqual(['react', '@mui/material', 'lodash', 'axios']);
    });

    it('should handle URL-only loadCodeVariant call and return externals correctly', async () => {
      // Test case: loadCodeVariant called with just a URL string
      const variantUrl = 'file:///demos/CheckboxBasic.tsx';

      // Mock loadVariantMeta to return a basic variant
      mockLoadVariantMeta.mockResolvedValue({
        url: variantUrl,
        fileName: 'CheckboxBasic.tsx',
      });

      // Mock loadSource to return externals for the URL-only case
      mockLoadSource.mockResolvedValue({
        source: `
import * as React from 'react';
import { Checkbox } from '@/components/Checkbox';

export default function CheckboxBasic() {
  return (
    <div>
      <Checkbox defaultChecked />
      <p style={{ color: '#CA244D' }}>Type Whatever You Want Below</p>
    </div>
  );
}
        `,
        externals: {
          react: [{ name: 'React', type: 'namespace' }],
          '@/components/Checkbox': [{ name: 'Checkbox', type: 'named' }],
        },
      });

      const result = await loadCodeVariant(
        variantUrl,
        'default',
        variantUrl, // URL passed as variant (string)
        {
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          sourceTransformers: mockSourceTransformers,
          disableParsing: true,
        },
      );

      // Should call loadVariantMeta to convert URL to VariantCode
      expect(mockLoadVariantMeta).toHaveBeenCalledWith('default', variantUrl);

      // Should return externals from loadSource
      expect(result.externals).toEqual({
        react: [{ name: 'React', type: 'namespace' }],
        '@/components/Checkbox': [{ name: 'Checkbox', type: 'named' }],
      });

      // Should set externals array on code object
      expect(result.code.externals).toEqual(['react', '@/components/Checkbox']);

      // Should include the URL in dependencies
      expect(result.dependencies).toEqual([variantUrl]);
    });

    it('should handle URL-only case with externals when loadVariantMeta is undefined', async () => {
      // Test case: loadCodeVariant called with URL string and no loadVariantMeta
      const variantUrl = 'file:///src/components/Button.tsx';

      // Mock loadSource to return externals
      mockLoadSource.mockResolvedValue({
        source: `
import React from 'react';
import { Button as MuiButton } from '@mui/material';
import type { ButtonProps } from '@mui/material';

export default function Button(props: ButtonProps) {
  return <MuiButton {...props}>Click me</MuiButton>;
}
        `,
        externals: {
          react: [{ name: 'React', type: 'default' }],
          '@mui/material': [
            { name: 'Button', type: 'named' },
            { name: 'ButtonProps', type: 'named', isType: true },
          ],
        },
      });

      const result = await loadCodeVariant(
        variantUrl,
        'default',
        variantUrl, // URL passed as variant (string)
        {
          sourceParser: undefined, // No parseSource
          loadSource: mockLoadSource,
          loadVariantMeta: undefined, // No loadVariantMeta - should use fallback
          sourceTransformers: mockSourceTransformers,
          disableParsing: true,
        },
      );

      // Should NOT call loadVariantMeta since it's undefined
      expect(mockLoadVariantMeta).not.toHaveBeenCalled();

      // Should call loadSource
      expect(mockLoadSource).toHaveBeenCalledWith(variantUrl);

      // Should return externals from loadSource including isType flags
      expect(result.externals).toEqual({
        react: [{ name: 'React', type: 'default' }],
        '@mui/material': [
          { name: 'Button', type: 'named' },
          { name: 'ButtonProps', type: 'named', isType: true },
        ],
      });

      // Should set externals array on code object
      expect(result.code.externals).toEqual(['react', '@mui/material']);

      // Should create basic variant with fileName from URL
      expect(result.code.fileName).toBe('Button.tsx');
      expect(result.code.url).toBe(variantUrl);

      // Should include the URL in dependencies
      expect(result.dependencies).toEqual([variantUrl]);
    });

    it('should properly merge externals by combining imports from same modules', async () => {
      const variant: VariantCode = {
        fileName: 'main.ts',
        url: 'file:///main.ts',
        extraFiles: {
          'helper.ts': 'file:///helper.ts',
          'utils.ts': 'file:///utils.ts',
        },
      };

      // Mock main file loading
      mockLoadSource.mockImplementation((url: string) => {
        if (url === 'file:///main.ts') {
          return Promise.resolve({
            source: 'const main = true;',
            externals: {
              react: [{ name: 'React', type: 'default' }],
              lodash: [{ name: 'map', type: 'named' }],
            },
          });
        }
        if (url === 'file:///helper.ts') {
          return Promise.resolve({
            source: 'const helper = true;',
            externals: {
              react: [{ name: 'useState', type: 'named' }],
              lodash: [{ name: 'filter', type: 'named' }],
            },
          });
        }
        if (url === 'file:///utils.ts') {
          return Promise.resolve({
            source: 'const utils = true;',
            externals: {
              react: [{ name: 'useEffect', type: 'named' }],
              lodash: [{ name: 'reduce', type: 'named' }],
              axios: [{ name: 'axios', type: 'default' }],
            },
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const result = await loadCodeVariant('file:///main.ts', 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true,
      });

      expect(result.code.source).toBe('const main = true;');
      // Should properly merge externals by combining all imports from each module:
      // - react: React (default from main) + useState (from helper) + useEffect (from utils)
      // - lodash: map (from main) + filter (from helper) + reduce (from utils)
      // - axios: only from utils
      expect(result.externals).toEqual({
        react: [
          { name: 'React', type: 'default' },
          { name: 'useState', type: 'named' },
          { name: 'useEffect', type: 'named' },
        ],
        lodash: [
          { name: 'map', type: 'named' },
          { name: 'filter', type: 'named' },
          { name: 'reduce', type: 'named' },
        ],
        axios: [{ name: 'axios', type: 'default' }],
      });
      // Verify that externals array is set on the code object
      expect(result.code.externals).toEqual(['react', 'lodash', 'axios']);
    });

    it('should preserve isType flags from loadSource externals', async () => {
      const variant: VariantCode = {
        fileName: 'main.ts',
        url: 'file:///main.ts',
        extraFiles: {
          'types.ts': 'file:///types.ts',
          'components.tsx': 'file:///components.tsx',
        },
      };

      // Mock main file loading with mixed type and runtime imports
      mockLoadSource.mockImplementation((url: string) => {
        if (url === 'file:///main.ts') {
          return Promise.resolve({
            source: 'const main = true;',
            externals: {
              react: [
                { name: 'React', type: 'default' }, // runtime import
                { name: 'FC', type: 'named', isType: true }, // type import
                { name: 'ReactNode', type: 'named', isType: true }, // type import
              ],
              '@mui/material': [
                { name: 'Button', type: 'named' }, // runtime import
                { name: 'ButtonProps', type: 'named', isType: true }, // type import
              ],
            },
          });
        }
        if (url === 'file:///types.ts') {
          return Promise.resolve({
            source: 'export type TypeDefs = {};',
            externals: {
              react: [
                { name: 'ComponentType', type: 'named', isType: true }, // additional type import
                { name: 'useState', type: 'named' }, // runtime import from types file
              ],
              typescript: [
                { name: 'TSConfig', type: 'named', isType: true }, // type-only module
              ],
            },
          });
        }
        if (url === 'file:///components.tsx') {
          return Promise.resolve({
            source: 'export const MyComponent = () => {};',
            externals: {
              react: [
                { name: 'useEffect', type: 'named' }, // runtime import
              ],
              '@mui/material': [
                { name: 'TextField', type: 'named' }, // runtime import
                { name: 'TextFieldProps', type: 'named', isType: true }, // type import
              ],
            },
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const result = await loadCodeVariant('file:///main.ts', 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true,
      });

      expect(result.code.source).toBe('const main = true;');

      // Should properly merge externals and preserve isType flags
      expect(result.externals).toEqual({
        react: [
          { name: 'React', type: 'default' }, // no isType flag (runtime)
          { name: 'FC', type: 'named', isType: true },
          { name: 'ReactNode', type: 'named', isType: true },
          { name: 'ComponentType', type: 'named', isType: true },
          { name: 'useState', type: 'named' }, // no isType flag (runtime)
          { name: 'useEffect', type: 'named' }, // no isType flag (runtime)
        ],
        '@mui/material': [
          { name: 'Button', type: 'named' }, // no isType flag (runtime)
          { name: 'ButtonProps', type: 'named', isType: true },
          { name: 'TextField', type: 'named' }, // no isType flag (runtime)
          { name: 'TextFieldProps', type: 'named', isType: true },
        ],
        typescript: [
          { name: 'TSConfig', type: 'named', isType: true }, // type-only module
        ],
      });

      // Verify that externals array is set on the code object
      expect(result.code.externals).toEqual(['react', '@mui/material', 'typescript']);
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

      const result = await loadCodeVariant('file:///main.ts', 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true,
      });

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

      const result = await loadCodeVariant('file:///main.ts', 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true,
      });

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

      const result = await loadCodeVariant(
        variantUrl,
        'default',
        variantUrl, // String variant
        {
          sourceParser: undefined, // parseSource
          loadSource: mockLoadSource,
          loadVariantMeta: undefined, // loadVariantMeta - this is the key test case
          sourceTransformers: mockSourceTransformers,
          disableParsing: true,
        },
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

      const result = await loadCodeVariant(variantUrl, 'default', variantUrl, {
        sourceParser: undefined,
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta, // Provided loadVariantMeta
        sourceTransformers: mockSourceTransformers,
        disableParsing: true,
      });

      // The result includes the original variant plus computed fields
      expect(result.code).toMatchObject(customVariant);
      expect(result.code.language).toBe('tsx'); // Derived from fileName extension
      expect(mockLoadVariantMeta).toHaveBeenCalledWith('default', variantUrl);
      expect(mockLoadSource).not.toHaveBeenCalled(); // Should use provided source
    });
  });

  describe('Optional URL handling', () => {
    it('should handle undefined URL gracefully when fileName is also undefined', async () => {
      const variant: VariantCode = {
        fileName: undefined, // No fileName
        source: 'const x = 1;',
        // No URL provided
      };

      const result = await loadCodeVariant(
        undefined, // undefined URL
        'default',
        variant,
        {
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          sourceTransformers: mockSourceTransformers,
          disableParsing: true,
        },
      );

      // Should return the code with basic HAST node since no processing can be done
      expect(result.code).toEqual({
        fileName: undefined,
        source: {
          type: 'root',
          children: [
            {
              type: 'text',
              value: 'const x = 1;',
            },
          ],
        },
      });

      // No transformations or parsing should occur
      expect(mockLoadSource).not.toHaveBeenCalled();
      expect(mockParseSource).not.toHaveBeenCalled();
      expect(mockSourceTransformers[0].transformer).not.toHaveBeenCalled();
    });

    it('should process normally when URL is undefined but fileName is provided', async () => {
      const variant: VariantCode = {
        fileName: 'test.ts',
        source: 'const x = 1;',
        // No URL provided
      };

      const result = await loadCodeVariant(
        undefined, // undefined URL
        'default',
        variant,
        {
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          sourceTransformers: mockSourceTransformers,
          disableParsing: true,
        },
      );

      // Should still transform even without URL since fileName is available
      expect(result.code.fileName).toBe('test.ts');
      expect(result.code.source).toBe('const x = 1;');

      // Transformations should still occur since fileName is available
      expect(mockSourceTransformers[0].transformer).toHaveBeenCalledWith('const x = 1;', 'test.ts');
    });
  });

  describe('globalsCode functionality', () => {
    it('should inject globalsCode as a VariantCode object into extraFiles', async () => {
      const variant: VariantCode = {
        fileName: 'main.ts',
        source: 'const main = true;',
      };

      const globalsCode: VariantCode = {
        fileName: 'global.ts',
        source: 'const global = true;',
      };

      const result = await loadCodeVariant(undefined, 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true,
        globalsCode: [globalsCode],
      });

      expect(result.code.fileName).toBe('main.ts');
      expect(result.code.source).toBe('const main = true;');
      // When globalsCode has no extraFiles, the main variant may not have extraFiles either
      if (result.code.extraFiles) {
        // Check that the original filename is not included (since we don't include the root file)
        expect(result.code.extraFiles['global.ts']).toBeUndefined();
        expect(Object.keys(result.code.extraFiles)).toEqual([]);
      } else {
        // extraFiles is undefined because there are no extra files to add
        expect(result.code.extraFiles).toBeUndefined();
      }
    });

    it('should inject globalsCode as a URL string into extraFiles', async () => {
      const variant: VariantCode = {
        fileName: 'main.ts',
        source: 'const main = true;',
      };

      const globalsUrl = 'file:///global.ts';

      mockLoadVariantMeta.mockResolvedValue({
        url: globalsUrl,
        fileName: 'global.ts',
        source: 'const sideEffect = true;',
      });

      const result = await loadCodeVariant(undefined, 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true,
        globalsCode: [globalsUrl],
      });

      expect(result.code.fileName).toBe('main.ts');
      expect(result.code.source).toBe('const main = true;');
      // When globalsCode has no extraFiles, the main variant may not have extraFiles either
      if (result.code.extraFiles) {
        expect(result.code.extraFiles['sideEffect_global.ts']).toBeUndefined();
        expect(Object.keys(result.code.extraFiles)).toEqual([]);
      } else {
        // extraFiles is undefined because there are no extra files to add
        expect(result.code.extraFiles).toBeUndefined();
      }
      expect(mockLoadVariantMeta).toHaveBeenCalledWith('default', globalsUrl);
    });

    it('should handle globalsCode with extraFiles', async () => {
      const variant: VariantCode = {
        fileName: 'main.ts',
        source: 'const main = true;',
      };

      const globalsCode: VariantCode = {
        fileName: 'global.ts',
        source: 'const sideEffect = true;',
        extraFiles: {
          'helper.ts': {
            source: 'const helper = true;',
          },
        },
      };

      const result = await loadCodeVariant(undefined, 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true,
        globalsCode: [globalsCode],
      });

      expect(result.code.fileName).toBe('main.ts');
      expect(result.code.source).toBe('const main = true;');
      expect(result.code.extraFiles).toBeDefined();
      // Only extraFiles from globalsCode should be included, not the root file itself
      expect(result.code.extraFiles!['global.ts']).toBeUndefined(); // Root file not included
      expect(result.code.extraFiles!['helper.ts']).toBeDefined(); // Original filename should be used
      expect((result.code.extraFiles!['helper.ts'] as any).source).toBe('const helper = true;');
      // Globals files should be marked with metadata: true
      expect((result.code.extraFiles!['helper.ts'] as any).metadata).toBe(true);
    });

    it('should not interfere with allFilesListed from the main variant', async () => {
      const variant: VariantCode = {
        fileName: 'main.ts',
        source: 'const main = true;',
        allFilesListed: true,
      };

      const globalsCode: VariantCode = {
        fileName: 'global.ts',
        source: 'const sideEffect = true;',
      };

      const result = await loadCodeVariant(undefined, 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true,
        globalsCode: [globalsCode],
      });

      expect(result.code.allFilesListed).toBe(true);
      // When globalsCode has no extraFiles, the main variant may not have extraFiles either
      if (result.code.extraFiles) {
        expect(result.code.extraFiles['sideEffect_global.ts']).toBeUndefined();
        expect(Object.keys(result.code.extraFiles)).toEqual([]);
      } else {
        // extraFiles is undefined because there are no extra files to add
        expect(result.code.extraFiles).toBeUndefined();
      }
    });

    it('should handle globalsCode externals', async () => {
      const variant: VariantCode = {
        fileName: 'main.ts',
        source: 'const main = true;',
      };

      const globalsUrl = 'file:///global.ts';

      mockLoadVariantMeta.mockResolvedValue({
        url: globalsUrl,
        fileName: 'global.ts',
      });

      mockLoadSource.mockResolvedValue({
        source: 'import React from "react"; const sideEffect = true;',
        externals: {
          react: [{ name: 'React', type: 'default' }],
        },
      });

      const result = await loadCodeVariant(undefined, 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true,
        globalsCode: [globalsUrl],
      });

      expect(result.externals).toEqual({
        react: [{ name: 'React', type: 'default' }],
      });
      expect(result.code.externals).toEqual(['react']);
    });

    it('should prevent infinite recursion with nested globalsCode', async () => {
      const variant: VariantCode = {
        fileName: 'main.ts',
        source: 'const main = true;',
      };

      const globalsCode: VariantCode = {
        fileName: 'global.ts',
        source: 'const sideEffect = true;',
      };

      // Mock loadCodeVariant to be called recursively
      const originalLoadVariant = loadCodeVariant;

      const result = await originalLoadVariant(undefined, 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true,
        globalsCode: [globalsCode],
      });

      // When globalsCode has no extraFiles, extraFiles may be undefined
      if (result.code.extraFiles) {
        expect(result.code.extraFiles['sideEffect_global.ts']).toBeUndefined();
      } else {
        expect(result.code.extraFiles).toBeUndefined();
      }
      // Should complete without infinite recursion
    });

    it('should handle globalsCode URL without loadVariantMeta fallback', async () => {
      const variant: VariantCode = {
        fileName: 'main.ts',
        source: 'const main = true;',
      };

      const globalsUrl = 'file:///global.ts';

      mockLoadSource.mockResolvedValue({
        source: 'const sideEffect = true;',
      });

      const result = await loadCodeVariant(undefined, 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: undefined, // No loadVariantMeta
        sourceTransformers: mockSourceTransformers,
        disableParsing: true,
        globalsCode: [globalsUrl],
      });

      // When globalsCode has no extraFiles, the main variant may not have extraFiles either
      if (result.code.extraFiles) {
        expect(result.code.extraFiles['sideEffect_global.ts']).toBeUndefined();
        expect(Object.keys(result.code.extraFiles)).toEqual([]);
      } else {
        // extraFiles is undefined because there are no extra files to add
        expect(result.code.extraFiles).toBeUndefined();
      }
    });

    it('should throw error for invalid globalsCode URL without fileName', async () => {
      const variant: VariantCode = {
        fileName: 'main.ts',
        source: 'const main = true;',
      };

      const invalidUrl = 'file:///invalid';

      await expect(
        loadCodeVariant(undefined, 'default', variant, {
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: undefined, // No loadVariantMeta
          sourceTransformers: mockSourceTransformers,
          disableParsing: true,
          globalsCode: [invalidUrl],
        }),
      ).rejects.toThrow('Failed to load globalsCode');
    });

    it('should throw error for globalsCode URL without valid file extension and no loadVariantMeta', async () => {
      const variant: VariantCode = {
        fileName: 'main.ts',
        source: 'const main = true;',
      };

      // Use a URL that returns empty fileName (like just a directory)
      const invalidUrl = 'file:///some-directory/';

      await expect(
        loadCodeVariant(undefined, 'default', variant, {
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: undefined, // No loadVariantMeta
          sourceTransformers: mockSourceTransformers,
          disableParsing: true,
          globalsCode: [invalidUrl],
        }),
      ).rejects.toThrow('Cannot determine fileName from globalsCode URL');
    });

    it('should handle CSS modules use case with theme files', async () => {
      const variant: VariantCode = {
        fileName: 'Component.tsx',
        source: 'const Component = () => <div>Hello</div>;',
      };

      const globalsCode: VariantCode = {
        url: 'file:///demo-data/theme/css-modules/index.ts',
        fileName: 'index.ts',
        source: "import './theme.css'",
        extraFiles: {
          'theme.css': {
            source: '.theme { color: red; }',
          },
        },
      };

      const result = await loadCodeVariant(undefined, 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true,
        globalsCode: [globalsCode],
      });

      expect(result.code.fileName).toBe('Component.tsx');
      expect(result.code.source).toBe('const Component = () => <div>Hello</div>;');
      expect(result.code.extraFiles).toBeDefined();

      // Should NOT inject the global index.ts file (root file is excluded)
      expect(result.code.extraFiles!['index.ts']).toBeUndefined();

      // Should inject the global CSS file (extraFiles are included)
      expect(result.code.extraFiles!['theme.css']).toBeDefined(); // Original filename should be used
      expect((result.code.extraFiles!['theme.css'] as any).source).toBe('.theme { color: red; }');
    });

    it('should handle filename conflicts with global_ prefix', async () => {
      const variant: VariantCode = {
        fileName: 'main.ts',
        source: 'const main = true;',
        extraFiles: {
          'theme.css': {
            source: '.main-theme { color: blue; }',
          },
        },
      };

      const globalsCode: VariantCode = {
        fileName: 'setup.ts',
        source: 'console.log("setup");',
        extraFiles: {
          'theme.css': {
            source: '.side-effect-theme { color: red; }',
          },
        },
      };

      const result = await loadCodeVariant(undefined, 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true,
        globalsCode: [globalsCode],
      });

      expect(result.code.fileName).toBe('main.ts');
      expect(result.code.source).toBe('const main = true;');
      expect(result.code.extraFiles).toBeDefined();

      // Original theme.css from main variant should remain
      expect(result.code.extraFiles!['theme.css']).toBeDefined();
      expect((result.code.extraFiles!['theme.css'] as any).source).toBe(
        '.main-theme { color: blue; }',
      );

      // Conflicting theme.css from globalsCode should get global_ prefix
      expect(result.code.extraFiles!['global_theme.css']).toBeDefined();
      expect((result.code.extraFiles!['global_theme.css'] as any).source).toBe(
        '.side-effect-theme { color: red; }',
      );
    });

    it('should handle filename conflicts with numbered suffixes', async () => {
      const variant: VariantCode = {
        fileName: 'main.ts',
        source: 'const main = true;',
        extraFiles: {
          'config.js': {
            source: 'const config1 = {};',
          },
          'global_config.js': {
            source: 'const config2 = {};',
          },
        },
      };

      const globalsCode: VariantCode = {
        fileName: 'setup.ts',
        source: 'console.log("setup");',
        extraFiles: {
          'config.js': {
            source: 'const sideEffectConfig = {};',
          },
        },
      };

      const result = await loadCodeVariant(undefined, 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true,
        globalsCode: [globalsCode],
      });

      expect(result.code.fileName).toBe('main.ts');
      expect(result.code.source).toBe('const main = true;');
      expect(result.code.extraFiles).toBeDefined();

      // Original files should remain
      expect(result.code.extraFiles!['config.js']).toBeDefined();
      expect((result.code.extraFiles!['config.js'] as any).source).toBe('const config1 = {};');
      expect(result.code.extraFiles!['global_config.js']).toBeDefined();
      expect((result.code.extraFiles!['global_config.js'] as any).source).toBe(
        'const config2 = {};',
      );

      // Conflicting file should get numbered suffix
      expect(result.code.extraFiles!['global_config_1.js']).toBeDefined();
      expect((result.code.extraFiles!['global_config_1.js'] as any).source).toBe(
        'const sideEffectConfig = {};',
      );
    });

    it('should handle multiple globalsCode items', async () => {
      const variant: VariantCode = {
        fileName: 'main.ts',
        source: 'const main = true;',
      };

      const globalsCode1: VariantCode = {
        fileName: 'global1.css',
        source: '.global1 { color: red; }',
        extraFiles: {
          'utils1.js': { source: 'const utils1 = {};' },
        },
      };

      const globalsCode2: VariantCode = {
        fileName: 'global2.css',
        source: '.global2 { color: blue; }',
        extraFiles: {
          'utils2.js': { source: 'const utils2 = {};' },
        },
      };

      const result = await loadCodeVariant(undefined, 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true,
        globalsCode: [globalsCode1, globalsCode2],
      });

      expect(result.code.fileName).toBe('main.ts');
      expect(result.code.source).toBe('const main = true;');

      // Should have extraFiles from both globals
      expect(result.code.extraFiles).toBeDefined();
      expect(result.code.extraFiles!['utils1.js']).toBeDefined();
      expect((result.code.extraFiles!['utils1.js'] as any).source).toBe('const utils1 = {};');
      expect(result.code.extraFiles!['utils2.js']).toBeDefined();
      expect((result.code.extraFiles!['utils2.js'] as any).source).toBe('const utils2 = {};');

      // Should mark global files with metadata: true
      expect((result.code.extraFiles!['utils1.js'] as any).metadata).toBe(true);
      expect((result.code.extraFiles!['utils2.js'] as any).metadata).toBe(true);
    });

    it('should avoid reloading globalsCode when already resolved as VariantCode objects', async () => {
      const variant: VariantCode = {
        fileName: 'main.ts',
        source: 'const main = true;',
      };

      // Pre-resolved globalsCode as VariantCode (as would come from loadCodeFallback)
      const preResolvedGlobalsCode: VariantCode = {
        fileName: 'global-theme.css',
        url: 'file:///themes/global-theme.css',
        source: '.global-theme { color: purple; }',
        extraFiles: {
          'variables.css': {
            source: ':root { --primary: #007bff; }',
          },
        },
      };

      const result = await loadCodeVariant(undefined, 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true,
        globalsCode: [preResolvedGlobalsCode],
      });

      // Should not call loadVariantMeta or loadSource since globalsCode is already resolved
      expect(mockLoadVariantMeta).not.toHaveBeenCalled();
      expect(mockLoadSource).not.toHaveBeenCalled();

      // Should include extraFiles from the pre-resolved globalsCode
      expect(result.code.extraFiles).toBeDefined();
      expect(result.code.extraFiles!['variables.css']).toBeDefined();
      expect((result.code.extraFiles!['variables.css'] as any).source).toBe(
        ':root { --primary: #007bff; }',
      );
      expect((result.code.extraFiles!['variables.css'] as any).metadata).toBe(true);
    });

    it('should handle mixed resolved and unresolved globalsCode efficiently', async () => {
      const variant: VariantCode = {
        fileName: 'main.ts',
        source: 'const main = true;',
      };

      // Mix of pre-resolved (from loadCodeFallback) and URL string (needs loading)
      const preResolvedGlobalsCode: VariantCode = {
        fileName: 'theme.css',
        source: '.theme { color: red; }',
        extraFiles: {
          'theme-vars.css': { source: ':root { --theme-color: red; }' },
        },
      };

      const unresolvedGlobalsUrl = 'file:///config/global-config.js';

      mockLoadVariantMeta.mockResolvedValue({
        fileName: 'global-config.js',
        url: unresolvedGlobalsUrl,
        source: 'window.APP_CONFIG = { theme: "dark" };',
        extraFiles: {
          'config-types.d.ts': {
            source: 'declare global { interface Window { APP_CONFIG: any; } }',
          },
        },
      });

      const result = await loadCodeVariant(undefined, 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true,
        globalsCode: [preResolvedGlobalsCode, unresolvedGlobalsUrl],
      });

      // Should only call loadVariantMeta for the unresolved URL
      expect(mockLoadVariantMeta).toHaveBeenCalledTimes(1);
      expect(mockLoadVariantMeta).toHaveBeenCalledWith('default', unresolvedGlobalsUrl);

      // Should include extraFiles from both resolved and unresolved globalsCode
      expect(result.code.extraFiles).toBeDefined();
      expect(result.code.extraFiles!['theme-vars.css']).toBeDefined();
      expect((result.code.extraFiles!['theme-vars.css'] as any).source).toBe(
        ':root { --theme-color: red; }',
      );
      expect(result.code.extraFiles!['config-types.d.ts']).toBeDefined();
      expect((result.code.extraFiles!['config-types.d.ts'] as any).source).toBe(
        'declare global { interface Window { APP_CONFIG: any; } }',
      );
    });

    it('should handle cross-variant globalsCode sharing correctly', async () => {
      // Scenario: loadCodeFallback processes one variant with globalsCode
      // Then other variants processed by loadCodeVariant should still get the same globalsCode

      const variant: VariantCode = {
        fileName: 'Component.tsx',
        source: 'const Component = () => <div>Component</div>;',
      };

      // Shared globalsCode that would be resolved by loadCodeFallback and passed to all variants
      const sharedGlobalsCode: VariantCode = {
        fileName: 'shared-styles.css',
        source: '.shared { font-family: Arial; }',
        extraFiles: {
          'reset.css': { source: '* { margin: 0; padding: 0; }' },
          'theme.css': { source: ':root { --primary: blue; }' },
        },
      };

      const result = await loadCodeVariant('file:///Component.tsx', 'typescript', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true,
        globalsCode: [sharedGlobalsCode],
      });

      // Should include all shared global files
      expect(result.code.extraFiles).toBeDefined();
      expect(result.code.extraFiles!['reset.css']).toBeDefined();
      expect((result.code.extraFiles!['reset.css'] as any).source).toBe(
        '* { margin: 0; padding: 0; }',
      );
      expect(result.code.extraFiles!['theme.css']).toBeDefined();
      expect((result.code.extraFiles!['theme.css'] as any).source).toBe(
        ':root { --primary: blue; }',
      );

      // Should mark global files as metadata: true
      expect((result.code.extraFiles!['reset.css'] as any).metadata).toBe(true);
      expect((result.code.extraFiles!['theme.css'] as any).metadata).toBe(true);

      // Should include the variant URL in dependencies but not the resolved globalsCode URL
      expect(result.dependencies).toEqual(['file:///Component.tsx']);
    });

    it('should load globalsCode when loadCodeFallback skips early return', async () => {
      // Scenario: loadCodeFallback takes early return without processing globalsCode
      // loadCodeVariant should handle the globalsCode loading

      const variant: VariantCode = {
        fileName: 'QuickComponent.tsx',
        source: 'const QuickComponent = () => <span>Quick</span>;',
        allFilesListed: true, // This would trigger early return in loadCodeFallback
      };

      const globalsUrl = 'file:///styles/global-animations.css';

      mockLoadVariantMeta.mockResolvedValue({
        fileName: 'global-animations.css',
        url: globalsUrl,
        source: '@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }',
        extraFiles: {
          'animation-utils.css': { source: '.fade-in { animation: fadeIn 0.3s ease-in; }' },
        },
      });

      const result = await loadCodeVariant('file:///QuickComponent.tsx', 'default', variant, {
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: mockSourceTransformers,
        disableParsing: true,
        globalsCode: [globalsUrl],
      });

      // Should call loadVariantMeta to resolve the globalsCode URL
      expect(mockLoadVariantMeta).toHaveBeenCalledWith('default', globalsUrl);

      // Should include the loaded globalsCode extraFiles
      expect(result.code.extraFiles).toBeDefined();
      expect(result.code.extraFiles!['animation-utils.css']).toBeDefined();
      expect((result.code.extraFiles!['animation-utils.css'] as any).source).toBe(
        '.fade-in { animation: fadeIn 0.3s ease-in; }',
      );
      expect((result.code.extraFiles!['animation-utils.css'] as any).metadata).toBe(true);

      // Should include main variant URL in dependencies, but not necessarily globalsCode URL
      // since globalsCode processing may or may not add URLs to dependencies depending on implementation
      expect(result.dependencies).toContain('file:///QuickComponent.tsx');
    });
  });
});

describe('loadCodeVariant - helper functions', () => {
  // Tests for helper function behavior through integration

  describe('allFilesListed validation', () => {
    it('should throw error in non-production when allFilesListed=true and loadSource returns unknown extra files', async () => {
      const originalEnv = process.env.NODE_ENV;
      // @ts-expect-error
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
          loadCodeVariant('file:///Button.tsx', 'default', 'file:///Button.tsx', {
            sourceParser: undefined,
            loadSource: mockLoadSource,
            loadVariantMeta: mockLoadVariantMeta,
            sourceTransformers: undefined,
            disableParsing: true,
          }),
        ).rejects.toThrow(
          'Unexpected files discovered via loadSource when allFilesListed=true (variant: default, file: Button.tsx). ' +
            'New files: helper.js. ' +
            'Please update the loadVariantMeta function to provide the complete list of files upfront.',
        );
      } finally {
        // @ts-expect-error
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('should console.warn in production when allFilesListed=true and loadSource returns unknown extra files', async () => {
      const originalEnv = process.env.NODE_ENV;
      // @ts-expect-error
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

        const result = await loadCodeVariant(
          'file:///Button.tsx',
          'default',
          'file:///Button.tsx',
          {
            sourceParser: undefined,
            loadSource: mockLoadSource,
            loadVariantMeta: mockLoadVariantMeta,
            sourceTransformers: undefined,
            disableParsing: true,
          },
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
        // @ts-expect-error
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

      const result = await loadCodeVariant('file:///Button.tsx', 'default', 'file:///Button.tsx', {
        sourceParser: undefined,
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: undefined,
        disableParsing: true,
      });

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

      const result = await loadCodeVariant('file:///Button.tsx', 'default', 'file:///Button.tsx', {
        sourceParser: undefined,
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        sourceTransformers: undefined,
        disableParsing: true,
      });

      // Should work normally and include the discovered files
      expect(result.code.extraFiles).toBeDefined();
      expect(result.code.extraFiles!['helper.js']).toBeDefined();
    });

    it('should allow extraDependencies from loadSource when allFilesListed=true', async () => {
      const originalEnv = process.env.NODE_ENV;
      // @ts-expect-error
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

        const result = await loadCodeVariant(
          'file:///Button.tsx',
          'default',
          'file:///Button.tsx',
          {
            sourceParser: undefined,
            loadSource: mockLoadSource,
            loadVariantMeta: mockLoadVariantMeta,
            sourceTransformers: undefined,
            disableParsing: true,
          },
        );

        // extraDependencies should not cause errors since they're internal/webpack dependencies
        expect(result.code.source).toBe('const Button = () => <button>Click</button>;');
        expect(result.dependencies).toEqual([
          'file:///Button.tsx',
          'file:///path/to/dependency.js',
        ]);
      } finally {
        // @ts-expect-error
        process.env.NODE_ENV = originalEnv;
      }
    });
  });

  describe('language field derivation', () => {
    it('should derive language from fileName extension', async () => {
      const variant: VariantCode = {
        fileName: 'Component.tsx',
        source: 'const Component = () => <div />;',
      };

      const result = await loadCodeVariant('file:///Component.tsx', 'default', variant, {
        disableParsing: true,
      });

      expect(result.code.language).toBe('tsx');
    });

    it('should derive language from URL when fileName is not provided', async () => {
      const localMockLoadSource = vi.fn<LoadSource>().mockResolvedValue({
        source: 'const x = 1;',
      });

      const result = await loadCodeVariant(
        'file:///src/utils.ts',
        'default',
        'file:///src/utils.ts',
        {
          loadSource: localMockLoadSource,
          disableParsing: true,
        },
      );

      expect(result.code.language).toBe('typescript');
    });

    it.each([
      ['Component.tsx', 'tsx'],
      ['Component.jsx', 'jsx'],
      ['utils.ts', 'typescript'],
      ['utils.js', 'javascript'],
      ['styles.css', 'css'],
      ['README.md', 'markdown'],
      ['docs.mdx', 'mdx'],
      ['index.html', 'html'],
      ['config.json', 'json'],
      ['script.sh', 'shell'],
      ['config.yaml', 'yaml'],
    ])('should derive language "%s" from fileName "%s"', async (fileName, expectedLanguage) => {
      const variant: VariantCode = {
        fileName,
        source: '// content',
      };

      const result = await loadCodeVariant(`file:///${fileName}`, 'default', variant, {
        disableParsing: true,
      });

      expect(result.code.language).toBe(expectedLanguage);
    });

    it('should normalize short language aliases to canonical names', async () => {
      const variant: VariantCode = {
        source: 'console.log("test");',
        language: 'js', // Short alias should be normalized to 'javascript'
      };

      const result = await loadCodeVariant(undefined, 'default', variant, {
        disableParsing: true,
      });

      // Short alias should be normalized
      expect(result.code.language).toBe('javascript');
    });

    it.each([
      ['js', 'javascript'],
      ['ts', 'typescript'],
      ['md', 'markdown'],
      ['sh', 'shell'],
      ['bash', 'shell'],
      ['yml', 'yaml'],
    ])('should normalize language alias "%s" to "%s"', async (alias, expectedLanguage) => {
      const variant: VariantCode = {
        source: '// content',
        language: alias,
      };

      const result = await loadCodeVariant(undefined, 'default', variant, {
        disableParsing: true,
      });

      expect(result.code.language).toBe(expectedLanguage);
    });

    it('should preserve explicit language from variant over derived language', async () => {
      const variant: VariantCode = {
        fileName: 'Component.tsx',
        language: 'javascript', // Explicitly set different language
        source: 'const Component = () => <div />;',
      };

      const result = await loadCodeVariant('file:///Component.tsx', 'default', variant, {
        disableParsing: true,
      });

      // Explicit language should be preserved
      expect(result.code.language).toBe('javascript');
    });

    it('should return undefined language for unknown extensions', async () => {
      const variant: VariantCode = {
        fileName: 'file.unknown',
        source: 'content',
      };

      const result = await loadCodeVariant('file:///file.unknown', 'default', variant, {
        disableParsing: true,
      });

      expect(result.code.language).toBeUndefined();
    });

    it('should return undefined language when no fileName and no URL', async () => {
      const variant: VariantCode = {
        source: 'const x = 1;',
      };

      const result = await loadCodeVariant(undefined, 'default', variant, {
        disableParsing: true,
      });

      expect(result.code.language).toBeUndefined();
    });

    it('should include language in result when using loadVariantMeta', async () => {
      const variantUrl = 'file:///src/Button.tsx';
      const customVariant: VariantCode = {
        url: variantUrl,
        fileName: 'Button.tsx',
        source: 'const Button = () => <button>Click</button>;',
        allFilesListed: true,
      };

      const localMockLoadVariantMeta = vi.fn<LoadVariantMeta>().mockResolvedValue(customVariant);

      const result = await loadCodeVariant(variantUrl, 'default', variantUrl, {
        loadVariantMeta: localMockLoadVariantMeta,
        disableParsing: true,
      });

      expect(result.code.language).toBe('tsx');
    });
  });
});
