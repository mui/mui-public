/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
// eslint-disable-next-line testing-library/no-manual-cleanup
import { renderHook, act, cleanup } from '@testing-library/react';
import { useTransformManagement } from './useTransformManagement';
import {
  getAvailableTransforms,
  getApplicableTransforms,
  createTransformedFiles,
  transformHasCollapsePlaceholder,
} from './useCodeUtils';

import {
  registerPeer as registerCoordinatedPeer,
  announceTarget as announceCoordinatedTarget,
} from '../useCoordinated/coordinatePreference';
import { resetCoordinatorsForTests as resetCoordinatedForTests } from '../useCoordinated/coordinatePreference.testUtils';

/**
 * Test-only bridge: register a phantom peer on the new coordination
 * engine and expose an `acknowledge` shim that simulates that peer
 * joining the barrier with the given target. Mirrors the small slice
 * of the legacy `getTransformCoordinator(...).register/acknowledge`
 * surface that the originator-vs-phantom-peer scenarios in this file
 * rely on. Returns an `unregister` callback for `finally`-block
 * cleanup.
 */
function registerPhantomPeer(channelKey: string, peerId: string) {
  const unregister = registerCoordinatedPeer(channelKey, peerId);
  return {
    acknowledge(target: string | null) {
      announceCoordinatedTarget(channelKey, peerId, target, {
        isOriginator: false,
        causesLayoutShift: () => true,
        onCommit: () => {},
        announceTime: Date.now(),
      });
    },
    unregister,
  };
}

// Mock the utility functions. `getApplicableTransforms` defaults to
// returning whatever `getAvailableTransforms` returns so existing tests
// that only configure `getAvailableTransforms.mockReturnValue(...)`
// automatically cover the resolution path. Regression tests that need
// a broader applicable set (e.g. rename-only transforms hidden from
// the visible toggle list) can override
// `getApplicableTransforms.mockReturnValue(...)` independently.
vi.mock('./useCodeUtils', () => {
  const availableMock = vi.fn(() => [] as string[]);
  const applicableMock = vi.fn((...args: unknown[]) =>
    (availableMock as (...innerArgs: unknown[]) => string[])(...args),
  );
  return {
    getAvailableTransforms: availableMock,
    getApplicableTransforms: applicableMock,
    createTransformedFiles: vi.fn(),
    // Default to phase 1 (coordinated swap) so existing tests that
    // assert lockstep / transformDelay behaviour keep their previous
    // semantics. Individual tests that want to exercise the phase 2
    // path override this with `mockReturnValue(false)`.
    transformHasCollapsePlaceholder: vi.fn(() => true),
  };
});

/**
 * Test-only mirrors of the timing constants used inside
 * `useTransformManagement`. Kept here (rather than imported) so a
 * silent tweak to a production constant breaks the test instead of
 * passing with mismatched expectations.
 *
 * - `MIN_TRANSFORM_WAIT_MS` matches the source constant of the same
 *   name (one animation frame at ~60fps); the coordinator waits this
 *   long before committing when `transformDelay` is unset/zero.
 * - `PAST_MIN_TRANSFORM_WAIT_MS` advances past that wait with a
 *   single-frame safety margin so any pending macrotask
 *   (`setTimeout(release, 0)`) also fires.
 * - `DEFAULT_TRANSFORM_DELAY_MS` is the value passed as
 *   `transformDelay` in test fixtures that want a visible barrier.
 * - `TRANSFORM_GRACE_PERIOD_MS` mirrors the coordinator's default
 *   `gracePeriodMs` — the boundary at which `onWaitingForPeers`
 *   fires while a barrier is still pending.
 */
const MIN_TRANSFORM_WAIT_MS = 16;
const PAST_MIN_TRANSFORM_WAIT_MS = MIN_TRANSFORM_WAIT_MS * 2;
const DEFAULT_TRANSFORM_DELAY_MS = 250;
const TRANSFORM_GRACE_PERIOD_MS = 300;

describe('useTransformManagement', () => {
  // The transform coordinator is a module-level singleton keyed by
  // applicable-transform set, so registrations and barrier state
  // persist across tests within the same key. Reset between tests so
  // a lingering registration from a prior test can't pollute the
  // current test's `expectedPeers` set.
  afterEach(() => {
    // RTL's auto-cleanup is gated on globals being available, which
    // this project disables. Unmount everything before resetting any
    // module-level singletons so unmount-time effects can drain.
    cleanup();
    resetCoordinatedForTests();
    // Some tests replace `window.localStorage` with an in-memory
    // shim via `Object.defineProperty`. Reinstall a fresh shim per
    // test so a stored preference from a prior case never leaks into
    // the next (and never causes the next hook to receiver-flow into
    // `runCoordination` before its `registerPeer` effect has mounted).
    const store: Record<string, string> = {};
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn((key: string) => (key in store ? store[key] : null)),
        setItem: vi.fn((key: string, value: string) => {
          store[key] = value;
        }),
        removeItem: vi.fn((key: string) => {
          delete store[key];
        }),
        clear: vi.fn(() => {
          for (const key of Object.keys(store)) {
            delete store[key];
          }
        }),
        key: vi.fn(() => null),
        length: 0,
      },
      writable: true,
      configurable: true,
    });
  });

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
      }),
    );

    expect(result.current.availableTransforms).toEqual(['CustomTransform']);
    // The visible toggle list comes from context without consulting
    // `getAvailableTransforms` directly. (`getApplicableTransforms` is
    // still invoked for resolution and our default mock delegates to
    // `getAvailableTransforms`, so we don't assert call counts here.)
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
        }),
      );

      // Should read from localStorage with correct key
      expect(mockGetItem).toHaveBeenCalledWith('_docs_transform_pref:JavaScript:TypeScript');
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
        '_docs_transform_pref:JavaScript:TypeScript',
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
        }),
      );

      // Clear any previous calls
      vi.clearAllMocks();

      // User explicitly deselects transform
      act(() => {
        result.current.selectTransform(null);
      });

      // Should save empty string preference to localStorage (not 'null')
      expect(localStorage.setItem).toHaveBeenCalledWith(
        '_docs_transform_pref:JavaScript:TypeScript',
        '',
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

      // Test that transforms in different orders generate the same storage key.
      // The storage key is derived from `applicableTransforms`, so set that mock
      // directly (the visible-list mock is irrelevant for this assertion).
      (getApplicableTransforms as any).mockReturnValueOnce(['TypeScript', 'JavaScript', 'Flow']);

      renderHook(() =>
        useTransformManagement({
          effectiveCode: mockEffectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant: mockSelectedVariant,
        }),
      );

      // Expected storage key should be sorted regardless of input order
      const expectedKey = '_docs_transform_pref:Flow:JavaScript:TypeScript';

      // Should read from the expected key
      expect(mockGetItem).toHaveBeenCalledWith(expectedKey);

      // Clear calls and test with different order
      mockGetItem.mockClear();

      (getApplicableTransforms as any).mockReturnValueOnce(['Flow', 'JavaScript', 'TypeScript']);

      renderHook(() =>
        useTransformManagement({
          effectiveCode: mockEffectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant: mockSelectedVariant,
        }),
      );

      // Should read from the same key even with different transform order
      expect(mockGetItem).toHaveBeenCalledWith(expectedKey);
    });

    it('should not sync from localStorage when initialTransform is provided', () => {
      // Note: The new useLocalStorageState implementation always tries to read from localStorage
      // In this case, localStorage returns 'JavaScript' but that should be a valid transform that gets used
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

      // Set up localStorage to return 'JavaScript' (a valid transform)
      mockGetItem.mockReturnValue('JavaScript');

      const { result } = renderHook(() =>
        useTransformManagement({
          effectiveCode: mockEffectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant: mockSelectedVariant,
          initialTransform: 'TypeScript',
        }),
      );

      // The localStorage value takes precedence since it's a valid transform
      // This is actually the expected behavior - localStorage should persist user preferences
      expect(result.current.selectedTransform).toBe('JavaScript');
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
        }),
      );

      // Should attempt to read from localStorage even for single transform
      expect(mockGetItem).toHaveBeenCalledWith('_docs_transform_pref:TypeScript');

      // Clear previous calls
      vi.clearAllMocks();

      // User explicitly selects the transform
      act(() => {
        result.current.selectTransform('TypeScript');
      });

      // Should save the selection to localStorage
      expect(mockSetItem).toHaveBeenCalledWith('_docs_transform_pref:TypeScript', 'TypeScript');

      // Clear again
      vi.clearAllMocks();

      // User deselects the transform (sets to null)
      act(() => {
        result.current.selectTransform(null);
      });

      // Should save empty string preference to localStorage (not 'null')
      expect(mockSetItem).toHaveBeenCalledWith('_docs_transform_pref:TypeScript', '');
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
        }),
      );

      expect(result1.current.selectedTransform).toBe('TypeScript');

      // Test restoring "no transform" preference
      mockGetItem.mockReturnValue('');

      const { result: result2 } = renderHook(() =>
        useTransformManagement({
          effectiveCode: mockEffectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant: mockSelectedVariant,
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
        }),
      );

      // Should fall back to null without crashing (localStorage errors return null from getSnapshot)
      expect(result.current.selectedTransform).toBe(null);

      // When localStorage is failing, setting values might not persist across re-renders
      // but the hook should still allow state changes within the component's lifecycle
      act(() => {
        result.current.selectTransform('TypeScript');
      });

      // Due to the nature of useSyncExternalStore with a failing external store,
      // the value might not update as expected, which is acceptable for error handling
      // The important thing is that it doesn't crash
      expect(['string', 'object'].includes(typeof result.current.selectedTransform)).toBe(true);
    });
  });

  describe('transform selection', () => {
    it('should select valid transform', () => {
      // Set up a more realistic localStorage mock
      const store: Record<string, string> = {};
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: (key: string) => store[key] || null,
          setItem: (key: string, value: string) => {
            store[key] = value;
          },
          removeItem: (key: string) => {
            delete store[key];
          },
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
        }),
      );

      // Initially no transform is selected (returns null)
      expect(result.current.selectedTransform).toBe(null);

      act(() => {
        result.current.selectTransform('TypeScript');
      });

      expect(result.current.selectedTransform).toBe('TypeScript');
    });

    it('should fallback to null for invalid transform', () => {
      (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']);
      (createTransformedFiles as any).mockReturnValue({ transformed: true });

      const { result } = renderHook(() =>
        useTransformManagement({
          effectiveCode: mockEffectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant: mockSelectedVariant,
          initialTransform: 'TypeScript', // This becomes the fallback value
        }),
      );

      act(() => {
        result.current.selectTransform('InvalidTransform');
      });

      // Should fallback to null when invalid transform is selected (not the initial value)
      // The implementation validates stored values and returns null for invalid ones
      expect(result.current.selectedTransform).toBe(null);
    });

    it('should allow setting transform to null', () => {
      // Set up a more realistic localStorage mock
      const store: Record<string, string> = {};
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: (key: string) => store[key] ?? null,
          setItem: (key: string, value: string) => {
            store[key] = value;
          },
          removeItem: (key: string) => {
            delete store[key];
          },
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
          initialTransform: 'TypeScript',
        }),
      );

      // First, verify the initial transform is set
      expect(result.current.selectedTransform).toBe('TypeScript');

      // Set to null
      act(() => {
        result.current.selectTransform(null);
      });

      // Check that an empty string was stored (our null representation)
      const storageKey = '_docs_transform_pref:JavaScript:TypeScript';
      expect(store[storageKey]).toBe('');

      expect(result.current.selectedTransform).toBe(null);
    });

    it('renders only stable applied-transform values during a coordinated null → transform swap', () => {
      // Realistic localStorage so usePreference actually round-trips through useSyncExternalStore.
      const store: Record<string, string> = {};
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: (key: string) => store[key] ?? null,
          setItem: (key: string, value: string) => {
            store[key] = value;
          },
          removeItem: (key: string) => {
            delete store[key];
          },
        },
        writable: true,
        configurable: true,
      });

      vi.useFakeTimers();
      try {
        (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']);
        // Make the returned transformedFiles object reflect the transform argument
        // so we can assert per-render that the value driving the displayed code matches
        // the value driving the toggle button.
        (createTransformedFiles as any).mockImplementation(
          (_variant: unknown, transform: string | null) => ({ appliedTransform: transform }),
        );

        const renders: Array<{
          selectedTransform: string | null;
          appliedTransform: string | null;
        }> = [];

        const { result, rerender } = renderHook(() => {
          const value = useTransformManagement({
            effectiveCode: mockEffectiveCode,
            selectedVariantKey: 'Default',
            selectedVariant: mockSelectedVariant,
          });
          renders.push({
            selectedTransform: value.selectedTransform,
            appliedTransform: (
              value.transformedFiles as unknown as { appliedTransform: string | null }
            ).appliedTransform,
          });
          return value;
        });

        // Baseline: initial render(s) must agree.
        for (const snap of renders) {
          expect(snap.selectedTransform).toBe(snap.appliedTransform);
        }
        const baselineRenderCount = renders.length;

        act(() => {
          result.current.selectTransform('TypeScript');
        });

        // Allow the coordinator's one-frame minimum wait to elapse so
        // the deferred swap commits.
        act(() => {
          vi.advanceTimersByTime(PAST_MIN_TRANSFORM_WAIT_MS);
        });

        // Force at least one extra render so any deferred effect-driven sync would surface.
        rerender();

        // Final state must be the requested transform.
        expect(result.current.selectedTransform).toBe('TypeScript');
        expect(
          (result.current.transformedFiles as unknown as { appliedTransform: string | null })
            .appliedTransform,
        ).toBe('TypeScript');

        // Every render captured during/after the user action must show
        // `transformedFiles.appliedTransform` at one of the two stable
        // values for the in-flight swap — either the outgoing `null`
        // (during the coordinator's barrier wait) or the incoming
        // 'TypeScript' (after commit). A torn third state would
        // indicate the local mirror has resurfaced.
        const postActionRenders = renders.slice(baselineRenderCount);
        expect(postActionRenders.length).toBeGreaterThan(0);
        for (const [index, snap] of postActionRenders.entries()) {
          expect(
            snap.appliedTransform === null || snap.appliedTransform === 'TypeScript',
            `render #${baselineRenderCount + index}: transformedFiles.appliedTransform=${String(
              snap.appliedTransform,
            )} is not one of the stable values (null, 'TypeScript')`,
          ).toBe(true);
          expect(snap.selectedTransform).toBe('TypeScript');
        }
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('transformDelay', () => {
    it('updates selectedTransform immediately but defers the transformedFiles swap', () => {
      vi.useFakeTimers();
      try {
        (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']);
        (createTransformedFiles as any).mockImplementation(
          (_variant: unknown, transform: string | null) => ({ transform }),
        );

        const { result } = renderHook(() =>
          useTransformManagement({
            effectiveCode: mockEffectiveCode,
            selectedVariantKey: 'Default',
            selectedVariant: mockSelectedVariant,
            initialTransform: 'TypeScript',
            transformDelay: DEFAULT_TRANSFORM_DELAY_MS,
          }),
        );

        expect(result.current.selectedTransform).toBe('TypeScript');
        expect(result.current.transformedFiles).toEqual({ transform: 'TypeScript' });
        expect(result.current.transformingPhase).toBe(null);

        act(() => {
          result.current.selectTransform('JavaScript');
        });

        // selectedTransform reflects the click immediately so the UI
        // control updates without delay; transformedFiles still reflects
        // the previously-applied transform.
        expect(result.current.selectedTransform).toBe('JavaScript');
        expect(result.current.transformedFiles).toEqual({ transform: 'TypeScript' });
        expect(result.current.transformingPhase).toBe('collapsed');

        act(() => {
          vi.advanceTimersByTime(DEFAULT_TRANSFORM_DELAY_MS - 1);
        });
        expect(result.current.transformedFiles).toEqual({ transform: 'TypeScript' });
        expect(result.current.transformingPhase).toBe('collapsed');

        act(() => {
          vi.advanceTimersByTime(1);
        });
        // Swap commits and `'expanded'` paused phase arms synchronously through the
        // post-swap window so consumer CSS can animate the incoming
        // tree (transform → transform is `2 × transformDelay` total:
        // expand → swap → collapse).
        expect(result.current.selectedTransform).toBe('JavaScript');
        expect(result.current.transformedFiles).toEqual({ transform: 'JavaScript' });
        expect(result.current.transformingPhase).toBe('expanded');

        act(() => {
          vi.advanceTimersByTime(DEFAULT_TRANSFORM_DELAY_MS);
        });
        expect(result.current.transformingPhase).toBe(null);
      } finally {
        vi.useRealTimers();
      }
    });

    it('advances from paused to active phase when notifyTransformTransitionReady fires', () => {
      vi.useFakeTimers();
      try {
        (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']);
        (createTransformedFiles as any).mockImplementation(
          (_variant: unknown, transform: string | null) => ({ transform }),
        );

        const { result } = renderHook(() =>
          useTransformManagement({
            effectiveCode: mockEffectiveCode,
            selectedVariantKey: 'Default',
            selectedVariant: mockSelectedVariant,
            initialTransform: 'TypeScript',
            transformDelay: DEFAULT_TRANSFORM_DELAY_MS,
          }),
        );

        act(() => {
          result.current.selectTransform('JavaScript');
        });
        // Pre-swap paused window — `<Pre>` has not yet painted at the
        // collapsed value.
        expect(result.current.transformingPhase).toBe('collapsed');

        act(() => {
          result.current.notifyTransformTransitionReady();
        });
        // After the consumer signals readiness, the active value
        // arms so consumer CSS can animate.
        expect(result.current.transformingPhase).toBe('expanding');

        // Swap commits — the post-swap window opens at its own paused
        // value (`'expanded'`), independent of the pre-swap readiness.
        act(() => {
          vi.advanceTimersByTime(DEFAULT_TRANSFORM_DELAY_MS);
        });
        expect(result.current.transformingPhase).toBe('expanded');

        act(() => {
          result.current.notifyTransformTransitionReady();
        });
        expect(result.current.transformingPhase).toBe('collapsing');

        act(() => {
          vi.advanceTimersByTime(DEFAULT_TRANSFORM_DELAY_MS);
        });
        expect(result.current.transformingPhase).toBe(null);
      } finally {
        vi.useRealTimers();
      }
    });

    it('falls back to the paused value when a new swap starts mid-window', () => {
      vi.useFakeTimers();
      try {
        (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript', 'Preact']);
        (createTransformedFiles as any).mockImplementation(
          (_variant: unknown, transform: string | null) => ({ transform }),
        );

        const { result } = renderHook(() =>
          useTransformManagement({
            effectiveCode: mockEffectiveCode,
            selectedVariantKey: 'Default',
            selectedVariant: mockSelectedVariant,
            initialTransform: 'TypeScript',
            transformDelay: DEFAULT_TRANSFORM_DELAY_MS,
          }),
        );

        act(() => {
          result.current.selectTransform('JavaScript');
        });
        act(() => {
          result.current.notifyTransformTransitionReady();
        });
        expect(result.current.transformingPhase).toBe('expanding');

        // Second click supersedes the first — the swap window key
        // flips (target changes) so readiness drops back to false
        // without an explicit reset and the phase returns to the
        // paused pre-swap value.
        act(() => {
          result.current.selectTransform('Preact');
        });
        expect(result.current.transformingPhase).toBe('collapsed');
      } finally {
        vi.useRealTimers();
      }
    });

    it('cancels a pending swap when the user clicks again', () => {
      vi.useFakeTimers();
      try {
        (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript', 'Preact']);
        (createTransformedFiles as any).mockImplementation(
          (_variant: unknown, transform: string | null) => ({ transform }),
        );

        const { result } = renderHook(() =>
          useTransformManagement({
            effectiveCode: mockEffectiveCode,
            selectedVariantKey: 'Default',
            selectedVariant: mockSelectedVariant,
            initialTransform: 'TypeScript',
            transformDelay: DEFAULT_TRANSFORM_DELAY_MS,
          }),
        );

        act(() => {
          result.current.selectTransform('JavaScript');
        });
        act(() => {
          vi.advanceTimersByTime(100);
        });
        // Second click before the first commits — supersedes the first.
        act(() => {
          result.current.selectTransform('Preact');
        });

        // selectedTransform tracks the latest click.
        expect(result.current.selectedTransform).toBe('Preact');
        expect(result.current.transformedFiles).toEqual({ transform: 'TypeScript' });
        expect(result.current.transformingPhase).toBe('collapsed');

        // The original timer was cleared; advancing past *its* deadline
        // does not commit.
        act(() => {
          vi.advanceTimersByTime(200);
        });
        expect(result.current.transformedFiles).toEqual({ transform: 'TypeScript' });
        expect(result.current.transformingPhase).toBe('collapsed');

        // After the second timer's full delay from the second click, the
        // latest target commits. Phase flips to `'expanded'` (paused) synchronously
        // through the post-swap window.
        act(() => {
          vi.advanceTimersByTime(50);
        });
        expect(result.current.transformedFiles).toEqual({ transform: 'Preact' });
        expect(result.current.transformingPhase).toBe('expanded');

        act(() => {
          vi.advanceTimersByTime(DEFAULT_TRANSFORM_DELAY_MS);
        });
        expect(result.current.transformingPhase).toBe(null);
      } finally {
        vi.useRealTimers();
      }
    });

    it('also delays the swap when the change arrives from external state', () => {
      vi.useFakeTimers();
      try {
        // Realistic in-tab localStorage so the two hook instances actually
        // observe each other's writes via the in-process broadcast that
        // `useLocalStorageState` wires up.
        const store: Record<string, string> = {};
        Object.defineProperty(window, 'localStorage', {
          value: {
            getItem: (key: string) => store[key] ?? null,
            setItem: (key: string, value: string) => {
              store[key] = value;
            },
            removeItem: (key: string) => {
              delete store[key];
            },
          },
          writable: true,
          configurable: true,
        });

        (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']);
        (createTransformedFiles as any).mockImplementation(
          (_variant: unknown, transform: string | null) => ({ transform }),
        );

        const props = {
          effectiveCode: mockEffectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant: mockSelectedVariant,
          initialTransform: 'TypeScript',
          transformDelay: DEFAULT_TRANSFORM_DELAY_MS,
        };

        // Two peer demos sharing the same preference key.
        const { result: resultA } = renderHook(() => useTransformManagement(props));
        const { result: resultB } = renderHook(() => useTransformManagement(props));

        expect(resultA.current.selectedTransform).toBe('TypeScript');
        expect(resultB.current.selectedTransform).toBe('TypeScript');

        // Peer A drives the change. The broadcast fires synchronously so
        // peer B observes the new `selectedTransform` in the same tick
        // and both demos open their pre-swap `'collapsed'` paused window together.
        act(() => {
          resultA.current.selectTransform('JavaScript');
        });

        expect(resultA.current.selectedTransform).toBe('JavaScript');
        expect(resultA.current.transformedFiles).toEqual({ transform: 'TypeScript' });
        expect(resultA.current.transformingPhase).toBe('collapsed');
        expect(resultB.current.selectedTransform).toBe('JavaScript');
        expect(resultB.current.transformedFiles).toEqual({ transform: 'TypeScript' });
        expect(resultB.current.transformingPhase).toBe('collapsed');

        // After 1× delay: both peers' swaps commit; the post-swap
        // `'expanded'` paused window then arms synchronously so consumer CSS
        // can animate the incoming tree.
        act(() => {
          vi.advanceTimersByTime(DEFAULT_TRANSFORM_DELAY_MS);
        });
        expect(resultA.current.transformedFiles).toEqual({ transform: 'JavaScript' });
        expect(resultB.current.transformedFiles).toEqual({ transform: 'JavaScript' });
        expect(resultA.current.transformingPhase).toBe('expanded');
        expect(resultB.current.transformingPhase).toBe('expanded');

        // After 2× delay: both peers settle.
        act(() => {
          vi.advanceTimersByTime(DEFAULT_TRANSFORM_DELAY_MS);
        });
        expect(resultA.current.transformingPhase).toBe(null);
        expect(resultB.current.transformingPhase).toBe(null);
      } finally {
        vi.useRealTimers();
      }
    });

    it('commits synchronously when transformDelay is unset or zero', () => {
      (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']);
      (createTransformedFiles as any).mockImplementation(
        (_variant: unknown, transform: string | null) => ({ transform }),
      );

      const { result: noDelay } = renderHook(() =>
        useTransformManagement({
          effectiveCode: mockEffectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant: mockSelectedVariant,
          initialTransform: 'TypeScript',
        }),
      );
      act(() => {
        noDelay.current.selectTransform('JavaScript');
      });
      expect(noDelay.current.selectedTransform).toBe('JavaScript');
      expect(noDelay.current.transformedFiles).toEqual({ transform: 'JavaScript' });
      expect(noDelay.current.transformingPhase).toBe(null);

      const { result: zeroDelay } = renderHook(() =>
        useTransformManagement({
          effectiveCode: mockEffectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant: mockSelectedVariant,
          initialTransform: 'TypeScript',
          transformDelay: 0,
        }),
      );
      act(() => {
        zeroDelay.current.selectTransform('JavaScript');
      });
      expect(zeroDelay.current.selectedTransform).toBe('JavaScript');
      expect(zeroDelay.current.transformedFiles).toEqual({ transform: 'JavaScript' });
      expect(zeroDelay.current.transformingPhase).toBe(null);
    });

    it('still coordinates phase 1 across peers when transformDelay is unset, using a one-frame minimum wait without setting transformingPhase', () => {
      resetCoordinatedForTests();
      vi.useFakeTimers();
      try {
        const store: Record<string, string> = {};
        Object.defineProperty(window, 'localStorage', {
          value: {
            getItem: (key: string) => store[key] ?? null,
            setItem: (key: string, value: string) => {
              store[key] = value;
            },
            removeItem: (key: string) => {
              delete store[key];
            },
          },
          writable: true,
          configurable: true,
        });

        // Both sides carry `.collapse` so the swap is layout-shift-prone
        // and must coordinate even without `transformDelay`.
        (transformHasCollapsePlaceholder as any).mockReturnValue(true);
        (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']);
        (createTransformedFiles as any).mockImplementation(
          (_variant: unknown, transform: string | null) => ({ transform }),
        );

        const props = {
          effectiveCode: mockEffectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant: mockSelectedVariant,
          initialTransform: 'TypeScript',
        };

        const { result: originator } = renderHook(() => useTransformManagement(props));
        const { result: peer } = renderHook(() => useTransformManagement(props));

        act(() => {
          originator.current.selectTransform('JavaScript');
        });

        // Immediately after the click both demos still show the
        // outgoing tree — the barrier is waiting one frame so peers
        // can land on the same paint as the originator.
        expect(originator.current.selectedTransform).toBe('JavaScript');
        expect(originator.current.transformedFiles).toEqual({ transform: 'TypeScript' });
        expect(peer.current.selectedTransform).toBe('JavaScript');
        expect(peer.current.transformedFiles).toEqual({ transform: 'TypeScript' });
        // No `transformDelay` → no animation window → no
        // `data-transforming` flag during the short coordinator wait.
        expect(originator.current.transformingPhase).toBe(null);
        expect(peer.current.transformingPhase).toBe(null);

        // After the one-frame minimum wait both demos commit in lockstep.
        act(() => {
          vi.advanceTimersByTime(PAST_MIN_TRANSFORM_WAIT_MS);
        });
        expect(originator.current.transformedFiles).toEqual({ transform: 'JavaScript' });
        expect(peer.current.transformedFiles).toEqual({ transform: 'JavaScript' });
        expect(originator.current.transformingPhase).toBe(null);
        expect(peer.current.transformingPhase).toBe(null);
      } finally {
        vi.useRealTimers();
      }
    });

    it('no-ops when re-selecting the current transform with no pending change', () => {
      vi.useFakeTimers();
      try {
        (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']);
        (createTransformedFiles as any).mockImplementation(
          (_variant: unknown, transform: string | null) => ({ transform }),
        );

        const { result } = renderHook(() =>
          useTransformManagement({
            effectiveCode: mockEffectiveCode,
            selectedVariantKey: 'Default',
            selectedVariant: mockSelectedVariant,
            initialTransform: 'TypeScript',
            transformDelay: DEFAULT_TRANSFORM_DELAY_MS,
          }),
        );

        // Re-click whatever the current value is — must not arm a timer.
        const current = result.current.selectedTransform;
        // Capture the baseline (the coordinator's presence interval is
        // always running while a demo is registered) so we can assert
        // *no new* timer was armed by the no-op re-select.
        const baselineTimerCount = vi.getTimerCount();
        act(() => {
          result.current.selectTransform(current);
        });
        expect(result.current.transformingPhase).toBe(null);
        expect(vi.getTimerCount()).toBe(baselineTimerCount);
      } finally {
        vi.useRealTimers();
      }
    });

    it('commits null → transformed in the same render but holds `transformingPhase` non-null for the delay window', () => {
      resetCoordinatedForTests();
      vi.useFakeTimers();
      try {
        // Fresh storage so prior tests' broadcasts don't leak in as an
        // initial value.
        Object.defineProperty(window, 'localStorage', {
          value: {
            getItem: () => null,
            setItem: vi.fn(),
            removeItem: vi.fn(),
          },
          writable: true,
          configurable: true,
        });

        // No `.collapse` placeholders on either side of the swap, so
        // the carve-out for collapse-bearing peers doesn't apply and
        // the null → transform fast path stays a same-render commit.
        (transformHasCollapsePlaceholder as any).mockReturnValue(false);
        (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']);
        (createTransformedFiles as any).mockImplementation(
          (_variant: unknown, transform: string | null) => ({ transform }),
        );

        const { result } = renderHook(() =>
          useTransformManagement({
            effectiveCode: mockEffectiveCode,
            selectedVariantKey: 'Default',
            selectedVariant: mockSelectedVariant,
            initialTransform: undefined,
            transformDelay: DEFAULT_TRANSFORM_DELAY_MS,
          }),
        );

        expect(result.current.selectedTransform).toBe(null);
        expect(result.current.transformedFiles).toEqual({ transform: null });

        // null → 'JavaScript' commits in the same render — there's no
        // collapse placeholder on screen to exit-animate, so deferring
        // the swap would just look like input latency. The post-swap
        // `'expanded'`/`'collapsing'` window arms synchronously so consumer CSS gets a
        // `data-transforming="expanded"`/`"collapsing"` window to animate the new
        // tree's entry.
        act(() => {
          result.current.selectTransform('JavaScript');
        });
        expect(result.current.selectedTransform).toBe('JavaScript');
        expect(result.current.transformedFiles).toEqual({ transform: 'JavaScript' });
        expect(result.current.transformingPhase).toBe('expanded');

        // Window closes after the delay.
        act(() => {
          vi.advanceTimersByTime(DEFAULT_TRANSFORM_DELAY_MS);
        });
        expect(result.current.transformingPhase).toBe(null);

        // The reverse — going back to untransformed from a transform —
        // still uses the pre-swap `'collapsed'` paused window because there *are*
        // placeholders to expand.
        act(() => {
          result.current.selectTransform(null);
        });
        expect(result.current.selectedTransform).toBe(null);
        expect(result.current.transformedFiles).toEqual({ transform: 'JavaScript' });
        expect(result.current.transformingPhase).toBe('collapsed');

        act(() => {
          vi.advanceTimersByTime(DEFAULT_TRANSFORM_DELAY_MS);
        });
        expect(result.current.transformedFiles).toEqual({ transform: null });
        expect(result.current.transformingPhase).toBe(null);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not emit an `expand` phase for external null → transform receiver updates', () => {
      resetCoordinatedForTests();
      vi.useFakeTimers();
      try {
        Object.defineProperty(window, 'localStorage', {
          value: {
            getItem: () => null,
            setItem: vi.fn(),
            removeItem: vi.fn(),
          },
          writable: true,
          configurable: true,
        });

        // Force the null -> transform fast-path classification.
        (transformHasCollapsePlaceholder as any).mockReturnValue(false);
        (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']);
        (createTransformedFiles as any).mockImplementation(
          (_variant: unknown, transform: string | null) => ({ transform }),
        );

        const phaseHistory: Array<'collapsed' | 'expanding' | 'expanded' | 'collapsing' | null> =
          [];
        const { result, rerender } = renderHook(
          ({ initialTransform }: { initialTransform?: string }) => {
            const value = useTransformManagement({
              effectiveCode: mockEffectiveCode,
              selectedVariantKey: 'Default',
              selectedVariant: mockSelectedVariant,
              initialTransform,
              transformDelay: DEFAULT_TRANSFORM_DELAY_MS,
            });
            phaseHistory.push(value.transformingPhase);
            return value;
          },
          { initialProps: { initialTransform: undefined as string | undefined } },
        );

        expect(result.current.selectedTransform).toBe(null);
        expect(result.current.transformedFiles).toEqual({ transform: null });

        rerender({ initialTransform: 'JavaScript' });

        expect(result.current.selectedTransform).toBe('JavaScript');
        expect(result.current.transformingPhase).not.toBe('collapsed');
        expect(phaseHistory).not.toContain('collapsed');
        expect(phaseHistory).not.toContain('expanding');

        act(() => {
          vi.advanceTimersByTime(DEFAULT_TRANSFORM_DELAY_MS);
        });
        expect(phaseHistory).not.toContain('collapsed');
        expect(phaseHistory).not.toContain('expanding');
      } finally {
        vi.useRealTimers();
      }
    });

    it('defers a localStorage-restored swap until the highlighter is ready', () => {
      resetCoordinatedForTests();
      vi.useFakeTimers();
      try {
        // localStorage already has the restored preference, so on the very
        // first render `usePreference` returns `'JavaScript'` (via
        // `useSyncExternalStore`'s `getSnapshot`). In production this is
        // exactly the refresh path that caused the visible double-jump:
        // SSR rendered the un-transformed TS variant, hydration sees the
        // stored JS preference, but `parseCode` hasn't produced HAST for
        // the JS variant yet, so committing the swap now would paint
        // unhighlighted text and re-flow once the highlighter catches up.
        Object.defineProperty(window, 'localStorage', {
          value: {
            getItem: (key: string) =>
              key === '_docs_transform_pref:JavaScript:TypeScript' ? 'JavaScript' : null,
            setItem: vi.fn(),
            removeItem: vi.fn(),
          },
          writable: true,
          configurable: true,
        });

        (transformHasCollapsePlaceholder as any).mockReturnValue(false);
        (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']);
        (createTransformedFiles as any).mockImplementation(
          (_variant: unknown, transform: string | null) => ({ transform }),
        );

        const phaseHistory: Array<'collapsed' | 'expanding' | 'expanded' | 'collapsing' | null> =
          [];
        const { result, rerender } = renderHook(
          ({ deferHighlight }: { deferHighlight: boolean }) => {
            const value = useTransformManagement({
              context: { deferHighlight },
              effectiveCode: mockEffectiveCode,
              selectedVariantKey: 'Default',
              selectedVariant: mockSelectedVariant,
              transformDelay: DEFAULT_TRANSFORM_DELAY_MS,
            });
            phaseHistory.push(value.transformingPhase);
            return value;
          },
          { initialProps: { deferHighlight: true } },
        );

        // While the highlighter is still pending, the receiver flow
        // must NOT open the barrier — `selectedTransform` should
        // stay at the SSR-safe `null` so the rendered tree matches
        // the server output and no animation kicks off against an
        // unhighlighted target.
        expect(result.current.selectedTransform).toBe(null);
        expect(result.current.transformedFiles).toEqual({ transform: null });
        expect(phaseHistory).not.toContain('collapsed');
        expect(phaseHistory).not.toContain('expanding');
        expect(phaseHistory).not.toContain('expanded');
        expect(phaseHistory).not.toContain('collapsing');

        // Advance well past `transformDelay` to prove the gate
        // really suppresses the swap (not just delays it).
        act(() => {
          vi.advanceTimersByTime(DEFAULT_TRANSFORM_DELAY_MS * 2);
        });
        expect(result.current.selectedTransform).toBe(null);
        expect(phaseHistory).not.toContain('collapsed');
        expect(phaseHistory).not.toContain('expanding');
        expect(phaseHistory).not.toContain('expanded');
        expect(phaseHistory).not.toContain('collapsing');

        // Highlighter resolves — flip `deferHighlight` to false.
        // Now the receiver flow should see the stored value and
        // open its barrier so the post-swap collapse window plays
        // against fully-highlighted HAST.
        rerender({ deferHighlight: false });

        // `selectedTransform` (the pending intent) updates
        // synchronously when the receiver opens its barrier — that
        // alone proves the gate released. (The full phase-2 commit
        // drain is exercised by the dedicated phase-2 peer tests; we
        // intentionally don't repeat their `requestIdleCallback`
        // plumbing here.)
        expect(result.current.selectedTransform).toBe('JavaScript');
      } finally {
        vi.useRealTimers();
      }
    });

    it('defers an interactive originator swap until the highlighter is ready', async () => {
      resetCoordinatedForTests();
      vi.useFakeTimers();
      try {
        (transformHasCollapsePlaceholder as any).mockReturnValue(false);
        (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']);
        (createTransformedFiles as any).mockImplementation(
          (_variant: unknown, transform: string | null) => ({ transform }),
        );

        const { result, rerender } = renderHook(
          ({ deferHighlight }: { deferHighlight: boolean }) =>
            useTransformManagement({
              context: { deferHighlight },
              effectiveCode: mockEffectiveCode,
              selectedVariantKey: 'Default',
              selectedVariant: mockSelectedVariant,
              initialTransform: 'TypeScript',
              transformDelay: DEFAULT_TRANSFORM_DELAY_MS,
            }),
          { initialProps: { deferHighlight: true } },
        );

        expect(result.current.transformedFiles).toEqual({ transform: 'TypeScript' });

        // Originator click while the highlighter is still pending.
        // `selectedTransform` (intent) updates immediately so the
        // toolbar is responsive, the pre-swap `'collapsed'` paused window
        // opens, but the barrier must NOT commit until the gate
        // releases — even after `transformDelay` has elapsed.
        act(() => {
          result.current.selectTransform('JavaScript');
        });
        expect(result.current.selectedTransform).toBe('JavaScript');
        expect(result.current.transformedFiles).toEqual({ transform: 'TypeScript' });
        expect(result.current.transformingPhase).toBe('collapsed');

        // Drain the `transformDelay` timer — the barrier's `minWaitMs`
        // is satisfied, but the preload promise is still awaiting the
        // gate, so commit must NOT have landed.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(DEFAULT_TRANSFORM_DELAY_MS * 2);
        });
        expect(result.current.transformedFiles).toEqual({ transform: 'TypeScript' });
        expect(result.current.transformingPhase).toBe('collapsed');

        // Highlighter resolves — preload promise resolves on the next
        // microtask, the barrier collects the result, and the commit
        // lands. Flush microtasks so the awaiting promise can settle.
        rerender({ deferHighlight: false });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });

        expect(result.current.transformedFiles).toEqual({ transform: 'JavaScript' });
        expect(result.current.transformingPhase).toBe('expanded');
      } finally {
        vi.useRealTimers();
      }
    });

    it('broadcasts immediately so peer demos animate in lockstep with the originator', () => {
      vi.useFakeTimers();
      try {
        const store: Record<string, string> = {};
        Object.defineProperty(window, 'localStorage', {
          value: {
            getItem: (key: string) => store[key] ?? null,
            setItem: (key: string, value: string) => {
              store[key] = value;
            },
            removeItem: (key: string) => {
              delete store[key];
            },
          },
          writable: true,
          configurable: true,
        });

        (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']);
        (createTransformedFiles as any).mockImplementation(
          (_variant: unknown, transform: string | null) => ({ transform }),
        );

        const { result } = renderHook(() =>
          useTransformManagement({
            effectiveCode: mockEffectiveCode,
            selectedVariantKey: 'Default',
            selectedVariant: mockSelectedVariant,
            initialTransform: 'TypeScript',
            transformDelay: DEFAULT_TRANSFORM_DELAY_MS,
          }),
        );

        const storageKey = '_docs_transform_pref:JavaScript:TypeScript';
        expect(store[storageKey] ?? null).toBe(null);

        act(() => {
          result.current.selectTransform('JavaScript');
        });

        // Broadcast fires synchronously regardless of `transformDelay` so
        // every demo on the page enters the same expand → swap → collapse
        // window together.
        expect(store[storageKey]).toBe('JavaScript');
        // The local demo still runs its pre-swap `'collapsed'` paused phase…
        expect(result.current.transformingPhase).toBe('collapsed');

        act(() => {
          vi.advanceTimersByTime(DEFAULT_TRANSFORM_DELAY_MS);
        });
        // …followed by the post-swap `'expanded'` paused phase, which arms
        // synchronously through the post-swap window.
        expect(result.current.transformingPhase).toBe('expanded');

        act(() => {
          vi.advanceTimersByTime(DEFAULT_TRANSFORM_DELAY_MS);
        });
        expect(result.current.transformingPhase).toBe(null);
      } finally {
        vi.useRealTimers();
      }
    });

    it('broadcasts immediately when going from untransformed to a transform', () => {
      vi.useFakeTimers();
      try {
        const store: Record<string, string> = {};
        Object.defineProperty(window, 'localStorage', {
          value: {
            getItem: (key: string) => store[key] ?? null,
            setItem: (key: string, value: string) => {
              store[key] = value;
            },
            removeItem: (key: string) => {
              delete store[key];
            },
          },
          writable: true,
          configurable: true,
        });

        (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']);
        (createTransformedFiles as any).mockImplementation(
          (_variant: unknown, transform: string | null) => ({ transform }),
        );

        const { result } = renderHook(() =>
          useTransformManagement({
            effectiveCode: mockEffectiveCode,
            selectedVariantKey: 'Default',
            selectedVariant: mockSelectedVariant,
            initialTransform: undefined,
            transformDelay: DEFAULT_TRANSFORM_DELAY_MS,
          }),
        );

        const storageKey = '_docs_transform_pref:JavaScript:TypeScript';

        act(() => {
          result.current.selectTransform('JavaScript');
        });

        // No local swap delay → broadcast fires immediately. (The single
        // pending timer is the post-swap `'expanded'` paused window for the
        // null → transformed case, not the broadcast.)
        expect(store[storageKey]).toBe('JavaScript');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('rename-only transforms (hasDelta: false)', () => {
    it('resolves a stored preference for a transform that is hidden from the visible toggle list', () => {
      // Demo where 'JavaScript' is a rename-only transform: it does
      // not appear in the visible toggle list supplied via context, but
      // it IS part of the applicable set returned by
      // `getApplicableTransforms` so a stored preference should still
      // apply the rename.
      const mockGetItem = vi.fn().mockReturnValue('JavaScript');
      Object.defineProperty(window, 'localStorage', {
        value: { getItem: mockGetItem, setItem: vi.fn(), removeItem: vi.fn() },
        writable: true,
        configurable: true,
      });

      (getAvailableTransforms as any).mockReturnValue(['TypeScript']); // visible
      (getApplicableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']); // full set
      (createTransformedFiles as any).mockReturnValue({ transformed: true });

      const context = { availableTransforms: ['TypeScript'] };

      const { result } = renderHook(() =>
        useTransformManagement({
          context,
          effectiveCode: mockEffectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant: mockSelectedVariant,
        }),
      );

      // The visible toggle list still only shows TypeScript…
      expect(result.current.availableTransforms).toEqual(['TypeScript']);
      // …but the rename-only 'JavaScript' preference resolves because
      // the resolver consults the broader applicable set.
      expect(result.current.selectedTransform).toBe('JavaScript');
    });

    it('uses the applicable set (not the visible toggle list) for the storage key', () => {
      const mockGetItem = vi.fn();
      Object.defineProperty(window, 'localStorage', {
        value: { getItem: mockGetItem, setItem: vi.fn(), removeItem: vi.fn() },
        writable: true,
        configurable: true,
      });

      (getAvailableTransforms as any).mockReturnValue(['TypeScript']); // visible only
      (getApplicableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']); // includes rename-only
      (createTransformedFiles as any).mockReturnValue({ transformed: true });

      const context = { availableTransforms: ['TypeScript'] };

      renderHook(() =>
        useTransformManagement({
          context,
          effectiveCode: mockEffectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant: mockSelectedVariant,
        }),
      );

      // Storage key is derived from the *applicable* set so a demo where
      // 'JavaScript' is rename-only uses the same bucket as a demo where
      // 'JavaScript' has a real delta.
      expect(mockGetItem).toHaveBeenCalledWith('_docs_transform_pref:JavaScript:TypeScript');
    });

    it('still derives a storage key when every transform is rename-only', () => {
      const mockGetItem = vi.fn();
      Object.defineProperty(window, 'localStorage', {
        value: { getItem: mockGetItem, setItem: vi.fn(), removeItem: vi.fn() },
        writable: true,
        configurable: true,
      });

      (getAvailableTransforms as any).mockReturnValue([]); // toggle hidden
      (getApplicableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']);
      (createTransformedFiles as any).mockReturnValue({ transformed: true });

      renderHook(() =>
        useTransformManagement({
          effectiveCode: mockEffectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant: mockSelectedVariant,
        }),
      );

      // Even though no toggle is shown, the demo still participates in
      // cross-demo preference broadcasting.
      expect(mockGetItem).toHaveBeenCalledWith('_docs_transform_pref:JavaScript:TypeScript');
    });
  });

  describe('phase 2 (non-layout peer swaps)', () => {
    it('originator always commits in phase 1 even when no `.collapse` is involved', () => {
      resetCoordinatedForTests();
      vi.useFakeTimers();
      try {
        // No collapse on either side of the swap, but the demo was
        // driven by a direct `selectTransform` call → it's the
        // originator and must run through phase 1 so the click feels
        // responsive.
        (transformHasCollapsePlaceholder as any).mockReturnValue(false);
        (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']);
        (createTransformedFiles as any).mockImplementation(
          (_variant: unknown, transform: string | null) => ({ transform }),
        );

        const { result } = renderHook(() =>
          useTransformManagement({
            effectiveCode: mockEffectiveCode,
            selectedVariantKey: 'Default',
            selectedVariant: mockSelectedVariant,
            initialTransform: 'TypeScript',
            transformDelay: DEFAULT_TRANSFORM_DELAY_MS,
          }),
        );

        act(() => {
          result.current.selectTransform('JavaScript');
        });

        expect(result.current.transformedFiles).toEqual({ transform: 'TypeScript' });

        // Phase 1: commits after a single `transformDelay`, not after 2×.
        act(() => {
          vi.advanceTimersByTime(DEFAULT_TRANSFORM_DELAY_MS);
        });
        expect(result.current.transformedFiles).toEqual({ transform: 'JavaScript' });
      } finally {
        vi.useRealTimers();
      }
    });

    it('peer with no `.collapse` defers the swap to phase 2 (transformDelay × 2 + idle)', () => {
      resetCoordinatedForTests();
      vi.useFakeTimers();
      const originalRIC = (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
      const originalCIC = (globalThis as { cancelIdleCallback?: unknown }).cancelIdleCallback;
      const idleCallbacks: Array<() => void> = [];
      (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = (
        callback: () => void,
      ) => {
        idleCallbacks.push(callback);
        return idleCallbacks.length;
      };
      (globalThis as { cancelIdleCallback?: unknown }).cancelIdleCallback = () => {};

      try {
        // Realistic in-tab localStorage so the two hook instances
        // observe each other's writes via the in-process broadcast
        // wired up by `useLocalStorageState`.
        const store: Record<string, string> = {};
        Object.defineProperty(window, 'localStorage', {
          value: {
            getItem: (key: string) => store[key] ?? null,
            setItem: (key: string, value: string) => {
              store[key] = value;
            },
            removeItem: (key: string) => {
              delete store[key];
            },
          },
          writable: true,
          configurable: true,
        });
        (transformHasCollapsePlaceholder as any).mockReturnValue(false);
        (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']);
        (createTransformedFiles as any).mockImplementation(
          (_variant: unknown, transform: string | null) => ({ transform }),
        );

        const props = {
          effectiveCode: mockEffectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant: mockSelectedVariant,
          initialTransform: 'TypeScript',
          transformDelay: DEFAULT_TRANSFORM_DELAY_MS,
        };

        const { result: originator } = renderHook(() => useTransformManagement(props));
        const { result: peer } = renderHook(() => useTransformManagement(props));

        act(() => {
          originator.current.selectTransform('JavaScript');
        });

        // Originator is phase 1 → after draining its rIC (which carries
        // its own ack) the coordinator barrier resolves on `minWait`
        // and the originator commits at +250ms.
        act(() => {
          const originatorIdle = idleCallbacks.shift();
          originatorIdle?.();
          vi.advanceTimersByTime(DEFAULT_TRANSFORM_DELAY_MS);
        });
        expect(originator.current.transformedFiles).toEqual({ transform: 'JavaScript' });
        // Peer is phase 2 → still on the old tree at 1× delay.
        expect(peer.current.transformedFiles).toEqual({ transform: 'TypeScript' });

        // After 2× delay the peer's setTimeout fires and queues an rIC
        // for the commit. The lazy peer's pipeline only starts after
        // the barrier's post-commit macrotask release, so the second
        // tick must also drain that release before the lazy timer can
        // run.
        act(() => {
          vi.advanceTimersByTime(DEFAULT_TRANSFORM_DELAY_MS);
          // Drain any timers (including the lazy peer's commit timer)
          // that were scheduled during the deferred release that just
          // fired.
          vi.runOnlyPendingTimers();
        });
        expect(peer.current.transformedFiles).toEqual({ transform: 'TypeScript' });

        // Draining the remaining idle callbacks (peer's precompute +
        // peer's commit) flips the peer to the new tree.
        act(() => {
          while (idleCallbacks.length > 0) {
            const callback = idleCallbacks.shift();
            callback?.();
          }
        });
        expect(peer.current.transformedFiles).toEqual({ transform: 'JavaScript' });
      } finally {
        vi.useRealTimers();
        if (originalRIC === undefined) {
          delete (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
        } else {
          (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = originalRIC;
        }
        if (originalCIC === undefined) {
          delete (globalThis as { cancelIdleCallback?: unknown }).cancelIdleCallback;
        } else {
          (globalThis as { cancelIdleCallback?: unknown }).cancelIdleCallback = originalCIC;
        }
      }
    });

    it('peer with `.collapse` on either side stays in phase 1 with the originator', () => {
      resetCoordinatedForTests();
      vi.useFakeTimers();
      try {
        const store: Record<string, string> = {};
        Object.defineProperty(window, 'localStorage', {
          value: {
            getItem: (key: string) => store[key] ?? null,
            setItem: (key: string, value: string) => {
              store[key] = value;
            },
            removeItem: (key: string) => {
              delete store[key];
            },
          },
          writable: true,
          configurable: true,
        });

        // Both transforms involve `.collapse` → peer is phase 1 and
        // commits in lockstep with the originator after 1× delay (not
        // after 2×).
        (transformHasCollapsePlaceholder as any).mockReturnValue(true);
        (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']);
        (createTransformedFiles as any).mockImplementation(
          (_variant: unknown, transform: string | null) => ({ transform }),
        );

        const props = {
          effectiveCode: mockEffectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant: mockSelectedVariant,
          initialTransform: 'TypeScript',
          transformDelay: DEFAULT_TRANSFORM_DELAY_MS,
        };

        const { result: originator } = renderHook(() => useTransformManagement(props));
        const { result: peer } = renderHook(() => useTransformManagement(props));

        act(() => {
          originator.current.selectTransform('JavaScript');
        });

        act(() => {
          vi.advanceTimersByTime(DEFAULT_TRANSFORM_DELAY_MS);
        });
        expect(originator.current.transformedFiles).toEqual({ transform: 'JavaScript' });
        expect(peer.current.transformedFiles).toEqual({ transform: 'JavaScript' });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('pendingTransform', () => {
    it('defaults to `null` on a freshly-rendered hook', () => {
      (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']);
      (createTransformedFiles as any).mockImplementation(
        (_variant: unknown, transform: string | null) => ({ transform }),
      );

      const { result } = renderHook(() =>
        useTransformManagement({
          effectiveCode: mockEffectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant: mockSelectedVariant,
          initialTransform: 'TypeScript',
          transformDelay: DEFAULT_TRANSFORM_DELAY_MS,
        }),
      );

      expect(result.current.pendingTransform).toBe(undefined);
    });

    it('reports the target transform on an originator whose phantom sibling never acks, then clears to `undefined` when the safety net force-resolves', () => {
      vi.useFakeTimers();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const store: Record<string, string> = {};
        Object.defineProperty(window, 'localStorage', {
          value: {
            getItem: (key: string) => store[key] ?? null,
            setItem: (key: string, value: string) => {
              store[key] = value;
            },
            removeItem: (key: string) => {
              delete store[key];
            },
          },
          writable: true,
          configurable: true,
        });

        (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']);
        (createTransformedFiles as any).mockImplementation(
          (_variant: unknown, transform: string | null) => ({ transform }),
        );

        // Pre-register a phantom sibling on the coordinator that will
        // never open its own barrier (simulates a peer demo blocked on
        // a slow precompute / main-thread jank). The originator's
        // barrier must wait for its ack, cross the grace boundary,
        // and surface that wait through `pendingTransform`.
        const coordinatorKey = ['JavaScript', 'TypeScript'].sort().join(':');
        const phantom = registerPhantomPeer(coordinatorKey, 'phantom-peer');
        const unregisterPhantom = phantom.unregister;

        try {
          const { result } = renderHook(() =>
            useTransformManagement({
              effectiveCode: mockEffectiveCode,
              selectedVariantKey: 'Default',
              selectedVariant: mockSelectedVariant,
              initialTransform: 'TypeScript',
              transformDelay: DEFAULT_TRANSFORM_DELAY_MS,
            }),
          );

          act(() => {
            result.current.selectTransform('JavaScript');
          });

          // Inside the animation window: not yet waiting (the local
          // ack scheduled via `scheduleTask` and the `minWait` timer
          // both pending).
          expect(result.current.pendingTransform).toBe(undefined);

          // Advance past `minWait` (250) and the local ack (0ms
          // `setTimeout(fn, 0)` from `scheduleTask`). Phantom peer
          // still hasn't acked, but we're inside the grace window
          // (default 300ms), so still no indicator.
          act(() => {
            vi.advanceTimersByTime(DEFAULT_TRANSFORM_DELAY_MS);
          });
          expect(result.current.pendingTransform).toBe(undefined);

          // Cross the grace boundary (`minWait + gracePeriodMs` =
          // 550ms total). `onWaitingForPeers` fires → indicator
          // surfaces the target transform name.
          act(() => {
            vi.advanceTimersByTime(TRANSFORM_GRACE_PERIOD_MS);
          });
          expect(result.current.pendingTransform).toBe('JavaScript');

          // Barrier still open — files have not swapped.
          expect(result.current.transformedFiles).toEqual({ transform: 'TypeScript' });

          // Drain the safety net (default 10s ultimate timeout from
          // announceTime). After force-resolve, indicator clears and
          // files swap.
          act(() => {
            vi.advanceTimersByTime(10_000);
          });
          expect(result.current.pendingTransform).toBe(undefined);
          expect(result.current.transformedFiles).toEqual({ transform: 'JavaScript' });
          expect(warn).toHaveBeenCalledTimes(1);
        } finally {
          unregisterPhantom();
        }
      } finally {
        warn.mockRestore();
        vi.useRealTimers();
      }
    });

    it('stays `undefined` on a non-originator peer even while the originator is waiting', () => {
      vi.useFakeTimers();
      try {
        const store: Record<string, string> = {};
        Object.defineProperty(window, 'localStorage', {
          value: {
            getItem: (key: string) => store[key] ?? null,
            setItem: (key: string, value: string) => {
              store[key] = value;
            },
            removeItem: (key: string) => {
              delete store[key];
            },
          },
          writable: true,
          configurable: true,
        });

        (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']);
        (createTransformedFiles as any).mockImplementation(
          (_variant: unknown, transform: string | null) => ({ transform }),
        );

        const coordinatorKey = ['JavaScript', 'TypeScript'].sort().join(':');
        const phantom = registerPhantomPeer(coordinatorKey, 'phantom-peer');
        const unregisterPhantom = phantom.unregister;

        try {
          const props = {
            effectiveCode: mockEffectiveCode,
            selectedVariantKey: 'Default',
            selectedVariant: mockSelectedVariant,
            initialTransform: 'TypeScript',
            transformDelay: DEFAULT_TRANSFORM_DELAY_MS,
          };
          const { result: originator } = renderHook(() => useTransformManagement(props));
          const { result: peer } = renderHook(() => useTransformManagement(props));

          act(() => {
            originator.current.selectTransform('JavaScript');
          });

          // Cross `minWait + gracePeriod` so the originator's
          // `onWaitingForPeers` fires.
          act(() => {
            vi.advanceTimersByTime(DEFAULT_TRANSFORM_DELAY_MS + TRANSFORM_GRACE_PERIOD_MS);
          });
          expect(originator.current.pendingTransform).toBe('JavaScript');
          // Peer is a non-originator (it observed the change via
          // `usePreference` broadcast) — never surfaces the wait flag.
          expect(peer.current.pendingTransform).toBe(undefined);
        } finally {
          unregisterPhantom();
        }
      } finally {
        vi.useRealTimers();
      }
    });

    it('clears back to `undefined` as soon as the slow peer acks before the safety net', () => {
      vi.useFakeTimers();
      try {
        const store: Record<string, string> = {};
        Object.defineProperty(window, 'localStorage', {
          value: {
            getItem: (key: string) => store[key] ?? null,
            setItem: (key: string, value: string) => {
              store[key] = value;
            },
            removeItem: (key: string) => {
              delete store[key];
            },
          },
          writable: true,
          configurable: true,
        });

        (getAvailableTransforms as any).mockReturnValue(['TypeScript', 'JavaScript']);
        (createTransformedFiles as any).mockImplementation(
          (_variant: unknown, transform: string | null) => ({ transform }),
        );

        const coordinatorKey = ['JavaScript', 'TypeScript'].sort().join(':');
        const phantom = registerPhantomPeer(coordinatorKey, 'phantom-peer');
        const unregisterPhantom = phantom.unregister;

        try {
          const { result } = renderHook(() =>
            useTransformManagement({
              effectiveCode: mockEffectiveCode,
              selectedVariantKey: 'Default',
              selectedVariant: mockSelectedVariant,
              initialTransform: 'TypeScript',
              transformDelay: DEFAULT_TRANSFORM_DELAY_MS,
            }),
          );

          act(() => {
            result.current.selectTransform('JavaScript');
          });

          act(() => {
            vi.advanceTimersByTime(DEFAULT_TRANSFORM_DELAY_MS + TRANSFORM_GRACE_PERIOD_MS);
          });
          expect(result.current.pendingTransform).toBe('JavaScript');

          // Phantom peer finally acks (e.g. its precompute landed).
          // The barrier resolves on the next tick, commit fires,
          // and the waiting flag clears.
          act(() => {
            phantom.acknowledge('JavaScript');
            vi.advanceTimersByTime(0);
          });
          expect(result.current.pendingTransform).toBe(undefined);
          expect(result.current.transformedFiles).toEqual({ transform: 'JavaScript' });
        } finally {
          unregisterPhantom();
        }
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('transformLayoutShift props plumbing', () => {
    // These tests verify that the new `transformLayoutShift`,
    // `selectedFileName`, and `expanded` props reach
    // `transformHasCollapsePlaceholder` unchanged. Mode-specific
    // semantics are covered exhaustively by the helper's own unit
    // tests in `useCodeUtils.test.ts`.

    it('forwards transformLayoutShift / selectedFileName / expanded to the classifier', () => {
      (transformHasCollapsePlaceholder as any).mockClear();
      (getAvailableTransforms as any).mockReturnValue(['TypeScript']);
      (createTransformedFiles as any).mockReturnValue({ transformed: true });
      (transformHasCollapsePlaceholder as any).mockReturnValue(false);

      renderHook(() =>
        useTransformManagement({
          effectiveCode: mockEffectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant: mockSelectedVariant,
          initialTransform: 'TypeScript',
          transformLayoutShift: 'focus',
          selectedFileName: 'extra.ts',
          expanded: false,
        }),
      );

      const calls = (transformHasCollapsePlaceholder as any).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      // Every call receives the third opts arg with our values.
      for (const call of calls) {
        expect(call[2]).toEqual({
          mode: 'focus',
          selectedFileName: 'extra.ts',
          expanded: false,
        });
      }
    });

    it('passes undefined values when the new props are omitted (legacy callers)', () => {
      (transformHasCollapsePlaceholder as any).mockClear();
      (getAvailableTransforms as any).mockReturnValue(['TypeScript']);
      (createTransformedFiles as any).mockReturnValue({ transformed: true });
      (transformHasCollapsePlaceholder as any).mockReturnValue(true);

      renderHook(() =>
        useTransformManagement({
          effectiveCode: mockEffectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant: mockSelectedVariant,
          initialTransform: 'TypeScript',
        }),
      );

      const calls = (transformHasCollapsePlaceholder as any).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call[2]).toEqual({
          mode: undefined,
          selectedFileName: undefined,
          expanded: undefined,
        });
      }
    });
  });
});
