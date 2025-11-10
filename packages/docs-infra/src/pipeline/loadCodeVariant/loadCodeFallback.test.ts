import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MockedFunction } from 'vitest';

import { loadCodeFallback } from './loadCodeFallback';
import { maybeCodeInitialData } from './maybeCodeInitialData';
import type {
  Code,
  LoadCodeMeta,
  LoadVariantMeta,
  LoadSource,
  ParseSource,
  VariantCode,
} from '../../CodeHighlighter/types';
import { loadCodeVariant } from './loadCodeVariant';

// Mock loadCodeVariant since loadCodeFallback now uses it for globalsCode processing
vi.mock('./loadCodeVariant', () => ({
  loadCodeVariant: vi.fn(),
}));

/**
 * Tests for loadCodeFallback function.
 *
 * This test suite focuses on the core fallback logic and optimization strategies:
 * - Early return optimizations when allFilesListed=true
 * - Fallback to loadCodeVariant when extra processing is needed
 * - Initial filename handling and file selection
 * - Integration with loadVariantMeta for variant resolution
 *
 * Note: URL/filename parsing is thoroughly tested in getFileNameFromUrl.test.ts
 */
describe('loadCodeFallback', () => {
  let mockLoadCodeMeta: MockedFunction<LoadCodeMeta>;
  let mockLoadVariantMeta: MockedFunction<LoadVariantMeta>;
  let mockLoadSource: MockedFunction<LoadSource>;
  let mockParseSource: MockedFunction<ParseSource>;
  let mockLoadVariant: MockedFunction<typeof loadCodeVariant>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadCodeMeta = vi.fn();
    mockLoadVariantMeta = vi.fn();
    mockLoadSource = vi.fn();
    mockParseSource = vi.fn();
    mockLoadVariant = vi.mocked(loadCodeVariant);

    // Setup default mock behavior for loadCodeVariant to return the input variant
    // with globalsCode processing simulated
    mockLoadVariant.mockImplementation(async (url, variantName, variantCode, options = {}) => {
      const { loadSource, loadVariantMeta } = options;

      // If variantCode is a string, we need to resolve it first using loadVariantMeta
      let processedVariant: VariantCode;

      if (typeof variantCode === 'string') {
        if (loadVariantMeta) {
          // Call the actual loadVariantMeta function that was passed in
          processedVariant = await loadVariantMeta(variantName, variantCode);
        } else {
          // Fallback to basic variant
          processedVariant = {
            url: variantCode,
            fileName: 'App.tsx',
            source: 'fallback source',
          };
        }
      } else {
        // variantCode is already a VariantCode object
        processedVariant = variantCode as VariantCode;
      }

      // If the processed variant is missing its source and has a URL, load it
      if (
        !processedVariant.source &&
        processedVariant.url &&
        loadSource &&
        mockLoadSource.getMockImplementation()
      ) {
        const loadedContent = await loadSource(processedVariant.url);
        processedVariant = {
          ...processedVariant,
          source: loadedContent.source,
        };
      }

      // Process the main variant's extraFiles (call loadSource for URL strings)
      if (processedVariant.extraFiles) {
        const processedExtraFiles = { ...processedVariant.extraFiles };
        await Promise.all(
          Object.entries(processedVariant.extraFiles).map(async ([fileName, fileContent]) => {
            if (
              typeof fileContent === 'string' &&
              loadSource &&
              mockLoadSource.getMockImplementation()
            ) {
              // String URL - call loadSource to resolve it
              const loadedContent = await loadSource(fileContent);
              processedExtraFiles[fileName] = {
                source: loadedContent.source,
              };
            }
            // Otherwise keep the file as-is (object with source)
          }),
        );

        processedVariant = {
          ...processedVariant,
          extraFiles: processedExtraFiles,
        };
      }

      if (options.globalsCode && Array.isArray(options.globalsCode)) {
        // Simulate merging globalsCode extraFiles into the variant
        const mergedExtraFiles = { ...processedVariant.extraFiles };
        const existingFiles = new Set(Object.keys(mergedExtraFiles));

        // Helper function to generate conflict-free filenames (mimics loadCodeVariant logic)
        const generateConflictFreeFilename = (originalFilename: string): string => {
          if (!existingFiles.has(originalFilename)) {
            return originalFilename;
          }

          const globalFilename = `global_${originalFilename}`;
          if (!existingFiles.has(globalFilename)) {
            return globalFilename;
          }

          // Split filename into name and extension for proper numbering
          const lastDotIndex = originalFilename.lastIndexOf('.');
          let nameWithoutExt: string;
          let extension: string;

          if (lastDotIndex === -1 || lastDotIndex === 0) {
            nameWithoutExt = originalFilename;
            extension = '';
          } else {
            nameWithoutExt = originalFilename.substring(0, lastDotIndex);
            extension = originalFilename.substring(lastDotIndex);
          }

          let counter = 1;
          let candidateName: string;
          do {
            candidateName = `global_${nameWithoutExt}_${counter}${extension}`;
            counter += 1;
          } while (existingFiles.has(candidateName));

          return candidateName;
        };

        await Promise.all(
          options.globalsCode.map(async (globalVariant) => {
            if (typeof globalVariant === 'string') {
              // String URL - call loadVariantMeta to resolve it
              if (loadVariantMeta && mockLoadVariantMeta.getMockImplementation()) {
                const resolvedVariant = await loadVariantMeta('default', globalVariant);
                if (resolvedVariant && resolvedVariant.extraFiles) {
                  await Promise.all(
                    Object.entries(resolvedVariant.extraFiles).map(
                      async ([fileName, fileContent]) => {
                        const conflictFreeFilename = generateConflictFreeFilename(fileName);

                        if (typeof fileContent === 'string') {
                          // String URL in resolved variant - call loadSource to resolve it
                          if (loadSource && mockLoadSource.getMockImplementation()) {
                            const loadedContent = await loadSource(fileContent);
                            mergedExtraFiles[conflictFreeFilename] = {
                              source: loadedContent.source,
                              metadata: true,
                            };
                          } else {
                            // Fallback if no loadSource
                            mergedExtraFiles[conflictFreeFilename] = fileContent;
                          }
                        } else {
                          // Object with source - mark globalsCode files with metadata: true
                          mergedExtraFiles[conflictFreeFilename] = {
                            ...fileContent,
                            metadata: true,
                          };
                        }
                        existingFiles.add(conflictFreeFilename);
                      },
                    ),
                  );
                }
              }
            } else if (typeof globalVariant === 'object' && globalVariant.extraFiles) {
              // VariantCode object - merge extraFiles with conflict resolution
              await Promise.all(
                Object.entries(globalVariant.extraFiles).map(async ([fileName, fileContent]) => {
                  const conflictFreeFilename = generateConflictFreeFilename(fileName);

                  if (typeof fileContent === 'string') {
                    // String URL - call loadSource to resolve it
                    if (loadSource && mockLoadSource.getMockImplementation()) {
                      const loadedContent = await loadSource(fileContent);
                      mergedExtraFiles[conflictFreeFilename] = {
                        source: loadedContent.source,
                        metadata: true,
                      };
                    } else {
                      // Fallback if no loadSource
                      mergedExtraFiles[conflictFreeFilename] = fileContent;
                    }
                  } else {
                    // Object with source - mark globalsCode files with metadata: true
                    mergedExtraFiles[conflictFreeFilename] = {
                      ...fileContent,
                      metadata: true,
                    };
                  }
                  existingFiles.add(conflictFreeFilename);
                }),
              );
            }
          }),
        );

        processedVariant = {
          ...processedVariant,
          extraFiles: mergedExtraFiles,
        };
      }

      return {
        code: processedVariant,
        dependencies: [],
        externals: {},
      };
    });
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

      const result = await loadCodeFallback('http://example.com', 'default', loaded, {
        shouldHighlight: false,
        fallbackUsesExtraFiles: false,
        fallbackUsesAllVariants: false,
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        loadCodeMeta: mockLoadCodeMeta,
      });

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
      mockParseSource.mockReturnValue(parsedSource);

      const result = await loadCodeFallback('http://example.com', 'default', loaded, {
        shouldHighlight: true,
        fallbackUsesExtraFiles: false,
        fallbackUsesAllVariants: false,
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        loadCodeMeta: mockLoadCodeMeta,
      });

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

      const result = await loadCodeFallback('http://example.com', 'default', loaded, {
        shouldHighlight: false,
        fallbackUsesExtraFiles: false,
        fallbackUsesAllVariants: false,
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        loadCodeMeta: mockLoadCodeMeta,
        initialFilename: 'utils.ts',
      });

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

      const result = await loadCodeFallback('http://example.com', 'default', loaded, {
        shouldHighlight: false,
        fallbackUsesExtraFiles: false,
        fallbackUsesAllVariants: false,
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        loadCodeMeta: mockLoadCodeMeta,
      });

      expect(mockLoadVariantMeta).toHaveBeenCalledWith('default', 'http://example.com/default');
      expect(result.allFileNames).toEqual(['App.tsx']);
      expect(result.initialSource).toBe('const App = () => <div>Hello</div>;');
    });
  });

  describe('Fallback to full loadCodeVariant processing', () => {
    it('should process through loadCodeVariant when allFilesListed=false', async () => {
      const variantCode: VariantCode = {
        fileName: 'App.tsx',
        url: 'http://example.com/App.tsx',
        source: 'const App = () => <div>Hello</div>;',
        allFilesListed: false, // Forces full processing
      };

      const loaded: Code = { default: variantCode };

      const result = await loadCodeFallback('http://example.com', 'default', loaded, {
        shouldHighlight: false,
        fallbackUsesExtraFiles: false,
        fallbackUsesAllVariants: false,
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        loadCodeMeta: mockLoadCodeMeta,
      });

      // Verify we got the expected results (loadCodeVariant processes the variant)
      expect(result.initialSource).toBe('const App = () => <div>Hello</div>;');
      expect(result.allFileNames).toEqual(['App.tsx']);
    });

    it('should process through loadCodeVariant when fallbackUsesExtraFiles=true', async () => {
      const variantCode: VariantCode = {
        fileName: 'App.tsx',
        url: 'http://example.com/App.tsx',
        source: 'const App = () => <div>Hello</div>;',
        allFilesListed: true, // Even with this true, should not early return
      };

      const loaded: Code = { default: variantCode };

      const result = await loadCodeFallback('http://example.com', 'default', loaded, {
        shouldHighlight: false,
        fallbackUsesExtraFiles: true,
        fallbackUsesAllVariants: false,
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        loadCodeMeta: mockLoadCodeMeta,
      });

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

      const result = await loadCodeFallback('http://example.com', 'javascript', loaded, {
        shouldHighlight: false,
        fallbackUsesExtraFiles: false,
        fallbackUsesAllVariants: true,
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        loadCodeMeta: mockLoadCodeMeta,
        initialFilename: undefined,
        variants: ['javascript', 'typescript'],
      });

      expect(mockLoadVariantMeta).toHaveBeenCalledWith(
        'typescript',
        'http://example.com/typescript',
      );
      expect(result.allFileNames).toEqual(['App.tsx', 'types.ts']);
    });

    it('should infer variants from loaded code when variants argument is not provided', async () => {
      const variant1: VariantCode = {
        fileName: 'App.tsx',
        url: 'http://example.com/App.tsx',
        source: 'const App = () => <div>Hello</div>;',
        allFilesListed: true,
      };

      const loaded: Code = {
        javascript: variant1,
        typescript: 'http://example.com/typescript',
        python: 'http://example.com/python',
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

      const variant3: VariantCode = {
        fileName: 'App.py',
        url: 'http://example.com/App.py',
        source: 'def app(): return "Hello Python"',
        allFilesListed: true,
      };

      mockLoadVariantMeta.mockImplementation(async (variantName) => {
        if (variantName === 'typescript') {
          return variant2;
        }
        if (variantName === 'python') {
          return variant3;
        }
        throw new Error(`Unexpected variant: ${variantName}`);
      });

      const result = await loadCodeFallback('http://example.com', 'javascript', loaded, {
        shouldHighlight: false,
        fallbackUsesExtraFiles: false,
        fallbackUsesAllVariants: true,
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        loadCodeMeta: mockLoadCodeMeta,
        initialFilename: undefined,
        variants: undefined,
      });

      expect(mockLoadVariantMeta).toHaveBeenCalledWith(
        'typescript',
        'http://example.com/typescript',
      );
      expect(mockLoadVariantMeta).toHaveBeenCalledWith('python', 'http://example.com/python');
      expect(result.allFileNames).toEqual(['App.tsx', 'types.ts', 'App.py']);
    });
  });

  describe('Error handling', () => {
    it('should throw error when initial variant not found after loadCodeMeta', async () => {
      mockLoadCodeMeta.mockResolvedValue({ otherVariant: 'something' });

      await expect(
        loadCodeFallback('http://example.com', 'nonexistent', undefined, {
          shouldHighlight: false,
          fallbackUsesExtraFiles: false,
          fallbackUsesAllVariants: false,
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          loadCodeMeta: mockLoadCodeMeta,
        }),
      ).rejects.toThrow('Initial variant "nonexistent" not found in loaded code.');
    });

    it('should throw error when loadCodeMeta is required but not provided', async () => {
      await expect(
        loadCodeFallback(
          'http://example.com',
          'default',
          undefined, // no loaded code
          {
            shouldHighlight: false,
            fallbackUsesExtraFiles: false,
            fallbackUsesAllVariants: false,
            sourceParser: Promise.resolve(mockParseSource),
            loadSource: mockLoadSource,
            loadVariantMeta: mockLoadVariantMeta,
            loadCodeMeta: undefined,
          },
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
        loadCodeFallback('http://example.com', 'default', loaded, {
          shouldHighlight: false,
          fallbackUsesExtraFiles: false,
          fallbackUsesAllVariants: false,
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          loadCodeMeta: mockLoadCodeMeta,
          initialFilename: 'nonexistent.ts',
        }),
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

      const result = await loadCodeFallback(
        'http://example.com',
        'default',
        undefined, // no loaded code
        {
          shouldHighlight: false,
          fallbackUsesExtraFiles: false,
          fallbackUsesAllVariants: false,
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          loadCodeMeta: mockLoadCodeMeta,
        },
      );

      expect(mockLoadCodeMeta).toHaveBeenCalledWith('http://example.com');
      expect(result.initialSource).toBe('const App = () => <div>Hello</div>;');
    });
  });

  describe('Integration with loadCodeVariant', () => {
    it('should handle complex variant with extra files that need loading', async () => {
      const variantCode: VariantCode = {
        fileName: 'App.tsx',
        url: 'http://example.com/App.tsx',
        source: 'import { helper } from "./utils";',
        extraFiles: {
          'utils.ts': 'http://example.com/utils.ts',
        },
        allFilesListed: false, // Will trigger loadCodeVariant processing
      };

      mockLoadSource.mockResolvedValue({
        source: 'export const helper = () => "loaded";',
        extraFiles: {},
      });

      const result = await loadCodeFallback(
        'http://example.com',
        'default',
        { default: variantCode },
        {
          shouldHighlight: false,
          fallbackUsesExtraFiles: false,
          fallbackUsesAllVariants: false,
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          loadCodeMeta: mockLoadCodeMeta,
        },
      );

      // Verify loadCodeVariant processed the variant and loaded dependencies
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

      const result = await loadCodeFallback(
        'https://example.com',
        'default',
        {}, // loaded
        {
          shouldHighlight: false,
          fallbackUsesExtraFiles: false,
          fallbackUsesAllVariants: false,
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: undefined, // this is the key test case
          loadCodeMeta: mockLoadCodeMeta,
          initialFilename: 'Button.tsx',
        },
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
        const result = await loadCodeFallback(
          'https://example.com',
          'default',
          {}, // loaded
          {
            shouldHighlight: false,
            fallbackUsesExtraFiles: false,
            fallbackUsesAllVariants: false,
            sourceParser: Promise.resolve(mockParseSource),
            loadSource: mockLoadSource,
            loadVariantMeta: undefined,
            loadCodeMeta: mockLoadCodeMeta,
            initialFilename: expectedFileName,
          },
        );

        expect(result.code.default).toBeDefined();
        expect((result.code.default as VariantCode).url).toBe(url);
        expect((result.code.default as VariantCode).fileName).toBe(expectedFileName);
      }
    });

    it('should still use loadVariantMeta when provided in loadCodeFallback', async () => {
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

      const result = await loadCodeFallback(
        'https://example.com',
        'default',
        {}, // loaded
        {
          shouldHighlight: false,
          fallbackUsesExtraFiles: false,
          fallbackUsesAllVariants: false,
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta, // Provided loadVariantMeta
          loadCodeMeta: mockLoadCodeMeta,
          initialFilename: 'Button.tsx',
        },
      );

      expect(result.code.default).toBeDefined();
      expect((result.code.default as VariantCode).fileName).toBe('CustomButton.tsx');
      expect(mockLoadVariantMeta).toHaveBeenCalledWith('default', variantUrl);
    });
  });

  describe('Integration with maybeCodeInitialData', () => {
    it('should produce output that passes maybeCodeInitialData validation for needsAllFiles scenario', async () => {
      // Start with data that fails maybeCodeInitialData because extra files are URLs
      const variantCode: VariantCode = {
        fileName: 'Component.tsx',
        url: 'http://example.com/Component.tsx',
        source: 'import { helper } from "./utils";',
        extraFiles: {
          'utils.ts': 'http://example.com/utils.ts', // URL - would fail maybeCodeInitialData
        },
        allFilesListed: false, // Would fail early return optimizations
      };

      // Mock loadSource to provide actual content
      mockLoadSource.mockImplementation(async (url: string) => {
        if (url.includes('utils.ts')) {
          return {
            source: 'export const helper = () => "loaded utility";',
            extraFiles: {},
          };
        }
        return { source: 'fallback source', extraFiles: {} };
      });

      // First, verify that maybeCodeInitialData returns false for the initial data
      const initialValidation = maybeCodeInitialData(
        ['default'],
        'default',
        { default: variantCode },
        undefined,
        false, // needsHighlight
        true, // needsAllFiles - this will fail because extraFiles has URLs
        false, // needsAllVariants
      );
      expect(initialValidation.initialData).toBe(false);
      expect(initialValidation.reason).toBe('Not all extra files are available');

      // Now run loadCodeFallback to process the data
      const result = await loadCodeFallback(
        'http://example.com',
        'default',
        { default: variantCode },
        {
          shouldHighlight: false,
          fallbackUsesExtraFiles: true, // fallbackUsesExtraFiles - ensure extra files are loaded
          fallbackUsesAllVariants: false,
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          loadCodeMeta: mockLoadCodeMeta,
        },
      );

      // Verify that the processed result now passes maybeCodeInitialData validation
      const processedValidation = maybeCodeInitialData(
        ['default'],
        'default',
        result.code,
        undefined,
        false, // needsHighlight
        true, // needsAllFiles - should now pass since files are loaded
        false, // needsAllVariants
      );

      expect(processedValidation.initialData).not.toBe(false);
      expect(processedValidation.initialData).toEqual({
        code: result.code,
        initialFilename: 'Component.tsx',
        initialSource: 'import { helper } from "./utils";',
        initialExtraFiles: expect.any(Object),
      });

      // Double-check that the extra files are properly loaded with source content
      const processedVariant = result.code.default as VariantCode;
      expect(processedVariant.extraFiles?.['utils.ts']).toEqual({
        source: 'export const helper = () => "loaded utility";',
      });
    });

    it('should produce output that passes maybeCodeInitialData validation for needsHighlight scenario', async () => {
      // Start with data that has string source but needs highlighting
      const variantCode: VariantCode = {
        fileName: 'App.tsx',
        url: 'http://example.com/App.tsx',
        source: 'const App = () => <div>Hello</div>;', // String source
        allFilesListed: true,
      };

      const parsedSource = { type: 'root', children: [] } as any;
      mockParseSource.mockReturnValue(parsedSource);

      // Verify that maybeCodeInitialData returns false for highlighting needs
      const initialValidation = maybeCodeInitialData(
        ['default'],
        'default',
        { default: variantCode },
        undefined,
        true, // needsHighlight - this will fail because source is a string
        false,
        false,
      );
      expect(initialValidation.initialData).toBe(false);
      expect(initialValidation.reason).toBe('File needs highlighting');

      // Run loadCodeFallback with highlighting enabled
      const result = await loadCodeFallback(
        'http://example.com',
        'default',
        { default: variantCode },
        {
          shouldHighlight: true, // this will parse the source
          fallbackUsesExtraFiles: false,
          fallbackUsesAllVariants: false,
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          loadCodeMeta: mockLoadCodeMeta,
        },
      );

      // Verify that the processed result now passes maybeCodeInitialData validation
      const processedValidation = maybeCodeInitialData(
        ['default'],
        'default',
        result.code,
        undefined,
        true, // needsHighlight - should now pass since source is parsed
        false,
        false,
      );

      expect(processedValidation.initialData).not.toBe(false);
      expect(processedValidation.initialData).toEqual({
        code: result.code,
        initialFilename: 'App.tsx',
        initialSource: parsedSource,
        initialExtraFiles: undefined,
      });
    });

    it('should produce output that passes maybeCodeInitialData validation for missing source scenario', async () => {
      // Start with variant that has no source
      const variantCode: VariantCode = {
        fileName: 'App.tsx',
        url: 'http://example.com/App.tsx',
        // No source property
        allFilesListed: false,
      };

      mockLoadSource.mockResolvedValue({
        source: 'const App = () => <div>Loaded via fallback</div>;',
        extraFiles: {},
      });

      // Verify that maybeCodeInitialData returns false due to missing source
      const initialValidation = maybeCodeInitialData(
        ['default'],
        'default',
        { default: variantCode },
        undefined,
        false,
        false,
        false,
      );
      expect(initialValidation.initialData).toBe(false);
      expect(initialValidation.reason).toBe('File source not found');

      // Run loadCodeFallback to load the source
      const result = await loadCodeFallback(
        'http://example.com',
        'default',
        { default: variantCode },
        {
          shouldHighlight: false,
          fallbackUsesExtraFiles: false,
          fallbackUsesAllVariants: false,
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          loadCodeMeta: mockLoadCodeMeta,
        },
      );

      // Verify that the processed result now passes maybeCodeInitialData validation
      const processedValidation = maybeCodeInitialData(
        ['default'],
        'default',
        result.code,
        undefined,
        false,
        false,
        false,
      );

      expect(processedValidation.initialData).not.toBe(false);
      expect(processedValidation.initialData).toEqual({
        code: result.code,
        initialFilename: 'App.tsx',
        initialSource: 'const App = () => <div>Loaded via fallback</div>;',
        initialExtraFiles: undefined, // No extra files in this case
      });
    });

    it('should produce output that passes maybeCodeInitialData validation for missing requested file scenario', async () => {
      // Start with variant that has extra files as URLs
      const variantCode: VariantCode = {
        fileName: 'App.tsx',
        url: 'http://example.com/App.tsx',
        source: 'const App = () => <div>Hello</div>;',
        extraFiles: {
          'utils.ts': 'http://example.com/utils.ts', // URL, needs loading
        },
        allFilesListed: false, // This ensures loadCodeVariant processes the files
      };

      mockLoadSource.mockImplementation(async (url: string) => {
        if (url.includes('utils.ts')) {
          return {
            source: 'export const helper = () => "loaded utility";',
            extraFiles: {},
          };
        }
        return { source: 'fallback source', extraFiles: {} };
      });

      // Verify that maybeCodeInitialData returns false when requesting utils.ts file
      const initialValidation = maybeCodeInitialData(
        ['default'],
        'default',
        { default: variantCode },
        'utils.ts', // Request specific file that's not loaded
        false,
        false,
        false,
      );
      expect(initialValidation.initialData).toBe(false);
      expect(initialValidation.reason).toBe('File is not loaded yet');

      // Run loadCodeFallback to load the requested file
      const result = await loadCodeFallback(
        'http://example.com',
        'default',
        { default: variantCode },
        {
          shouldHighlight: false,
          fallbackUsesExtraFiles: false,
          fallbackUsesAllVariants: false,
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          loadCodeMeta: mockLoadCodeMeta,
          initialFilename: 'utils.ts', // Request the same file
        },
      );

      // Check what the processed variant looks like
      const processedVariant = result.code.default as VariantCode;
      expect(processedVariant.extraFiles?.['utils.ts']).toEqual({
        source: 'export const helper = () => "loaded utility";',
      });

      // Verify that the processed result now passes maybeCodeInitialData validation
      const processedValidation = maybeCodeInitialData(
        ['default'],
        'default',
        result.code,
        'utils.ts', // Request the same file
        false,
        false,
        false,
      );

      expect(processedValidation.initialData).not.toBe(false);
      if (processedValidation.initialData !== false) {
        expect(processedValidation.initialData).toEqual({
          code: result.code,
          initialFilename: 'utils.ts',
          initialSource: 'export const helper = () => "loaded utility";',
          initialExtraFiles: expect.any(Object),
        });
      }
    });

    it('should produce output that successfully passes maybeCodeInitialData validation', async () => {
      // Scenario: Start with data that would fail maybeCodeInitialData,
      // then verify loadCodeFallback produces data that passes
      const variantCode: VariantCode = {
        fileName: 'Component.tsx',
        url: 'http://example.com/Component.tsx',
        source: 'import { helper } from "./utils";',
        extraFiles: {
          'utils.ts': 'http://example.com/utils.ts', // URL - would fail maybeCodeInitialData
        },
        allFilesListed: false, // Would fail early return optimizations
      };

      // Mock loadSource to provide actual content
      mockLoadSource.mockImplementation(async (url: string) => {
        if (url.includes('utils.ts')) {
          return {
            source: 'export const helper = () => "loaded utility";',
            extraFiles: {},
          };
        }
        return { source: 'fallback source', extraFiles: {} };
      });

      // First, verify that maybeCodeInitialData would return false for the initial data
      const initialValidation = maybeCodeInitialData(
        ['default'],
        'default',
        { default: variantCode },
        undefined,
        false, // needsHighlight
        true, // needsAllFiles - this will fail because extraFiles has URLs
        false, // needsAllVariants
      );
      expect(initialValidation.initialData).toBe(false);
      expect(initialValidation.reason).toBe('Not all extra files are available');

      // Now run loadCodeFallback to process the data
      const result = await loadCodeFallback(
        'http://example.com',
        'default',
        { default: variantCode },
        {
          shouldHighlight: false,
          fallbackUsesExtraFiles: true, // fallbackUsesExtraFiles - ensure extra files are loaded
          fallbackUsesAllVariants: false,
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          loadCodeMeta: mockLoadCodeMeta,
        },
      );

      // Verify that the processed result now passes maybeCodeInitialData validation
      const processedValidation = maybeCodeInitialData(
        ['default'],
        'default',
        result.code,
        undefined,
        false, // needsHighlight
        true, // needsAllFiles - should now pass since files are loaded
        false, // needsAllVariants
      );

      expect(processedValidation.initialData).not.toBe(false);
      expect(processedValidation.initialData).toEqual({
        code: result.code,
        initialFilename: 'Component.tsx',
        initialSource: 'import { helper } from "./utils";',
        initialExtraFiles: expect.any(Object),
      });

      // Double-check that the extra files are properly loaded with source content
      const processedVariant = result.code.default as VariantCode;
      expect(processedVariant.extraFiles?.['utils.ts']).toEqual({
        source: 'export const helper = () => "loaded utility";',
      });
    });
  });

  describe('Undefined filename handling', () => {
    it('should gracefully handle undefined initialFilename', async () => {
      const variantCode: VariantCode = {
        fileName: 'App.tsx',
        url: 'http://example.com/App.tsx',
        source: 'const App = () => <div>Hello</div>;',
        allFilesListed: true,
      };

      const loaded: Code = { default: variantCode };

      const result = await loadCodeFallback('http://example.com', 'default', loaded, {
        shouldHighlight: false,
        fallbackUsesExtraFiles: false,
        fallbackUsesAllVariants: false,
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        loadCodeMeta: mockLoadCodeMeta,
        initialFilename: undefined, // undefined initialFilename
      });

      // Should default to the main file
      expect(result.initialFilename).toBe('App.tsx');
      expect(result.initialSource).toBe('const App = () => <div>Hello</div>;');
    });

    it('should return variant source when getFileSource called without filename', async () => {
      const variantCode: VariantCode = {
        fileName: 'App.tsx',
        url: 'http://example.com/App.tsx',
        source: 'const App = () => <div>Hello</div>;',
        allFilesListed: true,
      };

      const loaded: Code = { default: variantCode };

      const result = await loadCodeFallback('http://example.com', 'default', loaded, {
        shouldHighlight: false,
        fallbackUsesExtraFiles: false,
        fallbackUsesAllVariants: false,
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        loadCodeMeta: mockLoadCodeMeta,
        initialFilename: undefined, // This triggers the getFileSource(variant, undefined) code path
      });

      expect(result.initialSource).toBe('const App = () => <div>Hello</div>;');
      expect(result.initialFilename).toBe('App.tsx');
    });

    it('should handle variant with bare source (no filename or URL)', async () => {
      const variantCode: VariantCode = {
        // No fileName property
        // No url property
        source: 'const BareComponent = () => <div>Just source code</div>;',
        allFilesListed: true,
      };

      const loaded: Code = { default: variantCode };

      const result = await loadCodeFallback('http://example.com', 'default', loaded, {
        shouldHighlight: false,
        fallbackUsesExtraFiles: false,
        fallbackUsesAllVariants: false,
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        loadCodeMeta: mockLoadCodeMeta,
        initialFilename: undefined, // undefined initialFilename
      });

      // Should still return the source, but filename should be undefined
      expect(result.initialSource).toBe('const BareComponent = () => <div>Just source code</div>;');
      expect(result.initialFilename).toBeUndefined();
      expect(result.allFileNames).toEqual([]); // No files since no filename
    });

    it('should handle variant with bare source and shouldHighlight=true', async () => {
      const variantCode: VariantCode = {
        // No fileName property
        // No url property
        source: 'const BareComponent = () => <div>Highlight me</div>;',
        allFilesListed: true,
      };

      const loaded: Code = { default: variantCode };

      const result = await loadCodeFallback('http://example.com', 'default', loaded, {
        shouldHighlight: true, // shouldHighlight=true
        fallbackUsesExtraFiles: false,
        fallbackUsesAllVariants: false,
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        loadCodeMeta: mockLoadCodeMeta,
        initialFilename: undefined, // undefined initialFilename
      });

      // Since there's no filename, parsing creates a basic HAST node to mark it passed through pipeline
      expect(result.initialSource).toEqual({
        type: 'root',
        children: [
          {
            type: 'text',
            value: 'const BareComponent = () => <div>Highlight me</div>;',
          },
        ],
      });
      expect(result.initialFilename).toBeUndefined();
      expect(mockParseSource).not.toHaveBeenCalled(); // No actual parsing without filename
    });

    it('should create HAST node structure for undefined filename in early return path', async () => {
      const loaded: Code = {
        default: {
          fileName: undefined, // No fileName
          source: 'const EarlyReturn = () => <div>Test</div>;',
          allFilesListed: true, // Enables early return
        },
      };

      const result = await loadCodeFallback('/demo/example', 'default', loaded, {
        shouldHighlight: true, // shouldHighlight=true
        fallbackUsesExtraFiles: false, // fallbackUsesExtraFiles=false
        fallbackUsesAllVariants: false, // fallbackUsesAllVariants=false
        sourceParser: Promise.resolve(mockParseSource),
        loadSource: mockLoadSource,
        loadVariantMeta: mockLoadVariantMeta,
        loadCodeMeta: mockLoadCodeMeta,
        initialFilename: undefined, // undefined initialFilename
      });

      // Should create HAST structure in early return path too
      expect(result.initialSource).toEqual({
        type: 'root',
        children: [
          {
            type: 'text',
            value: 'const EarlyReturn = () => <div>Test</div>;',
          },
        ],
      });
      expect(result.initialFilename).toBeUndefined();
      expect(mockParseSource).not.toHaveBeenCalled(); // No actual parsing without filename
    });
  });

  describe('globalsCode integration', () => {
    it('should process globalsCode when fallbackUsesExtraFiles=true', async () => {
      const variantCode: VariantCode = {
        fileName: 'App.tsx',
        url: 'http://example.com/App.tsx',
        source: 'const App = () => <div>Hello</div>;',
        extraFiles: {
          'main-styles.css': {
            source: '.app { color: blue; }',
          },
        },
        allFilesListed: false, // Force fallback to loadCodeVariant
      };

      const globalsCode: Code = {
        default: {
          fileName: 'theme.ts',
          source: "console.log('theme loaded');",
          extraFiles: {
            'theme.css': {
              source: '.theme { color: red; }',
            },
            'globals.css': {
              source: '.global { margin: 0; }',
            },
          },
        },
      };

      const result = await loadCodeFallback(
        'http://example.com',
        'default',
        { default: variantCode },
        {
          shouldHighlight: false,
          fallbackUsesExtraFiles: true, // fallbackUsesExtraFiles=true
          fallbackUsesAllVariants: false,
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          loadCodeMeta: mockLoadCodeMeta,
          initialFilename: undefined,
          variants: undefined,
          globalsCode: [globalsCode], // Pass globalsCode
        },
      );

      // Verify the main variant's files are present
      expect(result.allFileNames).toContain('App.tsx');
      expect(result.allFileNames).toContain('main-styles.css');

      // Verify globalsCode extraFiles are included (but not the root file)
      expect(result.allFileNames).toContain('theme.css'); // Original filename used
      expect(result.allFileNames).toContain('globals.css'); // Original filename used
      expect(result.allFileNames).not.toContain('theme.ts'); // Root file excluded

      // Check that the processed variant has the globals files
      const processedVariant = result.code.default as VariantCode;
      expect(processedVariant.extraFiles?.['theme.css']).toBeDefined();
      expect(processedVariant.extraFiles?.['globals.css']).toBeDefined();
      expect((processedVariant.extraFiles?.['theme.css'] as any).source).toBe(
        '.theme { color: red; }',
      );
      expect((processedVariant.extraFiles?.['globals.css'] as any).source).toBe(
        '.global { margin: 0; }',
      );
    });

    it('should handle globalsCode filename conflicts in fallback scenarios', async () => {
      const variantCode: VariantCode = {
        fileName: 'App.tsx',
        url: 'http://example.com/App.tsx',
        source: 'const App = () => <div>Hello</div>;',
        extraFiles: {
          'theme.css': {
            source: '.main-theme { color: blue; }',
          },
          'global_theme.css': {
            source: '.alt-theme { color: green; }',
          },
        },
        allFilesListed: false, // Force fallback to loadCodeVariant
      };

      const globalsCode: Code = {
        default: {
          fileName: 'setup.ts',
          source: "console.log('setup');",
          extraFiles: {
            'theme.css': {
              source: '.side-effect-theme { color: red; }',
            },
          },
        },
      };

      const result = await loadCodeFallback(
        'http://example.com',
        'default',
        { default: variantCode },
        {
          shouldHighlight: false,
          fallbackUsesExtraFiles: true, // fallbackUsesExtraFiles=true
          fallbackUsesAllVariants: false,
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          loadCodeMeta: mockLoadCodeMeta,
          initialFilename: undefined,
          variants: undefined,
          globalsCode: [globalsCode],
        },
      );

      // Verify conflict resolution naming
      expect(result.allFileNames).toContain('App.tsx');
      expect(result.allFileNames).toContain('theme.css'); // Original from main variant
      expect(result.allFileNames).toContain('global_theme.css'); // Original from main variant
      expect(result.allFileNames).toContain('global_theme_1.css'); // Conflicting file with numbered suffix

      const processedVariant = result.code.default as VariantCode;
      expect(processedVariant.extraFiles?.['theme.css']).toBeDefined();
      expect((processedVariant.extraFiles?.['theme.css'] as any).source).toBe(
        '.main-theme { color: blue; }',
      );
      expect(processedVariant.extraFiles?.['global_theme_1.css']).toBeDefined();
      expect((processedVariant.extraFiles?.['global_theme_1.css'] as any).source).toBe(
        '.side-effect-theme { color: red; }',
      );
    });

    it('should pass globalsCode through when fallbackUsesAllVariants=true', async () => {
      const jsVariant: VariantCode = {
        fileName: 'App.js',
        url: 'http://example.com/App.js',
        source: 'const App = () => React.createElement("div", null, "Hello JS");',
        allFilesListed: false,
      };

      const tsVariant: VariantCode = {
        fileName: 'App.tsx',
        url: 'http://example.com/App.tsx',
        source: 'const App = () => <div>Hello TS</div>;',
        allFilesListed: false,
      };

      const globalsCode: Code = {
        javascript: {
          fileName: 'js-setup.ts',
          source: "console.log('JS setup');",
          extraFiles: {
            'shared-styles.css': {
              source: '.shared { font-family: Arial; }',
            },
          },
        },
        typescript: {
          fileName: 'ts-setup.ts',
          source: "console.log('TS setup');",
          extraFiles: {
            'shared-styles.css': {
              source: '.shared { font-family: Arial; }',
            },
          },
        },
      };

      mockLoadVariantMeta.mockResolvedValue(tsVariant);

      const result = await loadCodeFallback(
        'http://example.com',
        'javascript',
        {
          javascript: jsVariant,
          typescript: 'http://example.com/typescript',
        },
        {
          shouldHighlight: false,
          fallbackUsesExtraFiles: false,
          fallbackUsesAllVariants: true, // fallbackUsesAllVariants=true
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          loadCodeMeta: mockLoadCodeMeta,
          initialFilename: undefined,
          variants: ['javascript', 'typescript'],
          globalsCode: [globalsCode],
        },
      );

      // Verify all variants are processed and globals are included
      expect(result.allFileNames).toContain('App.js'); // From JS variant
      expect(result.allFileNames).toContain('App.tsx'); // From TS variant
      expect(result.allFileNames).toContain('shared-styles.css'); // From globalsCode

      // Verify that loadVariantMeta was called with globalsCode argument
      expect(mockLoadVariantMeta).toHaveBeenCalledWith(
        'typescript',
        'http://example.com/typescript',
      );

      // Check that both variants have the globals
      const jsProcessedVariant = result.code.javascript as VariantCode;
      const tsProcessedVariant = result.code.typescript as VariantCode;

      expect(jsProcessedVariant.extraFiles?.['shared-styles.css']).toBeDefined();
      expect(tsProcessedVariant.extraFiles?.['shared-styles.css']).toBeDefined();
    });

    it('should handle globalsCode URL string in fallback scenarios', async () => {
      const variantCode: VariantCode = {
        fileName: 'Component.tsx',
        url: 'http://example.com/Component.tsx',
        source: 'const Component = () => <div>Component</div>;',
        allFilesListed: false, // Force fallback to loadCodeVariant
      };

      const globalsUrl = 'http://example.com/side-effects.ts';
      const globalsVariant: VariantCode = {
        url: globalsUrl,
        fileName: 'side-effects.ts',
        source: "import './styles.css';",
        extraFiles: {
          'styles.css': {
            source: '.side-effects { background: yellow; }',
          },
        },
      };

      // Mock loadCodeMeta to return a Code object for the URL string
      mockLoadCodeMeta.mockResolvedValue({
        default: globalsVariant,
      });

      mockLoadVariantMeta.mockResolvedValue(globalsVariant);

      const result = await loadCodeFallback(
        'http://example.com',
        'default',
        { default: variantCode },
        {
          shouldHighlight: false,
          fallbackUsesExtraFiles: true, // fallbackUsesExtraFiles=true
          fallbackUsesAllVariants: false,
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          loadCodeMeta: mockLoadCodeMeta,
          initialFilename: undefined,
          variants: undefined,
          globalsCode: [globalsUrl], // Pass URL string
        },
      );

      // Verify globals extraFiles are included
      expect(result.allFileNames).toContain('Component.tsx');
      expect(result.allFileNames).toContain('styles.css');
      expect(result.allFileNames).not.toContain('side-effects.ts'); // Root file excluded

      const processedVariant = result.code.default as VariantCode;
      expect(processedVariant.extraFiles?.['styles.css']).toBeDefined();
      expect((processedVariant.extraFiles?.['styles.css'] as any).source).toBe(
        '.side-effects { background: yellow; }',
      );

      // Verify loadCodeMeta was called for the URL string (new architecture)
      expect(mockLoadCodeMeta).toHaveBeenCalledWith(globalsUrl);
    });

    it('should call loadVariantMeta when globalsCode is a URL string', async () => {
      const variantCode: VariantCode = {
        fileName: 'App.tsx',
        url: 'http://example.com/App.tsx',
        source: 'const App = () => <div>Hello</div>;',
        allFilesListed: false,
      };

      const globalsUrl = 'http://example.com/global-setup.ts';
      const globalsVariant: VariantCode = {
        url: globalsUrl,
        fileName: 'global-setup.ts',
        source: "import './theme.css'; import './reset.css';",
        extraFiles: {
          'theme.css': {
            source: '.theme { color: purple; }',
          },
          'reset.css': {
            source: '* { margin: 0; }',
          },
        },
      };

      // Mock loadCodeMeta to return a Code object for the URL string
      mockLoadCodeMeta.mockResolvedValue({
        default: globalsVariant,
      });

      mockLoadVariantMeta.mockResolvedValue(globalsVariant);

      await loadCodeFallback(
        'http://example.com',
        'default',
        { default: variantCode },
        {
          shouldHighlight: false,
          fallbackUsesExtraFiles: true, // fallbackUsesExtraFiles=true
          fallbackUsesAllVariants: false,
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          loadCodeMeta: mockLoadCodeMeta,
          initialFilename: undefined,
          variants: undefined,
          globalsCode: [globalsUrl], // URL string for globalsCode
        },
      );

      // Verify loadCodeMeta is called correctly for globalsCode URL (new architecture)
      expect(mockLoadCodeMeta).toHaveBeenCalledWith(globalsUrl);
      expect(mockLoadCodeMeta).toHaveBeenCalledTimes(1);
    });

    it('should call loadSource for globalsCode extraFiles URLs', async () => {
      const variantCode: VariantCode = {
        fileName: 'Component.tsx',
        url: 'http://example.com/Component.tsx',
        source: 'const Component = () => <div>Component</div>;',
        allFilesListed: false,
      };

      const globalsCode: Code = {
        default: {
          fileName: 'setup.ts',
          source: "import './config.json'; import './styles.scss';",
          extraFiles: {
            'config.json': 'http://example.com/config.json', // URL that needs loading
            'styles.scss': 'http://example.com/styles.scss', // URL that needs loading
            'constants.js': {
              source: 'export const API_URL = "https://api.example.com";', // Already loaded
            },
          },
        },
      };

      // Mock loadSource responses for the URL extraFiles
      mockLoadSource.mockImplementation(async (url: string) => {
        if (url.includes('config.json')) {
          return {
            source: '{"theme": "dark", "locale": "en"}',
            extraFiles: {},
          };
        }
        if (url.includes('styles.scss')) {
          return {
            source: '$primary-color: #007bff; .btn { color: $primary-color; }',
            extraFiles: {},
          };
        }
        return { source: 'fallback', extraFiles: {} };
      });

      const result = await loadCodeFallback(
        'http://example.com',
        'default',
        { default: variantCode },
        {
          shouldHighlight: false,
          fallbackUsesExtraFiles: true, // fallbackUsesExtraFiles=true
          fallbackUsesAllVariants: false,
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          loadCodeMeta: mockLoadCodeMeta,
          initialFilename: undefined,
          variants: undefined,
          globalsCode: [globalsCode],
        },
      );

      // Verify loadSource was called for each URL in globalsCode extraFiles
      expect(mockLoadSource).toHaveBeenCalledWith('http://example.com/config.json');
      expect(mockLoadSource).toHaveBeenCalledWith('http://example.com/styles.scss');
      expect(mockLoadSource).toHaveBeenCalledTimes(2); // Only for the URLs, not the already-loaded content

      // Verify the loaded content is properly integrated
      const processedVariant = result.code.default as VariantCode;
      expect(processedVariant.extraFiles?.['config.json']).toBeDefined();
      expect(processedVariant.extraFiles?.['styles.scss']).toBeDefined();
      expect(processedVariant.extraFiles?.['constants.js']).toBeDefined();
      expect((processedVariant.extraFiles?.['config.json'] as any).source).toBe(
        '{"theme": "dark", "locale": "en"}',
      );
      expect((processedVariant.extraFiles?.['styles.scss'] as any).source).toBe(
        '$primary-color: #007bff; .btn { color: $primary-color; }',
      );
      expect((processedVariant.extraFiles?.['constants.js'] as any).source).toBe(
        'export const API_URL = "https://api.example.com";',
      );
    });

    it('should handle complex globalsCode loading scenarios with both loadSource and loadVariantMeta', async () => {
      const variantCode: VariantCode = {
        fileName: 'App.tsx',
        url: 'http://example.com/App.tsx',
        source: 'const App = () => <div>App</div>;',
        extraFiles: {
          'utils.ts': 'http://example.com/utils.ts', // Main variant also needs loading
        },
        allFilesListed: false,
      };

      // globalsCode as URL string that returns variant with URL extraFiles
      const globalsUrl = 'http://example.com/complex-setup.ts';
      const globalsVariant: VariantCode = {
        url: globalsUrl,
        fileName: 'complex-setup.ts',
        source: "import './polyfills.js'; import './vendor.css';",
        extraFiles: {
          'polyfills.js': 'http://example.com/polyfills.js', // Needs loadSource
          'vendor.css': 'http://example.com/vendor.css', // Needs loadSource
          'inline-config.json': {
            source: '{"version": "1.0.0"}', // Already loaded
          },
        },
      };

      // Mock loadCodeMeta to return a Code object for the URL string
      mockLoadCodeMeta.mockResolvedValue({
        default: globalsVariant,
      });

      // Mock loadVariantMeta for globalsCode
      mockLoadVariantMeta.mockResolvedValue(globalsVariant);

      // Mock loadSource for various URLs
      mockLoadSource.mockImplementation(async (url: string) => {
        if (url.includes('utils.ts')) {
          return {
            source: 'export const formatDate = (date) => date.toISOString();',
            extraFiles: {},
          };
        }
        if (url.includes('polyfills.js')) {
          return {
            source: 'window.Promise = window.Promise || Promise;',
            extraFiles: {},
          };
        }
        if (url.includes('vendor.css')) {
          return {
            source: '.vendor { font-family: "Vendor Font"; }',
            extraFiles: {},
          };
        }
        return { source: 'unknown', extraFiles: {} };
      });

      const result = await loadCodeFallback(
        'http://example.com',
        'default',
        { default: variantCode },
        {
          shouldHighlight: false,
          fallbackUsesExtraFiles: true, // fallbackUsesExtraFiles=true
          fallbackUsesAllVariants: false,
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          loadCodeMeta: mockLoadCodeMeta,
          initialFilename: undefined,
          variants: undefined,
          globalsCode: [globalsUrl],
        },
      );

      // Verify loadCodeMeta was called for globalsCode URL (new architecture)
      expect(mockLoadCodeMeta).toHaveBeenCalledWith(globalsUrl);

      // Verify loadSource was called for all URL extraFiles (main variant + globalsCode)
      expect(mockLoadSource).toHaveBeenCalledWith('http://example.com/utils.ts'); // Main variant
      expect(mockLoadSource).toHaveBeenCalledWith('http://example.com/polyfills.js'); // globalsCode
      expect(mockLoadSource).toHaveBeenCalledWith('http://example.com/vendor.css'); // globalsCode
      expect(mockLoadSource).toHaveBeenCalledTimes(3);

      // Verify all files are present in results
      expect(result.allFileNames).toContain('App.tsx');
      expect(result.allFileNames).toContain('utils.ts'); // From main variant
      expect(result.allFileNames).toContain('polyfills.js'); // From globalsCode
      expect(result.allFileNames).toContain('vendor.css'); // From globalsCode
      expect(result.allFileNames).toContain('inline-config.json'); // From globalsCode
      expect(result.allFileNames).not.toContain('complex-setup.ts'); // Root file excluded

      // Verify content is properly loaded and integrated
      const processedVariant = result.code.default as VariantCode;
      expect(processedVariant.extraFiles?.['utils.ts']).toBeDefined();
      expect(processedVariant.extraFiles?.['polyfills.js']).toBeDefined();
      expect(processedVariant.extraFiles?.['vendor.css']).toBeDefined();
      expect(processedVariant.extraFiles?.['inline-config.json']).toBeDefined();

      expect((processedVariant.extraFiles?.['utils.ts'] as any).source).toBe(
        'export const formatDate = (date) => date.toISOString();',
      );
      expect((processedVariant.extraFiles?.['polyfills.js'] as any).source).toBe(
        'window.Promise = window.Promise || Promise;',
      );
      expect((processedVariant.extraFiles?.['vendor.css'] as any).source).toBe(
        '.vendor { font-family: "Vendor Font"; }',
      );
      expect((processedVariant.extraFiles?.['inline-config.json'] as any).source).toBe(
        '{"version": "1.0.0"}',
      );
    });

    it('should work correctly when globalsCode is provided but early return path is taken', async () => {
      const variantCode: VariantCode = {
        fileName: 'App.tsx',
        url: 'http://example.com/App.tsx',
        source: 'const App = () => <div>Hello</div>;',
        extraFiles: {
          'existing.css': {
            source: '.existing { color: blue; }',
          },
        },
        allFilesListed: true, // This should allow early return
      };

      const globalsCode: Code = {
        default: {
          fileName: 'theme.ts',
          source: "console.log('theme');",
          extraFiles: {
            'theme.css': {
              source: '.theme { color: red; }',
            },
          },
        },
      };

      const result = await loadCodeFallback(
        'http://example.com',
        'default',
        { default: variantCode },
        {
          shouldHighlight: false,
          fallbackUsesExtraFiles: false, // No extra processing needed
          fallbackUsesAllVariants: false, // No all variants needed
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          loadCodeMeta: mockLoadCodeMeta,
          initialFilename: undefined,
          variants: undefined,
          globalsCode: [globalsCode], // globalsCode provided but should be ignored in early return
        },
      );

      // In early return path, globalsCode should not be processed
      expect(result.allFileNames).toContain('App.tsx');
      expect(result.allFileNames).toContain('existing.css');
      expect(result.allFileNames).not.toContain('theme.css'); // Not processed in early return

      const processedVariant = result.code.default as VariantCode;
      expect(processedVariant.extraFiles?.['existing.css']).toBeDefined();
      expect(processedVariant.extraFiles?.['theme.css']).toBeUndefined(); // Not processed
    });

    it('should handle globalsCode with complex extraFiles in fallback', async () => {
      const variantCode: VariantCode = {
        fileName: 'App.tsx',
        url: 'http://example.com/App.tsx',
        source: 'const App = () => <div>Hello</div>;',
        allFilesListed: false,
      };

      const globalsCode: Code = {
        default: {
          fileName: 'complex-setup.ts',
          source: "import './base.css'; import './components.css';",
          extraFiles: {
            'base.css': {
              source: '* { box-sizing: border-box; }',
            },
            'components/button.css': {
              source: '.btn { padding: 8px; }',
            },
            'utils/helpers.js': {
              source: 'export const format = (s) => s.trim();',
            },
          },
        },
      };

      const result = await loadCodeFallback(
        'http://example.com',
        'default',
        { default: variantCode },
        {
          shouldHighlight: false,
          fallbackUsesExtraFiles: true, // fallbackUsesExtraFiles=true
          fallbackUsesAllVariants: false,
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          loadCodeMeta: mockLoadCodeMeta,
          initialFilename: undefined,
          variants: undefined,
          globalsCode: [globalsCode],
        },
      );

      // Verify all globals extraFiles are included
      expect(result.allFileNames).toContain('App.tsx');
      expect(result.allFileNames).toContain('base.css');
      expect(result.allFileNames).toContain('components/button.css');
      expect(result.allFileNames).toContain('utils/helpers.js');
      expect(result.allFileNames).not.toContain('complex-setup.ts'); // Root excluded

      const processedVariant = result.code.default as VariantCode;
      expect(processedVariant.extraFiles?.['base.css']).toBeDefined();
      expect(processedVariant.extraFiles?.['components/button.css']).toBeDefined();
      expect(processedVariant.extraFiles?.['utils/helpers.js']).toBeDefined();
      expect((processedVariant.extraFiles?.['base.css'] as any).source).toBe(
        '* { box-sizing: border-box; }',
      );
      expect((processedVariant.extraFiles?.['components/button.css'] as any).source).toBe(
        '.btn { padding: 8px; }',
      );
      expect((processedVariant.extraFiles?.['utils/helpers.js'] as any).source).toBe(
        'export const format = (s) => s.trim();',
      );

      // Verify that globals files are marked with metadata: true
      expect((processedVariant.extraFiles?.['base.css'] as any).metadata).toBe(true);
      expect((processedVariant.extraFiles?.['components/button.css'] as any).metadata).toBe(true);
      expect((processedVariant.extraFiles?.['utils/helpers.js'] as any).metadata).toBe(true);
    });

    it('should resolve Code objects to VariantCode objects for efficient loadCodeVariant processing', async () => {
      const variantCode: VariantCode = {
        fileName: 'App.tsx',
        url: 'http://example.com/App.tsx',
        source: 'const App = () => <div>App</div>;',
        allFilesListed: false, // Force loadCodeVariant processing
      };

      // Pass globalsCode as Code object (simulating loadCodeFallback receiving it from component)
      const globalsCodeAsCodeObject: Code = {
        default: {
          fileName: 'global-theme.css',
          source: '.global-theme { color: blue; }',
          extraFiles: {
            'theme-vars.css': { source: ':root { --theme-blue: #007bff; }' },
          },
        },
      };

      const result = await loadCodeFallback(
        'http://example.com',
        'default',
        { default: variantCode },
        {
          shouldHighlight: false,
          fallbackUsesExtraFiles: false,
          fallbackUsesAllVariants: false,
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          loadCodeMeta: mockLoadCodeMeta,
          initialFilename: undefined,
          variants: undefined,
          globalsCode: [globalsCodeAsCodeObject],
        },
      );

      // Verify that loadCodeFallback resolved the Code object and passed VariantCode to loadCodeVariant
      // The mock loadCodeVariant should have been called with resolved VariantCode objects in globalsCode
      expect(mockLoadVariant).toHaveBeenCalledWith(
        'http://example.com',
        'default',
        variantCode,
        expect.objectContaining({
          disableTransforms: true,
          disableParsing: true,
          sourceParser: expect.any(Promise),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          sourceTransformers: undefined,
          globalsCode: expect.arrayContaining([
            expect.objectContaining({
              fileName: 'global-theme.css',
              source: '.global-theme { color: blue; }',
              extraFiles: expect.objectContaining({
                'theme-vars.css': { source: ':root { --theme-blue: #007bff; }' },
              }),
            }),
          ]),
        }),
      );

      // Verify that the globalsCode processing worked (from our mock)
      expect(result.allFileNames).toContain('App.tsx');
      expect(result.allFileNames).toContain('theme-vars.css');
    });

    it('should handle string URLs in globalsCode without requiring preprocessing', async () => {
      const variantCode: VariantCode = {
        fileName: 'Component.tsx',
        url: 'http://example.com/Component.tsx',
        source: 'const Component = () => <span>Component</span>;',
        allFilesListed: true, // Allow early return
      };

      const globalsUrl = 'http://example.com/lazy-styles.css';

      // Provide the loaded Code object with our variant
      const loaded: Code = {
        default: variantCode,
      };

      const result = await loadCodeFallback(
        'http://example.com',
        'default',
        loaded, // Provide loaded Code
        {
          shouldHighlight: false, // shouldHighlight
          fallbackUsesExtraFiles: false, // fallbackUsesExtraFiles
          fallbackUsesAllVariants: false, // fallbackUsesAllVariants
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          loadCodeMeta: mockLoadCodeMeta,
          initialFilename: 'Component.tsx', // initialFilename
          variants: undefined, // variants
          globalsCode: [globalsUrl], // globalsCode - Pass URL string directly
        },
      );

      // Verify that the function completes successfully with globalsCode
      expect(result.allFileNames).toContain('Component.tsx');
      expect(result.initialSource).toBeDefined();

      // The key test: globalsCode string URLs should be accepted without preprocessing
      // This is an optimization where strings are passed through directly to loadCodeVariant
      // when it's needed, avoiding unnecessary pre-resolution

      // Verify the result structure is correct
      expect(result.allFileNames).toContain('Component.tsx');
    });

    it('should handle early return scenarios efficiently without processing globalsCode', async () => {
      const variantCode: VariantCode = {
        fileName: 'QuickComponent.tsx',
        url: 'http://example.com/QuickComponent.tsx',
        source: 'const QuickComponent = () => <div>Quick</div>;',
        allFilesListed: true, // Enable early return
      };

      const globalsUrl = 'http://example.com/unused-globals.css';

      const result = await loadCodeFallback(
        'http://example.com',
        'default',
        { default: variantCode },
        {
          shouldHighlight: false, // shouldHighlight=false
          fallbackUsesExtraFiles: false, // fallbackUsesExtraFiles=false
          fallbackUsesAllVariants: false, // fallbackUsesAllVariants=false
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          loadCodeMeta: mockLoadCodeMeta,
          initialFilename: undefined,
          variants: undefined,
          globalsCode: [globalsUrl], // globalsCode provided but should be ignored in early return
        },
      );

      // Verify early return took place (loadCodeVariant should not have been called)
      expect(mockLoadVariant).not.toHaveBeenCalled();

      // Verify no globalsCode processing occurred (loadVariantMeta not called)
      expect(mockLoadVariantMeta).not.toHaveBeenCalled();

      // Result should only contain the main variant without globalsCode processing
      expect(result.allFileNames).toEqual(['QuickComponent.tsx']);
      expect(result.initialSource).toBe('const QuickComponent = () => <div>Quick</div>;');
    });

    it('should handle fallbackUsesAllVariants with globalsCode sharing across variants', async () => {
      const jsVariant: VariantCode = {
        fileName: 'App.js',
        url: 'http://example.com/App.js',
        source: 'const App = () => React.createElement("div", null, "JS");',
        allFilesListed: false,
      };

      const tsVariant: VariantCode = {
        fileName: 'App.tsx',
        url: 'http://example.com/App.tsx',
        source: 'const App = () => <div>TS</div>;',
        allFilesListed: false,
      };

      const sharedGlobalsCode: Code = {
        javascript: {
          fileName: 'js-shared.css',
          source: '.js-shared { font-family: Arial; }',
          extraFiles: {
            'reset.css': { source: '* { margin: 0; }' },
          },
        },
        typescript: {
          fileName: 'ts-shared.css',
          source: '.ts-shared { font-family: Arial; }',
          extraFiles: {
            'reset.css': { source: '* { margin: 0; }' },
          },
        },
      };

      mockLoadVariantMeta.mockResolvedValue(tsVariant);

      const result = await loadCodeFallback(
        'http://example.com',
        'javascript', // Initial variant
        {
          javascript: jsVariant,
          typescript: 'http://example.com/typescript', // String URL
        },
        {
          shouldHighlight: false,
          fallbackUsesExtraFiles: false,
          fallbackUsesAllVariants: true, // fallbackUsesAllVariants=true
          sourceParser: Promise.resolve(mockParseSource),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          loadCodeMeta: mockLoadCodeMeta,
          initialFilename: undefined,
          variants: ['javascript', 'typescript'],
          globalsCode: [sharedGlobalsCode], // Shared across variants
        },
      );

      // Verify loadCodeVariant was called for both variants with the same resolved globalsCode
      expect(mockLoadVariant).toHaveBeenCalledTimes(2);

      // Each variant should receive its own specific globalsCode
      const expectedJavascriptGlobalsCode = expect.arrayContaining([
        expect.objectContaining({
          fileName: 'js-shared.css',
          source: '.js-shared { font-family: Arial; }',
          extraFiles: expect.objectContaining({
            'reset.css': { source: '* { margin: 0; }' },
          }),
        }),
      ]);

      const expectedTypescriptGlobalsCode = expect.arrayContaining([
        expect.objectContaining({
          fileName: 'ts-shared.css',
          source: '.ts-shared { font-family: Arial; }',
          extraFiles: expect.objectContaining({
            'reset.css': { source: '* { margin: 0; }' },
          }),
        }),
      ]);

      expect(mockLoadVariant).toHaveBeenCalledWith(
        'http://example.com',
        'javascript',
        jsVariant,
        expect.objectContaining({
          sourceParser: expect.any(Promise),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          sourceTransformers: undefined,
          globalsCode: expectedJavascriptGlobalsCode,
        }),
      );

      expect(mockLoadVariant).toHaveBeenCalledWith(
        'http://example.com',
        'typescript',
        'http://example.com/typescript', // URL string, not VariantCode object
        expect.objectContaining({
          disableTransforms: true,
          disableParsing: true,
          sourceParser: expect.any(Promise),
          loadSource: mockLoadSource,
          loadVariantMeta: mockLoadVariantMeta,
          sourceTransformers: undefined,
          globalsCode: expectedTypescriptGlobalsCode,
        }),
      );

      // Verify both variants are included in results
      expect(result.allFileNames).toContain('App.js');
      expect(result.allFileNames).toContain('App.tsx');
      expect(result.allFileNames).toContain('reset.css'); // From shared globalsCode
    });
  });
});
