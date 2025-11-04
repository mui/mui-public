/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUIState } from './useUIState';

// Mock the useUrlHashState hook to prevent browser API issues
// JSDOM doesn't fully support hash change events, so we mock this to control hash values in tests
let mockHashValue: string | null = null;
let mockSetHash = vi.fn();

vi.mock('../useUrlHashState', () => ({
  useUrlHashState: () => [mockHashValue, mockSetHash],
}));

describe('useUIState', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();
    mockHashValue = null;
    mockSetHash = vi.fn();
  });

  describe('initial state', () => {
    it('should start collapsed when defaultOpen is false and no relevant hash', () => {
      mockHashValue = null;

      const { result } = renderHook(() =>
        useUIState({
          defaultOpen: false,
          mainSlug: 'demo',
        }),
      );

      expect(result.current.expanded).toBe(false);
    });

    it('should start expanded when defaultOpen is true', () => {
      mockHashValue = null;

      const { result } = renderHook(() =>
        useUIState({
          defaultOpen: true,
          mainSlug: 'demo',
        }),
      );

      expect(result.current.expanded).toBe(true);
    });

    it('should auto-expand when relevant hash is present on mount', () => {
      // Hash is relevant to this demo
      mockHashValue = 'demo:file.tsx';

      const { result } = renderHook(() =>
        useUIState({
          defaultOpen: false,
          mainSlug: 'demo',
        }),
      );

      // Should auto-expand because hash is relevant
      expect(result.current.expanded).toBe(true);
    });

    it('should not auto-expand when hash is for different demo', () => {
      // Hash is for a different demo
      mockHashValue = 'other-demo:file.tsx';

      const { result } = renderHook(() =>
        useUIState({
          defaultOpen: false,
          mainSlug: 'demo',
        }),
      );

      // Should not expand because hash is not relevant
      expect(result.current.expanded).toBe(false);
    });

    it('should handle missing mainSlug gracefully', () => {
      mockHashValue = 'demo:file.tsx';

      const { result } = renderHook(() =>
        useUIState({
          defaultOpen: false,
          // mainSlug not provided
        }),
      );

      // Should not expand because mainSlug is undefined
      expect(result.current.expanded).toBe(false);
    });

    it('should handle empty mainSlug gracefully', () => {
      mockHashValue = 'demo:file.tsx';

      const { result } = renderHook(() =>
        useUIState({
          defaultOpen: false,
          mainSlug: '',
        }),
      );

      // Should not expand because mainSlug is empty
      expect(result.current.expanded).toBe(false);
    });
  });

  describe('expand function', () => {
    it('should expand when expand function is called', () => {
      mockHashValue = null;

      const { result } = renderHook(() =>
        useUIState({
          defaultOpen: false,
          mainSlug: 'demo',
        }),
      );

      expect(result.current.expanded).toBe(false);

      act(() => {
        result.current.expand();
      });

      expect(result.current.expanded).toBe(true);
    });

    it('should be stable and not cause re-renders', () => {
      mockHashValue = null;

      const { result, rerender } = renderHook(() => {
        return useUIState({
          defaultOpen: false,
          mainSlug: 'demo',
        });
      });

      const firstExpand = result.current.expand;
      rerender();
      const secondExpand = result.current.expand;

      // expand function should be stable (same reference)
      expect(firstExpand).toBe(secondExpand);
    });
  });

  describe('setExpanded function', () => {
    it('should allow manual control of expanded state', () => {
      mockHashValue = null;

      const { result } = renderHook(() =>
        useUIState({
          defaultOpen: false,
          mainSlug: 'demo',
        }),
      );

      expect(result.current.expanded).toBe(false);

      act(() => {
        result.current.setExpanded(true);
      });

      expect(result.current.expanded).toBe(true);

      act(() => {
        result.current.setExpanded(false);
      });

      expect(result.current.expanded).toBe(false);
    });

    it('should support functional updates', () => {
      mockHashValue = null;

      const { result } = renderHook(() =>
        useUIState({
          defaultOpen: false,
          mainSlug: 'demo',
        }),
      );

      act(() => {
        result.current.setExpanded((prev) => !prev);
      });

      expect(result.current.expanded).toBe(true);

      act(() => {
        result.current.setExpanded((prev) => !prev);
      });

      expect(result.current.expanded).toBe(false);
    });
  });

  describe('hash change behavior', () => {
    it('should auto-expand when hash becomes relevant', () => {
      mockHashValue = null;

      const { result, rerender } = renderHook(() =>
        useUIState({
          defaultOpen: false,
          mainSlug: 'demo',
        }),
      );

      expect(result.current.expanded).toBe(false);

      // Hash becomes relevant
      mockHashValue = 'demo:file.tsx';
      rerender();

      // Should auto-expand
      expect(result.current.expanded).toBe(true);
    });

    it('should not auto-expand if already expanded', () => {
      mockHashValue = null;

      const { result, rerender } = renderHook(() =>
        useUIState({
          defaultOpen: true,
          mainSlug: 'demo',
        }),
      );

      expect(result.current.expanded).toBe(true);

      // Hash becomes relevant, but already expanded
      mockHashValue = 'demo:file.tsx';
      rerender();

      // Should still be expanded
      expect(result.current.expanded).toBe(true);
    });

    it('should not collapse when hash becomes irrelevant', () => {
      // Start with relevant hash
      mockHashValue = 'demo:file.tsx';

      const { result, rerender } = renderHook(() =>
        useUIState({
          defaultOpen: false,
          mainSlug: 'demo',
        }),
      );

      expect(result.current.expanded).toBe(true);

      // Hash becomes irrelevant
      mockHashValue = 'other-demo:file.tsx';
      rerender();

      // Should NOT auto-collapse - user may have manually expanded
      expect(result.current.expanded).toBe(true);
    });

    it('should not collapse when hash is removed', () => {
      // Start with relevant hash
      mockHashValue = 'demo:file.tsx';

      const { result, rerender } = renderHook(() =>
        useUIState({
          defaultOpen: false,
          mainSlug: 'demo',
        }),
      );

      expect(result.current.expanded).toBe(true);

      // Hash is removed
      mockHashValue = null;
      rerender();

      // Should NOT auto-collapse
      expect(result.current.expanded).toBe(true);
    });
  });

  describe('kebab-case slug matching', () => {
    it('should match PascalCase mainSlug with kebab-case hash', () => {
      mockHashValue = 'my-complex-demo:file.tsx';

      const { result } = renderHook(() =>
        useUIState({
          defaultOpen: false,
          mainSlug: 'MyComplexDemo',
        }),
      );

      // Should auto-expand because "MyComplexDemo" converts to "my-complex-demo"
      expect(result.current.expanded).toBe(true);
    });

    it('should match camelCase mainSlug with kebab-case hash', () => {
      mockHashValue = 'my-demo-name:file.tsx';

      const { result } = renderHook(() =>
        useUIState({
          defaultOpen: false,
          mainSlug: 'myDemoName',
        }),
      );

      // Should auto-expand because "myDemoName" converts to "my-demo-name"
      expect(result.current.expanded).toBe(true);
    });

    it('should handle hash with variant in the middle', () => {
      mockHashValue = 'demo:typescript:file.tsx';

      const { result } = renderHook(() =>
        useUIState({
          defaultOpen: false,
          mainSlug: 'demo',
        }),
      );

      // Should auto-expand because hash starts with "demo:"
      expect(result.current.expanded).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle rapid hash changes', () => {
      mockHashValue = null;

      const { result, rerender } = renderHook(() =>
        useUIState({
          defaultOpen: false,
          mainSlug: 'demo',
        }),
      );

      expect(result.current.expanded).toBe(false);

      // Rapid hash changes
      mockHashValue = 'demo:file1.tsx';
      rerender();
      expect(result.current.expanded).toBe(true);

      mockHashValue = 'demo:file2.tsx';
      rerender();
      expect(result.current.expanded).toBe(true);

      mockHashValue = 'demo:file3.tsx';
      rerender();
      expect(result.current.expanded).toBe(true);
    });

    it('should handle manual collapse followed by relevant hash', () => {
      mockHashValue = null;

      const { result, rerender } = renderHook(() =>
        useUIState({
          defaultOpen: true,
          mainSlug: 'demo',
        }),
      );

      expect(result.current.expanded).toBe(true);

      // User manually collapses
      act(() => {
        result.current.setExpanded(false);
      });

      expect(result.current.expanded).toBe(false);

      // Hash becomes relevant - should re-expand
      mockHashValue = 'demo:file.tsx';
      rerender();

      expect(result.current.expanded).toBe(true);
    });

    it('should handle defaultOpen changing', () => {
      mockHashValue = null;

      const { result, rerender } = renderHook(
        ({ defaultOpen }) =>
          useUIState({
            defaultOpen,
            mainSlug: 'demo',
          }),
        {
          initialProps: { defaultOpen: false },
        },
      );

      expect(result.current.expanded).toBe(false);

      // Changing defaultOpen doesn't affect current state (only initial state)
      rerender({ defaultOpen: true });

      // State shouldn't change - defaultOpen only affects initial render
      expect(result.current.expanded).toBe(false);
    });
  });
});
