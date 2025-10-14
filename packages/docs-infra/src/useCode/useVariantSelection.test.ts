/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
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
      expect(mockGetItem).toHaveBeenCalledWith('_docs_variant_pref:Alternative:Default');
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
        '_docs_variant_pref:variant1:variant2',
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
      const expectedKey = '_docs_variant_pref:Npm:Pnpm:Yarn';

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
        '_docs_variant_pref:Alternative:Default',
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

      // With React state as source of truth, variant selection works even when localStorage fails
      // localStorage is only used for persistence across sessions
      act(() => {
        result.current.selectVariant('Alternative');
      });

      // State changes successfully even though localStorage persistence fails
      // This provides better UX - variant switching works, just won't persist
      expect(result.current.selectedVariantKey).toBe('Alternative');
    });

    it('should ignore localStorage when URL hash is present', () => {
      // Mock localStorage to have TypeScript preference
      const mockGetItem = vi.fn((key) => {
        if (key?.includes('variant_pref')) {
          return 'TypeScript';
        }
        return null;
      });
      const mockSetItem = vi.fn();
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: mockGetItem,
          setItem: mockSetItem,
        },
        writable: true,
        configurable: true,
      });

      // Mock window.location.hash to simulate a URL hash being present
      Object.defineProperty(window, 'location', {
        value: {
          ...window.location,
          hash: '#demo:demo.js',
        },
        writable: true,
        configurable: true,
      });

      const effectiveCode = {
        JavaScript: { source: 'const x = 1;', fileName: 'demo.js' },
        TypeScript: { source: 'const x: number = 1;', fileName: 'demo.ts' },
      };

      const { result } = renderHook(() => useVariantSelection({ effectiveCode, mainSlug: 'demo' }));

      // Should ignore localStorage and use first variant (JavaScript) because hash is present
      expect(result.current.selectedVariantKey).toBe('JavaScript');

      // Clean up
      Object.defineProperty(window, 'location', {
        value: {
          ...window.location,
          hash: '',
        },
        writable: true,
        configurable: true,
      });
    });

    it('should use localStorage when URL hash is for a different demo', async () => {
      // Mock localStorage returning "TypeScript"
      const mockGetItem = vi.fn((key) => {
        // Key format is _docs_variant_pref:{sorted variant keys}
        if (key === '_docs_variant_pref:JavaScript:TypeScript') {
          return 'TypeScript';
        }
        return null;
      });
      const mockSetItem = vi.fn();
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: mockGetItem,
          setItem: mockSetItem,
        },
        writable: true,
        configurable: true,
      });

      // Mock window.location.hash with a different demo's hash
      Object.defineProperty(window, 'location', {
        value: {
          ...window.location,
          hash: '#other-demo:demo.js',
        },
        writable: true,
        configurable: true,
      });

      const effectiveCode = {
        JavaScript: { source: 'const x = 1;', fileName: 'demo.js' },
        TypeScript: { source: 'const x: number = 1;', fileName: 'demo.ts' },
      };

      const { result } = renderHook(() => useVariantSelection({ effectiveCode, mainSlug: 'demo' }));

      // Should use localStorage (TypeScript) because hash is for a different demo
      // Wait for the effect to apply localStorage
      await waitFor(() => {
        expect(result.current.selectedVariantKey).toBe('TypeScript');
      });

      // Clean up
      Object.defineProperty(window, 'location', {
        value: {
          ...window.location,
          hash: '',
        },
        writable: true,
        configurable: true,
      });
    });
  });

  describe('variantType parameter', () => {
    it('should use variantType for localStorage key when provided', () => {
      // Mock localStorage
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

      const effectiveCode = {
        Default: { source: 'const x = 1;', fileName: 'test.js' },
        Alternative: { source: 'let x = 1;', fileName: 'test.js' },
      };

      // Use a custom variantType instead of the actual variant keys
      renderHook(() => useVariantSelection({ effectiveCode, variantType: 'packageManager' }));

      // Should use the variantType for localStorage key instead of sorted variant keys
      expect(mockGetItem).toHaveBeenCalledWith('_docs_variant_pref:packageManager');
    });

    it('should allow sharing preferences across different variant sets with same variantType', () => {
      // Mock localStorage to return a stored preference
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

      // Set up localStorage to return 'npm' preference
      mockGetItem.mockReturnValue('npm');

      // First set of variants (npm, yarn, pnpm)
      const effectiveCode1 = {
        npm: { source: 'npm install', fileName: 'install.sh' },
        yarn: { source: 'yarn install', fileName: 'install.sh' },
        pnpm: { source: 'pnpm install', fileName: 'install.sh' },
      };

      const { result: result1 } = renderHook(() =>
        useVariantSelection({ effectiveCode: effectiveCode1, variantType: 'packageManager' }),
      );

      // Should read from localStorage and select 'npm'
      expect(mockGetItem).toHaveBeenCalledWith('_docs_variant_pref:packageManager');
      expect(result1.current.selectedVariantKey).toBe('npm');

      // Clear previous calls
      mockGetItem.mockClear();

      // Second set of variants (different names but same variantType)
      const effectiveCode2 = {
        npm: { source: 'npm run build', fileName: 'build.sh' },
        yarn: { source: 'yarn build', fileName: 'build.sh' },
        pnpm: { source: 'pnpm build', fileName: 'build.sh' },
      };

      const { result: result2 } = renderHook(() =>
        useVariantSelection({ effectiveCode: effectiveCode2, variantType: 'packageManager' }),
      );

      // Should use the same localStorage key and preference
      expect(mockGetItem).toHaveBeenCalledWith('_docs_variant_pref:packageManager');
      expect(result2.current.selectedVariantKey).toBe('npm');
    });

    it('should save selections under variantType key', () => {
      // Mock localStorage
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

      const effectiveCode = {
        npm: { source: 'npm install', fileName: 'install.sh' },
        yarn: { source: 'yarn install', fileName: 'install.sh' },
        pnpm: { source: 'pnpm install', fileName: 'install.sh' },
      };

      const { result } = renderHook(() =>
        useVariantSelection({ effectiveCode, variantType: 'packageManager' }),
      );

      // Clear any previous calls
      vi.clearAllMocks();

      // User selects a variant
      act(() => {
        result.current.selectVariant('yarn');
      });

      // Should save under the variantType key
      expect(mockSetItem).toHaveBeenCalledWith('_docs_variant_pref:packageManager', 'yarn');
    });

    it('should fallback to variant keys when variantType is not provided', () => {
      // Mock localStorage
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

      const effectiveCode = {
        Default: { source: 'const x = 1;', fileName: 'test.js' },
        Alternative: { source: 'let x = 1;', fileName: 'test.js' },
      };

      // Don't provide variantType - should use variant keys
      renderHook(() => useVariantSelection({ effectiveCode }));

      // Should use sorted variant keys for localStorage key
      expect(mockGetItem).toHaveBeenCalledWith('_docs_variant_pref:Alternative:Default');
    });

    it('should fallback to variant keys when variantType is empty or falsy', () => {
      // Mock localStorage
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

      const effectiveCode = {
        Default: { source: 'const x = 1;', fileName: 'test.js' },
        Alternative: { source: 'let x = 1;', fileName: 'test.js' },
      };

      // Use empty string as variantType - should fallback to variant keys
      const { result } = renderHook(() => useVariantSelection({ effectiveCode, variantType: '' }));

      // Should fallback to using variant keys since empty string is falsy
      expect(mockGetItem).toHaveBeenCalledWith('_docs_variant_pref:Alternative:Default');
      expect(result.current.selectedVariantKey).toBe('Default'); // Should fallback to first variant
    });

    it('should work with single variant and variantType', () => {
      // Mock localStorage
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

      const effectiveCode = {
        Default: { source: 'const x = 1;', fileName: 'test.js' },
        // Only one variant
      };

      const { result } = renderHook(() =>
        useVariantSelection({ effectiveCode, variantType: 'singleType' }),
      );

      // Should use the variantType even with single variant
      expect(mockGetItem).toHaveBeenCalledWith('_docs_variant_pref:singleType');
      expect(result.current.selectedVariantKey).toBe('Default');
    });
  });

  describe('stability and re-render behavior', () => {
    it('should not cause excessive re-renders when selectVariant is called multiple times with same value', () => {
      const effectiveCode = {
        Default: { source: 'const x = 1;', fileName: 'test.js' },
        Alternative: { source: 'let x = 1;', fileName: 'test.js' },
      };

      let callCount = 0;
      const { result } = renderHook(() => {
        callCount += 1;
        return useVariantSelection({ effectiveCode });
      });

      expect(result.current.selectedVariantKey).toBe('Default');
      const initialCalls = callCount;

      // Call selectVariant multiple times with the same value
      // This could happen with URL hash changes or user interactions
      act(() => {
        result.current.selectVariant('Default');
      });

      act(() => {
        result.current.selectVariant('Default');
      });

      act(() => {
        result.current.selectVariant('Default');
      });

      // Should not cause excessive re-renders when setting the same value repeatedly
      const totalNewCalls = callCount - initialCalls;
      // Allow some re-renders for the localStorage updates, but not hundreds
      expect(totalNewCalls).toBeLessThan(10);

      // Verify state is still correct
      expect(result.current.selectedVariantKey).toBe('Default');
    });
  });
});
