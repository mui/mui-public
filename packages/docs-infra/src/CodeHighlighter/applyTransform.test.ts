import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Nodes as HastNodes } from 'hast';
import { applyTransform, applyTransforms } from './applyTransform';
import { transformSource } from './transformSource';
import { transformParsedSource } from './transformParsedSource';
import type { VariantSource, Transforms, SourceTransformers, ParseSource } from './types';

describe('applyTransform', () => {
  describe('applyTransform', () => {
    it('should apply transform to string source', () => {
      const source = 'const x = 1;';
      const transforms: Transforms = {
        'syntax-highlight': {
          delta: [['const x = 1; // highlighted']],
        },
      };

      const result = applyTransform(source, transforms, 'syntax-highlight');
      expect(result).toBe('const x = 1; // highlighted');
    });

    it('should apply transform to HastNodes source', () => {
      const source: HastNodes = {
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'code',
            properties: {},
            children: [{ type: 'text', value: 'const x = 1;' }],
          },
        ],
      };
      const transforms: Transforms = {
        'syntax-highlight': {
          delta: {
            children: {
              0: {
                children: {
                  0: {
                    value: ['const x = 1; // highlighted'],
                  },
                },
              },
            },
          },
        },
      };

      const result = applyTransform(source, transforms, 'syntax-highlight');
      expect(result).toEqual({
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'code',
            properties: {},
            children: [{ type: 'text', value: 'const x = 1; // highlighted' }],
          },
        ],
      });
    });

    it('should apply transform to hastJson source', () => {
      const hastJson = JSON.stringify({
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'code',
            properties: {},
            children: [{ type: 'text', value: 'const x = 1;' }],
          },
        ],
      });
      const source: VariantSource = { hastJson };
      const transforms: Transforms = {
        'syntax-highlight': {
          delta: {
            children: {
              0: {
                children: {
                  0: {
                    value: ['const x = 1; // highlighted'],
                  },
                },
              },
            },
          },
        },
      };

      const result = applyTransform(source, transforms, 'syntax-highlight');
      expect(result).toEqual({
        hastJson: JSON.stringify({
          type: 'root',
          children: [
            {
              type: 'element',
              tagName: 'code',
              properties: {},
              children: [{ type: 'text', value: 'const x = 1; // highlighted' }],
            },
          ],
        }),
      });
    });

    it('should apply complex delta transformations', () => {
      const source = 'line1\nline2\nline3';
      const transforms: Transforms = {
        'modify-lines': {
          delta: {
            1: ['line2 modified'],
            _t: 'a',
          },
        },
      };

      const result = applyTransform(source, transforms, 'modify-lines');
      expect(result).toContain('line2 modified');
    });

    it('should throw error for non-existent transform key', () => {
      const source = 'const x = 1;';
      const transforms: Transforms = {
        'syntax-highlight': {
          delta: [['const x = 1; // highlighted']],
        },
      };

      expect(() => applyTransform(source, transforms, 'non-existent')).toThrow(
        'Transform "non-existent" not found in transforms',
      );
    });

    it('should throw error when patch returns invalid result', () => {
      const source = 'const x = 1;';
      const transforms: Transforms = {
        'invalid-transform': {
          delta: null as any,
        },
      };

      expect(() => applyTransform(source, transforms, 'invalid-transform')).toThrow();
    });

    it('should handle multiline source correctly', () => {
      const source = 'const x = 1;\nconst y = 2;\nconst z = 3;';
      const transforms: Transforms = {
        'add-comments': {
          delta: {
            0: ['const x = 1; // variable x'],
            1: ['const y = 2; // variable y'],
            2: ['const z = 3; // variable z'],
            _t: 'a',
          },
        },
      };

      const result = applyTransform(source, transforms, 'add-comments');
      expect(result).toContain('variable x');
      expect(result).toContain('variable y');
      expect(result).toContain('variable z');
    });
  });

  describe('applyTransforms', () => {
    it('should apply multiple transforms in sequence', () => {
      const source = 'const x = 1;';
      const transforms: Transforms = {
        'first-transform': {
          delta: [['const x = 1; // first']],
        },
        'second-transform': {
          delta: [['const x = 1; // first // second']],
        },
      };

      const result = applyTransforms(source, transforms, ['first-transform', 'second-transform']);
      expect(result).toBe('const x = 1; // first // second');
    });

    it('should handle empty transform keys array', () => {
      const source = 'const x = 1;';
      const transforms: Transforms = {
        'syntax-highlight': {
          delta: [['const x = 1; // highlighted']],
        },
      };

      const result = applyTransforms(source, transforms, []);
      expect(result).toBe('const x = 1;');
    });

    it('should apply single transform via array', () => {
      const source = 'const x = 1;';
      const transforms: Transforms = {
        'syntax-highlight': {
          delta: [['const x = 1; // highlighted']],
        },
      };

      const result = applyTransforms(source, transforms, ['syntax-highlight']);
      expect(result).toBe('const x = 1; // highlighted');
    });

    it('should throw error for non-existent transform in sequence', () => {
      const source = 'const x = 1;';
      const transforms: Transforms = {
        'syntax-highlight': {
          delta: [['const x = 1; // highlighted']],
        },
      };

      expect(() =>
        applyTransforms(source, transforms, ['syntax-highlight', 'non-existent']),
      ).toThrow('Transform "non-existent" not found in transforms');
    });
  });

  describe('Integration tests with real-world transformers', () => {
    const mockParseSource = vi.fn();

    beforeEach(() => {
      mockParseSource.mockClear();
    });

    it('should work with real transformSource deltas for string sources', async () => {
      // Mock a simple syntax highlighter transformer
      const mockTransformer = vi.fn().mockResolvedValue({
        'syntax-highlight': {
          source: 'const x = 1; // highlighted\nconst y = 2; // also highlighted',
          fileName: 'test.js',
        },
      });

      const sourceTransformers: SourceTransformers = [
        {
          extensions: ['js', 'ts'],
          transformer: mockTransformer,
        },
      ];

      const source = 'const x = 1;\nconst y = 2;';
      const fileName = 'test.js';

      // Generate real deltas using transformSource
      const transforms = await transformSource(source, fileName, sourceTransformers);
      expect(transforms).toBeDefined();

      // Apply the real-world delta
      const result = applyTransform(source, transforms!, 'syntax-highlight');
      expect(result).toBe('const x = 1; // highlighted\nconst y = 2; // also highlighted');
    });

    it('should work with transformSource deltas for HastNodes sources converted to string', async () => {
      // Note: transformSource converts HastNodes to text using toText() internally
      // So the deltas it creates are always line-based, suitable for string sources
      const mockHastNodes: HastNodes = {
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'pre',
            properties: {},
            children: [
              {
                type: 'element',
                tagName: 'code',
                properties: { className: ['language-javascript'] },
                children: [{ type: 'text', value: 'function test() {\n  return true;\n}' }],
              },
            ],
          },
        ],
      };

      const mockTransformer = vi.fn().mockResolvedValue({
        'add-comments': {
          source: 'function test() {\n  // Added comment\n  return true;\n}',
          fileName: 'test.js',
        },
      });

      const sourceTransformers: SourceTransformers = [
        {
          extensions: ['js'],
          transformer: mockTransformer,
        },
      ];

      const transforms = await transformSource(mockHastNodes, 'test.js', sourceTransformers);
      expect(transforms).toBeDefined();

      // Since transformSource creates line-based deltas, we need to use a string source for applying them
      const stringSource = 'function test() {\n  return true;\n}'; // Equivalent text from HastNodes
      const result = applyTransform(stringSource, transforms!, 'add-comments');

      // Result should be a string since we applied to string source
      expect(typeof result).toBe('string');
      expect(result).toContain('// Added comment');
    });

    it('should work with transformSource deltas for hastJson sources converted to string', async () => {
      // Note: transformSource converts hastJson to text using toText() internally
      const hastJson = JSON.stringify({
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'code',
            properties: {},
            children: [{ type: 'text', value: 'console.log("hello");' }],
          },
        ],
      });

      const mockTransformer = vi.fn().mockResolvedValue({
        'add-semicolon': {
          source: 'console.log("hello world");',
          fileName: 'test.js',
        },
      });

      const sourceTransformers: SourceTransformers = [
        {
          extensions: ['js'],
          transformer: mockTransformer,
        },
      ];

      const source: VariantSource = { hastJson };
      const transforms = await transformSource(source, 'test.js', sourceTransformers);
      expect(transforms).toBeDefined();

      // Since transformSource creates line-based deltas, we need to use a string source for applying them
      const stringSource = 'console.log("hello");'; // Equivalent text from hastJson
      const result = applyTransform(stringSource, transforms!, 'add-semicolon');

      // Result should be a string since we applied to string source
      expect(typeof result).toBe('string');
      expect(result).toContain('hello world');
    });

    it('should work with transformParsedSource deltas for complex object transformations', async () => {
      const sourceString = 'const greeting = "hello";';
      const originalParsed: HastNodes = {
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'pre',
            properties: {},
            children: [
              {
                type: 'element',
                tagName: 'code',
                properties: {},
                children: [{ type: 'text', value: 'const greeting = "hello";' }],
              },
            ],
          },
        ],
      };

      const transformedParsed: HastNodes = {
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'pre',
            properties: { className: ['highlighted'] },
            children: [
              {
                type: 'element',
                tagName: 'code',
                properties: { className: ['language-js'] },
                children: [{ type: 'text', value: 'const greeting = "hello world";' }],
              },
            ],
          },
        ],
      };

      mockParseSource.mockResolvedValue(transformedParsed);

      // Create initial transforms (simulating what transformSource would create)
      const initialTransforms: Transforms = {
        'enhance-code': {
          delta: [
            ['const greeting = "hello world";'], // Simple line replacement
          ],
          fileName: 'test.js',
        },
      };

      // Use transformParsedSource to create complex object deltas
      const realTransforms = await transformParsedSource(
        sourceString,
        originalParsed,
        'test.js',
        initialTransforms,
        mockParseSource as ParseSource,
      );

      // Apply the real parsed-source delta to the original HastNodes
      const result = applyTransform(originalParsed, realTransforms, 'enhance-code');

      expect(result).toEqual(
        expect.objectContaining({
          type: 'root',
          children: expect.arrayContaining([
            expect.objectContaining({
              type: 'element',
              tagName: 'pre',
              properties: { className: ['highlighted'] },
              children: expect.arrayContaining([
                expect.objectContaining({
                  properties: { className: ['language-js'] },
                }),
              ]),
            }),
          ]),
        }),
      );
    });

    it('should handle multiple transforms in sequence with real deltas', async () => {
      const mockTransformer1 = vi.fn().mockResolvedValue({
        'add-types': {
          source: 'const x: number = 1;\nconst y: string = "hello";',
          fileName: 'test.ts',
        },
      });

      const mockTransformer2 = vi.fn().mockResolvedValue({
        'add-comments': {
          source: '// Type annotations added\nconst x: number = 1;\nconst y: string = "hello";',
          fileName: 'test.ts',
        },
      });

      const sourceTransformers: SourceTransformers = [
        {
          extensions: ['ts'],
          transformer: mockTransformer1,
        },
        {
          extensions: ['ts'],
          transformer: mockTransformer2,
        },
      ];

      const source = 'const x = 1;\nconst y = "hello";';
      const fileName = 'test.ts';

      // Get transforms from transformSource
      const transforms = await transformSource(source, fileName, sourceTransformers);
      expect(transforms).toBeDefined();

      // Apply multiple transforms in sequence
      const result = applyTransforms(source, transforms!, ['add-types', 'add-comments']);

      expect(result).toContain('number');
      expect(result).toContain('string');
      expect(result).toContain('// Type annotations added');
    });

    it('should preserve input format when applying real-world deltas', async () => {
      // Test string input with transformSource
      const stringSource = 'let value = 42;';
      const mockTransformer1 = vi.fn().mockResolvedValue({
        'update-value': {
          source: 'let value = 100;',
          fileName: 'test.js',
        },
      });

      const sourceTransformers1: SourceTransformers = [
        {
          extensions: ['js'],
          transformer: mockTransformer1,
        },
      ];

      const transforms1 = await transformSource(stringSource, 'test.js', sourceTransformers1);
      expect(transforms1).toBeDefined();

      const result1 = applyTransform(stringSource, transforms1!, 'update-value');
      expect(typeof result1).toBe('string');
      expect(result1).toContain('100');

      // Test HastNodes input with proper object deltas (simulating transformParsedSource behavior)
      const hastNodesSource: HastNodes = {
        type: 'root',
        children: [{ type: 'text', value: 'let value = 42;' }],
      };

      // Create object-based deltas that work with HastNodes structure
      const hastNodesTransforms: Transforms = {
        'update-value': {
          delta: {
            children: {
              0: {
                value: ['let value = 100;'],
              },
            },
          },
        },
      };

      const result2 = applyTransform(hastNodesSource, hastNodesTransforms, 'update-value');
      expect(typeof result2).toBe('object');
      expect(result2).toEqual(
        expect.objectContaining({
          type: 'root',
          children: [expect.objectContaining({ value: 'let value = 100;' })],
        }),
      );

      // Test hastJson input with object deltas
      const hastJsonSource: VariantSource = {
        hastJson: JSON.stringify({
          type: 'root',
          children: [{ type: 'text', value: 'let value = 42;' }],
        }),
      };

      const hastJsonTransforms: Transforms = {
        'update-value': {
          delta: {
            children: {
              0: {
                value: ['let value = 100;'],
              },
            },
          },
        },
      };

      const result3 = applyTransform(hastJsonSource, hastJsonTransforms, 'update-value');
      expect(typeof result3).toBe('object');
      expect(result3).toEqual(
        expect.objectContaining({
          hastJson: expect.any(String),
        }),
      );

      const parsedResult = JSON.parse((result3 as { hastJson: string }).hastJson);
      expect(parsedResult.children[0].value).toBe('let value = 100;');
    });
  });
});
