import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import type { Nodes } from 'hast';
import { diffHast } from './diffHast';
import type { ParseSource, Transforms } from '../../CodeHighlighter/types';

describe('diffHast', () => {
  let mockParseSource: MockedFunction<ParseSource>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockParseSource = vi.fn();
  });

  it('should handle empty transforms', async () => {
    const source = 'const x = 1;';
    const parsedSource: Nodes = {
      type: 'root',
      children: [],
    };
    const filename = 'test.ts';
    const transforms: Transforms = {};

    const result = await diffHast(source, parsedSource, filename, transforms, mockParseSource);

    expect(mockParseSource).not.toHaveBeenCalled();
    expect(result).toEqual({});
  });

  it('should handle single transform with valid delta', async () => {
    const source = 'const x = 1;';
    const parsedSource: Nodes = {
      type: 'root',
      children: [],
    };
    const filename = 'test.ts';
    const transforms: Transforms = {
      'syntax-highlight': {
        delta: [['const x = 1; // highlighted']],
        fileName: 'test.ts',
      },
    };

    const transformedParsedSource: Nodes = {
      type: 'root',
      children: [],
    };

    mockParseSource.mockResolvedValue(transformedParsedSource);

    const result = await diffHast(source, parsedSource, filename, transforms, mockParseSource);

    expect(mockParseSource).toHaveBeenCalledWith('const x = 1; // highlighted', 'test.ts');
    expect(result['syntax-highlight']).toBeDefined();
  });

  it('should fallback to main filename when transform fileName not provided', async () => {
    const source = 'const x = 1;';
    const parsedSource: Nodes = {
      type: 'root',
      children: [],
    };
    const filename = 'test.ts';
    const transforms: Transforms = {
      'syntax-highlight': {
        delta: [['const x = 1; // highlighted']],
        // No fileName provided - should fall back to main filename
      },
    };

    const transformedParsedSource: Nodes = {
      type: 'root',
      children: [],
    };

    mockParseSource.mockResolvedValue(transformedParsedSource);

    const result = await diffHast(source, parsedSource, filename, transforms, mockParseSource);

    expect(mockParseSource).toHaveBeenCalledWith('const x = 1; // highlighted', 'test.ts');
    expect(result['syntax-highlight'].fileName).toBeUndefined();
  });

  it('should handle parseSource errors', async () => {
    const source = 'const x = 1;';
    const parsedSource: Nodes = {
      type: 'root',
      children: [],
    };
    const filename = 'test.ts';
    const transforms: Transforms = {
      'syntax-highlight': {
        delta: [['const x = 1; // highlighted']],
        fileName: 'test.ts',
      },
    };

    mockParseSource.mockRejectedValue(new Error('Parse error'));

    await expect(
      diffHast(source, parsedSource, filename, transforms, mockParseSource),
    ).rejects.toThrow('Parse error');
  });

  it('should throw error when patch does not return array', async () => {
    const source = 'const x = 1;';
    const parsedSource: Nodes = {
      type: 'root',
      children: [],
    };
    const filename = 'test.ts';
    const transforms: Transforms = {
      'invalid-transform': {
        delta: null as any, // Invalid delta that won't patch correctly
        fileName: 'test.ts',
      },
    };

    await expect(
      diffHast(source, parsedSource, filename, transforms, mockParseSource),
    ).rejects.toThrow(); // Accept any error from the patch operation
  });
});
