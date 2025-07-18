import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MockedFunction } from 'vitest';

import { loadFallbackCode } from './loadFallbackCode';
import type {
  Code,
  LoadCodeMeta,
  LoadVariantMeta,
  LoadSource,
  ParseSource,
  VariantCode,
} from './types';

/**
 * Tests for loadFallbackCode function.
 *
 * This test suite focuses on the core fallback logic and optimization strategies:
 * - Early return optimizations when allFilesListed=true
 * - Fallback to loadVariant when extra processing is needed
 * - Initial filename handling and file selection
 * - Integration with loadVariantMeta for variant resolution
 *
 * Note: URL/filename parsing is thoroughly tested in getFileNameFromUrl.test.ts
 */
describe('loadFallbackCode', () => {
  let mockLoadCodeMeta: MockedFunction<LoadCodeMeta>;
  let mockLoadVariantMeta: MockedFunction<LoadVariantMeta>;
  let mockLoadSource: MockedFunction<LoadSource>;
  let mockParseSource: MockedFunction<ParseSource>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadCodeMeta = vi.fn();
    mockLoadVariantMeta = vi.fn();
    mockLoadSource = vi.fn();
    mockParseSource = vi.fn();
  });

  describe('Early return optimization with allFilesListed', () => {
    it('should return early when variant has allFilesListed=true and no extra processing needed', async () => {
      const variantCode: VariantCode = {
        fileName: 'App.tsx',
        url: 'http://example.com/App.tsx',
        source: 'const App = () => <div>Hello</div>;',
        extraFiles: {
          'utils.ts': { source: 'export const helper = () => {};' },
        },
        allFilesListed: true,
      };

      const loaded: Code = {
        default: variantCode,
      };

      const result = await loadFallbackCode(
        'http://example.com',
        'default',
        loaded,
        false, // shouldHighlight
        false, // fallbackUsesExtraFiles
        false, // fallbackUsesAllVariants
        mockParseSource,
        mockLoadSource,
        mockLoadVariantMeta,
        mockLoadCodeMeta,
      );

      // Verify the optimization worked - we got the right results
      expect(result.allFileNames).toEqual(['App.tsx', 'utils.ts']);
      expect(result.initialFilename).toBe('App.tsx');
      expect(result.initialSource).toBe('const App = () => <div>Hello</div>;');
      expect(result.code.default).toEqual(variantCode);
    });

    it('should parse source when shouldHighlight=true in early return path', async () => {
      const variantCode: VariantCode = {
        fileName: 'App.tsx',
        url: 'http://example.com/App.tsx',
        source: 'const App = () => <div>Hello</div>;',
        allFilesListed: true,
      };

      const loaded: Code = { default: variantCode };
      const parsedSource = { type: 'root', children: [] } as any;
      mockParseSource.mockResolvedValue(parsedSource);

      const result = await loadFallbackCode(
        'http://example.com',
        'default',
        loaded,
        true, // shouldHighlight
        false,
        false,
        mockParseSource,
        mockLoadSource,
        mockLoadVariantMeta,
        mockLoadCodeMeta,
      );

      expect(mockParseSource).toHaveBeenCalledWith(
        'const App = () => <div>Hello</div>;',
        'App.tsx',
      );
      expect(result.initialSource).toBe(parsedSource);
    });

    it('should load specific file when initialFilename is provided', async () => {
      const variantCode: VariantCode = {
        fileName: 'App.tsx',
        url: 'http://example.com/App.tsx',
        source: 'const App = () => <div>Hello</div>;',
        extraFiles: {
          'utils.ts': 'http://example.com/utils.ts', // URL, needs to be loaded
        },
        allFilesListed: true,
      };

      const loaded: Code = { default: variantCode };
      mockLoadSource.mockResolvedValue({
        source: 'export const helper = () => {};',
        extraFiles: {},
      });

      const result = await loadFallbackCode(
        'http://example.com',
        'default',
        loaded,
        false,
        false,
        false,
        mockParseSource,
        mockLoadSource,
        mockLoadVariantMeta,
        mockLoadCodeMeta,
        'utils.ts', // initialFilename
      );

      expect(mockLoadSource).toHaveBeenCalledWith('http://example.com/utils.ts');
      expect(result.initialFilename).toBe('utils.ts');
      expect(result.initialSource).toBe('export const helper = () => {};');
    });
  });

  describe('Early return with loadVariantMeta optimization', () => {
    it('should use loadVariantMeta and return early when allFilesListed=true', async () => {
      const loaded: Code = { default: 'http://example.com/default' };
      const variantCode: VariantCode = {
        fileName: 'App.tsx',
        url: 'http://example.com/App.tsx',
        source: 'const App = () => <div>Hello</div>;',
        allFilesListed: true,
      };

      mockLoadVariantMeta.mockResolvedValue(variantCode);

      const result = await loadFallbackCode(
        'http://example.com',
        'default',
        loaded,
        false,
        false,
        false,
        mockParseSource,
        mockLoadSource,
        mockLoadVariantMeta,
        mockLoadCodeMeta,
      );

      expect(mockLoadVariantMeta).toHaveBeenCalledWith('default', 'http://example.com/default');
      expect(result.allFileNames).toEqual(['App.tsx']);
      expect(result.initialSource).toBe('const App = () => <div>Hello</div>;');
    });
  });

  describe('Fallback to full loadVariant processing', () => {
    it('should process through loadVariant when allFilesListed=false', async () => {
      const variantCode: VariantCode = {
        fileName: 'App.tsx',
        url: 'http://example.com/App.tsx',
        source: 'const App = () => <div>Hello</div>;',
        allFilesListed: false, // Forces full processing
      };

      const loaded: Code = { default: variantCode };

      const result = await loadFallbackCode(
        'http://example.com',
        'default',
        loaded,
        false,
        false,
        false,
        mockParseSource,
        mockLoadSource,
        mockLoadVariantMeta,
        mockLoadCodeMeta,
      );

      // Verify we got the expected results (loadVariant processes the variant)
      expect(result.initialSource).toBe('const App = () => <div>Hello</div>;');
      expect(result.allFileNames).toEqual(['App.tsx']);
    });

    it('should process through loadVariant when fallbackUsesExtraFiles=true', async () => {
      const variantCode: VariantCode = {
        fileName: 'App.tsx',
        url: 'http://example.com/App.tsx',
        source: 'const App = () => <div>Hello</div>;',
        allFilesListed: true, // Even with this true, should not early return
      };

      const loaded: Code = { default: variantCode };

      const result = await loadFallbackCode(
        'http://example.com',
        'default',
        loaded,
        false,
        true, // fallbackUsesExtraFiles
        false,
        mockParseSource,
        mockLoadSource,
        mockLoadVariantMeta,
        mockLoadCodeMeta,
      );

      expect(result.initialSource).toBe('const App = () => <div>Hello</div>;');
      expect(result.allFileNames).toEqual(['App.tsx']);
    });
  });

  describe('fallbackUsesAllVariants', () => {
    it('should load all variants and collect file names', async () => {
      const variant1: VariantCode = {
        fileName: 'App.tsx',
        url: 'http://example.com/App.tsx',
        source: 'const App = () => <div>Hello</div>;',
        allFilesListed: true,
      };

      const loaded: Code = {
        javascript: variant1,
        typescript: 'http://example.com/typescript',
      };

      const variant2: VariantCode = {
        fileName: 'App.tsx',
        url: 'http://example.com/App.tsx',
        source: 'const App = () => <div>Hello TypeScript</div>;',
        extraFiles: {
          'types.ts': { source: 'export type Props = {};' },
        },
        allFilesListed: true,
      };

      mockLoadVariantMeta.mockResolvedValue(variant2);

      const result = await loadFallbackCode(
        'http://example.com',
        'javascript',
        loaded,
        false,
        false,
        true, // fallbackUsesAllVariants
        mockParseSource,
        mockLoadSource,
        mockLoadVariantMeta,
        mockLoadCodeMeta,
      );

      expect(mockLoadVariantMeta).toHaveBeenCalledWith(
        'typescript',
        'http://example.com/typescript',
      );
      expect(result.allFileNames).toEqual(['App.tsx', 'types.ts']);
    });
  });

  describe('Error handling', () => {
    it('should throw error when initial variant not found after loadCodeMeta', async () => {
      mockLoadCodeMeta.mockResolvedValue({ otherVariant: 'something' });

      await expect(
        loadFallbackCode(
          'http://example.com',
          'nonexistent',
          undefined,
          false,
          false,
          false,
          mockParseSource,
          mockLoadSource,
          mockLoadVariantMeta,
          mockLoadCodeMeta,
        ),
      ).rejects.toThrow('Initial variant "nonexistent" not found in loaded code.');
    });

    it('should throw error when loadCodeMeta is required but not provided', async () => {
      await expect(
        loadFallbackCode(
          'http://example.com',
          'default',
          undefined, // no loaded code
          false,
          false,
          false,
          mockParseSource,
          mockLoadSource,
          mockLoadVariantMeta,
          undefined, // no loadCodeMeta function
        ),
      ).rejects.toThrow('"loadCodeMeta" function is required when initial variant is not provided');
    });

    it('should throw error when requested file cannot be found', async () => {
      const variantCode: VariantCode = {
        fileName: 'App.tsx',
        url: 'http://example.com/App.tsx',
        source: 'const App = () => <div>Hello</div>;',
        allFilesListed: true,
      };

      const loaded: Code = { default: variantCode };

      await expect(
        loadFallbackCode(
          'http://example.com',
          'default',
          loaded,
          false,
          false,
          false,
          mockParseSource,
          mockLoadSource,
          mockLoadVariantMeta,
          mockLoadCodeMeta,
          'nonexistent.ts', // initialFilename that doesn't exist
        ),
      ).rejects.toThrow('Failed to get source for file nonexistent.ts in variant default');
    });
  });

  describe('loadCodeMeta optimization', () => {
    it('should call loadCodeMeta when no initial variant is provided', async () => {
      const variantCode: VariantCode = {
        fileName: 'App.tsx',
        url: 'http://example.com/App.tsx',
        source: 'const App = () => <div>Hello</div>;',
        allFilesListed: true,
      };

      mockLoadCodeMeta.mockResolvedValue({ default: variantCode });

      const result = await loadFallbackCode(
        'http://example.com',
        'default',
        undefined, // no loaded code
        false,
        false,
        false,
        mockParseSource,
        mockLoadSource,
        mockLoadVariantMeta,
        mockLoadCodeMeta,
      );

      expect(mockLoadCodeMeta).toHaveBeenCalledWith('http://example.com');
      expect(result.initialSource).toBe('const App = () => <div>Hello</div>;');
    });
  });

  describe('Integration with loadVariant', () => {
    it('should handle complex variant with extra files that need loading', async () => {
      const variantCode: VariantCode = {
        fileName: 'App.tsx',
        url: 'http://example.com/App.tsx',
        source: 'import { helper } from "./utils";',
        extraFiles: {
          'utils.ts': 'http://example.com/utils.ts',
        },
        allFilesListed: false, // Will trigger loadVariant processing
      };

      mockLoadSource.mockResolvedValue({
        source: 'export const helper = () => "loaded";',
        extraFiles: {},
      });

      const result = await loadFallbackCode(
        'http://example.com',
        'default',
        { default: variantCode },
        false,
        false,
        false,
        mockParseSource,
        mockLoadSource,
        mockLoadVariantMeta,
        mockLoadCodeMeta,
      );

      // Verify loadVariant processed the variant and loaded dependencies
      expect(result.allFileNames).toContain('App.tsx');
      expect(result.allFileNames).toContain('utils.ts');
      expect(result.initialSource).toBe('import { helper } from "./utils";');
    });
  });

  describe('loadVariantMeta fallback behavior', () => {
    it('should create basic variant from URL string when loadVariantMeta is undefined', async () => {
      const variantUrl = 'file:///src/components/Button.tsx';
      mockLoadCodeMeta.mockResolvedValue({
        default: variantUrl,
      });
      mockLoadSource.mockResolvedValue({
        source: 'const Button = () => <button>Click me</button>;',
      });

      const result = await loadFallbackCode(
        'https://example.com',
        'default',
        {}, // loaded
        false, // shouldHighlight
        false, // fallbackUsesExtraFiles
        false, // fallbackUsesAllVariants
        mockParseSource, // parseSource
        mockLoadSource, // loadSource
        undefined, // loadVariantMeta - this is the key test case
        mockLoadCodeMeta, // loadCodeMeta
        'Button.tsx', // initialFilename
      );

      expect(result.code.default).toBeDefined();
      expect((result.code.default as VariantCode).url).toBe(variantUrl);
      expect((result.code.default as VariantCode).fileName).toBe('Button.tsx');
    });

    it('should handle various URL formats in fallback', async () => {
      const testCases = [
        {
          url: 'file:///src/components/Header.tsx',
          expectedFileName: 'Header.tsx',
        },
        {
          url: 'https://example.com/utils/constants.js',
          expectedFileName: 'constants.js',
        },
        {
          url: 'file:///index.ts',
          expectedFileName: 'index.ts',
        },
      ];

      for (const { url, expectedFileName } of testCases) {
        mockLoadCodeMeta.mockResolvedValue({
          default: url,
        });
        mockLoadSource.mockResolvedValue({
          source: 'const code = true;',
        });

        // eslint-disable-next-line no-await-in-loop
        const result = await loadFallbackCode(
          'https://example.com',
          'default',
          {}, // loaded
          false, // shouldHighlight
          false, // fallbackUsesExtraFiles
          false, // fallbackUsesAllVariants
          mockParseSource, // parseSource
          mockLoadSource, // loadSource
          undefined, // loadVariantMeta
          mockLoadCodeMeta, // loadCodeMeta
          expectedFileName, // initialFilename
        );

        expect(result.code.default).toBeDefined();
        expect((result.code.default as VariantCode).url).toBe(url);
        expect((result.code.default as VariantCode).fileName).toBe(expectedFileName);
      }
    });

    it('should still use loadVariantMeta when provided in loadFallbackCode', async () => {
      const variantUrl = 'file:///src/Button.tsx';
      const customVariant: VariantCode = {
        url: variantUrl,
        fileName: 'CustomButton.tsx',
        // Note: No source provided, so it should use loadSource
      };

      mockLoadCodeMeta.mockResolvedValue({
        default: variantUrl,
      });
      mockLoadVariantMeta.mockResolvedValue(customVariant);
      mockLoadSource.mockResolvedValue({
        source: 'const CustomButton = () => <button>Custom</button>;',
      });

      const result = await loadFallbackCode(
        'https://example.com',
        'default',
        {}, // loaded
        false, // shouldHighlight
        false, // fallbackUsesExtraFiles
        false, // fallbackUsesAllVariants
        mockParseSource, // parseSource
        mockLoadSource, // loadSource
        mockLoadVariantMeta, // Provided loadVariantMeta
        mockLoadCodeMeta, // loadCodeMeta
        'Button.tsx', // initialFilename
      );

      expect(result.code.default).toBeDefined();
      expect((result.code.default as VariantCode).fileName).toBe('CustomButton.tsx');
      expect(mockLoadVariantMeta).toHaveBeenCalledWith('default', variantUrl);
    });
  });
});
