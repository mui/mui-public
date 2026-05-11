import { describe, it, expect, vi } from 'vitest';
import { enhanceCode } from './enhanceCode';
import type { Code, HastRoot, SourceEnhancers, SourceComments } from '../../CodeHighlighter/types';

describe('enhanceCode', () => {
  // Helper to create a simple HAST root for testing
  const createHastRoot = (text: string): HastRoot => ({
    type: 'root',
    children: [{ type: 'text', value: text }],
  });

  describe('early returns', () => {
    it('should return code unchanged when sourceEnhancers is undefined', async () => {
      const code: Code = {
        Default: {
          fileName: 'test.ts',
          source: createHastRoot('const x = 1;'),
        },
      };

      const result = await enhanceCode(code, undefined as unknown as SourceEnhancers);

      expect(result).toBe(code);
    });

    it('should return code unchanged when sourceEnhancers is empty array', async () => {
      const code: Code = {
        Default: {
          fileName: 'test.ts',
          source: createHastRoot('const x = 1;'),
        },
      };

      const result = await enhanceCode(code, []);

      expect(result).toBe(code);
    });
  });

  describe('single variant enhancement', () => {
    it('should apply enhancer to variant with HAST source', async () => {
      const originalHast = createHastRoot('original');
      const enhancedHast = createHastRoot('enhanced');

      const code: Code = {
        Default: {
          fileName: 'test.ts',
          source: originalHast,
        },
      };

      const mockEnhancer = vi.fn().mockReturnValue(enhancedHast);
      const enhancers: SourceEnhancers = [mockEnhancer];

      const result = await enhanceCode(code, enhancers);

      expect(mockEnhancer).toHaveBeenCalledWith(originalHast, undefined, 'test.ts');
      expect(result.Default).toEqual({
        fileName: 'test.ts',
        source: enhancedHast,
        extraFiles: undefined,
        comments: undefined,
      });
    });

    it('should pass comments to enhancer', async () => {
      const comments: SourceComments = { 1: ['@highlight'], 5: ['@focus'] };
      const originalHast = createHastRoot('const x = 1;');

      const code: Code = {
        Default: {
          fileName: 'test.ts',
          source: originalHast,
          comments,
        },
      };

      const mockEnhancer = vi.fn().mockImplementation((root) => root);
      const enhancers: SourceEnhancers = [mockEnhancer];

      await enhanceCode(code, enhancers);

      expect(mockEnhancer).toHaveBeenCalledWith(originalHast, comments, 'test.ts');
    });

    it('should clear comments after enhancement', async () => {
      const code: Code = {
        Default: {
          fileName: 'test.ts',
          source: createHastRoot('const x = 1;'),
          comments: { 1: ['@highlight'] },
        },
      };

      const mockEnhancer = vi.fn().mockImplementation((root) => root);
      const result = await enhanceCode(code, [mockEnhancer]);

      expect(result.Default).toHaveProperty('comments', undefined);
    });

    it('should use "unknown" as fileName when not provided', async () => {
      const code: Code = {
        Default: {
          source: createHastRoot('const x = 1;'),
        },
      };

      const mockEnhancer = vi.fn().mockImplementation((root) => root);
      await enhanceCode(code, [mockEnhancer]);

      expect(mockEnhancer).toHaveBeenCalledWith(expect.anything(), undefined, 'unknown');
    });
  });

  describe('string variant handling', () => {
    it('should return string variants unchanged', async () => {
      const code: Code = {
        Default: 'file:///test.ts',
      };

      const mockEnhancer = vi.fn();
      const result = await enhanceCode(code, [mockEnhancer]);

      expect(mockEnhancer).not.toHaveBeenCalled();
      expect(result.Default).toBe('file:///test.ts');
    });
  });

  describe('non-HAST source handling', () => {
    it('should return variant unchanged when source is a string', async () => {
      const code: Code = {
        Default: {
          fileName: 'test.ts',
          source: 'const x = 1;', // String, not HAST
        },
      };

      const mockEnhancer = vi.fn();
      const result = await enhanceCode(code, [mockEnhancer]);

      expect(mockEnhancer).not.toHaveBeenCalled();
      expect(result.Default).toEqual({
        fileName: 'test.ts',
        source: 'const x = 1;',
      });
    });

    it('should return variant unchanged when source is undefined', async () => {
      const code: Code = {
        Default: {
          fileName: 'test.ts',
        },
      };

      const mockEnhancer = vi.fn();
      const result = await enhanceCode(code, [mockEnhancer]);

      expect(mockEnhancer).not.toHaveBeenCalled();
      expect(result.Default).toEqual({ fileName: 'test.ts' });
    });

    it('should return variant unchanged when source is hastJson format', async () => {
      const code: Code = {
        Default: {
          fileName: 'test.ts',
          source: { hastJson: '{"type":"root","children":[]}' },
        },
      };

      const mockEnhancer = vi.fn();
      await enhanceCode(code, [mockEnhancer]);

      // hastJson is not a direct HAST root, so isHastRoot returns false
      expect(mockEnhancer).not.toHaveBeenCalled();
    });
  });

  describe('multiple variants', () => {
    it('should enhance all variants in parallel', async () => {
      const tsHast = createHastRoot('TypeScript');
      const jsHast = createHastRoot('JavaScript');

      const code: Code = {
        TypeScript: {
          fileName: 'test.ts',
          source: tsHast,
        },
        JavaScript: {
          fileName: 'test.js',
          source: jsHast,
        },
      };

      const callOrder: string[] = [];
      const mockEnhancer = vi.fn().mockImplementation((root, _comments, fileName) => {
        callOrder.push(fileName);
        return { ...root, data: { enhanced: true } };
      });

      const result = await enhanceCode(code, [mockEnhancer]);

      expect(mockEnhancer).toHaveBeenCalledTimes(2);
      expect(callOrder).toContain('test.ts');
      expect(callOrder).toContain('test.js');

      expect((result.TypeScript as { source: HastRoot }).source.data).toEqual({ enhanced: true });
      expect((result.JavaScript as { source: HastRoot }).source.data).toEqual({ enhanced: true });
    });

    it('should handle mixed variant types (some HAST, some string)', async () => {
      const code: Code = {
        TypeScript: {
          fileName: 'test.ts',
          source: createHastRoot('TypeScript'),
        },
        JavaScript: 'file:///test.js', // String variant
        Empty: undefined,
      };

      const mockEnhancer = vi.fn().mockImplementation((root) => root);
      const result = await enhanceCode(code, [mockEnhancer]);

      expect(mockEnhancer).toHaveBeenCalledTimes(1); // Only TypeScript variant
      expect(result.JavaScript).toBe('file:///test.js');
      expect(result.Empty).toBeUndefined();
    });
  });

  describe('extraFiles enhancement', () => {
    it('should enhance extraFiles with HAST sources', async () => {
      const mainHast = createHastRoot('main');
      const helperHast = createHastRoot('helper');
      const enhancedHelper = createHastRoot('enhanced helper');

      const code: Code = {
        Default: {
          fileName: 'main.ts',
          source: mainHast,
          extraFiles: {
            'helper.ts': {
              source: helperHast,
            },
          },
        },
      };

      const mockEnhancer = vi.fn().mockImplementation((root, _comments, fileName) => {
        if (fileName === 'helper.ts') {
          return enhancedHelper;
        }
        return root;
      });

      const result = await enhanceCode(code, [mockEnhancer]);

      expect(mockEnhancer).toHaveBeenCalledTimes(2);
      expect(mockEnhancer).toHaveBeenCalledWith(mainHast, undefined, 'main.ts');
      expect(mockEnhancer).toHaveBeenCalledWith(helperHast, undefined, 'helper.ts');

      const extraFile = (result.Default as { extraFiles: { 'helper.ts': { source: HastRoot } } })
        .extraFiles['helper.ts'];
      expect(extraFile.source).toBe(enhancedHelper);
    });

    it('should pass extraFile comments to enhancer', async () => {
      const helperComments: SourceComments = { 3: ['@section'] };

      const code: Code = {
        Default: {
          fileName: 'main.ts',
          source: createHastRoot('main'),
          extraFiles: {
            'helper.ts': {
              source: createHastRoot('helper'),
              comments: helperComments,
            },
          },
        },
      };

      const mockEnhancer = vi.fn().mockImplementation((root) => root);
      await enhanceCode(code, [mockEnhancer]);

      expect(mockEnhancer).toHaveBeenCalledWith(expect.anything(), helperComments, 'helper.ts');
    });

    it('should clear extraFile comments after enhancement', async () => {
      const code: Code = {
        Default: {
          fileName: 'main.ts',
          source: createHastRoot('main'),
          extraFiles: {
            'helper.ts': {
              source: createHastRoot('helper'),
              comments: { 1: ['@highlight'] },
            },
          },
        },
      };

      const mockEnhancer = vi.fn().mockImplementation((root) => root);
      const result = await enhanceCode(code, [mockEnhancer]);

      const extraFile = (result.Default as { extraFiles: { 'helper.ts': { comments?: unknown } } })
        .extraFiles['helper.ts'];
      expect(extraFile.comments).toBeUndefined();
    });

    it('should keep string extraFiles unchanged', async () => {
      const code: Code = {
        Default: {
          fileName: 'main.ts',
          source: createHastRoot('main'),
          extraFiles: {
            'helper.ts': 'file:///helper.ts', // String reference
          },
        },
      };

      const mockEnhancer = vi.fn().mockImplementation((root) => root);
      const result = await enhanceCode(code, [mockEnhancer]);

      expect(
        (result.Default as { extraFiles: { 'helper.ts': string } }).extraFiles['helper.ts'],
      ).toBe('file:///helper.ts');
    });

    it('should keep extraFiles with string sources unchanged', async () => {
      const code: Code = {
        Default: {
          fileName: 'main.ts',
          source: createHastRoot('main'),
          extraFiles: {
            'helper.ts': {
              source: 'const helper = true;', // String source, not HAST
            },
          },
        },
      };

      const mockEnhancer = vi.fn().mockImplementation((root) => root);
      await enhanceCode(code, [mockEnhancer]);

      // Enhancer only called for main file (HAST), not helper (string source)
      expect(mockEnhancer).toHaveBeenCalledTimes(1);
      expect(mockEnhancer).toHaveBeenCalledWith(expect.anything(), undefined, 'main.ts');
    });
  });

  describe('enhancer chaining', () => {
    it('should apply multiple enhancers in sequence', async () => {
      const original = createHastRoot('original');
      const firstResult = createHastRoot('first');
      const secondResult = createHastRoot('second');

      const code: Code = {
        Default: {
          fileName: 'test.ts',
          source: original,
        },
      };

      const firstEnhancer = vi.fn().mockReturnValue(firstResult);
      const secondEnhancer = vi.fn().mockReturnValue(secondResult);

      const result = await enhanceCode(code, [firstEnhancer, secondEnhancer]);

      expect(firstEnhancer).toHaveBeenCalledWith(original, undefined, 'test.ts');
      expect(secondEnhancer).toHaveBeenCalledWith(firstResult, undefined, 'test.ts');
      expect((result.Default as { source: HastRoot }).source).toBe(secondResult);
    });

    it('should pass comments to all enhancers in chain', async () => {
      const comments: SourceComments = { 1: ['@test'] };

      const code: Code = {
        Default: {
          fileName: 'test.ts',
          source: createHastRoot('test'),
          comments,
        },
      };

      const firstEnhancer = vi.fn().mockImplementation((root) => root);
      const secondEnhancer = vi.fn().mockImplementation((root) => root);

      await enhanceCode(code, [firstEnhancer, secondEnhancer]);

      expect(firstEnhancer).toHaveBeenCalledWith(expect.anything(), comments, 'test.ts');
      expect(secondEnhancer).toHaveBeenCalledWith(expect.anything(), comments, 'test.ts');
    });
  });

  describe('async enhancers', () => {
    it('should support async enhancers', async () => {
      const original = createHastRoot('original');
      const enhanced = createHastRoot('async enhanced');

      const code: Code = {
        Default: {
          fileName: 'test.ts',
          source: original,
        },
      };

      const asyncEnhancer = vi.fn().mockResolvedValue(enhanced);
      const result = await enhanceCode(code, [asyncEnhancer]);

      expect(asyncEnhancer).toHaveBeenCalled();
      expect((result.Default as { source: HastRoot }).source).toBe(enhanced);
    });

    it('should support mixed sync and async enhancers', async () => {
      const original = createHastRoot('original');
      const firstResult = createHastRoot('first');
      const secondResult = createHastRoot('second');

      const code: Code = {
        Default: {
          fileName: 'test.ts',
          source: original,
        },
      };

      const syncEnhancer = vi.fn().mockReturnValue(firstResult);
      const asyncEnhancer = vi.fn().mockResolvedValue(secondResult);

      const result = await enhanceCode(code, [syncEnhancer, asyncEnhancer]);

      expect((result.Default as { source: HastRoot }).source).toBe(secondResult);
    });
  });

  describe('undefined/null variant handling', () => {
    it('should preserve undefined variants', async () => {
      const code: Code = {
        Default: undefined,
      };

      const mockEnhancer = vi.fn();
      const result = await enhanceCode(code, [mockEnhancer]);

      expect(mockEnhancer).not.toHaveBeenCalled();
      expect(result.Default).toBeUndefined();
    });
  });
});
