/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUIState } from './useUIState';

// Mock the useUrlHashState hook
let mockHashValue = '';
let mockSetHash = vi.fn();

vi.mock('../useUrlHashState', () => ({
  useUrlHashState: () => [mockHashValue, mockSetHash],
}));

describe('useUIState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHashValue = '';
    mockSetHash = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('expansion state', () => {
    it('should default to collapsed when no hash present', () => {
      mockHashValue = '';
      const { result } = renderHook(() => useUIState({ defaultOpen: false }));

      expect(result.current.expanded).toBe(false);
    });

    it('should default to expanded when defaultOpen is true', () => {
      mockHashValue = '';
      const { result } = renderHook(() => useUIState({ defaultOpen: true }));

      expect(result.current.expanded).toBe(true);
    });

    it('should expand when hash is relevant to demo on initial render', () => {
      mockHashValue = 'demo-slug:demo.js';

      const { result } = renderHook(() =>
        useUIState({
          defaultOpen: false,
          mainSlug: 'demo-slug',
        }),
      );

      expect(result.current.expanded).toBe(true);
    });

    it('should remain collapsed when hash is not relevant to demo', () => {
      mockHashValue = 'other-demo:demo.js';

      const { result } = renderHook(() =>
        useUIState({
          defaultOpen: false,
          mainSlug: 'demo-slug',
        }),
      );

      expect(result.current.expanded).toBe(false);
    });

    it('should expand when hash contains variant', () => {
      mockHashValue = 'demo-slug:type-script:demo.ts';

      const { result } = renderHook(() =>
        useUIState({
          defaultOpen: false,
          mainSlug: 'demo-slug',
        }),
      );

      expect(result.current.expanded).toBe(true);
    });

    it('should expand when hash becomes relevant after initial render', () => {
      mockHashValue = '';

      const { result, rerender } = renderHook(() =>
        useUIState({
          defaultOpen: false,
          mainSlug: 'demo-slug',
        }),
      );

      expect(result.current.expanded).toBe(false);

      // Hash becomes relevant
      act(() => {
        mockHashValue = 'demo-slug:demo.js';
      });

      rerender();

      expect(result.current.expanded).toBe(true);
    });

    it('should remain expanded even when hash becomes irrelevant', () => {
      mockHashValue = 'demo-slug:demo.js';

      const { result, rerender } = renderHook(() =>
        useUIState({
          defaultOpen: false,
          mainSlug: 'demo-slug',
        }),
      );

      expect(result.current.expanded).toBe(true);

      // Hash becomes irrelevant
      act(() => {
        mockHashValue = 'other-demo:demo.js';
      });

      rerender();

      // Should remain expanded (doesn't collapse automatically)
      expect(result.current.expanded).toBe(true);
    });

    it('should allow manual expansion via expand callback', () => {
      mockHashValue = '';

      const { result } = renderHook(() =>
        useUIState({
          defaultOpen: false,
          mainSlug: 'demo-slug',
        }),
      );

      expect(result.current.expanded).toBe(false);

      act(() => {
        result.current.expand();
      });

      expect(result.current.expanded).toBe(true);
    });

    it('should allow manual control via setExpanded', () => {
      mockHashValue = 'demo-slug:demo.js';

      const { result } = renderHook(() =>
        useUIState({
          defaultOpen: false,
          mainSlug: 'demo-slug',
        }),
      );

      expect(result.current.expanded).toBe(true);

      act(() => {
        result.current.setExpanded(false);
      });

      expect(result.current.expanded).toBe(false);
    });

    it('should handle kebab-case conversion in hash checks', () => {
      mockHashValue = 'demo-slug:demo.js';

      const { result } = renderHook(() =>
        useUIState({
          defaultOpen: false,
          mainSlug: 'DemoSlug', // CamelCase slug
        }),
      );

      expect(result.current.expanded).toBe(true);
    });

    it('should not expand when mainSlug is not provided', () => {
      mockHashValue = 'demo-slug:demo.js';

      const { result } = renderHook(() =>
        useUIState({
          defaultOpen: false,
        }),
      );

      expect(result.current.expanded).toBe(false);
    });
  });
});
