/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVariantSelection } from './useVariantSelection';

describe('useVariantSelection', () => {
  it('should select first variant by default', () => {
    const effectiveCode = {
      Default: { source: 'const x = 1;', fileName: 'test.js' },
      Alternative: { source: 'let x = 1;', fileName: 'test.js' },
    };

    const { result } = renderHook(() => useVariantSelection({ effectiveCode }));

    expect(result.current.variantKeys).toEqual(['Default', 'Alternative']);
    expect(result.current.selectedVariantKey).toBe('Default');
    expect(result.current.selectedVariant).toEqual(effectiveCode.Default);
  });

  it('should use initial variant when provided', () => {
    const effectiveCode = {
      Default: { source: 'const x = 1;', fileName: 'test.js' },
      Alternative: { source: 'let x = 1;', fileName: 'test.js' },
    };

    const { result } = renderHook(() =>
      useVariantSelection({ effectiveCode, initialVariant: 'Alternative' }),
    );

    expect(result.current.selectedVariantKey).toBe('Alternative');
    expect(result.current.selectedVariant).toEqual(effectiveCode.Alternative);
  });

  describe('localStorage persistence', () => {
    it('should load variant from localStorage when no initialVariant provided', () => {
      // Mock localStorage
      const mockGetItem = vi.fn();
      const mockSetItem = vi.fn();
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: mockGetItem,
          setItem: mockSetItem,
        },
        writable: true,
      });

      const effectiveCode = {
        Default: { source: 'const x = 1;', fileName: 'test.js' },
        Alternative: { source: 'let x = 1;', fileName: 'test.js' },
      };

      // Set up localStorage to return 'Alternative' (no JSON serialization)
      mockGetItem.mockReturnValue('Alternative');

      const { result } = renderHook(
        () => useVariantSelection({ effectiveCode }), // No initialVariant
      );

      // Should read from localStorage with correct key
      expect(mockGetItem).toHaveBeenCalledWith('_docs_infra_variant_prefs_Alternative:Default');
      expect(result.current.selectedVariantKey).toBe('Alternative');
    });

    it('should not save to localStorage on initial render', () => {
      const mockCode = {
        variant1: { source: 'code1' },
        variant2: { source: 'code2' },
      };

      renderHook(() => useVariantSelection({ effectiveCode: mockCode }));

      // Should not save anything to localStorage on initial render
      expect(localStorage.setItem).not.toHaveBeenCalled();
    });

    it('should save to localStorage only when user explicitly selects variant', () => {
      const mockCode = {
        variant1: { source: 'code1' },
        variant2: { source: 'code2' },
      };

      const { result } = renderHook(() => useVariantSelection({ effectiveCode: mockCode }));

      // Clear any previous calls
      vi.clearAllMocks();

      // User explicitly selects a variant
      act(() => {
        result.current.selectVariant('variant2');
      });

      // Should save to localStorage after user selection (no JSON serialization)
      expect(localStorage.setItem).toHaveBeenCalledWith(
        '_docs_infra_variant_prefs_variant1:variant2',
        'variant2', // Direct string value
      );
    });

    it('should restore from localStorage without triggering save', () => {
      const mockCode = {
        variant1: { source: 'code1' },
        variant2: { source: 'code2' },
      };

      // Clear any previous localStorage mocks
      vi.clearAllMocks();

      // Mock localStorage to return a stored variant (no JSON serialization)
      (localStorage.getItem as any).mockReturnValue('variant2');

      const { result } = renderHook(() => useVariantSelection({ effectiveCode: mockCode }));

      // Should restore the variant from localStorage
      expect(result.current.selectedVariantKey).toBe('variant2');

      // Should not save back to localStorage during restoration
      expect(localStorage.setItem).not.toHaveBeenCalled();
    });

    it('should generate consistent storage keys for same variants in different order', () => {
      // Mock localStorage for this test specifically
      const mockGetItem = vi.fn();
      const mockSetItem = vi.fn();

      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: mockGetItem,
          setItem: mockSetItem,
        },
        writable: true,
        configurable: true,
      });

      // Test that variants in different orders generate the same storage key
      const effectiveCode1 = {
        Yarn: { source: 'yarn install', fileName: 'install.sh' },
        Npm: { source: 'npm install', fileName: 'install.sh' },
        Pnpm: { source: 'pnpm install', fileName: 'install.sh' },
      };

      const effectiveCode2 = {
        Pnpm: { source: 'pnpm install', fileName: 'install.sh' },
        Npm: { source: 'npm install', fileName: 'install.sh' },
        Yarn: { source: 'yarn install', fileName: 'install.sh' },
      };

      // Expected storage key should be sorted regardless of input order
      const expectedKey = '_docs_infra_variant_prefs_Npm:Pnpm:Yarn';

      // Test first variant order
      renderHook(() => useVariantSelection({ effectiveCode: effectiveCode1 }));

      // Should read from the expected key
      expect(mockGetItem).toHaveBeenCalledWith(expectedKey);

      // Clear calls and test second variant order
      mockGetItem.mockClear();

      renderHook(() => useVariantSelection({ effectiveCode: effectiveCode2 }));

      // Should read from the same key even with different variant order
      expect(mockGetItem).toHaveBeenCalledWith(expectedKey);

      // Now test that saving works correctly with the consistent key
      // Use a fresh hook without any initial variant to ensure proper initialization
      mockGetItem.mockClear();
      mockSetItem.mockClear();

      const testCode = {
        Default: { source: 'const x = 1;', fileName: 'test.js' },
        Alternative: { source: 'let x = 1;', fileName: 'test.js' },
      };

      const { result } = renderHook(() => useVariantSelection({ effectiveCode: testCode }));

      // Clear and test saving
      vi.clearAllMocks();

      act(() => {
        result.current.selectVariant('Alternative');
      });

      // Should save to localStorage (no JSON serialization)
      expect(localStorage.setItem).toHaveBeenCalledWith(
        '_docs_infra_variant_prefs_Alternative:Default',
        'Alternative', // Direct string value
      );
    });

    it('should prioritize localStorage over initialVariant when both are provided', () => {
      // localStorage should always take precedence over initialVariant to respect user preferences
      // The useLocalStorageState implementation reads from localStorage and that value should be used
      const mockGetItem = vi.fn();
      const mockSetItem = vi.fn();
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: mockGetItem,
          setItem: mockSetItem,
        },
        writable: true,
      });

      const effectiveCode = {
        Default: { source: 'const x = 1;', fileName: 'test.js' },
        Alternative: { source: 'let x = 1;', fileName: 'test.js' },
      };

      // Set up localStorage to return 'Alternative'
      mockGetItem.mockReturnValue('Alternative');

      const { result } = renderHook(() =>
        useVariantSelection({ effectiveCode, initialVariant: 'Default' }),
      );

      // localStorage should take precedence over initialVariant to respect user preferences
      expect(result.current.selectedVariantKey).toBe('Alternative');
    });

    it('should not use localStorage for single variant', () => {
      // Mock localStorage
      const mockGetItem = vi.fn();
      const mockSetItem = vi.fn();
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: mockGetItem,
          setItem: mockSetItem,
        },
        writable: true,
      });

      const effectiveCode = {
        Default: { source: 'const x = 1;', fileName: 'test.js' },
        // Only one variant
      };

      const { result } = renderHook(() => useVariantSelection({ effectiveCode }));

      // Should not attempt to read from localStorage for single variant
      expect(mockGetItem).not.toHaveBeenCalled();
      expect(result.current.selectedVariantKey).toBe('Default');

      // Even if we somehow trigger a variant change (shouldn't happen in practice),
      // it shouldn't save to localStorage
      act(() => {
        result.current.selectVariant('Default');
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

      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: mockGetItem,
          setItem: mockSetItem,
        },
        writable: true,
      });

      const effectiveCode = {
        Default: { source: 'const x = 1;', fileName: 'test.js' },
        Alternative: { source: 'let x = 1;', fileName: 'test.js' },
      };

      const { result } = renderHook(() => useVariantSelection({ effectiveCode }));

      // Should fall back to first variant without crashing
      expect(result.current.selectedVariantKey).toBe('Default');

      // New implementation handles errors silently without warnings
      // This is the expected behavior for better user experience

      // Changing selection should handle error gracefully but state won't change
      // since the new implementation is driven by localStorage via useSyncExternalStore
      act(() => {
        result.current.selectVariant('Alternative');
      });

      // State remains the same when localStorage fails since useSyncExternalStore
      // doesn't update when the external store (localStorage) fails to change
      expect(result.current.selectedVariantKey).toBe('Default');
    });
  });
});
