/**
 * @vitest-environment jsdom
 */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTransformer } from './useTransformer';
import { Code } from './types';

// Mock the dependencies
vi.mock('./transformParsedSource', () => ({
  transformParsedSource: vi.fn(
    async (source: string, parsedSource: any, fileName: string, transforms: any) => {
      // Mock implementation that returns transformed transforms with deltas
      const result: any = {};
      for (const [key, transform] of Object.entries(transforms)) {
        result[key] = {
          ...(transform as any),
          delta: { type: 'mock', key }, // Mock delta
        };
      }
      return result;
    },
  ),
}));

vi.mock('../CodeProvider/CodeContext', () => ({
  useCodeContext: vi.fn(() => ({
    parseSource: vi.fn(async (source: string, fileName: string) => {
      // Mock parseSource implementation
      return { type: 'mock', content: source, fileName };
    }),
  })),
}));

describe('useTransformer', () => {
  let mockSetCode: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Create a stable setCode function that doesn't change between renders
    mockSetCode = vi.fn();
  });

  it('should return empty object when not ready for content', () => {
    const { result } = renderHook(() =>
      useTransformer({
        code: undefined,
        readyForContent: false,
        variants: ['Default'],
        setCode: mockSetCode,
      }),
    );

    expect(result.current).toEqual({});
    expect(mockSetCode).not.toHaveBeenCalled();
  });

  it('should return empty object when no code provided', () => {
    const { result } = renderHook(() =>
      useTransformer({
        code: undefined, // No code provided
        readyForContent: true,
        variants: ['Default'],
        setCode: mockSetCode,
      }),
    );

    expect(result.current).toEqual({});
    expect(mockSetCode).not.toHaveBeenCalled();
  });

  it('should not call setCode when variants are not parsed', () => {
    const mockCode: Code = {
      Default: 'const x = 1;', // String variant (not parsed)
    };

    const { result } = renderHook(() =>
      useTransformer({
        code: mockCode,
        readyForContent: true,
        variants: ['Default'],
        setCode: mockSetCode,
      }),
    );

    expect(result.current).toEqual({});
    expect(mockSetCode).not.toHaveBeenCalled();
  });

  it('should not call setCode when variants have no transforms', () => {
    const mockCode: Code = {
      Default: {
        source: { type: 'element', tagName: 'div', properties: {}, children: [] }, // Parsed source (not string)
        fileName: 'test.js',
        url: 'test.js',
        // No transforms
      },
    };

    const { result } = renderHook(() =>
      useTransformer({
        code: mockCode,
        readyForContent: true,
        variants: ['Default'],
        setCode: mockSetCode,
      }),
    );

    expect(result.current).toEqual({});
    expect(mockSetCode).not.toHaveBeenCalled();
  });

  it('should transform variants with transforms', async () => {
    const mockCode: Code = {
      Default: {
        source: { type: 'element', tagName: 'div', properties: {}, children: [] }, // Parsed source (not string)
        fileName: 'test.js',
        url: 'test.js',
        transforms: { removeComments: { delta: {}, fileName: 'test.js' } },
      },
    };

    renderHook(() =>
      useTransformer({
        code: mockCode,
        readyForContent: true,
        variants: ['Default'],
        setCode: mockSetCode,
      }),
    );

    // Wait for async transformation
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 0);
    });

    expect(mockSetCode).toHaveBeenCalledWith(
      expect.objectContaining({
        Default: expect.objectContaining({
          source: { type: 'element', tagName: 'div', properties: {}, children: [] },
          fileName: 'test.js',
          transforms: expect.objectContaining({
            removeComments: expect.objectContaining({
              delta: expect.objectContaining({ type: 'mock', key: 'removeComments' }),
              fileName: 'test.js',
            }),
          }),
        }),
      }),
    );
  });

  it('should call transformParsedSource every time (no caching)', async () => {
    const mockTransformParsedSource = vi.mocked(
      (await import('./transformParsedSource')).transformParsedSource,
    );

    const mockCode: Code = {
      Default: {
        source: { type: 'element', tagName: 'div', properties: {}, children: [] },
        fileName: 'test.js',
        url: 'test.js',
        transforms: { removeComments: { delta: {}, fileName: 'test.js' } },
      },
    };

    const { rerender } = renderHook(() =>
      useTransformer({
        code: mockCode,
        readyForContent: true,
        variants: ['Default'],
        setCode: mockSetCode,
      }),
    );

    // Wait for async transformation
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 0);
    });

    // First render should call transformParsedSource
    expect(mockTransformParsedSource).toHaveBeenCalledTimes(1);

    // Second render with same code should call transformParsedSource again (no caching)
    rerender();

    // Wait for potential async transformation
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 0);
    });

    expect(mockTransformParsedSource).toHaveBeenCalledTimes(2);
  });

  it('should call setCode with multiple variants', async () => {
    const mockCode: Code = {
      Default: {
        source: { type: 'element', tagName: 'div', properties: {}, children: [] },
        fileName: 'test.js',
        url: 'test.js',
        transforms: { removeComments: { delta: {}, fileName: 'test.js' } },
      },
      TypeScript: {
        source: { type: 'element', tagName: 'span', properties: {}, children: [] },
        fileName: 'test.ts',
        url: 'test.ts',
        transforms: { addTypes: { delta: {}, fileName: 'test.ts' } },
      },
    };

    renderHook(() =>
      useTransformer({
        code: mockCode,
        readyForContent: true,
        variants: ['Default', 'TypeScript'],
        setCode: mockSetCode,
      }),
    );

    // Wait for async transformation
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 0);
    });

    expect(mockSetCode).toHaveBeenCalledWith(
      expect.objectContaining({
        Default: expect.objectContaining({
          transforms: expect.objectContaining({
            removeComments: expect.objectContaining({
              delta: expect.objectContaining({ type: 'mock', key: 'removeComments' }),
            }),
          }),
        }),
        TypeScript: expect.objectContaining({
          transforms: expect.objectContaining({
            addTypes: expect.objectContaining({
              delta: expect.objectContaining({ type: 'mock', key: 'addTypes' }),
            }),
          }),
        }),
      }),
    );
  });

  it('should handle mixed string and parsed variants', async () => {
    const mockCode: Code = {
      Default: 'const x = 1;', // String variant
      TypeScript: {
        source: { type: 'element', tagName: 'div', properties: {}, children: [] },
        fileName: 'test.ts',
        url: 'test.ts',
        transforms: { addTypes: { delta: {}, fileName: 'test.ts' } },
      },
    };

    renderHook(() =>
      useTransformer({
        code: mockCode,
        readyForContent: true,
        variants: ['Default', 'TypeScript'],
        setCode: mockSetCode,
      }),
    );

    // Wait for async transformation
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 0);
    });

    expect(mockSetCode).toHaveBeenCalledWith(
      expect.objectContaining({
        Default: 'const x = 1;', // Should pass through unchanged
        TypeScript: expect.objectContaining({
          transforms: expect.objectContaining({
            addTypes: expect.objectContaining({
              delta: expect.objectContaining({ type: 'mock', key: 'addTypes' }),
            }),
          }),
        }),
      }),
    );
  });

  it('should handle transformation errors gracefully', async () => {
    const mockTransformParsedSource = vi.mocked(
      (await import('./transformParsedSource')).transformParsedSource,
    );

    // Make the mock throw an error
    mockTransformParsedSource.mockRejectedValueOnce(new Error('Transform failed'));

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const mockCode: Code = {
      Default: {
        source: { type: 'element', tagName: 'div', properties: {}, children: [] },
        fileName: 'test.js',
        url: 'test.js',
        transforms: { removeComments: { delta: {}, fileName: 'test.js' } },
      },
    };

    renderHook(() =>
      useTransformer({
        code: mockCode,
        readyForContent: true,
        variants: ['Default'],
        setCode: mockSetCode,
      }),
    );

    // Wait for async transformation
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 10);
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to transform variant "Default":',
      expect.any(Error),
    );

    // Should still call setCode with the original variant (error fallback)
    expect(mockSetCode).toHaveBeenCalledWith(
      expect.objectContaining({
        Default: expect.objectContaining({
          source: { type: 'element', tagName: 'div', properties: {}, children: [] },
          fileName: 'test.js',
          transforms: { removeComments: { delta: {}, fileName: 'test.js' } }, // Original transforms
        }),
      }),
    );

    consoleErrorSpy.mockRestore();
  });
});
