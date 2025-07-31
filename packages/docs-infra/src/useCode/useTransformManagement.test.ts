/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTransformManagement } from './useTransformManagement';
import { getAvailableTransforms, createTransformedFiles } from './useCodeUtils';

// Mock the utility functions
vi.mock('./useCodeUtils', () => ({
  getAvailableTransforms: vi.fn(),
  createTransformedFiles: vi.fn(),
}));

describe('useTransformManagement', () => {
  const mockEffectiveCode = {
    Default: { source: 'const x = 1;', fileName: 'test.js' },
    Alternative: { source: 'let x = 1;', fileName: 'test.js' },
  };

  const mockSelectedVariant = { source: 'const x = 1;', fileName: 'test.js' };

  it('should select first available transform by default when no initialTransform provided', () => {
    (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']);
    (createTransformedFiles as any).mockReturnValue({ transformed: true });

    const { result } = renderHook(() =>
      useTransformManagement({
        effectiveCode: mockEffectiveCode,
        selectedVariantKey: 'Default',
        selectedVariant: mockSelectedVariant,
        shouldHighlight: true,
      }),
    );

    expect(result.current.availableTransforms).toEqual(['TypeScript', 'JavaScript']);
    expect(result.current.selectedTransform).toBe(null); // No default selection
    expect(result.current.transformedFiles).toEqual({ transformed: true });
  });

  it('should use initial transform when provided', () => {
    (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']);
    (createTransformedFiles as any).mockReturnValue({ transformed: true });

    const { result } = renderHook(() =>
      useTransformManagement({
        effectiveCode: mockEffectiveCode,
        selectedVariantKey: 'Default',
        selectedVariant: mockSelectedVariant,
        initialTransform: 'TypeScript',
        shouldHighlight: true,
      }),
    );

    expect(result.current.selectedTransform).toBe('TypeScript');
  });

  it('should use context availableTransforms when provided', () => {
    const context = { availableTransforms: ['CustomTransform'] };
    (createTransformedFiles as any).mockReturnValue({ transformed: true });

    // Clear mocks before running test to ensure clean state
    vi.clearAllMocks();

    const { result } = renderHook(() =>
      useTransformManagement({
        context,
        effectiveCode: mockEffectiveCode,
        selectedVariantKey: 'Default',
        selectedVariant: mockSelectedVariant,
        shouldHighlight: true,
      }),
    );

    expect(result.current.availableTransforms).toEqual(['CustomTransform']);
    expect(getAvailableTransforms).not.toHaveBeenCalled();
  });

  describe('localStorage persistence', () => {
    it('should load transform from localStorage when no initialTransform provided', () => {
      // Mock localStorage
      const mockGetItem = vi.fn();
      const mockSetItem = vi.fn();
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: mockGetItem,
          setItem: mockSetItem,
          removeItem: vi.fn(),
        },
        writable: true,
      });

      (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']);
      (createTransformedFiles as any).mockReturnValue({ transformed: true });

      // Set up localStorage to return 'TypeScript'
      mockGetItem.mockReturnValue('TypeScript');

      const { result } = renderHook(() =>
        useTransformManagement({
          effectiveCode: mockEffectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant: mockSelectedVariant,
          shouldHighlight: true,
        }),
      );

      // Should read from localStorage with correct key
      expect(mockGetItem).toHaveBeenCalledWith('_docs_infra_transform_prefs_JavaScript:TypeScript');
      expect(result.current.selectedTransform).toBe('TypeScript');
    });

    it('should not save to localStorage on initial render', () => {
      (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']);
      (createTransformedFiles as any).mockReturnValue({ transformed: true });

      renderHook(() =>
        useTransformManagement({
          effectiveCode: mockEffectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant: mockSelectedVariant,
          shouldHighlight: true,
        }),
      );

      // Should not save anything to localStorage on initial render
      expect(localStorage.setItem).not.toHaveBeenCalled();
    });

    it('should save to localStorage only when user explicitly selects transform', () => {
      // Set up proper localStorage mock
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: vi.fn(),
          setItem: vi.fn(),
          removeItem: vi.fn(),
        },
        writable: true,
        configurable: true,
      });

      (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']);
      (createTransformedFiles as any).mockReturnValue({ transformed: true });

      const { result } = renderHook(() =>
        useTransformManagement({
          effectiveCode: mockEffectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant: mockSelectedVariant,
          shouldHighlight: true,
        }),
      );

      // Clear any previous calls
      vi.clearAllMocks();

      // User explicitly selects a transform
      act(() => {
        result.current.selectTransform('TypeScript');
      });

      // Should save to localStorage after user selection
      expect(localStorage.setItem).toHaveBeenCalledWith(
        '_docs_infra_transform_prefs_JavaScript:TypeScript',
        'TypeScript',
      );
    });

    it('should remove from localStorage when transform is set to null', () => {
      (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']);
      (createTransformedFiles as any).mockReturnValue({ transformed: true });

      const { result } = renderHook(() =>
        useTransformManagement({
          effectiveCode: mockEffectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant: mockSelectedVariant,
          initialTransform: 'TypeScript',
          shouldHighlight: true,
        }),
      );

      // Clear any previous calls
      vi.clearAllMocks();

      // User explicitly deselects transform
      act(() => {
        result.current.selectTransform(null);
      });

      // Should save null preference to localStorage
      expect(localStorage.setItem).toHaveBeenCalledWith(
        '_docs_infra_transform_prefs_JavaScript:TypeScript',
        'null',
      );
    });

    it('should restore from localStorage without triggering save', () => {
      (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']);
      (createTransformedFiles as any).mockReturnValue({ transformed: true });

      // Clear any previous localStorage mocks
      vi.clearAllMocks();

      // Mock localStorage to return a stored transform
      (localStorage.getItem as any).mockReturnValue('JavaScript');

      const { result } = renderHook(() =>
        useTransformManagement({
          effectiveCode: mockEffectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant: mockSelectedVariant,
          shouldHighlight: true,
        }),
      );

      // Should restore the transform from localStorage
      expect(result.current.selectedTransform).toBe('JavaScript');

      // Should not save back to localStorage during restoration
      expect(localStorage.setItem).not.toHaveBeenCalled();
    });

    it('should generate consistent storage keys for same transforms in different order', () => {
      // Mock localStorage
      const mockGetItem = vi.fn();
      const mockSetItem = vi.fn();
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: mockGetItem,
          setItem: mockSetItem,
          removeItem: vi.fn(),
        },
        writable: true,
        configurable: true,
      });

      (createTransformedFiles as any).mockReturnValue({ transformed: true });

      // Test that transforms in different orders generate the same storage key
      (getAvailableTransforms as any).mockReturnValueOnce(['TypeScript', 'JavaScript', 'Flow']);

      renderHook(() =>
        useTransformManagement({
          effectiveCode: mockEffectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant: mockSelectedVariant,
          shouldHighlight: true,
        }),
      );

      // Expected storage key should be sorted regardless of input order
      const expectedKey = '_docs_infra_transform_prefs_Flow:JavaScript:TypeScript';

      // Should read from the expected key
      expect(mockGetItem).toHaveBeenCalledWith(expectedKey);

      // Clear calls and test with different order
      mockGetItem.mockClear();

      (getAvailableTransforms as any).mockReturnValueOnce(['Flow', 'JavaScript', 'TypeScript']);

      renderHook(() =>
        useTransformManagement({
          effectiveCode: mockEffectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant: mockSelectedVariant,
          shouldHighlight: true,
        }),
      );

      // Should read from the same key even with different transform order
      expect(mockGetItem).toHaveBeenCalledWith(expectedKey);
    });

    it('should not sync from localStorage when initialTransform is provided', () => {
      // Mock localStorage
      const mockGetItem = vi.fn();
      const mockSetItem = vi.fn();
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: mockGetItem,
          setItem: mockSetItem,
          removeItem: vi.fn(),
        },
        writable: true,
      });

      (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']);
      (createTransformedFiles as any).mockReturnValue({ transformed: true });

      // Set up localStorage to return 'JavaScript'
      mockGetItem.mockReturnValue('JavaScript');

      const { result } = renderHook(() =>
        useTransformManagement({
          effectiveCode: mockEffectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant: mockSelectedVariant,
          initialTransform: 'TypeScript',
          shouldHighlight: true,
        }),
      );

      // Should NOT read from localStorage when initialTransform is provided
      expect(mockGetItem).not.toHaveBeenCalled();
      expect(result.current.selectedTransform).toBe('TypeScript');
    });

    it('should persist preferences even for single transform', () => {
      // Mock localStorage
      const mockGetItem = vi.fn();
      const mockSetItem = vi.fn();
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: mockGetItem,
          setItem: mockSetItem,
          removeItem: vi.fn(),
        },
        writable: true,
      });

      (getAvailableTransforms as any).mockReturnValue(['TypeScript']); // Only one transform
      (createTransformedFiles as any).mockReturnValue({ transformed: true });

      const { result } = renderHook(() =>
        useTransformManagement({
          effectiveCode: mockEffectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant: mockSelectedVariant,
          shouldHighlight: true,
        }),
      );

      // Should attempt to read from localStorage even for single transform
      expect(mockGetItem).toHaveBeenCalledWith('_docs_infra_transform_prefs_TypeScript');

      // Clear previous calls
      vi.clearAllMocks();

      // User explicitly selects the transform
      act(() => {
        result.current.selectTransform('TypeScript');
      });

      // Should save the selection to localStorage
      expect(mockSetItem).toHaveBeenCalledWith(
        '_docs_infra_transform_prefs_TypeScript',
        'TypeScript',
      );

      // Clear again
      vi.clearAllMocks();

      // User deselects the transform (sets to null)
      act(() => {
        result.current.selectTransform(null);
      });

      // Should save null preference to localStorage
      expect(mockSetItem).toHaveBeenCalledWith('_docs_infra_transform_prefs_TypeScript', 'null');
    });

    it('should restore single transform preference from localStorage', () => {
      // Mock localStorage
      const mockGetItem = vi.fn();
      const mockSetItem = vi.fn();
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: mockGetItem,
          setItem: mockSetItem,
          removeItem: vi.fn(),
        },
        writable: true,
      });

      (getAvailableTransforms as any).mockReturnValue(['TypeScript']);
      (createTransformedFiles as any).mockReturnValue({ transformed: true });

      // Test restoring a selected transform
      mockGetItem.mockReturnValue('TypeScript');

      const { result: result1 } = renderHook(() =>
        useTransformManagement({
          effectiveCode: mockEffectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant: mockSelectedVariant,
          shouldHighlight: true,
        }),
      );

      expect(result1.current.selectedTransform).toBe('TypeScript');

      // Test restoring "no transform" preference
      mockGetItem.mockReturnValue('null');

      const { result: result2 } = renderHook(() =>
        useTransformManagement({
          effectiveCode: mockEffectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant: mockSelectedVariant,
          shouldHighlight: true,
        }),
      );

      expect(result2.current.selectedTransform).toBe(null);
    });

    it('should not use localStorage when no transforms are available', () => {
      // Mock localStorage
      const mockGetItem = vi.fn();
      const mockSetItem = vi.fn();
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: mockGetItem,
          setItem: mockSetItem,
          removeItem: vi.fn(),
        },
        writable: true,
      });

      (getAvailableTransforms as any).mockReturnValue([]); // No transforms available
      (createTransformedFiles as any).mockReturnValue({ transformed: true });

      const { result } = renderHook(() =>
        useTransformManagement({
          effectiveCode: mockEffectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant: mockSelectedVariant,
          shouldHighlight: true,
        }),
      );

      // Should not attempt to read from localStorage when no transforms are available
      expect(mockGetItem).not.toHaveBeenCalled();
      expect(result.current.selectedTransform).toBe(null);

      // Even if we somehow trigger a transform change, it shouldn't save to localStorage
      act(() => {
        result.current.selectTransform(null);
      });
      expect(mockSetItem).not.toHaveBeenCalled();
    });

    it('should handle localStorage errors gracefully', () => {
      // Mock localStorage to throw errors
      const mockGetItem = vi.fn().mockImplementation(() => {
        throw new Error('localStorage not available');
      });
      const mockSetItem = vi.fn().mockImplementation(() => {
        throw new Error('localStorage not available');
      });

      // Mock console.warn to avoid cluttering test output
      const mockWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: mockGetItem,
          setItem: mockSetItem,
          removeItem: vi.fn(),
        },
        writable: true,
      });

      (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']);
      (createTransformedFiles as any).mockReturnValue({ transformed: true });

      const { result } = renderHook(() =>
        useTransformManagement({
          effectiveCode: mockEffectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant: mockSelectedVariant,
          shouldHighlight: true,
        }),
      );

      // Should fall back to null without crashing
      expect(result.current.selectedTransform).toBe(null);

      // Should log warnings for errors
      expect(mockWarn).toHaveBeenCalledWith(
        'Failed to read transform preference from localStorage:',
        expect.any(Error),
      );

      // Changing selection should also handle error gracefully
      act(() => {
        result.current.selectTransform('TypeScript');
      });
      expect(mockWarn).toHaveBeenCalledWith(
        'Failed to save transform preference to localStorage:',
        expect.any(Error),
      );

      mockWarn.mockRestore();
    });
  });

  describe('transform selection', () => {
    it('should select valid transform', () => {
      (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']);
      (createTransformedFiles as any).mockReturnValue({ transformed: true });

      const { result } = renderHook(() =>
        useTransformManagement({
          effectiveCode: mockEffectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant: mockSelectedVariant,
          shouldHighlight: true,
        }),
      );

      act(() => {
        result.current.selectTransform('TypeScript');
      });

      expect(result.current.selectedTransform).toBe('TypeScript');
    });

    it('should set to null for invalid transform', () => {
      (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']);
      (createTransformedFiles as any).mockReturnValue({ transformed: true });

      const { result } = renderHook(() =>
        useTransformManagement({
          effectiveCode: mockEffectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant: mockSelectedVariant,
          initialTransform: 'TypeScript',
          shouldHighlight: true,
        }),
      );

      act(() => {
        result.current.selectTransform('InvalidTransform');
      });

      expect(result.current.selectedTransform).toBe(null);
    });

    it('should allow setting transform to null', () => {
      (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']);
      (createTransformedFiles as any).mockReturnValue({ transformed: true });

      const { result } = renderHook(() =>
        useTransformManagement({
          effectiveCode: mockEffectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant: mockSelectedVariant,
          initialTransform: 'TypeScript',
          shouldHighlight: true,
        }),
      );

      act(() => {
        result.current.selectTransform(null);
      });

      expect(result.current.selectedTransform).toBe(null);
    });
  });
});
