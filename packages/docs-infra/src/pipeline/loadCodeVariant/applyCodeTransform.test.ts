import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Nodes as HastNodes } from 'hast';
import { applyCodeTransform, applyCodeTransforms } from './applyCodeTransform';
import { transformSource } from './transformSource';
import { diffHast } from './diffHast';
import type {
  VariantSource,
  Transforms,
  SourceTransformers,
  ParseSource,
} from '../../CodeHighlighter/types';

describe('applyCodeTransform', () => {
  describe('applyCodeTransform', () => {
    it('should apply transform to string source', () => {
      const source = 'const x = 1;';
      const transforms: Transforms = {
        'syntax-highlight': {
          delta: [['const x = 1; // highlighted']],
        },
      };

      const result = applyCodeTransform(source, transforms, 'syntax-highlight');
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

      const result = applyCodeTransform(source, transforms, 'syntax-highlight');
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

      const result = applyCodeTransform(source, transforms, 'syntax-highlight');
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

    it('should replace specific lines in multiline source', () => {
      const source = 'const x = 1;\nconst y = 2;\nconst z = 3;';
      const transforms: Transforms = {
        'add-types': {
          delta: {
            0: [undefined, 'const x: number = 1;'],
            1: [undefined, 'const y: number = 2;'],
            2: [undefined, 'const z: number = 3;'],
          },
        },
      };

      const result = applyCodeTransform(source, transforms, 'add-types');
      expect(result).toBe('const x: number = 1;\nconst y: number = 2;\nconst z: number = 3;');
    });

    it('should throw error for non-existent transform key', () => {
      const source = 'const x = 1;';
      const transforms: Transforms = {
        'syntax-highlight': {
          delta: [['const x = 1; // highlighted']],
        },
      };

      expect(() => applyCodeTransform(source, transforms, 'non-existent')).toThrow(
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

      expect(() => applyCodeTransform(source, transforms, 'invalid-transform')).toThrow();
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

      const result = applyCodeTransform(source, transforms, 'add-comments');
      expect(result).toContain('variable x');
      expect(result).toContain('variable y');
      expect(result).toContain('variable z');
    });
  });

  describe('applyCodeTransforms', () => {
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

      const result = applyCodeTransforms(source, transforms, ['first-transform', 'second-transform']);
      expect(result).toBe('const x = 1; // first // second');
    });

    it('should handle empty transform keys array', () => {
      const source = 'const x = 1;';
      const transforms: Transforms = {
        'syntax-highlight': {
          delta: [['const x = 1; // highlighted']],
        },
      };

      const result = applyCodeTransforms(source, transforms, []);
      expect(result).toBe('const x = 1;');
    });

    it('should apply single transform via array', () => {
      const source = 'const x = 1;';
      const transforms: Transforms = {
        'syntax-highlight': {
          delta: [['const x = 1; // highlighted']],
        },
      };

      const result = applyCodeTransforms(source, transforms, ['syntax-highlight']);
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
        applyCodeTransforms(source, transforms, ['syntax-highlight', 'non-existent']),
      ).toThrow('Transform "non-existent" not found in transforms');
    });
  });

  describe('Input immutability tests', () => {
    describe('HastNodes source immutability', () => {
      it('should not mutate original HastNodes when applying transform', () => {
        const originalSource: HastNodes = {
          type: 'root',
          children: [
            {
              type: 'element',
              tagName: 'code',
              properties: { className: ['language-js'] },
              children: [
                { type: 'text', value: 'const x = 1;' },
                { type: 'text', value: '\nconst y = 2;' },
              ],
            },
          ],
        };

        // Create a deep copy for comparison
        const originalCopy = JSON.parse(JSON.stringify(originalSource));

        const transforms: Transforms = {
          'modify-content': {
            delta: {
              children: {
                0: {
                  children: {
                    0: {
                      value: ['const x = 42; // modified'],
                    },
                  },
                },
              },
            },
          },
        };

        // Apply transform
        const result = applyCodeTransform(originalSource, transforms, 'modify-content');

        // Verify original is unchanged
        expect(originalSource).toEqual(originalCopy);

        // Verify result is different and correct
        expect(result).not.toEqual(originalSource);
        const resultRoot = result as HastNodes;
        if ('children' in resultRoot && resultRoot.children) {
          const resultElement = resultRoot.children[0] as any;
          if (resultElement && resultElement.children && Array.isArray(resultElement.children)) {
            expect(resultElement.children[0]).toEqual({
              type: 'text',
              value: 'const x = 42; // modified',
            });
          }
        }
      });

      it('should not mutate nested properties in HastNodes', () => {
        const originalSource: HastNodes = {
          type: 'root',
          children: [
            {
              type: 'element',
              tagName: 'pre',
              properties: {
                className: ['language-javascript'],
                'data-line-numbers': true,
              },
              children: [
                {
                  type: 'element',
                  tagName: 'code',
                  properties: { 'data-lang': 'js' },
                  children: [{ type: 'text', value: 'function test() { return true; }' }],
                },
              ],
            },
          ],
        };

        const originalCopy = JSON.parse(JSON.stringify(originalSource));

        const transforms: Transforms = {
          'add-highlighting': {
            delta: {
              children: {
                0: {
                  properties: {
                    className: [['language-javascript', 'hljs']],
                    'data-highlighted': [true],
                  },
                  children: {
                    0: {
                      children: {
                        0: {
                          value: ['function test() { /* highlighted */ return true; }'],
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        };

        applyCodeTransform(originalSource, transforms, 'add-highlighting');

        // Verify nested properties are not mutated
        expect(originalSource).toEqual(originalCopy);
        const originalElement = originalSource.children[0] as any;
        expect(originalElement.properties).toEqual({
          className: ['language-javascript'],
          'data-line-numbers': true,
        });
      });

      it('should not mutate original arrays within HastNodes', () => {
        const sharedClassNames = ['language-js', 'theme-dark'];
        const originalSource: HastNodes = {
          type: 'root',
          children: [
            {
              type: 'element',
              tagName: 'code',
              properties: { className: sharedClassNames }, // Reference to shared array
              children: [{ type: 'text', value: 'console.log("test");' }],
            },
          ],
        };

        const originalCopy = JSON.parse(JSON.stringify(originalSource));
        const originalSharedArray = [...sharedClassNames];

        const transforms: Transforms = {
          'modify-classes': {
            delta: {
              children: {
                0: {
                  properties: {
                    className: [['language-js', 'theme-dark', 'highlighted']],
                  },
                },
              },
            },
          },
        };

        applyCodeTransform(originalSource, transforms, 'modify-classes');

        // Verify original shared array is unchanged
        expect(sharedClassNames).toEqual(originalSharedArray);
        expect(originalSource).toEqual(originalCopy);
      });
    });

    describe('hastJson source immutability', () => {
      it('should not mutate original hastJson object when applying transform', () => {
        const hastData = {
          type: 'root',
          children: [
            {
              type: 'element',
              tagName: 'div',
              properties: { className: ['code-container'] },
              children: [{ type: 'text', value: 'original text' }],
            },
          ],
        };

        const originalSource: VariantSource = { hastJson: JSON.stringify(hastData) };
        const originalCopy = { hastJson: originalSource.hastJson };

        const transforms: Transforms = {
          'update-text': {
            delta: {
              children: {
                0: {
                  children: {
                    0: {
                      value: ['modified text'],
                    },
                  },
                },
              },
            },
          },
        };

        const result = applyCodeTransform(originalSource, transforms, 'update-text');

        // Verify original hastJson is unchanged
        expect(originalSource).toEqual(originalCopy);
        expect(originalSource.hastJson).toBe(originalCopy.hastJson);

        // Verify result is different
        expect(result).not.toEqual(originalSource);
        const resultData = JSON.parse((result as { hastJson: string }).hastJson);
        expect(resultData.children[0].children[0].value).toBe('modified text');
      });
    });

    describe('Multiple transform immutability', () => {
      it('should not mutate original source when applying multiple transforms', () => {
        const originalSource: HastNodes = {
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
                  children: [{ type: 'text', value: 'const value = 10;' }],
                },
              ],
            },
          ],
        };

        const originalCopy = JSON.parse(JSON.stringify(originalSource));

        const transforms: Transforms = {
          'first-transform': {
            delta: {
              children: {
                0: {
                  children: {
                    0: {
                      children: {
                        0: {
                          value: ['const value = 20; // first'],
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          'second-transform': {
            delta: {
              children: {
                0: {
                  properties: {
                    className: [['highlighted']],
                  },
                  children: {
                    0: {
                      children: {
                        0: {
                          value: ['const value = 30; // second'],
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        };

        // Apply multiple transforms
        applyCodeTransforms(originalSource, transforms, ['first-transform', 'second-transform']);

        // Verify original is completely unchanged after multiple transforms
        expect(originalSource).toEqual(originalCopy);
      });
    });

    describe('Complex nested structure immutability', () => {
      it('should not mutate deeply nested structures with complex transformations', () => {
        const originalSource: HastNodes = {
          type: 'root',
          children: [
            {
              type: 'element',
              tagName: 'div',
              properties: { className: ['container'] },
              children: [
                {
                  type: 'element',
                  tagName: 'pre',
                  properties: { 'data-lang': 'typescript' },
                  children: [
                    {
                      type: 'element',
                      tagName: 'code',
                      properties: { className: ['language-ts'] },
                      children: [
                        { type: 'text', value: 'interface User {\n' },
                        { type: 'text', value: '  name: string;\n' },
                        { type: 'text', value: '  age: number;\n' },
                        { type: 'text', value: '}' },
                      ],
                    },
                  ],
                },
                {
                  type: 'element',
                  tagName: 'div',
                  properties: { className: ['metadata'] },
                  children: [{ type: 'text', value: 'TypeScript interface' }],
                },
              ],
            },
          ],
        };

        const originalCopy = JSON.parse(JSON.stringify(originalSource));

        const transforms: Transforms = {
          'complex-transform': {
            delta: {
              children: {
                0: {
                  properties: {
                    className: [['container', 'highlighted']],
                    'data-transformed': [true],
                  },
                  children: {
                    0: {
                      children: {
                        0: {
                          properties: {
                            className: [['language-ts', 'syntax-highlighted']],
                          },
                          children: {
                            1: {
                              value: ['  name: string; // User name'],
                            },
                            2: {
                              value: ['  age: number; // User age'],
                            },
                          },
                        },
                      },
                    },
                    1: {
                      children: {
                        0: {
                          value: ['TypeScript interface - Enhanced'],
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        };

        applyCodeTransform(originalSource, transforms, 'complex-transform');

        // Verify the deeply nested original structure remains unchanged
        expect(originalSource).toEqual(originalCopy);

        // Specifically check that nested arrays and objects are untouched
        const originalContainer = originalSource.children[0] as any;
        const originalCopyContainer = originalCopy.children[0] as any;
        expect(originalContainer.properties).toEqual(originalCopyContainer.properties);
        expect(originalContainer.children).toEqual(originalCopyContainer.children);
      });
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
      const result = applyCodeTransform(source, transforms!, 'syntax-highlight');
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
      const result = applyCodeTransform(stringSource, transforms!, 'add-comments');

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
      const result = applyCodeTransform(stringSource, transforms!, 'add-semicolon');

      // Result should be a string since we applied to string source
      expect(typeof result).toBe('string');
      expect(result).toContain('hello world');
    });

    it('should work with diffHast deltas for complex object transformations', async () => {
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

      // Use diffHast to create complex object deltas
      const realTransforms = await diffHast(
        sourceString,
        originalParsed,
        'test.js',
        initialTransforms,
        mockParseSource as ParseSource,
      );

      // Apply the real parsed-source delta to the original HastNodes
      const result = applyCodeTransform(originalParsed, realTransforms, 'enhance-code');

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
      const result = applyCodeTransforms(source, transforms!, ['add-types', 'add-comments']);

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

      const result1 = applyCodeTransform(stringSource, transforms1!, 'update-value');
      expect(typeof result1).toBe('string');
      expect(result1).toContain('100');

      // Test HastNodes input with proper object deltas (simulating diffHast behavior)
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

      const result2 = applyCodeTransform(hastNodesSource, hastNodesTransforms, 'update-value');
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

      const result3 = applyCodeTransform(hastJsonSource, hastJsonTransforms, 'update-value');
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
