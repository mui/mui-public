/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// vitest globals aren't enabled in this project, so @testing-library/react's
// auto-cleanup `afterEach` never registers; we need to clean up manually to
// unmount the previous render's `useCoordinated` peer between tests.
// eslint-disable-next-line testing-library/no-manual-cleanup
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { useVariantSelection } from './useVariantSelection';

// Mock the useUrlHashState hook to prevent browser API issues
// JSDOM doesn't fully support hash change events, so we mock this to control hash values in tests
let mockHashValue: string | null = null;
let mockSetHash = vi.fn();

vi.mock('../useUrlHashState', () => ({
  useUrlHashState: () => [mockHashValue, mockSetHash],
}));

describe('useVariantSelection', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();
    mockHashValue = null;
    mockSetHash = vi.fn();
  });

  afterEach(() => {
    // Explicit cleanup so the previous render's `useCoordinated`
    // peer registration unsubscribes before the next test mounts —
    // otherwise its lingering `usePreference` subscription keeps
    // reading `window.localStorage.getItem` from the prior key after
    // the next test replaces the global mock.
    cleanup();
  });

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

    it('should prioritize URL hash over localStorage', () => {
      // Set hash BEFORE setting up localStorage and rendering
      mockHashValue = 'demo:java-script:demo.js';

      // Mock localStorage to return TypeScript preference
      const mockGetItem = vi.fn((key) => {
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

      const effectiveCode = {
        JavaScript: { source: 'const x = 1;', fileName: 'demo.js' },
        TypeScript: { source: 'const x: number = 1;', fileName: 'demo.ts' },
      };

      const { result } = renderHook(() => useVariantSelection({ effectiveCode, mainSlug: 'demo' }));

      // Should prioritize hash and ignore localStorage
      expect(result.current.selectedVariantKey).toBe('JavaScript');
      expect(mockGetItem).toHaveBeenCalledWith('_docs_variant_pref:JavaScript:TypeScript');
    });

    it('does not latch pendingBootstrap when the URL hash overrides a conflicting saved preference', () => {
      // Regression: previously `pendingBootstrap` was derived purely
      // from `storedValue !== committedVariantKey`, so a permalinked
      // demo whose user had a different saved preference would stay
      // in pendingBootstrap forever (no bootstrap commit ever fires
      // when the hash wins). `useCode` translates that into
      // `shouldHighlight=false` for the lifetime of the demo,
      // regressing hash-selected demos into permanently unhighlighted
      // code.
      mockHashValue = 'demo:java-script:demo.js';

      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: (key: string) =>
            key === '_docs_variant_pref:JavaScript:TypeScript' ? 'TypeScript' : null,
          setItem: vi.fn(),
        },
        writable: true,
        configurable: true,
      });

      const effectiveCode = {
        JavaScript: { source: 'const x = 1;', fileName: 'demo.js' },
        TypeScript: { source: 'const x: number = 1;', fileName: 'demo.ts' },
      };

      const { result } = renderHook(() => useVariantSelection({ effectiveCode, mainSlug: 'demo' }));

      expect(result.current.selectedVariantKey).toBe('JavaScript');
      // Hash takes precedence over the saved 'TypeScript' preference,
      // so no stored-preference bootstrap is in flight — the gate
      // must release immediately rather than latching forever.
      expect(result.current.pendingBootstrap).toBe(false);
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

  describe('variantSwapDelay', () => {
    it('keeps committedVariant lagging behind the pending key until the delay elapses', () => {
      vi.useFakeTimers();
      try {
        const effectiveCode = {
          Default: { source: 'const x = 1;', fileName: 'test.js' },
          Alternative: { source: 'let x = 1;', fileName: 'test.js' },
        };

        const { result } = renderHook(() =>
          useVariantSelection({ effectiveCode, variantSwapDelay: 100 }),
        );

        expect(result.current.selectedVariantKey).toBe('Default');
        expect(result.current.committedVariantKey).toBe('Default');
        expect(result.current.variantSwappingPhase).toBe(null);
        expect(result.current.swapPartnerVariantKey).toBe(null);

        act(() => {
          result.current.selectVariant('Alternative');
        });

        // UI controls reflect the click immediately; the rendered tree
        // (committedVariant) stays on the previous variant during the
        // pre-swap window.
        expect(result.current.selectedVariantKey).toBe('Alternative');
        expect(result.current.committedVariantKey).toBe('Default');
        expect(result.current.variantSwappingPhase).toBe('collapsed');
        expect(result.current.swapPartnerVariantKey).toBe('Alternative');

        act(() => {
          vi.advanceTimersByTime(99);
        });
        expect(result.current.committedVariantKey).toBe('Default');
        expect(result.current.variantSwappingPhase).toBe('collapsed');

        act(() => {
          vi.advanceTimersByTime(1);
        });
        // Swap commits; the post-swap window opens with the previously-
        // committed variant captured as the bridge partner.
        expect(result.current.committedVariantKey).toBe('Alternative');
        expect(result.current.variantSwappingPhase).toBe('expanded');
        expect(result.current.swapPartnerVariantKey).toBe('Default');

        act(() => {
          vi.advanceTimersByTime(100);
        });
        expect(result.current.variantSwappingPhase).toBe(null);
        expect(result.current.swapPartnerVariantKey).toBe(null);
      } finally {
        vi.useRealTimers();
      }
    });

    it('advances from paused to active phase when notifyVariantTransitionReady fires', () => {
      vi.useFakeTimers();
      try {
        const effectiveCode = {
          Default: { source: 'const x = 1;', fileName: 'test.js' },
          Alternative: { source: 'let x = 1;', fileName: 'test.js' },
        };

        const { result } = renderHook(() =>
          useVariantSelection({ effectiveCode, variantSwapDelay: 100 }),
        );

        act(() => {
          result.current.selectVariant('Alternative');
        });
        expect(result.current.variantSwappingPhase).toBe('collapsed');

        act(() => {
          result.current.notifyVariantTransitionReady();
        });
        expect(result.current.variantSwappingPhase).toBe('expanding');

        act(() => {
          vi.advanceTimersByTime(100);
        });
        expect(result.current.variantSwappingPhase).toBe('expanded');

        act(() => {
          result.current.notifyVariantTransitionReady();
        });
        expect(result.current.variantSwappingPhase).toBe('collapsing');

        act(() => {
          vi.advanceTimersByTime(100);
        });
        expect(result.current.variantSwappingPhase).toBe(null);
      } finally {
        vi.useRealTimers();
      }
    });

    it('falls back to the paused value when a new swap supersedes mid-window', () => {
      vi.useFakeTimers();
      try {
        const effectiveCode = {
          Default: { source: 'const x = 1;', fileName: 'test.js' },
          Alternative: { source: 'let x = 1;', fileName: 'test.js' },
          Third: { source: 'var x = 1;', fileName: 'test.js' },
        };

        const { result } = renderHook(() =>
          useVariantSelection({ effectiveCode, variantSwapDelay: 100 }),
        );

        act(() => {
          result.current.selectVariant('Alternative');
        });
        act(() => {
          result.current.notifyVariantTransitionReady();
        });
        expect(result.current.variantSwappingPhase).toBe('expanding');

        // Supersede with a different target — window key flips, so
        // readiness drops without an explicit reset.
        act(() => {
          result.current.selectVariant('Third');
        });
        expect(result.current.variantSwappingPhase).toBe('collapsed');
      } finally {
        vi.useRealTimers();
      }
    });

    it('commits synchronously when variantSwapDelay is not configured', () => {
      const effectiveCode = {
        Default: { source: 'const x = 1;', fileName: 'test.js' },
        Alternative: { source: 'let x = 1;', fileName: 'test.js' },
      };

      const { result } = renderHook(() => useVariantSelection({ effectiveCode }));

      act(() => {
        result.current.selectVariant('Alternative');
      });

      expect(result.current.selectedVariantKey).toBe('Alternative');
      expect(result.current.committedVariantKey).toBe('Alternative');
      expect(result.current.variantSwappingPhase).toBe(null);
      expect(result.current.swapPartnerVariantKey).toBe(null);
    });

    it('defers an interactive variant swap until the highlighter is ready', async () => {
      vi.useFakeTimers();
      try {
        const effectiveCode = {
          Default: { source: 'const x = 1;', fileName: 'test.js' },
          Alternative: { source: 'let x = 1;', fileName: 'test.js' },
        };

        const { result, rerender } = renderHook(
          ({ deferHighlight }: { deferHighlight: boolean }) =>
            useVariantSelection({ effectiveCode, variantSwapDelay: 100, deferHighlight }),
          { initialProps: { deferHighlight: true } },
        );

        expect(result.current.committedVariantKey).toBe('Default');

        // Originator click while the highlighter is still pending.
        // `selectedVariantKey` (intent) updates immediately so the
        // tabs/dropdown stay responsive, but the rendered tree
        // (committed key) must stay on the outgoing variant until
        // both the swap delay AND the highlight gate have settled.
        act(() => {
          result.current.selectVariant('Alternative');
        });
        expect(result.current.selectedVariantKey).toBe('Alternative');
        expect(result.current.committedVariantKey).toBe('Default');
        expect(result.current.variantSwappingPhase).toBe('collapsed');

        // Drain the `variantSwapDelay` window — the barrier's
        // `minWaitMs` is satisfied, but the preload promise is still
        // awaiting the gate, so the swap must NOT have committed.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(200);
        });
        expect(result.current.committedVariantKey).toBe('Default');
        expect(result.current.variantSwappingPhase).toBe('collapsed');

        // Highlighter resolves — preload promise settles on the next
        // microtask, the barrier collects the result, and the commit
        // lands with the post-swap `'expanded'` window opening.
        rerender({ deferHighlight: false });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });

        expect(result.current.committedVariantKey).toBe('Alternative');
        expect(result.current.variantSwappingPhase).toBe('expanded');
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
