import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import { transformSource } from './transformSource';
import type { SourceTransformers, TransformSource } from './types';

describe('transformSource', () => {
  let mockTransformer: MockedFunction<TransformSource>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTransformer = vi.fn();
  });

  describe('basic functionality', () => {
    it('should transform source with single transformer', async () => {
      const source = 'const x = 1;';
      const fileName = 'test.ts';
      const transformResult = {
        'syntax-highlight': {
          source: 'const x = 1; // highlighted',
          fileName: 'test.ts',
        },
      };

      mockTransformer.mockResolvedValue(transformResult);

      const sourceTransformers: SourceTransformers = [
        {
          extensions: ['ts', 'tsx'],
          transformer: mockTransformer,
        },
      ];

      const result = await transformSource(source, fileName, sourceTransformers);

      expect(mockTransformer).toHaveBeenCalledWith(source, fileName);
      expect(result).toBeDefined();
      expect(result!['syntax-highlight']).toBeDefined();
      expect(result!['syntax-highlight'].fileName).toBe('test.ts');
      expect(result!['syntax-highlight'].delta).toBeDefined();
    });

    it('should return undefined when no transformers match', async () => {
      const source = 'const x = 1;';
      const fileName = 'test.js';

      const sourceTransformers: SourceTransformers = [
        {
          extensions: ['ts', 'tsx'],
          transformer: mockTransformer,
        },
      ];

      const result = await transformSource(source, fileName, sourceTransformers);

      expect(mockTransformer).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it('should return undefined when transformer returns undefined', async () => {
      const source = 'const x = 1;';
      const fileName = 'test.ts';

      mockTransformer.mockResolvedValue(undefined);

      const sourceTransformers: SourceTransformers = [
        {
          extensions: ['ts', 'tsx'],
          transformer: mockTransformer,
        },
      ];

      const result = await transformSource(source, fileName, sourceTransformers);

      expect(mockTransformer).toHaveBeenCalledWith(source, fileName);
      expect(result).toBeUndefined();
    });
  });

  describe('extension matching', () => {
    it('should match file extension correctly', async () => {
      const source = 'const Component = () => <div />;';
      const fileName = 'component.tsx';
      const transformResult = {
        'jsx-highlight': {
          source: 'const Component = () => <div />; // jsx highlighted',
          fileName: 'component.tsx',
        },
      };

      const tsxTransformer = vi.fn().mockResolvedValue(transformResult);
      const jsTransformer = vi.fn().mockResolvedValue({
        'js-highlight': {
          source: 'const Component = () => <div />; // js highlighted',
          fileName: 'component.tsx',
        },
      });

      const sourceTransformers: SourceTransformers = [
        {
          extensions: ['js'],
          transformer: jsTransformer,
        },
        {
          extensions: ['ts', 'tsx'],
          transformer: tsxTransformer,
        },
      ];

      const result = await transformSource(source, fileName, sourceTransformers);

      // Only the .tsx transformer should be called
      expect(tsxTransformer).toHaveBeenCalledWith(source, fileName);
      expect(jsTransformer).not.toHaveBeenCalled();

      expect(result).toBeDefined();
      expect(result!['jsx-highlight']).toBeDefined();
      expect(result!['jsx-highlight'].fileName).toBe('component.tsx');
    });

    it('should handle multiple matching extensions', async () => {
      const source = 'const x = 1;';
      const fileName = 'test.ts';

      const highlightTransformer = vi.fn().mockResolvedValue({
        'syntax-highlight': {
          source: 'const x = 1; // highlighted',
          fileName: 'test.ts',
        },
      });

      const lintTransformer = vi.fn().mockResolvedValue({
        'lint-errors': {
          source: 'const x = 1; // lint error',
          fileName: 'test.ts',
        },
      });

      const sourceTransformers: SourceTransformers = [
        {
          extensions: ['ts', 'tsx'],
          transformer: highlightTransformer,
        },
        {
          extensions: ['ts'],
          transformer: lintTransformer,
        },
      ];

      const result = await transformSource(source, fileName, sourceTransformers);

      // Both transformers should be called
      expect(highlightTransformer).toHaveBeenCalledWith(source, fileName);
      expect(lintTransformer).toHaveBeenCalledWith(source, fileName);

      // Should merge transforms from both transformers
      expect(result).toBeDefined();
      expect(result!['syntax-highlight']).toBeDefined();
      expect(result!['lint-errors']).toBeDefined();
    });
  });

  describe('source type handling', () => {
    it('should handle string source', async () => {
      const source = 'const x = 1;';
      const fileName = 'test.ts';
      const transformResult = {
        highlight: {
          source: 'const x = 1; // highlighted',
          fileName: 'test.ts',
        },
      };

      mockTransformer.mockResolvedValue(transformResult);

      const sourceTransformers: SourceTransformers = [
        {
          extensions: ['ts'],
          transformer: mockTransformer,
        },
      ];

      const result = await transformSource(source, fileName, sourceTransformers);

      expect(mockTransformer).toHaveBeenCalledWith(source, fileName);
      expect(result).toBeDefined();
    });

    it('should handle HAST node source', async () => {
      const hastSource = {
        type: 'element' as const,
        tagName: 'pre',
        properties: {},
        children: [
          {
            type: 'text' as const,
            value: 'const x = 1;',
          },
        ],
      };
      const fileName = 'test.ts';
      const transformResult = {
        highlight: {
          source: 'const x = 1; // highlighted',
          fileName: 'test.ts',
        },
      };

      mockTransformer.mockResolvedValue(transformResult);

      const sourceTransformers: SourceTransformers = [
        {
          extensions: ['ts'],
          transformer: mockTransformer,
        },
      ];

      const result = await transformSource(hastSource, fileName, sourceTransformers);

      expect(mockTransformer).toHaveBeenCalledWith('const x = 1;', fileName);
      expect(result).toBeDefined();
    });

    it('should handle hastJson source', async () => {
      const hastJsonSource = {
        hastJson: JSON.stringify({
          type: 'element' as const,
          tagName: 'pre',
          properties: {},
          children: [
            {
              type: 'text' as const,
              value: 'const x = 1;',
            },
          ],
        }),
      };
      const fileName = 'test.ts';
      const transformResult = {
        highlight: {
          source: 'const x = 1; // highlighted',
          fileName: 'test.ts',
        },
      };

      mockTransformer.mockResolvedValue(transformResult);

      const sourceTransformers: SourceTransformers = [
        {
          extensions: ['ts'],
          transformer: mockTransformer,
        },
      ];

      const result = await transformSource(hastJsonSource, fileName, sourceTransformers);

      expect(mockTransformer).toHaveBeenCalledWith('const x = 1;', fileName);
      expect(result).toBeDefined();
    });
  });

  describe('delta calculation', () => {
    it('should calculate delta correctly for source changes', async () => {
      const source = 'const x = 1;\nconst y = 2;';
      const fileName = 'test.ts';
      const transformResult = {
        highlight: {
          source: 'const x = 1; // highlighted\nconst y = 2;',
          fileName: 'test.ts',
        },
      };

      mockTransformer.mockResolvedValue(transformResult);

      const sourceTransformers: SourceTransformers = [
        {
          extensions: ['ts'],
          transformer: mockTransformer,
        },
      ];

      const result = await transformSource(source, fileName, sourceTransformers);

      expect(result).toBeDefined();
      expect(result!.highlight.delta).toBeDefined();
      // Delta should represent the change from original to transformed
      expect(result!.highlight.delta).toMatchObject({
        0: ['const x = 1; // highlighted'],
      });
    });

    it('should handle multi-line changes', async () => {
      const source = 'const x = 1;\nconst y = 2;';
      const fileName = 'test.ts';
      const transformResult = {
        highlight: {
          source: '// File header\nconst x = 1;\nconst y = 2;\n// Footer',
          fileName: 'test.ts',
        },
      };

      mockTransformer.mockResolvedValue(transformResult);

      const sourceTransformers: SourceTransformers = [
        {
          extensions: ['ts'],
          transformer: mockTransformer,
        },
      ];

      const result = await transformSource(source, fileName, sourceTransformers);

      expect(result).toBeDefined();
      expect(result!.highlight.delta).toBeDefined();
      // Should handle additions at beginning and end
      expect(result!.highlight.delta).toMatchObject({
        0: ['// File header'],
        _t: 'a',
        3: ['// Footer'],
      });
    });
  });

  describe('error handling', () => {
    it('should handle transformer errors gracefully', async () => {
      const source = 'const x = 1;';
      const fileName = 'test.ts';

      mockTransformer.mockRejectedValue(new Error('Transform failed'));

      const sourceTransformers: SourceTransformers = [
        {
          extensions: ['ts'],
          transformer: mockTransformer,
        },
      ];

      await expect(transformSource(source, fileName, sourceTransformers)).rejects.toThrow(
        'Failed to transform source code (file: test.ts): Transform failed',
      );
    });

    it('should handle non-Error exceptions', async () => {
      const source = 'const x = 1;';
      const fileName = 'test.ts';

      mockTransformer.mockRejectedValue('String error');

      const sourceTransformers: SourceTransformers = [
        {
          extensions: ['ts'],
          transformer: mockTransformer,
        },
      ];

      await expect(transformSource(source, fileName, sourceTransformers)).rejects.toThrow(
        'Failed to transform source code (file: test.ts): false',
      );
    });

    it('should throw error for duplicate transform keys', async () => {
      const source = 'const x = 1;';
      const fileName = 'test.ts';

      const transformer1 = vi.fn().mockResolvedValue({
        'duplicate-key': {
          source: 'const x = 1; // transform1',
          fileName: 'test.ts',
        },
      });

      const transformer2 = vi.fn().mockResolvedValue({
        'duplicate-key': {
          source: 'const x = 1; // transform2',
          fileName: 'test.ts',
        },
      });

      const sourceTransformers: SourceTransformers = [
        {
          extensions: ['ts'],
          transformer: transformer1,
        },
        {
          extensions: ['ts'],
          transformer: transformer2,
        },
      ];

      await expect(transformSource(source, fileName, sourceTransformers)).rejects.toThrow(
        'Duplicate key found in source transformations: duplicate-key',
      );
    });
  });

  describe('edge cases', () => {
    it('should handle empty source', async () => {
      const source = '';
      const fileName = 'test.ts';
      const transformResult = {
        highlight: {
          source: '// Added header',
          fileName: 'test.ts',
        },
      };

      mockTransformer.mockResolvedValue(transformResult);

      const sourceTransformers: SourceTransformers = [
        {
          extensions: ['ts'],
          transformer: mockTransformer,
        },
      ];

      const result = await transformSource(source, fileName, sourceTransformers);

      expect(mockTransformer).toHaveBeenCalledWith('', fileName);
      expect(result).toBeDefined();
      expect(result!.highlight.delta).toBeDefined();
    });

    it('should handle empty transformers array', async () => {
      const source = 'const x = 1;';
      const fileName = 'test.ts';
      const sourceTransformers: SourceTransformers = [];

      const result = await transformSource(source, fileName, sourceTransformers);

      expect(result).toBeUndefined();
    });

    it('should handle transformer returning empty object', async () => {
      const source = 'const x = 1;';
      const fileName = 'test.ts';

      mockTransformer.mockResolvedValue({});

      const sourceTransformers: SourceTransformers = [
        {
          extensions: ['ts'],
          transformer: mockTransformer,
        },
      ];

      const result = await transformSource(source, fileName, sourceTransformers);

      expect(mockTransformer).toHaveBeenCalledWith(source, fileName);
      expect(result).toEqual({});
    });
  });
});
