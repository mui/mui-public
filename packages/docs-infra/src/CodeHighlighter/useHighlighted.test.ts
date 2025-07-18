/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useHighlighted } from './useHighlighted';
import type { Code } from './types';
import { useCodeContext } from '../CodeProvider/CodeContext';
import { useOnHydrate } from '../useOnHydrate';
import { useOnIdle } from '../useOnIdle';

// Mock dependencies
vi.mock('../CodeProvider/CodeContext', () => ({
  useCodeContext: vi.fn(),
}));

vi.mock('../useOnHydrate', () => ({
  useOnHydrate: vi.fn(),
}));

vi.mock('../useOnIdle', () => ({
  useOnIdle: vi.fn(),
}));

// Get the mocked functions
const mockUseCodeContext = vi.mocked(useCodeContext);
const mockUseOnHydrate = vi.mocked(useOnHydrate);
const mockUseOnIdle = vi.mocked(useOnIdle);
const mockParseSource = vi.fn();

describe('useHighlighted', () => {
  const mockSetCode = vi.fn();
  const mockControlledSetCode = vi.fn();

  const defaultProps = {
    highlightAt: 'hydration' as const,
    isControlled: false,
    activeCode: undefined,
    readyForContent: true,
    variants: ['Default'],
    setCode: mockSetCode,
    controlledSetCode: undefined,
  };

  const mockStringCode: Code = {
    Default: {
      url: 'test-url',
      fileName: 'test.js',
      source: 'console.log("Hello World");',
    },
  };

  const mockHighlightedCode: Code = {
    Default: {
      url: 'test-url',
      fileName: 'test.js',
      source: {
        type: 'element',
        tagName: 'div',
        properties: {},
        children: [{ type: 'text', value: 'console.log("Hello World");' }],
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Create a fresh stable context for each test
    const freshContext = {
      parseSource: mockParseSource,
    };
    mockUseCodeContext.mockReturnValue(freshContext);
    mockUseOnHydrate.mockReturnValue(false);
    mockUseOnIdle.mockReturnValue(false);
    mockParseSource.mockImplementation(async (source: string, _fileName: string) => ({
      type: 'element',
      tagName: 'div',
      properties: {},
      children: [{ type: 'text', value: source }],
    }));
  });

  describe('highlighting timing', () => {
    it('should highlight immediately when highlightAt is "init"', async () => {
      mockParseSource.mockImplementation(async (_source: string, _fileName: string) => ({
        type: 'element',
        tagName: 'div',
        properties: {},
        children: [{ type: 'text', value: 'parsed' }],
      }));

      const { result } = renderHook(() =>
        useHighlighted({
          ...defaultProps,
          highlightAt: 'init',
          activeCode: mockStringCode,
        }),
      );

      await waitFor(() => {
        expect(mockParseSource).toHaveBeenCalledWith('console.log("Hello World");', 'test.js');
      });

      await waitFor(() => {
        expect(result.current.overlaidCode).toBeDefined();
      });
    });

    it('should wait for hydration when highlightAt is "hydration"', async () => {
      mockUseOnHydrate.mockReturnValue(false);

      const { rerender } = renderHook(() =>
        useHighlighted({
          ...defaultProps,
          highlightAt: 'hydration',
          activeCode: mockStringCode,
        }),
      );

      // Should not highlight yet
      expect(mockParseSource).not.toHaveBeenCalled();

      // Simulate hydration
      mockUseOnHydrate.mockReturnValue(true);
      rerender();

      await waitFor(() => {
        expect(mockParseSource).toHaveBeenCalled();
      });
    });

    it('should wait for idle when highlightAt is "idle"', async () => {
      mockUseOnIdle.mockReturnValue(false);

      const { rerender } = renderHook(() =>
        useHighlighted({
          ...defaultProps,
          highlightAt: 'idle',
          activeCode: mockStringCode,
        }),
      );

      // Should not highlight yet
      expect(mockParseSource).not.toHaveBeenCalled();

      // Simulate idle
      mockUseOnIdle.mockReturnValue(true);
      rerender();

      await waitFor(() => {
        expect(mockParseSource).toHaveBeenCalled();
      });
    });
  });

  describe('string overlay conversion', () => {
    it('should convert highlighted code to strings when not ready to highlight', () => {
      mockUseOnHydrate.mockReturnValue(false); // Not ready to highlight

      const { result } = renderHook(() =>
        useHighlighted({
          ...defaultProps,
          highlightAt: 'hydration',
          activeCode: mockHighlightedCode,
        }),
      );

      expect(result.current.overlaidCode).toEqual({
        Default: {
          url: 'test-url',
          fileName: 'test.js',
          source: 'console.log("Hello World");',
        },
      });
    });

    it('should handle extra files in string conversion', () => {
      mockUseOnHydrate.mockReturnValue(false);

      const codeWithExtraFiles: Code = {
        Default: {
          url: 'test-url',
          fileName: 'test.js',
          source: {
            type: 'element',
            tagName: 'div',
            properties: {},
            children: [{ type: 'text', value: 'main code' }],
          },
          extraFiles: {
            'utils.js': {
              source: {
                type: 'element',
                tagName: 'div',
                properties: {},
                children: [{ type: 'text', value: 'utility code' }],
              },
            },
            'types.ts': 'string file',
          },
        },
      };

      const { result } = renderHook(() =>
        useHighlighted({
          ...defaultProps,
          highlightAt: 'hydration',
          activeCode: codeWithExtraFiles,
        }),
      );

      expect(result.current.overlaidCode).toEqual({
        Default: {
          url: 'test-url',
          fileName: 'test.js',
          source: 'main code',
          extraFiles: {
            'utils.js': {
              source: 'utility code',
            },
            'types.ts': 'string file',
          },
        },
      });
    });

    it('should not convert when ready to highlight', () => {
      mockUseOnHydrate.mockReturnValue(true); // Ready to highlight

      const { result } = renderHook(() =>
        useHighlighted({
          ...defaultProps,
          highlightAt: 'hydration',
          activeCode: mockHighlightedCode,
        }),
      );

      // Should not have string overlay since we're ready to highlight
      expect(result.current.overlaidCode).not.toEqual({
        Default: {
          url: 'test-url',
          fileName: 'test.js',
          source: 'console.log("Hello World");',
        },
      });
    });
  });

  describe('caching', () => {
    it('should cache parsed results', async () => {
      mockParseSource.mockResolvedValue({ value: 'parsed', type: 'Program', body: [] });

      const { rerender } = renderHook(() =>
        useHighlighted({
          ...defaultProps,
          highlightAt: 'init',
          activeCode: mockStringCode,
        }),
      );

      await waitFor(() => {
        expect(mockParseSource).toHaveBeenCalledTimes(1);
      });

      // Re-render with the same code
      rerender();

      await waitFor(() => {
        // Should still only be called once due to caching
        expect(mockParseSource).toHaveBeenCalledTimes(1);
      });
    });

    it('should cache extra files separately', async () => {
      const codeWithExtraFiles: Code = {
        Default: {
          url: 'test-url',
          fileName: 'test.js',
          source: 'main code',
          extraFiles: {
            'utils.js': 'utility code',
            'types.ts': 'type definitions',
          },
        },
      };

      mockParseSource.mockResolvedValue({ value: 'parsed', type: 'Program', body: [] });

      renderHook(() =>
        useHighlighted({
          ...defaultProps,
          highlightAt: 'init',
          activeCode: codeWithExtraFiles,
        }),
      );

      await waitFor(() => {
        expect(mockParseSource).toHaveBeenCalledTimes(3); // main + 2 extra files
      });

      expect(mockParseSource).toHaveBeenCalledWith('main code', 'test.js');
      expect(mockParseSource).toHaveBeenCalledWith('utility code', 'utils.js');
      expect(mockParseSource).toHaveBeenCalledWith('type definitions', 'types.ts');
    });
  });

  describe('controlled components', () => {
    it('should not update setCode when controlled', async () => {
      mockParseSource.mockResolvedValue({ value: 'parsed', type: 'Program', body: [] });

      renderHook(() =>
        useHighlighted({
          ...defaultProps,
          highlightAt: 'init',
          isControlled: true,
          activeCode: mockStringCode,
        }),
      );

      await waitFor(() => {
        expect(mockParseSource).toHaveBeenCalled();
      });

      // Should not call setCode for controlled components
      expect(mockSetCode).not.toHaveBeenCalled();
    });

    it('should provide contextSetCode when controlledSetCode is provided', () => {
      const { result } = renderHook(() =>
        useHighlighted({
          ...defaultProps,
          controlledSetCode: mockControlledSetCode,
        }),
      );

      expect(result.current.contextSetCode).toBeDefined();
    });

    it('should not provide contextSetCode when controlledSetCode is not provided', () => {
      const { result } = renderHook(() =>
        useHighlighted({
          ...defaultProps,
          controlledSetCode: undefined,
        }),
      );

      expect(result.current.contextSetCode).toBeUndefined();
    });
  });

  describe('contextSetCode', () => {
    it('should highlight string code before updating controlled state', async () => {
      mockParseSource.mockResolvedValue({ value: 'parsed', type: 'Program', body: [] });

      const { result } = renderHook(() =>
        useHighlighted({
          ...defaultProps,
          controlledSetCode: mockControlledSetCode,
        }),
      );

      await act(async () => {
        await result.current.contextSetCode!(mockStringCode);
      });

      expect(mockParseSource).toHaveBeenCalledWith('console.log("Hello World");', 'test.js');
      expect(mockControlledSetCode).toHaveBeenCalledWith(
        expect.objectContaining({
          Default: expect.objectContaining({
            source: { value: 'parsed', type: 'Program', body: [] },
          }),
        }),
      );
    });

    it('should handle already highlighted code', async () => {
      const { result } = renderHook(() =>
        useHighlighted({
          ...defaultProps,
          controlledSetCode: mockControlledSetCode,
        }),
      );

      await act(async () => {
        await result.current.contextSetCode!(mockHighlightedCode);
      });

      expect(mockParseSource).not.toHaveBeenCalled();
      expect(mockControlledSetCode).toHaveBeenCalledWith(mockHighlightedCode);
    });

    it('should handle undefined code', async () => {
      const { result } = renderHook(() =>
        useHighlighted({
          ...defaultProps,
          controlledSetCode: mockControlledSetCode,
        }),
      );

      await act(async () => {
        await result.current.contextSetCode!(undefined);
      });

      expect(mockControlledSetCode).toHaveBeenCalledWith(undefined);
    });

    it('should handle updater functions', async () => {
      mockParseSource.mockResolvedValue({ value: 'parsed', type: 'Program', body: [] });

      const { result } = renderHook(() =>
        useHighlighted({
          ...defaultProps,
          activeCode: mockStringCode,
          controlledSetCode: mockControlledSetCode,
        }),
      );

      const updater = vi.fn().mockReturnValue(mockStringCode);

      await act(async () => {
        await result.current.contextSetCode!(updater);
      });

      expect(updater).toHaveBeenCalledWith(mockStringCode);
      expect(mockParseSource).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle parsing errors gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockParseSource.mockRejectedValue(new Error('Parse error'));

      renderHook(() =>
        useHighlighted({
          ...defaultProps,
          highlightAt: 'init',
          activeCode: mockStringCode,
        }),
      );

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith('Error highlighting code:', expect.any(Error));
      });

      consoleErrorSpy.mockRestore();
    });

    it('should handle missing variants gracefully', async () => {
      const codeWithMissingVariant: Code = {
        Default: mockStringCode.Default,
      };

      const { result } = renderHook(() =>
        useHighlighted({
          ...defaultProps,
          highlightAt: 'init',
          activeCode: codeWithMissingVariant,
          variants: ['Default', 'MissingVariant'],
        }),
      );

      await waitFor(() => {
        expect(result.current.overlaidCode).toBeDefined();
      });
    });
  });

  describe('cleanup', () => {
    it('should abort highlighting when component unmounts', async () => {
      mockParseSource.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ value: 'parsed', type: 'Program', body: [] }), 100);
          }),
      );

      const { unmount } = renderHook(() =>
        useHighlighted({
          ...defaultProps,
          highlightAt: 'init',
          activeCode: mockStringCode,
        }),
      );

      // Unmount before parsing completes
      unmount();

      // Wait a bit to ensure the promise would have resolved
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 150);
      });

      // Should not have called setCode since component was unmounted
      expect(mockSetCode).not.toHaveBeenCalled();
    });
  });

  describe('multiple variants', () => {
    it('should handle multiple variants correctly', async () => {
      const multiVariantCode: Code = {
        Default: {
          url: 'test-url',
          fileName: 'test.js',
          source: 'console.log("Default");',
        },
        TypeScript: {
          url: 'test-url',
          fileName: 'test.ts',
          source: 'console.log("TypeScript");',
        },
      };

      mockParseSource.mockResolvedValue({ value: 'parsed', type: 'Program', body: [] });

      renderHook(() =>
        useHighlighted({
          ...defaultProps,
          highlightAt: 'init',
          activeCode: multiVariantCode,
          variants: ['Default', 'TypeScript'],
        }),
      );

      await waitFor(() => {
        expect(mockParseSource).toHaveBeenCalledTimes(2);
      });

      expect(mockParseSource).toHaveBeenCalledWith('console.log("Default");', 'test.js');
      expect(mockParseSource).toHaveBeenCalledWith('console.log("TypeScript");', 'test.ts');
    });

    it('should prevent infinite loops by avoiding re-parsing of unchanged content', async () => {
      const sameCode: Code = {
        Default: {
          url: 'test-url',
          fileName: 'test.js',
          source: 'console.log("same");',
        },
      };

      let parseCallCount = 0;
      mockParseSource.mockImplementation(async (_source: string, _fileName: string) => {
        parseCallCount += 1;
        return { value: `parsed-${parseCallCount}`, type: 'Program', body: [] };
      });

      const { rerender } = renderHook((props: any) =>
        useHighlighted({
          readyForContent: true,
          highlightAt: 'init',
          isControlled: false,
          variants: ['Default'],
          setCode: mockSetCode,
          ...props,
        }),
      );

      // Initial render with code
      rerender({ activeCode: sameCode });

      // Wait for initial parsing
      await waitFor(() => {
        expect(parseCallCount).toBe(1);
      });

      // Re-render with the same code - should not cause re-parsing
      rerender({ activeCode: sameCode });

      // Wait a bit to ensure no additional parsing occurs
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });

      // Should still be 1 - no additional parsing happened
      expect(parseCallCount).toBe(1);
    });

    it('should re-parse content when changing file and then changing back', async () => {
      const codeV1: Code = {
        Default: {
          url: 'test-url',
          fileName: 'test.js',
          source: 'console.log("version 1");',
        },
      };

      const codeV2: Code = {
        Default: {
          url: 'test-url',
          fileName: 'test.js',
          source: 'console.log("version 2");',
        },
      };

      let parseCallCount = 0;
      const parsedResults: string[] = [];

      mockParseSource.mockImplementation(async (source: string, _fileName: string) => {
        parseCallCount += 1;
        parsedResults.push(source);
        return { value: `parsed-${parseCallCount}`, type: 'Program', body: [] };
      });

      // Create stable references to avoid recreating dependencies
      const variants = ['Default'];
      const baseProps = {
        readyForContent: true,
        highlightAt: 'init' as const,
        isControlled: false,
        variants,
        setCode: mockSetCode,
      };

      const { result, rerender } = renderHook(
        (props: { activeCode: Code }) =>
          useHighlighted({
            ...baseProps,
            activeCode: props.activeCode,
          }),
        { initialProps: { activeCode: codeV1 } },
      );

      // Wait for initial parsing of v1
      await waitFor(() => {
        expect(parseCallCount).toBe(1);
      });
      expect(parsedResults[0]).toBe('console.log("version 1");');

      // Change to v2
      rerender({ activeCode: codeV2 });

      // Should parse v2
      await waitFor(() => {
        expect(parseCallCount).toBe(2);
      });
      expect(parsedResults[1]).toBe('console.log("version 2");');

      // Change back to v1 - should be parsed again since cache was replaced
      rerender({ activeCode: codeV1 });

      // Should parse v1 again since it's no longer in cache
      await waitFor(() => {
        expect(parseCallCount).toBe(3);
      });
      expect(parsedResults[2]).toBe('console.log("version 1");');

      // Verify the overlaidCode reflects the latest parsing
      expect(result.current.overlaidCode).toBeDefined();
      const defaultVariant = result.current.overlaidCode?.Default;
      if (defaultVariant && typeof defaultVariant !== 'string') {
        expect(defaultVariant.source).toEqual({ value: 'parsed-3', type: 'Program', body: [] });
      }
    });
  });

  describe('edge cases and robustness', () => {
    it('should handle empty activeCode gracefully', async () => {
      const emptyCode: Code = {};

      const { result } = renderHook(() =>
        useHighlighted({
          ...defaultProps,
          highlightAt: 'init',
          activeCode: emptyCode,
        }),
      );

      // For empty code, overlaidCode should be undefined
      expect(result.current.overlaidCode).toBeUndefined();
      expect(mockParseSource).not.toHaveBeenCalled();
    });

    it('should handle activeCode with null variants', async () => {
      const codeWithNulls: Code = {
        Default: null as any,
        TypeScript: undefined,
      };

      const { result } = renderHook(() =>
        useHighlighted({
          ...defaultProps,
          highlightAt: 'init',
          activeCode: codeWithNulls,
          variants: ['Default', 'TypeScript'],
        }),
      );

      // For code with null/undefined variants, overlaidCode should be undefined
      expect(result.current.overlaidCode).toBeUndefined();
      expect(mockParseSource).not.toHaveBeenCalled();
    });

    it('should handle parseSource returning null or undefined', async () => {
      mockParseSource.mockResolvedValue(null);

      const { result } = renderHook(() =>
        useHighlighted({
          ...defaultProps,
          highlightAt: 'init',
          activeCode: mockStringCode,
        }),
      );

      await waitFor(() => {
        expect(mockParseSource).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(result.current.overlaidCode).toBeDefined();
      });

      const defaultVariant = result.current.overlaidCode?.Default;
      if (defaultVariant && typeof defaultVariant !== 'string') {
        expect(defaultVariant.source).toBeNull();
      }
    });

    it('should handle missing parseSource gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Mock context with missing parseSource
      const contextWithoutParseSource = {
        parseSource: undefined,
      };
      mockUseCodeContext.mockReturnValue(contextWithoutParseSource as any);

      renderHook(() =>
        useHighlighted({
          ...defaultProps,
          highlightAt: 'init',
          activeCode: mockStringCode,
        }),
      );

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith('Error highlighting code:', expect.any(Error));
      });

      consoleErrorSpy.mockRestore();
    });

    it('should handle variants array changes without losing cache', async () => {
      mockParseSource.mockResolvedValue({ value: 'parsed', type: 'Program', body: [] });

      const { rerender } = renderHook(
        (props: { variants: string[] }) =>
          useHighlighted({
            ...defaultProps,
            highlightAt: 'init',
            activeCode: mockStringCode,
            variants: props.variants,
          }),
        { initialProps: { variants: ['Default'] } },
      );

      // Wait for initial parsing
      await waitFor(() => {
        expect(mockParseSource).toHaveBeenCalledTimes(1);
      });

      // Add another variant but keep Default
      rerender({ variants: ['Default', 'TypeScript'] });

      // Should still only be 1 call since Default is cached
      expect(mockParseSource).toHaveBeenCalledTimes(1);
    });

    it('should clear overlay when highlighting completes', async () => {
      mockParseSource.mockResolvedValue({ value: 'parsed', type: 'Program', body: [] });
      mockUseOnHydrate.mockReturnValue(false); // Not ready initially

      const { result, rerender } = renderHook(() =>
        useHighlighted({
          ...defaultProps,
          highlightAt: 'hydration',
          activeCode: mockHighlightedCode,
        }),
      );

      // Should have string overlay initially
      expect(result.current.overlaidCode).toEqual({
        Default: {
          url: 'test-url',
          fileName: 'test.js',
          source: 'console.log("Hello World");',
        },
      });

      // Simulate hydration
      mockUseOnHydrate.mockReturnValue(true);
      rerender();

      await waitFor(() => {
        // Should now have highlighted content instead of string overlay
        const defaultVariant = result.current.overlaidCode?.Default;
        if (defaultVariant && typeof defaultVariant !== 'string') {
          expect(typeof defaultVariant.source).toBe('object');
        }
      });
    });
  });

  describe('setOverlaidCode functionality', () => {
    it('should provide setOverlaidCode function', () => {
      const { result } = renderHook(() =>
        useHighlighted({
          ...defaultProps,
        }),
      );

      expect(typeof result.current.setOverlaidCode).toBe('function');
    });

    it('should update overlaidCode when setOverlaidCode is called', async () => {
      const { result } = renderHook(() =>
        useHighlighted({
          ...defaultProps,
        }),
      );

      const newCode: Code = {
        Default: {
          url: 'new-url',
          fileName: 'new.js',
          source: 'console.log("new");',
        },
      };

      act(() => {
        result.current.setOverlaidCode(newCode);
      });

      expect(result.current.overlaidCode).toEqual(newCode);
    });
  });

  describe('contextSetCode error handling', () => {
    it('should handle parsing errors in contextSetCode and fall back gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockParseSource.mockRejectedValue(new Error('Parse error in contextSetCode'));

      const { result } = renderHook(() =>
        useHighlighted({
          ...defaultProps,
          controlledSetCode: mockControlledSetCode,
        }),
      );

      await act(async () => {
        await result.current.contextSetCode!(mockStringCode);
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error highlighting code in contextSetCode:',
        expect.any(Error),
      );
      expect(mockControlledSetCode).toHaveBeenCalledWith(mockStringCode);

      consoleErrorSpy.mockRestore();
    });

    it('should handle contextSetCode being called without controlledSetCode', async () => {
      // This tests the edge case where contextSetCode is somehow called without controlledSetCode
      const { result } = renderHook(() =>
        useHighlighted({
          ...defaultProps,
          controlledSetCode: undefined,
        }),
      );

      // contextSetCode should be undefined when no controlledSetCode is provided
      expect(result.current.contextSetCode).toBeUndefined();
    });
  });

  describe('readyForContent handling', () => {
    it('should not highlight when readyForContent is false', async () => {
      renderHook(() =>
        useHighlighted({
          ...defaultProps,
          highlightAt: 'init',
          activeCode: mockStringCode,
          readyForContent: false,
        }),
      );

      // Wait a bit to ensure highlighting doesn't happen
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });

      expect(mockParseSource).not.toHaveBeenCalled();
    });

    it('should start highlighting when readyForContent changes to true', async () => {
      const { rerender } = renderHook(
        (props: { readyForContent: boolean }) =>
          useHighlighted({
            ...defaultProps,
            highlightAt: 'init',
            activeCode: mockStringCode,
            readyForContent: props.readyForContent,
          }),
        { initialProps: { readyForContent: false } },
      );

      expect(mockParseSource).not.toHaveBeenCalled();

      // Enable highlighting
      rerender({ readyForContent: true });

      await waitFor(() => {
        expect(mockParseSource).toHaveBeenCalled();
      });
    });
  });

  describe('complex extra files scenarios', () => {
    it('should handle mixed string and object extra files', async () => {
      const complexCode: Code = {
        Default: {
          url: 'test-url',
          fileName: 'test.js',
          source: 'main code',
          extraFiles: {
            'string-file.js': 'string content',
            'object-file.js': {
              source: 'object content',
              transforms: {},
            },
            'already-highlighted.js': {
              source: {
                type: 'element',
                tagName: 'div',
                properties: {},
                children: [{ type: 'text', value: 'already highlighted' }],
              },
            },
          },
        },
      };

      mockParseSource.mockResolvedValue({ value: 'parsed', type: 'Program', body: [] });

      renderHook(() =>
        useHighlighted({
          ...defaultProps,
          highlightAt: 'init',
          activeCode: complexCode,
        }),
      );

      await waitFor(() => {
        // Should parse main file, string file, and object file (3 total)
        // Already highlighted file should not be parsed
        expect(mockParseSource).toHaveBeenCalledTimes(3);
      });

      expect(mockParseSource).toHaveBeenCalledWith('main code', 'test.js');
      expect(mockParseSource).toHaveBeenCalledWith('string content', 'string-file.js');
      expect(mockParseSource).toHaveBeenCalledWith('object content', 'object-file.js');
    });

    it('should handle extra file parsing errors gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const codeWithExtraFiles: Code = {
        Default: {
          url: 'test-url',
          fileName: 'test.js',
          source: 'main code',
          extraFiles: {
            'error-file.js': 'file that will error',
          },
        },
      };

      mockParseSource.mockImplementation(async (source: string, fileName: string) => {
        if (fileName === 'error-file.js') {
          throw new Error('Extra file parse error');
        }
        return { value: 'parsed', type: 'Program', body: [] };
      });

      renderHook(() =>
        useHighlighted({
          ...defaultProps,
          highlightAt: 'init',
          activeCode: codeWithExtraFiles,
        }),
      );

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith('Error highlighting code:', expect.any(Error));
      });

      consoleErrorSpy.mockRestore();
    });
  });

  describe('hash-based caching', () => {
    it('should use hash-based caching for identical content with different object references', async () => {
      const code1: Code = {
        Default: {
          url: 'test-url',
          fileName: 'test.js',
          source: 'console.log("same");',
        },
      };

      const code2: Code = {
        Default: {
          url: 'test-url',
          fileName: 'test.js',
          source: 'console.log("same");', // Same content
        },
      };

      let parseCallCount = 0;
      mockParseSource.mockImplementation(async (_source: string, _fileName: string) => {
        parseCallCount += 1;
        return { value: `parsed-${parseCallCount}`, type: 'Program', body: [] };
      });

      const { rerender } = renderHook(
        (props: { activeCode: Code }) =>
          useHighlighted({
            ...defaultProps,
            highlightAt: 'init',
            activeCode: props.activeCode,
          }),
        { initialProps: { activeCode: code1 } },
      );

      await waitFor(() => {
        expect(parseCallCount).toBe(1);
      });

      // Switch to code2 (different object reference but same content)
      rerender({ activeCode: code2 });

      // Wait a bit to ensure no additional parsing occurs
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });

      // Should still be 1 due to hash-based caching
      expect(parseCallCount).toBe(1);
    });
  });
});
